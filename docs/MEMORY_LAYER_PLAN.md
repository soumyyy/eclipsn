# Memory Layer: Current Structure, Restructure & Plan

## 1. Current structure (as-is)

### 1.1 Database (schema today)

| Table | Purpose |
|-------|--------|
| `users` | Auth identity (id, email). |
| `user_profiles` | Profile + flexible `document` JSONB. No dedicated “memory” rows. |
| `conversations`, `messages` | Chat; brain does **not** persist messages (stub). |
| `gmail_tokens` | Gmail OAuth. |
| `gmail_threads` | Synced **inbox** threads (subject, summary, sender, etc.). **Sent mail is not synced** (buildQuery uses `category:primary OR label:important` only). |
| `gmail_thread_embeddings` | One embedding per thread (user_id, thread_id, embedding vector 1536). Used for semantic search. |
| `gmail_thread_bodies` | Full body text per thread. |
| `tasks` | Extracted tasks (source, description, thread_id, etc.). |
| `memory_ingestions` | Bespoke upload batches (source, status, chunked_files, etc.). |
| `memory_chunks` | Bespoke markdown chunks (content, **embedding** vector 1536, file_path, ingestion_id). Brain indexes these and also builds a **FAISS** index per user for search. |
| `feed_cards` | Used by brain feed_engine; **not** in `schema.sql` / `supabase-init.sql` (must exist in your DB or be added). |

There is **no** table for:
- User-level “memory” facts (what the user asked to remember, or high-signal extracted facts).
- Storing or querying memories by user with semantic search and “forget this” by id.

### 1.2 Recall today

- **Brain** `search_memories_tool`:
  1. **Bespoke**: `search_bespoke_memory(user_id, query, k)` → FAISS index (built from `memory_chunks` per user) + metadata file; returns snippets (content, file_path, source).
  2. **Gmail**: `_gmail_semantic_results` → gateway `POST /api/gmail/threads/search` (embed query, search `gmail_thread_embeddings`), returns thread summaries as “memories”.
  3. **Fallback**: `db.search_memories(query, user_id)` → **stub** in brain `models/db.py` (returns `[]`).
- Results are RRF-merged and returned as a list of “memories” (id, content, source). There is **no** unified store you can “forget” by id; no confidence; no single “what do you remember?” table.

### 1.3 Gmail

- **Sync**: `buildQuery` = date range + `category:primary OR label:important` → **inbox, primary/important only**. Sent mail is **not** included.
- **Semantic search**: Over `gmail_thread_embeddings` (inbox threads only).

### 1.4 Bespoke (Index)

- **Gateway**: Upload → `memory_ingestions` + `memory_chunks` (content only); triggers brain to index.
- **Brain**: Reads chunks (with `embedding IS NULL`), embeds, writes embeddings into `memory_chunks`, builds FAISS + `meta.json` per user. Recall = FAISS search.

### 1.5 Chat

- Gateway `POST /chat` → brain `sendChat`; brain chat agent has tools (memory_lookup, gmail_*, etc.). Conversation history is passed in the request; **no** persistence to `messages` in brain (stub).

---

## 2. Additions and restructure

### 2.1 Database changes

**Add:**

1. **`user_memories`** (unified memory store for recall + “forget this”):
   - `id` UUID PRIMARY KEY
   - `user_id` UUID NOT NULL REFERENCES users(id)
   - `content` TEXT NOT NULL
   - `source_type` TEXT NOT NULL — e.g. `'gmail'`, `'bespoke'`, `'chat'`, `'extraction'`
   - `source_id` TEXT — e.g. thread_id, chunk_id, message_id, so we can “forget” by source
   - `scope` TEXT — optional, e.g. `'fact'`, `'preference'`, `'note'`
   - `confidence` REAL — 0.0–1.0 for future “only save when useful”
   - `embedding` VECTOR(1536) — for semantic recall
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `deleted_at` TIMESTAMPTZ — soft delete for “forget this”
   - Indexes: `(user_id, deleted_at)`, vector index on `(embedding)` for ANN search (e.g. ivfflat or hnsw).

2. **`feed_cards`** (if missing):
   - Add to `schema.sql` / `supabase-init.sql` so feed_engine has a defined schema (you already use it in brain).

