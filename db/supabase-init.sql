-- Run this file inside the Supabase SQL editor to prepare Eclipsn's schema.
-- Assumes the database user has permission to enable these extensions.
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "vector";

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    created_at timestamptz not null default now()
);

create table if not exists user_profiles (
    user_id uuid primary key references users(id),
    full_name text,
    preferred_name text,
    timezone text,
    contact_email text,
    phone text,
    company text,
    role text,
    preferences jsonb,
    biography text,
    custom_data jsonb default '{}'::jsonb,
    gmail_onboarded boolean not null default false,
    updated_at timestamptz not null default now()
);

create table if not exists conversations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    title text,
    created_at timestamptz not null default now()
);
create index if not exists idx_conversations_user_id on conversations(user_id);

create table if not exists messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references conversations(id),
    role text not null check (role in ('user', 'assistant', 'system')),
    text text not null,
    created_at timestamptz not null default now()
);
create index if not exists idx_messages_conversation_id on messages(conversation_id);

create table if not exists gmail_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references users(id),
    access_token text,
    refresh_token text,
    expiry timestamptz not null,
    initial_sync_started_at timestamptz,
    initial_sync_completed_at timestamptz,
    initial_sync_total_threads integer,
    initial_sync_synced_threads integer,
    initial_sync_onboarded boolean not null default false,
    access_token_enc jsonb,
    refresh_token_enc jsonb,
    token_key_id text,
    created_at timestamptz not null default now()
);
create index if not exists idx_gmail_tokens_user_id on gmail_tokens(user_id);

create table if not exists gmail_threads (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    thread_id text not null,
    subject text,
    summary text,
    sender text,
    category text,
    importance_score integer,
    expires_at timestamptz,
    last_message_at timestamptz,
    created_at timestamptz not null default now()
);
create unique index if not exists idx_gmail_threads_user_thread on gmail_threads(user_id, thread_id);

create table if not exists gmail_thread_embeddings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    thread_id uuid not null references gmail_threads(id) on delete cascade,
    embedding vector(1536) not null,
    created_at timestamptz not null default now(),
    unique (user_id, thread_id)
);
create index if not exists idx_gmail_thread_embeddings_user on gmail_thread_embeddings(user_id);

create table if not exists gmail_thread_bodies (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    thread_id uuid not null references gmail_threads(id) on delete cascade,
    body text not null,
    created_at timestamptz not null default now()
);
create unique index if not exists idx_gmail_thread_bodies_thread on gmail_thread_bodies(thread_id);

create table if not exists tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    source text not null,
    description text not null,
    thread_id text,
    due_date timestamptz,
    status text not null default 'open',
    created_at timestamptz not null default now()
);
create index if not exists idx_tasks_user_id on tasks(user_id);
create index if not exists idx_tasks_thread_id on tasks(thread_id);

create table if not exists memory_ingestions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    source text not null,
    total_files int default 0,
    processed_files int default 0,
    chunked_files int default 0,
    indexed_chunks int default 0,
    status text not null default 'pending',
    error text,
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    last_indexed_at timestamptz,
    batch_name text,
    graph_metrics jsonb,
    graph_synced_at timestamptz
);
create index if not exists idx_memory_ingestions_user on memory_ingestions(user_id);

create table if not exists memory_chunks (
    id uuid primary key default gen_random_uuid(),
    ingestion_id uuid not null references memory_ingestions(id) on delete cascade,
    user_id uuid not null references users(id),
    source text not null,
    file_path text not null,
    chunk_index int not null,
    content text not null,
    metadata jsonb default '{}'::jsonb,
    display_name text,
    summary text,
    embedding vector(1536),
    graph_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_memory_chunks_ingestion on memory_chunks(ingestion_id);
create index if not exists idx_memory_chunks_user on memory_chunks(user_id);
create index if not exists idx_memory_chunks_ingestion_user on memory_chunks(ingestion_id, user_id);
