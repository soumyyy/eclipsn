# Memory System: Bottlenecks and Improvements

This doc captures issues that caused the agent to claim "I've saved" without actually persisting, and how we fixed or can improve them.

## Root causes (fixed)

### 1. Agent claiming success without calling the tool
**Problem:** The agent could reply "I've saved the information" without ever invoking `memory_save`. The model sometimes "complies" in text only.

**Fix:**
- **Prompt:** Explicit rule that the agent may only say it saved after it called `memory_save` and received a response starting with `Stored: [id: ...]`. If it did not call the tool or got an error, it must say it could not save.
- **Prompt:** When the user says "save this", "learn from this and save", or "store this information", the agent MUST call `memory_save` one or more times with concrete content.
- **Tool description:** `memory_save` description now states that success returns `Stored: [id: <uuid>]` and to only tell the user they saved after receiving that; if the tool returns an error, tell them you could not save.

### 2. Memories stored but invisible (NULL embedding)
**Problem:** `insert_user_memory` allowed inserting rows with `embedding = NULL` when OpenAI embedding failed or was disabled. Semantic search (`search_user_memories`, `memory_lookup`, `memory_context`) only returns rows where `embedding IS NOT NULL`. So a memory could be "saved" (row inserted) but never show up when the user asks "what do you remember?" or checks memory logs via search—leading to "it hasn't really saved."

**Fix:**
- **user_memory_store.insert_user_memory:** If embedding cannot be computed (OpenAI disabled or failed), we no longer insert. We raise `ValueError` so the caller gets a clear failure.
- **memory_save_coro:** Wrapped in try/except; on any exception (including ValueError from insert), returns a clear string: `Error: Could not save to memory (database or embedding issue). Please try again.` so the agent never sees a raw exception and can report accurately to the user.

### 3. No explicit error path for save failures
**Problem:** If `insert_user_memory` raised (e.g. DB error), the exception propagated. The agent might see an opaque error or the executor might surface it inconsistently, and still reply with a generic "I've saved" in some cases.

**Fix:** `memory_save_coro` catches all exceptions and returns a single, explicit error string. The agent is instructed to treat any non-`Stored:` response as failure and to tell the user it could not save.

---

## Bottlenecks and future improvements

### Reliability
- **Tool-call visibility:** Consider logging tool invocations (name + args + result prefix) so we can verify in logs whether the agent actually called `memory_save` when the user asked to save.
- **Confirmation flow:** Optional: after the agent calls `memory_save`, the UI could show a short "Saved to memory" chip or allow the user to "View in Memories" so they get immediate feedback that persistence happened.

### Searchability
- **Embedding dependency:** Today, every stored memory must have an embedding (we no longer insert without one). If OpenAI is down or disabled, saves fail. Future: optional fallback (e.g. store without embedding and include in list-only or keyword search) with clear UX that the memory won’t appear in semantic "what do you know about me?" until embeddings are available.

### Save-from-context behavior
- **Chunking:** When the user says "save everything from that website", the agent may call `memory_save` once with a long summary. If that hits token/DB limits or is too coarse, consider prompting the agent to save 2–3 concrete facts per call instead of one giant blob.
- **Source attribution:** Memories store `source_type` (e.g. "chat") but not a link to the URL or message they came from. Adding optional `source_id` or a "source_url" field could help the UI show "Saved from soumyamaheshwari.com".

### Observability
- **Metrics:** Count successful vs failed `memory_save` calls and embed failures to detect regressions (e.g. missing OPENAI_API_KEY in an environment).
- **Settings UI:** On the Memories page, show a short note when embedding is unavailable (e.g. "New memories need OpenAI embedding to appear in search; check brain config.") if we ever allow listing without search again.

---

## End-to-end flow: save and retrieve

### Save paths

**A. Auto-save (when user says "save that" / "learn from this and save")**
1. Gateway `POST /api/chat` → `requireUserId(req)`, body: `{ message, history, profile }`.
2. Brain `POST /chat` → `run_chat_agent(user_id=request.user_id, message, history, profile)`.
3. In `run_chat_agent`: if `_user_wants_to_save(message)` and we have `url_context_block` (same message) or `_get_last_assistant_content(history)` (previous reply), call `_auto_save_from_context(user_id, content_to_save)`.
4. `_auto_save_from_context` → `create_memory_tool(user_id, content, source="chat")` (content truncated to 4000 chars).
5. `create_memory_tool` → `user_memory_store.insert_user_memory(user_id, content, source_type="chat", ...)`.
6. `insert_user_memory`: reject empty content (ValueError); compute embedding; if None, raise (no insert); INSERT into `user_memories` with embedding, RETURNING id.
7. Success: inject into prompt "The following has been saved to your memory. Confirm to the user." + `Stored: [id: <uuid>] ...`. Agent replies that it saved.

**B. Manual save (agent calls `memory_save` tool)**
1. Same gateway → brain flow; agent decides to call `memory_save(content)`.
2. `memory_save_coro` → `create_memory_tool` → `insert_user_memory` (same as above).
3. Tool returns `Stored: [id: <uuid>] <content>` or `Error: ...`; agent may only claim success on `Stored:`.

### Retrieve paths

**Chat: memory_lookup / memory_context**
1. Agent calls `memory_lookup(query)` or `memory_context(query)`.
2. `search_memories_tool` / `get_context_with_budget`: embed query (OpenAI); if no embedding, `user_memories` contribution is [] (profile/bespoke/Gmail still merged).
3. `user_memory_store.search_user_memories(user_id, query_embedding, limit)` → SQL `WHERE user_id = $1 AND deleted_at IS NULL AND embedding IS NOT NULL ORDER BY embedding <=> $2 LIMIT $3`.
4. Results merged with profile notes, bespoke, Gmail via RRF; returned to agent as lines `- [id: <id>] <content>`.

**Settings UI: list and search**
1. Frontend `GET /api/memories?q=...&limit=...&offset=...` (gateway adds `user_id` from session).
2. Gateway → Brain `GET /memory/user-memories?user_id=...&q=...&limit=...&offset=...`.
3. If `q` provided: `search_user_memories_by_query(user_id, q)` → embed q; if no embedding, returns []. If `q` not provided: `list_user_memories(user_id, limit, offset)` → all non-deleted rows, no embedding filter.
4. So: **list (no search)** always shows all memories; **search (with q)** requires OpenAI embedding—if disabled, search returns empty.

### Delete / forget

- **Chat:** Agent calls `memory_forget(memory_id)`. UUID → `user_memory_store.delete_user_memory` (soft-delete). `profile:N` → gateway profile update `remove_note`.
- **Settings:** User clicks Forget → `DELETE /api/memories/:id` → gateway → brain `DELETE /memory/user-memories/:id?user_id=...` → `delete_user_memory(memory_id, user_id)`.

### Validation and safeguards

- **Empty content:** `insert_user_memory` raises `ValueError("Content cannot be empty.")` for empty or whitespace-only content; callers (memory_save_coro, _auto_save_from_context) avoid calling with empty.
- **Embedding required:** No insert without embedding; no ghost rows that would be invisible in search.
- **user_id:** Always from gateway session → brain request; all brain memory APIs take `user_id` and scope DB by it.
