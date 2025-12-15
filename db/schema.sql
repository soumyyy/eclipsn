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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expiry TIMESTAMPTZ NOT NULL,
    initial_sync_started_at TIMESTAMPTZ,
    initial_sync_completed_at TIMESTAMPTZ,
    initial_sync_total_threads INTEGER,
    initial_sync_synced_threads INTEGER,
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

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    source TEXT NOT NULL,
    description TEXT NOT NULL,
    thread_id TEXT,
    due_date TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_thread_id ON tasks(thread_id);

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
