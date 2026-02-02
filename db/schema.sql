CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    full_name TEXT,
    preferred_name TEXT,
    timezone TEXT,
    contact_email TEXT,
    phone TEXT,
    company TEXT,
    role TEXT,
    preferences JSONB,
    biography TEXT,
    custom_data JSONB DEFAULT '{}'::jsonb,
    document JSONB NOT NULL DEFAULT '{}'::jsonb,
    gmail_onboarded BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_document ON user_profiles USING GIN (document jsonb_path_ops);

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS gmail_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id),
    access_token TEXT,
    refresh_token TEXT,
    expiry TIMESTAMPTZ NOT NULL,
    initial_sync_started_at TIMESTAMPTZ,
    initial_sync_completed_at TIMESTAMPTZ,
    initial_sync_total_threads INTEGER,
    initial_sync_synced_threads INTEGER,
    initial_sync_onboarded BOOLEAN NOT NULL DEFAULT FALSE,
    access_token_enc JSONB,
    refresh_token_enc JSONB,
    token_key_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gmail_tokens_user_id ON gmail_tokens(user_id);

CREATE TABLE IF NOT EXISTS gmail_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    thread_id TEXT NOT NULL,
    subject TEXT,
    summary TEXT,
    sender TEXT,
    category TEXT,
  importance_score INT,
  expires_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_threads_user_thread ON gmail_threads(user_id, thread_id);

CREATE TABLE IF NOT EXISTS gmail_thread_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    thread_id UUID NOT NULL REFERENCES gmail_threads(id) ON DELETE CASCADE,
    embedding VECTOR(1536) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_gmail_thread_embeddings_user ON gmail_thread_embeddings(user_id);

CREATE TABLE IF NOT EXISTS gmail_thread_bodies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    thread_id UUID NOT NULL REFERENCES gmail_threads(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmail_thread_bodies_thread ON gmail_thread_bodies(thread_id);

-- Tasks are feed_cards with type='task'; data = { description, due_date?, status?, source?, thread_id? }

CREATE TABLE IF NOT EXISTS memory_ingestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    source TEXT NOT NULL,
    total_files INT DEFAULT 0,
    processed_files INT DEFAULT 0,
    chunked_files INT DEFAULT 0,
    indexed_chunks INT DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    batch_name TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    last_indexed_at TIMESTAMPTZ,
    graph_metrics JSONB,
    graph_synced_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_memory_ingestions_user ON memory_ingestions(user_id);

CREATE TABLE IF NOT EXISTS memory_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingestion_id UUID NOT NULL REFERENCES memory_ingestions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    source TEXT NOT NULL,
    file_path TEXT NOT NULL,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    display_name TEXT,
    summary TEXT,
    embedding VECTOR(1536),
    graph_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_ingestion ON memory_chunks(ingestion_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_user ON memory_chunks(user_id);

CREATE TABLE IF NOT EXISTS user_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    scope TEXT,
    confidence REAL,
    embedding VECTOR(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_memories_user_deleted
    ON user_memories (user_id, deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_memories_embedding
    ON user_memories USING hnsw (embedding vector_cosine_ops)
    WHERE deleted_at IS NULL AND embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS feed_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    priority_score REAL NOT NULL DEFAULT 0,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_feed_cards_user_id ON feed_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_cards_user_type_status ON feed_cards(user_id, type, status);

-- Scheduled memory extraction: last run time (24h check + nightly cron)
CREATE TABLE IF NOT EXISTS memory_extraction_runs (
    id SERIAL PRIMARY KEY,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_ran_at ON memory_extraction_runs(ran_at DESC);
