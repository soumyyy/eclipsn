# Eclipsn

Eclipsn is a personal agent inspired by Bind.ai and Poke that focuses on a single user’s knowledge graph, Gmail, and long-term memory. It offers a chat-first experience with a clear gateway and brain split so each layer can evolve independently.

## Phase 1 Features
- Chat with Eclipsn via the web UI.
- Persist long-term memories from chats or Gmail-derived knowledge.
- Connect Gmail (OAuth 2.0, read-only) to ingest mail for summaries and task extraction.
- Summarize Gmail threads and extract actionable tasks.

## Architecture Overview
1. **Frontend (Next.js App Router)** – chat UI, sidebar, and simple stateful experience. Talks to the gateway only.
2. **Gateway (Node.js + Express)** – REST endpoints, Gmail OAuth handler, proxy to the Python brain, and optional GraphQL facade.
3. **Brain (FastAPI + LangChain)** – orchestrates LLM calls, tools, and memory search. Stubs included for LangChain tools and pg-backed memory store.
4. **Database (Postgres + pgvector)** – stores users, conversations, messages, memories, Gmail tokens, threads, and tasks. Schema lives in `db/schema.sql`.

### Request Flow
Browser → Gateway (`/api/chat`) → Brain (`/chat`) → tools (memory + Gmail stubs) → Brain response → Gateway → Browser UI.

## Getting Started
### Prerequisites
- Node.js 18+
- Python 3.11+
- Postgres 15+ with `pgvector` extension
- Docker (optional but recommended for Postgres)

### Setup Steps
1. Clone this repo.
2. Copy `.env.example` to `.env` and fill the variables for your environment and OAuth credentials.
3. Install dependencies:
   - `cd frontend && npm install`
   - `cd gateway && npm install`
   - `cd brain && poetry install` (or `pip install -r requirements.txt` if you export later)
4. Provision a database:
   - **Local**: `docker-compose up -d postgres` and apply the schema with `psql $DATABASE_URL -f db/schema.sql`.
   - **Supabase**: create a project, enable the `pgvector` extension, and run `db/supabase-init.sql` from the Supabase SQL editor. Copy the connection string (ensure it ends with `?sslmode=require`) into `DATABASE_URL`.
5. Start services (in separate terminals):
   - Brain: `cd brain && poetry run uvicorn src.main:app --reload --port 8000`
   - Gateway: `cd gateway && npm run dev`
   - Frontend: `cd frontend && npm run dev`

Visit http://localhost:3000, send a chat message, and the UI will proxy through the gateway to the brain’s stubbed agent. Supabase-hosted databases work the same way; set `DATABASE_SSL=true` so the gateway pg client negotiates TLS.

## Gmail Integration Notes
- Uses OAuth 2.0 with read-only Gmail scope (`https://www.googleapis.com/auth/gmail.readonly`).
- Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`.
- Tokens are stored in `gmail_tokens` table (currently in plaintext; future work will encrypt them).
- After connecting Gmail (`GET /api/gmail/connect`), call `GET /api/gmail/threads?limit=5` to sync the latest threads into Postgres and return summaries to the UI/brain layer.
- Set `GATEWAY_INTERNAL_URL` so the Python brain can call the gateway when it needs Gmail context during a chat.
- The gateway now runs background jobs: an incremental sync every 10 minutes (`newer_than:10m` filter) and a midnight cleanup that deletes expired Gmail summaries.

## User Profile Notes
- Each user now has a profile row (`user_profiles`) that stores preferred name, contact info, timezone, company/role, and arbitrary `custom_data` for facts Eclipsn learns.
- Use `GET/POST /api/profile` from the gateway to display or update profile data in the UI.
- The brain exposes a `profile_update` tool; Eclipsn calls it automatically when the user shares new personal information, so the agent can remember preferences naturally.

## Web Search Notes
- Eclipsn uses Tavily for web intelligence. Set `TAVILY_API_KEY` in `.env` to enable it.
- When enabled, the brain service will call Tavily for complex/unknown questions, share which sources were queried, and summarize the findings inside the chat response.

## Security Notes
- Keep secrets in environment variables, not in code. When using Supabase, store the full connection string (with password) only in `.env`.
- Gmail tokens and other sensitive data should be encrypted/restricted; placeholder TODO comments mark where that enforcement is planned.
- Sessions and cookies should use `SESSION_SECRET` and HTTPS in production. If Supabase requires certificate pinning, configure `NODE_EXTRA_CA_CERTS` before running the gateway.

## Future Roadmap
- Task management dashboards across Gmail + chat sources.
- Calendar integration for proactive scheduling.
- Multi-agent workflows with proactive alerts and summaries.
