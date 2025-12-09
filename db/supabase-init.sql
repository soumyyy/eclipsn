-- Run this file inside the Supabase SQL editor to prepare Pluto's schema.
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

create table if not exists memories (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    source text not null,
    content text not null,
    importance_score numeric,
    created_at timestamptz not null default now()
);
create index if not exists idx_memories_user_id on memories(user_id);

create table if not exists memory_embeddings (
    id uuid primary key default gen_random_uuid(),
    memory_id uuid not null references memories(id) on delete cascade,
    embedding vector(1536),
    index_type text not null default 'semantic'
);
create index if not exists idx_memory_embeddings_memory_id on memory_embeddings(memory_id);

create table if not exists gmail_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references users(id),
    access_token text not null,
    refresh_token text not null,
    expiry timestamptz not null,
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