**Keep as-is (for now):**

- `gmail_threads`, `gmail_thread_embeddings`, `gmail_thread_bodies` — continue to drive Gmail semantic search and future extraction.
- `memory_ingestions`, `memory_chunks` — continue to drive bespoke uploads and FAISS; later we can **also** derive high-signal rows into `user_memories` (Phase 4).

**Restructure (conceptually):**

- **Recall**: Add a single path that queries `user_memories` (semantic + `deleted_at IS NULL`) and, in the same tool, can optionally **fuse** with existing bespoke FAISS + Gmail semantic so “what do you remember?” feels like one place.
- **Delete**: “Forget this” = set `deleted_at` (or hard delete) on one or more `user_memories` rows by id or by source_id / filter.

### 2.2 Service/API changes (high level)

- **Brain**:
  - **DB layer**: Implement `user_memories` — insert, search by embedding (ANN), list by user, soft-delete by id or filter.
  - **Recall**: New or refactored `memory_recall` tool that (1) queries `user_memories`, (2) optionally fuses with `search_bespoke_memory` + `_gmail_semantic_results`, (3) returns unified list with source refs (so UI can show “From email / note” and “Forget this” with an id).
- **Gateway** (optional for Phase 1): Expose `GET /api/memories?q=...` and `DELETE /api/memories/:id` so the app can show “what I remember” and “forget this” without going through chat. If you want “memory store + recall” to be chat-only first, you can skip gateway memory routes in Phase 1.

### 2.3 What stays the same for Phase 1

- Gmail sync and semantic search (inbox-only) — no sent yet.
- Bespoke upload → `memory_ingestions` / `memory_chunks` → brain FAISS.
- Chat agent and existing tools; we add or rewire **memory_recall** (and later **memory_forget**) to use `user_memories`.

---

## 3. Updated order and exact plan

### Phase 1: Memory store + recall (current focus)

**Goal:** One place to “remember” and “what do you remember?” with semantic search and source refs; optional fuse with existing Gmail + bespoke.

1. **DB**
   - Add migration: create `user_memories` (columns above).
   - Add vector index on `embedding` (e.g. hnsw or ivfflat) for fast ANN.
   - Add `feed_cards` to schema if not present.

2. **Brain – persistence**
   - Implement in brain (e.g. `models/db.py` or a new `services/user_memory_store.py`):
     - `insert_user_memory(user_id, content, source_type, source_id, scope, confidence, embedding)`
     - `search_user_memories(user_id, query_embedding, limit, deleted_at IS NULL)`
     - `list_user_memories(user_id, limit, offset)` (optional, for “list what you remember”).
     - `delete_user_memory(id, user_id)` (soft: set `deleted_at`) or `delete_user_memories_by_filter(user_id, source_type, source_id)`.

3. **Brain – recall**
   - **Option A**: New tool `memory_recall(query)` that:
     - Embeds `query`, searches `user_memories`, returns list `{ id, content, source_type, source_id }`.
     - Optionally fuses with existing `search_bespoke_memory` + `_gmail_semantic_results` (RRF or append), so “what do you remember?” still includes Gmail + bespoke even before we backfill `user_memories`.
   - **Option B**: Refactor `search_memories_tool` to (1) query `user_memories` first, (2) merge with bespoke + Gmail, same return shape plus `id` for each memory so “forget this” can target an id.
   - **Recommendation:** Option B — single “memory lookup” tool that uses `user_memories` + bespoke + Gmail, and returns stable `id` where available (for `user_memories` rows; bespoke/Gmail can use composite id like `gmail:threadId`).

4. **Seeding `user_memories` (Phase 1)**
   - So “what do you remember?” returns something useful from day one:
     - **Option 1**: Backfill from existing sources: e.g. run a one-off that (1) takes recent Gmail thread summaries (from gateway) and bespoke chunk summaries (from `memory_chunks`), (2) inserts into `user_memories` with `source_type` / `source_id`, (3) optional confidence = 1.0 for now.
     - **Option 2**: No backfill; only new writes (e.g. “remember this” from chat) go into `user_memories`; recall still fuses with Gmail + bespoke so answers are good, and `user_memories` grows over time.
   - **Recommendation:** Option 2 for Phase 1 (simplest); add backfill in Phase 4 when extraction + confidence exist.

