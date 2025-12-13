
## Unify Chunk + Graph Storage Plan

### Goal
Collapse `memory_chunks` + `memory_chunk_embeddings` + the bespoke graph tables into a single storage flow so each chunk is stored once with its metadata, embedding vector, and any graph-friendly information.

### Proposed Approach
1. **Schema changes**
   - Add the following columns to `memory_chunks`:
     * `chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (currently implicit via `id` – keep `id`, reuse as chunk id)
     * `embedding VECTOR(1536)` (replaces `memory_chunk_embeddings`)
     * `display_name TEXT`, `summary TEXT`, `graph_metadata JSONB`, etc., if we want to reuse the table for graph data.
     * Optional booleans for section/document boundaries (`is_document`, `is_section`) so we can reconstruct the hierarchy without separate `graph_nodes` rows.
   - Remove `memory_chunk_embeddings` and (optionally) `graph_nodes`/`graph_edges` or replace them with generated views referencing `memory_chunks`.
   - `memory_ingestions` remains for tracking batches/status.

2. **Data migration strategy**
   - Add new columns to `memory_chunks` (embedding, display fields) **without** dropping existing tables yet.
   - Backfill embeddings: `INSERT INTO memory_chunks (embedding) SELECT embedding FROM memory_chunk_embeddings …` (or run an update per chunk).
   - Update graph loader to read from the enhanced `memory_chunks` instead of `graph_nodes`/`graph_edges`.
   - Once code is swapped, drop `memory_chunk_embeddings`, `graph_nodes`, `graph_edges`, `graph_node_embeddings` tables.

3. **Code changes**
   - Gateway `services/db.ts`: update `insertMemoryChunk` to accept the new columns, remove references to `graph_*` tables.
   - Ingestion job (`processMemoryIngestion`) continues to insert chunk rows; embeddings now go straight into `memory_chunks.embedding` (the indexer writes to the same table).
   - Brain `memory_indexer` loads from `memory_chunks` and upserts embeddings there instead of `memory_chunk_embeddings`.
   - Brain graph utilities (`graph_store`, `graph_loader`, `graph_sync`, etc.) should derive nodes/edges on the fly from chunk metadata instead of a separate graph schema.
   - Remove unused memory tables (`memories`, `memory_embeddings`) and Outlook tokens if not needed.

4. **Graph reconstruction**
   - Option A: Add pseudo-node columns (`section_path`, `document_id`) to `memory_chunks` and build a graph view with SQL (e.g., `CREATE VIEW graph_nodes AS …`).
   - Option B: Keep lightweight `graph_nodes`/`graph_edges`, but populate them via triggers or at query time from `memory_chunks` rather than duplicating data manually.

5. **Testing / rollout**
   - Stage migrations locally, verify ingestion + indexing + graph view.
   - Run end-to-end tests: upload docs, inspect `memory_chunks` rows, ensure embeddings + graph view still look correct.
   - Deploy migrations, then deploy code changes.

### Files / Areas Impacted
- `db/schema.sql` (and migrations) – add columns, drop tables, create views.
- `gateway/src/services/db.ts` – chunk insert/select APIs, remove embedding table usage, adjust graph queries.
- `gateway/src/routes/memory.ts` – ingestion/graph endpoints.
- `brain/src/services/memory_indexer.py` and `memory_indexer` job – embedding storage.
- `brain/src/services/graph_*` and `graph_loader.py` – rebuild graph logic to source from `memory_chunks`.
- Any tests or scripts referencing `memory_chunk_embeddings`, `graph_nodes`, `graph_edges`.
