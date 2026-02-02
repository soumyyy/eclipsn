# Schema Analysis & Cleanup

## Current tables (usage)

| Table | Used by | Notes |
|-------|--------|--------|
| **users** | Auth, Gmail, profiles, listAllUserIds | Keep. |
| **user_profiles** | Profile API, chat (getUserProfile), Gmail (custom_data, document) | Keep. Fluid profile lives in `document` + `custom_data`; structured fields (preferred_name, timezone, etc.) still read/written. |
| **conversations** | deleteAccount only; no INSERT | Kept for later multi-conversation. |
| **messages** | deleteAccount only; insertMessage exists but is never called | Kept for later; will be wired when we add multi-conversation. |
| **gmail_tokens** | Gmail OAuth, sync | Keep. |
| **gmail_threads** | Gmail sync, search, embeddings | Keep. |
| **gmail_thread_embeddings** | Gmail semantic search | Keep. |
| **gmail_thread_bodies** | Gmail thread detail | Keep. |
| **tasks** | deleteAccount (DELETE only); no INSERT anywhere; GraphQL returns `[]` | **Removed.** Tasks are represented as **feed_cards** with `type='task'`. |
| **memory_ingestions** | Bespoke upload, gateway memory routes | Keep. |
| **memory_chunks** | Bespoke index, FAISS, extraction | Keep. |
| **user_memories** | Memory layer (recall, forget, extraction) | Keep. |
| **feed_cards** | Brain feed_engine (briefing, recovery, vitals, etc.) + **tasks** | Keep. Tasks = `type='task'`, `data` = { description, due_date?, status, source?, thread_id? }. |
| **memory_extraction_runs** | Scheduled extraction (24h + nightly) | Keep. |
| **user_integrations** | Whoop, etc. | Keep. |
| **service_accounts** | Service account sync | Keep. |
| **whoop_*** | Whoop data | Keep. |

## Removed / repurposed

- **tasks table** – Dropped. Tasks are stored as **feed_cards** with `type = 'task'` and `data` JSONB:
  - `data.description` (required)
  - `data.due_date` (ISO string or null)
  - `data.status` (default `'open'`)
  - `data.source` (e.g. `'chat'`, `'gmail'`)
  - `data.thread_id` (optional, for email-derived tasks)

## Multi-conversation (later)

- **conversations** and **messages** are kept for when we add multiple conversations.
- Plan: create one conversation per chat thread; persist each user/assistant message; chat route accepts `conversation_id`, loads history from DB, persists new messages after reply. No implementation in this pass.