5. **Chat agent**
   - Ensure the agent has one “memory” tool that:
     - On “what do you remember?” / “what do you know about X?” → calls recall (user_memories + fused Gmail + bespoke), then answers in natural language and can cite sources (and, when we add Phase 2, “Forget this” buttons with memory ids).

**Outcome of Phase 1:**  
- DB has `user_memories` with semantic search and soft-delete.  
- Recall path is unified (user_memories + optional fuse with Gmail + bespoke).  
- “What do you remember?” works; “forget this” is implementable in Phase 2 by id.

---

### Phase 2: Memory delete (“Forget this”)

1. **Brain**: Tool `memory_forget(memory_id)` or `memory_forget(scope, filter)` that calls `delete_user_memory` / `delete_user_memories_by_filter`.
2. **Gateway** (optional): `DELETE /api/memories/:id` that calls brain or DB.
3. **Chat**: Agent uses tool when user says “forget that” / “delete that” (resolve “that” to last-cited memory id or ask for clarification).
4. **UI** (optional): “Forget this” on a cited memory that sends delete by id.

---

### Phase 3: Gmail sent + full context

1. **Gmail sync**: Extend `buildQuery` or add a separate sync path that includes **sent** mail (e.g. `in:sent` or label SENT), and sync into the same `gmail_threads` (or a clear convention so embeddings and search include sent).
2. **Embeddings**: Ensure sent threads get embeddings and are included in `gmail_thread_embeddings` (or equivalent) so semantic search and future extraction see sent.
3. **Thread bodies**: Store and expose sent message bodies the same way as inbox where needed.

---

### Phase 4: Extraction + confidence (only save when useful)

1. **Extractor**: Pipeline (batch or on-demand) that reads Gmail (inbox + sent), bespoke chunks, and optionally chat, and produces **memory candidates** (short text, source_type, source_id).
2. **Scorer**: Each candidate gets a **confidence** (0–1) from rules and/or a small model (relevance, user-specific, actionable).
3. **Threshold**: Insert into `user_memories` only if confidence ≥ threshold (e.g. 0.7); store `confidence` in row.
4. **Backfill**: One-off job that runs extractor + scorer over existing Gmail threads and bespoke chunks and inserts into `user_memories` (so Phase 1 recall gets richer without changing Phase 1 code).

---

### Phase 5: Orchestrator polish (“run the whole context”)

1. **Context budget**: When the user asks a broad question, orchestrator can request “top N” from user_memories + top K Gmail + top K bespoke (with a total token budget) so the model “runs the whole context” without blowing the window.
2. **Tooling**: Single “memory + context” tool or multiple tools that the orchestrator calls; clear semantics for “recall” vs “search Gmail” vs “search Index” so the agent can choose.
3. **UX**: “What do you remember?” → one answer with citations; “Forget this” → one action; optional “Memory” settings page (list / delete memories).

---

## 4. Summary table

| Phase | Focus | DB change | Main deliverable |
|-------|--------|-----------|------------------|
| **1** | Memory store + recall | Add `user_memories` (+ optional `feed_cards`) | Single recall path (user_memories + fuse Gmail + bespoke); “what do you remember?” works. |
| **2** | Delete | — | `memory_forget` tool + optional API/UI “Forget this”. |
| **3** | Gmail sent | Optional: sent flag or separate sync | Sent mail in sync + embeddings + search. |
| **4** | Extraction + confidence | — | Pipeline: Gmail + Index (+ chat) → candidates → score → insert into `user_memories` if above threshold. |
| **5** | Orchestrator | — | “Run the whole context” + unified memory/context tools + UX. |

---

## 5. What to do first (Phase 1 only)

1. **Migration**: Add `user_memories` table and vector index; add `feed_cards` to schema if missing.
2. **Brain**: Implement `user_memories` CRUD + semantic search; implement/refactor `search_memories_tool` to use it and fuse with bespoke + Gmail; return stable ids for user_memories rows.
3. **Seeding**: Either no backfill (recall = user_memories + Gmail + bespoke, user_memories grows from “remember this” only) or a minimal backfill (e.g. last N Gmail threads + last N bespoke chunks as rows with confidence 1.0).
4. **Chat**: No change to gateway chat API; only brain tool behavior. User says “what do you remember about X?” → agent calls recall → answers with citations.

