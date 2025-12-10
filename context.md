# Pluto Workspace Context

This document captures the current state of the project, major features implemented so far, and the key architectural decisions. It serves as a quick reference when planning new work (e.g., the graph-based RAG visualization).

## 1. High-Level Architecture
- **Gateway (Node/Express + PostgreSQL):** handles OAuth flows, Gmail/Outlook proxies, bespoke memory uploads, and coordination with the brain service.
- **Brain (FastAPI/LangChain):** orchestrates the chat agent, retrieval (bespoke FAISS, Gmail semantic search, Tavily URL context), and tool calls (Gmail detail, profile_update, etc.).
- **Frontend (Next.js/React):** hosts the chat UI, bespoke memory modal, and sidebar connections.

## 2. Major Features Delivered

### Bespoke Memory
- Upload `.md` files/folders via the modal (drag/drop + inline confirmation).
- Chunking/embedding pipeline in gateway & brain:
  - `memory_chunks` table records each chunk, `memory_chunk_embeddings` stores vectors.
  - Brain indexer embeds pending chunks and maintains per-user FAISS indexes.
- Auto-triggered indexing: gateway calls `/memory/index` so uploads become searchable immediately.
- Clear/delete flows:
  - History list (showing folder `batch_name`) supports per-ingestion delete.
  - “Clear All” button inside the modal deletes all ingestions and rebuilds FAISS, resolving any leakage from stale indexes.

### Gmail Integration
- OAuth + token refresh (Gmail).
- Thread ingestion (`fetchRecentThreads`) + embedding storage (`gmail_thread_embeddings`).
- Semantic search endpoint returns structured JSON (subject, snippet, sender, link, timestamp).
- Brain merges Gmail snippets with bespoke memories via Reciprocal Rank Fusion (`search_memories_tool`).
- Full-thread detail:
  - Gateway caches bodies in `gmail_thread_bodies`.
  - Agent tool `gmail_thread_detail` fetches full content on demand (handles HTML/plain text extraction).

### URL Auto-Fetch
- Messages with URLs trigger automatic Tavily extraction.
- Agent input is augmented with “URL Context” blocks.
- URLs appear in the response `sources`, giving users the page references.

## 3. Key Tables / Endpoints (Gateway)
- `memory_ingestions`: tracks uploads (`chunked_files`, `indexed_chunks`, `batch_name`, progress statuses).
- `memory_chunks`, `memory_chunk_embeddings`: chunk storage + vectors.
- `gmail_threads`, `gmail_thread_embeddings`, `gmail_thread_bodies`: Gmail metadata, vectors, and cached bodies.
- Endpoints:
  - `/api/memory/upload`, `/api/memory/status`, `/api/memory/history`, `/api/memory/:id`, `DELETE /api/memory` (clear all).
  - `/api/gmail/threads`, `/api/gmail/threads/search`, `/api/gmail/threads/:threadId` (full body).

## 4. Agent Tools (Brain)
- `memory_lookup`: bespoke FAISS (plus Gmail RRF fallback).
- `web_search`: Tavily general search.
- `gmail_inbox`: simple inbox summary.
- `gmail_semantic_search`: Gmail semantic hits (structured JSON).
- `gmail_thread_detail`: fetch full Gmail content.
- `profile_update`: structured profile updates.
- URL auto-context (pre-processing step, not a tool) uses Tavily extract.

## 5. Operational Notes
- Indexer runs asynchronously inside `/memory/index` (AsyncPG + OpenAI embeddings). Cache invalidation ensures FAISS files are rebuilt cleanly after deletes.
- Gateway uses `multer` for uploads, merges custom data, and now infers `batch_name` from the folder path.
- Tavily extracts and general search share the same API key (`TAVILY_API_KEY`).
- Supabase/Postgres schema changes tracked via `db/schema.sql` and individual migrations in `db/migrations/`.

## 6. Next Steps Candidates
- Outlook ingestion parity (Graph fetcher, embeddings, full-body cache).
- Graph visualization plan (documented in `outlook-plan.md` but pending implementation).
- Tagging/filtering for bespoke uploads and RRF citations.
- Sidebar status indicators for memory upload/index progress.
- Graph-based UI (per new spec) once data infra is ready.

This context should be updated whenever we add major features or schema changes to keep onboarding fast and planning aligned.
