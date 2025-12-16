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
4. **Database (Postgres + pgvector)** – stores users, conversations, messages, bespoke memory ingestions/chunks, Gmail tokens, threads, and tasks. Schema lives in `db/schema.sql`.

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
5. Set `UPSTASH_REDIS_URL` (or `REDIS_URL`) so the gateway can persist sessions. For Upstash, copy the rediss URL/token and set `UPSTASH_REDIS_TOKEN`. In production, also set `USER_COOKIE_SECURE=true` and `USER_COOKIE_SAMESITE=strict`.
6. Generate a 32-byte hex `GMAIL_TOKEN_ENC_KEY` (e.g., `openssl rand -hex 32`). The gateway encrypts all Gmail refresh/access tokens with AES-256-GCM, so this key must stay secret. Optionally set `GMAIL_TOKEN_KEY_ID` for rotations.
7. Set `INTERNAL_API_KEY` (gateway) and `GATEWAY_INTERNAL_SECRET` (brain) so internal service-to-service calls can specify `user_id` without cookies.
6. Ensure `NEXT_PUBLIC_GATEWAY_URL` points to the gateway root (e.g. `http://localhost:4000`). The frontend will automatically append `/api/...`, so do not include `/api` in the env var.
8. Start services (in separate terminals):
   - Brain: `cd brain && poetry run uvicorn src.main:app --reload --port 8000`
   - Gateway: `cd gateway && npm run dev`
   - Frontend: `cd frontend && npm run dev`

Visit http://localhost:3000, send a chat message, and the UI will proxy through the gateway to the brain’s stubbed agent. Supabase-hosted databases work the same way; set `DATABASE_SSL=true` so the gateway pg client negotiates TLS.

## Architecture & Components
- **Frontend (Next.js/React)** – chat surface, sidebar, bespoke memory modal. Uses `SessionProvider` to hydrate Gmail/profile status and renders Markdown+math via `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`.
- **Gateway (Node/Express + Postgres + Redis)** – OAuth, Gmail proxy, bespoke upload pipeline, session management (Redis via Upstash), and REST APIs for the frontend and the brain.
- **Brain (FastAPI + LangChain)** – orchestrates the chat agent, Tavily web search, bespoke FAISS retrieval, Gmail tools, and profile updates.
- **Database (Postgres/Supabase w/ pgvector)** – stores users, sessions, Gmail metadata/embeddings/bodies, bespoke memory ingestions/chunks, tasks, and profile data.

## Feature Highlights

### Bespoke Memory
- Drag-and-drop Markdown uploads; `multer` stores files under `tmp/memory_uploads`.
- Gateway chunks files, inserts metadata into `memory_chunks`, and triggers `/memory/index` so the brain embeds pending chunks and maintains per-user FAISS indices.
- History view shows batch names & progress; per-ingestion delete plus “Clear All” reset stale data and rebuild FAISS.
- `/api/memory` endpoints expose status, history, graph slices, and ingestion controls.

### Gmail Integration
- Full OAuth 2.0 flow (`/api/gmail/connect`/`/callback`) with encrypted refresh/access tokens.
- Initial sync fetches up to one year of threads (`fetchRecentThreads`), stores summaries in `gmail_threads`, and embeddings in `gmail_thread_embeddings`.
- `/api/gmail/threads` defaults to a 48h window (override via `?hours=`) and returns meta counts (total/important/promotions).
- Semantic search (`/api/gmail/threads/search`) returns structured results; `/api/gmail/threads/:threadId` fetches cached bodies.
- Brain merges Gmail snippets with bespoke memories via reciprocal-rank fusion and can fetch full threads on demand.
- URL auto-context: Tavily pulls summaries when a chat message includes URLs; results appear in the assistant’s `sources`.

## Key Tables & API Surface
- `memory_ingestions`, `memory_chunks`, `memory_thread_bodies`, `gmail_threads`, `gmail_thread_embeddings`, `gmail_tokens`, `tasks`, `user_profiles`.
- Gateway routes:
  - `/api/memory/upload`, `/status`, `/history`, `/graph`, `/clear`.
  - `/api/gmail/threads`, `/threads/search`, `/threads/:id`, `/status`, `/disconnect`, `/threads/full-sync`.
  - `/api/profile` (GET/POST), `/api/profile/logout`, `/api/profile/account` (delete).
  - `/api/chat` proxies to the brain.

## Brain Tooling
- `memory_lookup`: bespoke FAISS + Gmail fallback.
- `gmail_inbox`: recency summaries when users ask “what’s new”.
- `gmail_semantic_search`: topic-based Gmail retrieval.
- `gmail_thread_detail`: bodies cached in gateway.
- `web_search`: Tavily general search with URL source summaries.
- `profile_update`: structured profile patching (field/value or free-form note).

## Operational Notes
- Memory indexing runs inside `/memory/index` using AsyncPG + OpenAI embeddings; FAISS cache invalidation ensures deletions rebuild indexes.
- Gateway infers bespoke batch names from folder paths, normalizes profile notes via shared helpers, and logs initial Gmail sync counts.
- Supabase/Postgres schema lives in `db/schema.sql`; any ad‑hoc migrations go into `db/migrations/`.
- Sessions default to 7 days, backed by Redis (Upstash). Cookies are httpOnly and honor `USER_COOKIE_*` env overrides.
- Gmail tokens are AES‑256‑GCM encrypted at rest (`GMAIL_TOKEN_ENC_KEY`), and any `invalid_grant` responses delete tokens automatically.

## Future Enhancements
- Graph visualization refinements once the underlying graph APIs stabilize.
- Tagging/filtering for bespoke uploads and citation surfacing inside chat responses.
- Sidebar indicators for bespoke ingestion progress (upload, indexing, graph).
- Hybrid graph-based UI/workflows once the V2 data infra ships.

## Gmail Integration Notes
- Uses OAuth 2.0 with read-only Gmail scope (`https://www.googleapis.com/auth/gmail.readonly`).
- Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`.
- Refresh/access tokens are stored encrypted (AES-256-GCM) in `gmail_tokens`; set `GMAIL_TOKEN_ENC_KEY` to keep them safe.
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