This gives you the exact plan and order; Phase 1 is “memory store + recall” only, with a clear path to add “forget this,” sent mail, extraction with confidence, and orchestrator polish next.

---

## 6. Ingestion order (sync + learn)

**Goal:** Ingest and learn from mail in a fixed order: main account sent (1y) → main account inbox → then other accounts (service accounts) → their inbox.

**Implemented (main account):**

1. **Phase 1 – Sent (last 1 year):** Initial Gmail sync runs **sent** first: `in:sent` + date range (default 365 days). Threads are synced into `gmail_threads`; embeddings and “learn” (Phase 4 extraction) use this data.
2. **Phase 2 – Inbox (last 1 year):** Same user, same date range, **inbox** (no `in:sent`). Threads upsert into `gmail_threads`; overlapping threads (in both sent and inbox) are updated.

**Other accounts (service accounts):** Synced separately (e.g. `serviceAccountSync`). Intended order per account: **sent** (e.g. last 1y) first, then **inbox**. Today service-account sync is PDF/attachment-focused; extending it to follow sent → inbox for memory/learning is a follow-up.

**Learning:** “Learn” = Phase 4 extraction (Gmail + bespoke → candidates → score → insert into `user_memories`). Sync order only affects *which* mail is available first; extraction can run after sync (batch or on-demand).

---

## 7. Unified recall & forget (one place from the user's perspective)

**Do we need two places (memories vs notes)?**  
We keep two stores under the hood, but the **user sees one flow**: "what do you know?" and "forget that" work the same whether the fact lives in stored memories or in profile notes.

**Where things live:**

| Store | Used for | Forget by |
|-------|----------|-----------|
| **user_memories** | Facts saved with "remember this" / memory_save; semantic recall. | `memory_forget(<uuid>)` |
| **Profile notes** | Facts the user shared that were stored as a note (e.g. via profile_update in the past). | `memory_forget(profile:0)` etc. |
| **Bespoke / Gmail** | Index uploads, Gmail threads. Shown in recall but not forgettable by id. | — |

**Unified behavior:**

1. **Recall:** `memory_lookup(query)` returns one merged list from: user_memories (semantic), **profile notes** (filtered by query), bespoke (FAISS), Gmail (semantic). Each item has a stable id: UUID, `profile:0`, `profile:1`, …, `gmail:…`, `bespoke:…`.
2. **Forget:** `memory_forget(id)` accepts: **UUID** → soft-delete in user_memories; **profile:N** → remove that profile note; `gmail:…` / `bespoke:…` → tool says those cannot be forgotten.
3. **Agent rule:** For "forget that", the agent always calls `memory_lookup(topic)` then `memory_forget(id)` with the id from the relevant result. It must not say "I cannot delete notes"; it uses the same tool for both memories and profile notes.

**Going forward:** Prefer **memory_save** for any fact the user wants to recall or forget later. Profile notes remain for backward compatibility; both are shown in memory_lookup and forgettable via memory_forget(profile:N).

---

## 8. Phase 3 & 4 implemented

- **Phase 3 (Gmail sent):** Initial sync runs sent (1y) then inbox (1y); embeddings are created inside `fetchRecentThreads` for every batch (sent and inbox). No extra work needed.
- **Phase 4 (Extraction + confidence):**
  - **Gateway:** `listGmailThreadSummaries(userId, limit)` in db; `GET /internal/gmail/threads/:userId?limit=500` (internal auth) for brain to fetch thread summaries.
  - **Brain:** `memory_extraction.py`: `_fetch_gmail_candidates` (via internal client), `_fetch_bespoke_candidates` (from `memory_chunks`), `run_extraction_for_user(user_id, gmail_limit=500, bespoke_limit=200)`. Confidence: Gmail 0.7, bespoke 0.75; threshold 0.7. Skips if `exists_user_memory_for_source` already.
  - **Backfill:** `brain/src/jobs/memory_extraction_backfill.py` — `poetry run python -m src.jobs.memory_extraction_backfill --user-id <uuid>` or `--all`.
  - **On-demand:** `POST /api/memory/extract` (body: `{ "user_id": "..." }`) on the brain.
