# VPS Deployment Plan

This guide outlines how to containerize Pluto’s services and run them on a single low-cost VPS (e.g., Hetzner CX21, DO $8 droplet, etc.). The stack will live behind an Nginx/Caddy reverse proxy with Docker Compose orchestrating all containers.

---

## 1. Repository Preparation

1. **Secrets & env layout**
   - Keep your local `.env` for dev. Create a production variant (`.env.vps`) that includes **only** the variables each service needs. Example split:
     - `frontend/.env.production` – `NEXT_PUBLIC_*`, analytics, etc.
     - `gateway/.env.production` – `DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_*`, `BRAIN_SERVICE_URL`, `TAVILY_API_KEY`.
     - `brain/.env.production` – `DATABASE_URL`, `OPENAI_API_KEY`, `GATEWAY_INTERNAL_URL`, Tavily, etc.
   - Store OAuth secrets and DB URLs in your password manager. Never bake secrets into images.

2. **Dockerfiles**
   - **Frontend (`frontend/Dockerfile`)**
     ```dockerfile
     FROM node:18-alpine AS builder
     WORKDIR /app
     COPY package*.json ./
     RUN npm ci
     COPY . .
     RUN npm run build

     FROM node:18-alpine as runner
     WORKDIR /app
     ENV NODE_ENV=production
     COPY --from=builder /app ./
     EXPOSE 3000
     CMD ["npm", "run", "start"]
     ```
     *Outputs a production Next.js server listening on port 3000.*

   - **Gateway (`gateway/Dockerfile`)**
     ```dockerfile
     FROM node:18-alpine
     WORKDIR /app
     COPY package*.json ./
     RUN npm ci
     COPY . .
     RUN npm run build
     EXPOSE 4000
     CMD ["node", "dist/index.js"]
     ```

   - **Brain (`brain/Dockerfile`)**
     ```dockerfile
     FROM python:3.11-slim
     WORKDIR /app
     ENV PIP_NO_CACHE_DIR=1
     COPY pyproject.toml poetry.lock ./
     RUN pip install --upgrade pip && pip install poetry && poetry config virtualenvs.create false && poetry install --only main
     COPY src ./src
     EXPOSE 8000
     CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
     ```
     Alternatively export requirements via `poetry export` if you prefer `pip`.

3. **Compose file (`docker-compose.vps.yml`)**
   ```yaml
   version: "3.9"
   networks:
     pluto-net:
       driver: bridge

   services:
     postgres:
       image: postgres:15
       restart: unless-stopped
       env_file: ./infrastructure/env/postgres.env
       volumes:
         - postgres_data:/var/lib/postgresql/data
       networks: [pluto-net]

     gateway:
       build: ./gateway
       env_file: ./gateway/.env.production
       depends_on: [postgres, brain]
       networks: [pluto-net]

     brain:
       build: ./brain
       env_file: ./brain/.env.production
       depends_on: [postgres]
       networks: [pluto-net]

     frontend:
       build: ./frontend
       env_file: ./frontend/.env.production
       depends_on: [gateway]
       networks: [pluto-net]

     proxy:
       image: caddy:2
       restart: unless-stopped
       ports:
         - "80:80"
         - "443:443"
       volumes:
         - ./infrastructure/Caddyfile:/etc/caddy/Caddyfile
         - caddy_data:/data
         - caddy_config:/config
       depends_on: [frontend, gateway]
       networks: [pluto-net]

   volumes:
     postgres_data:
     caddy_data:
     caddy_config:
   ```

   - `Caddyfile` example:
     ```
     pluto.example.com {
       reverse_proxy frontend:3000
     }

     api.pluto.example.com {
       reverse_proxy gateway:4000
     }

     brain.pluto.example.com {
       reverse_proxy brain:8000
     }
     ```
     Swap in Nginx if you prefer manual TLS configuration.

4. **Infra directory**
   - `infrastructure/env/postgres.env` storing DB user/password/db.
   - Scripts for backups, migrations, etc.

---

## 2. VPS Provisioning

1. **Create VPS**
   - Choose provider (Hetzner CX21 / DO Basic). Minimum spec: 2 vCPU, 4 GB RAM, 80 GB SSD.
   - Configure SSH keys, disable password auth.

2. **Base packages**
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y git ufw fail2ban
   ```

3. **Docker & Compose**
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER
   sudo systemctl enable docker
   sudo apt install -y docker-compose-plugin
   ```

4. **Firewall**
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 80
   sudo ufw allow 443
   sudo ufw enable
   ```

---

## 3. Deployment Workflow

1. **Clone repo**
   ```bash
   git clone https://github.com/you/pluto.git
   cd pluto
   ```

2. **Copy prod env files**
   ```bash
   scp frontend/.env.production vps:~/pluto/frontend/.env.production
   scp gateway/.env.production vps:~/pluto/gateway/.env.production
   scp brain/.env.production vps:~/pluto/brain/.env.production
   scp infrastructure/env/postgres.env vps:~/pluto/infrastructure/env/postgres.env
   ```

3. **Build & run**
   ```bash
   docker compose -f docker-compose.vps.yml pull  # if using remote registry
   docker compose -f docker-compose.vps.yml build
   docker compose -f docker-compose.vps.yml up -d
   ```

4. **Database migration**
   - From host:
     ```bash
     docker compose exec postgres psql -U pluto -d pluto -f /app/db/schema.sql
     ```
     (Mount schema file or run from local machine using `psql $DATABASE_URL -f db/schema.sql`.)

5. **Logs & monitoring**
   ```bash
   docker compose logs -f gateway
   docker compose logs -f brain
   ```
   - Optionally add `promtail` + Grafana/Prometheus stack or use a lightweight alternative (Vector/Dozzle).

6. **TLS & domains**
   - Point DNS `A` records (`pluto.example.com`, `api.pluto.example.com`, `brain.pluto.example.com`) to the VPS IP.
   - Caddy auto-issues Let’s Encrypt certs. For Nginx, use Certbot.

---

## 4. Local Build & Push (Optional)

If you prefer building images locally and pushing to a registry:

```bash
docker build -t ghcr.io/you/pluto-frontend:latest frontend
docker push ghcr.io/you/pluto-frontend:latest
# repeat for gateway/brain
```

Then adjust `docker-compose.vps.yml` service definitions to `image: ghcr.io/you/...` and run `docker compose pull && up -d`.

---

## 5. Backup & Maintenance

- **Postgres**: schedule nightly `pg_dump` via cron (host or container) and push dumps to object storage (S3/Spaces).
- **Watchtower**: optional container to auto-pull updates.
- **System updates**: periodically `sudo apt update && sudo apt upgrade`, `docker system prune`.
- **Secrets rotation**: update OAuth/Tavily tokens and restart relevant containers.

---

## 6. Checklist Before Production

- [ ] All env files set with production secrets.
- [ ] Gmail OAuth redirect URI matches `https://api.pluto.example.com/api/gmail/callback`.
- [ ] TLS certificates verified (no mixed content).
- [ ] Database schema applied; migrations run.
- [ ] Backups tested.
- [ ] Monitoring alerts configured (90% disk, high CPU, container restarts).

This plan keeps costs low (single VPS) while isolating each service in its own container, secured behind a reverse proxy with automatic TLS. When traffic grows, you can lift the same images into a managed Kubernetes or multi-node setup without rewriting build steps.
