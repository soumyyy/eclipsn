import { Pool } from 'pg';
import { config } from '../config';

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSSL
    ? {
        rejectUnauthorized: false
      }
    : undefined
});

export async function saveGmailTokens(params: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiry: Date;
}) {
  // TODO: encrypt tokens at rest.
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO gmail_tokens (id, user_id, access_token, refresh_token, expiry)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       ON CONFLICT (user_id)
       DO UPDATE SET access_token = EXCLUDED.access_token,
                     refresh_token = EXCLUDED.refresh_token,
                     expiry = EXCLUDED.expiry`,
      [params.userId, params.accessToken, params.refreshToken, params.expiry]
    );
  } finally {
    client.release();
  }
}

export async function getGmailTokens(userId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT access_token as "accessToken", refresh_token as "refreshToken", expiry
       FROM gmail_tokens
       WHERE user_id = $1`,
      [userId]
    );
    if (result.rowCount === 0) {
      return null;
    }
    const row = result.rows[0];
    return {
      accessToken: row.accessToken as string,
      refreshToken: row.refreshToken as string,
      expiry: row.expiry as Date
    };
  } finally {
    client.release();
  }
}

export async function deleteGmailTokens(userId: string) {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM gmail_tokens WHERE user_id = $1`, [userId]);
  } finally {
    client.release();
  }
}

export async function saveOutlookTokens(params: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiry: Date;
  tenantId?: string;
  scope?: string;
}) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO outlook_tokens (id, user_id, access_token, refresh_token, expiry, tenant_id, scope)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id)
       DO UPDATE SET access_token = EXCLUDED.access_token,
                     refresh_token = EXCLUDED.refresh_token,
                     expiry = EXCLUDED.expiry,
                     tenant_id = EXCLUDED.tenant_id,
                     scope = EXCLUDED.scope`,
      [params.userId, params.accessToken, params.refreshToken, params.expiry, params.tenantId ?? null, params.scope ?? null]
    );
  } finally {
    client.release();
  }
}

export async function getOutlookTokens(userId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT access_token as "accessToken",
              refresh_token as "refreshToken",
              expiry,
              tenant_id as "tenantId",
              scope
       FROM outlook_tokens
       WHERE user_id = $1`,
      [userId]
    );
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0];
  } finally {
    client.release();
  }
}

export async function deleteOutlookTokens(userId: string) {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM outlook_tokens WHERE user_id = $1`, [userId]);
  } finally {
    client.release();
  }
}

export interface GmailThreadRecord {
  threadId: string;
  subject: string;
  snippet: string;
  sender?: string;
  lastMessageAt?: Date | null;
  category?: string;
  importanceScore?: number;
  expiresAt?: Date | null;
}

export async function saveGmailThreads(userId: string, threads: GmailThreadRecord[]) {
  if (!threads.length) return [] as string[];
  const client = await pool.connect();
  const rowIds: string[] = [];
  try {
    for (const thread of threads) {
      const result = await client.query(
        `INSERT INTO gmail_threads (id, user_id, thread_id, subject, summary, sender, category, importance_score, expires_at, last_message_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, thread_id)
         DO UPDATE SET subject = EXCLUDED.subject,
                       summary = EXCLUDED.summary,
                       sender = EXCLUDED.sender,
                       category = EXCLUDED.category,
                       importance_score = EXCLUDED.importance_score,
                       expires_at = EXCLUDED.expires_at,
                       last_message_at = EXCLUDED.last_message_at
         RETURNING id`,
        [
          userId,
          thread.threadId,
          thread.subject,
          thread.snippet,
          thread.sender,
          thread.category,
          thread.importanceScore ?? 0,
          thread.expiresAt ?? null,
          thread.lastMessageAt ?? null
        ]
      );
      if (result.rows[0]?.id) {
        rowIds.push(result.rows[0].id as string);
      } else {
        rowIds.push('');
      }
    }
  } finally {
    client.release();
  }
  return rowIds;
}

export async function upsertGmailEmbedding(params: {
  userId: string;
  threadRowId: string;
  embedding: number[];
}) {
  const client = await pool.connect();
  try {
    const vectorParam = `[${params.embedding.join(',')}]`;
    await client.query(
      `INSERT INTO gmail_thread_embeddings (id, user_id, thread_id, embedding)
       VALUES (gen_random_uuid(), $1, $2, $3)
       ON CONFLICT (user_id, thread_id)
       DO UPDATE SET embedding = EXCLUDED.embedding,
                     created_at = NOW()`,
      [params.userId, params.threadRowId, vectorParam]
    );
  } finally {
    client.release();
  }
}

export async function searchGmailEmbeddings(params: {
  userId: string;
  embedding: number[];
  limit?: number;
}) {
  const client = await pool.connect();
  try {
    const vectorParam = `[${params.embedding.join(',')}]`;
    const result = await client.query(
      `SELECT ge.thread_id as "threadId",
              gt.subject,
              gt.summary,
              gt.sender,
              gt.category,
              gt.last_message_at,
              CONCAT('https://mail.google.com/mail/u/0/#inbox/', gt.thread_id) as "link"
       FROM gmail_thread_embeddings ge
       JOIN gmail_threads gt ON ge.thread_id = gt.id
       WHERE ge.user_id = $1 AND (gt.expires_at IS NULL OR gt.expires_at > NOW())
       ORDER BY ge.embedding <-> $2
       LIMIT $3`,
      [params.userId, vectorParam, params.limit ?? 5]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function upsertGmailThreadBody(params: {
  userId: string;
  threadRowId: string;
  body: string;
}) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO gmail_thread_bodies (id, user_id, thread_id, body)
       VALUES (gen_random_uuid(), $1, $2, $3)
       ON CONFLICT (thread_id)
       DO UPDATE SET body = EXCLUDED.body,
                     created_at = NOW()`,
      [params.userId, params.threadRowId, params.body]
    );
  } finally {
    client.release();
  }
}

export async function getGmailThreadBody(threadRowId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT body FROM gmail_thread_bodies WHERE thread_id = $1`,
      [threadRowId]
    );
    if (result.rowCount === 0) return null;
    return result.rows[0].body as string;
  } finally {
    client.release();
  }
}

export async function getGmailThreadMetadata(threadRowId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id,
              thread_id as "gmailThreadId",
              subject,
              summary,
              sender,
              category,
              last_message_at as "lastMessageAt"
       FROM gmail_threads
       WHERE id = $1`,
      [threadRowId]
    );
    if (result.rowCount === 0) return null;
    return result.rows[0];
  } finally {
    client.release();
  }
}

export async function getGmailThreadMetadataByGmailId(userId: string, gmailThreadId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id,
              thread_id as "gmailThreadId",
              subject,
              summary,
              sender,
              category,
              last_message_at as "lastMessageAt"
       FROM gmail_threads
       WHERE user_id = $1 AND thread_id = $2`,
      [userId, gmailThreadId]
    );
    if (result.rowCount === 0) return null;
    return result.rows[0];
  } finally {
    client.release();
  }
}

export async function insertMessage(params: {
  userId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO messages (id, conversation_id, role, text)
       VALUES (gen_random_uuid(), $1, $2, $3)`,
      [params.conversationId, params.role, params.text]
    );
  } finally {
    client.release();
  }
}

export function getPool() {
  return pool;
}

export async function getUserProfile(userId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT full_name as "fullName",
              preferred_name as "preferredName",
              timezone,
              contact_email as "contactEmail",
              phone,
              company,
              role,
              preferences,
              biography,
              custom_data as "customData",
              updated_at as "updatedAt"
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0];
  } finally {
    client.release();
  }
}

export async function upsertUserProfile(userId: string, data: Record<string, unknown>) {
  const client = await pool.connect();
  try {
    const existingRes = await client.query(
      `SELECT full_name,
              preferred_name,
              timezone,
              contact_email,
              phone,
              company,
              role,
              preferences,
              biography,
              custom_data
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );
    const existing = existingRes.rows[0] || {};
    const incomingCustom = (data.customData ?? data.custom_data ?? {}) as Record<string, unknown>;
    const existingCustom = (existing.custom_data ?? {}) as Record<string, unknown>;
    const mergedCustom = { ...existingCustom, ...incomingCustom };
    const preferences = data.preferences ?? existing.preferences ?? null;

    await client.query(
      `INSERT INTO user_profiles (user_id, full_name, preferred_name, timezone, contact_email, phone, company, role, preferences, biography, custom_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id)
       DO UPDATE SET full_name = EXCLUDED.full_name,
                     preferred_name = EXCLUDED.preferred_name,
                     timezone = EXCLUDED.timezone,
                     contact_email = EXCLUDED.contact_email,
                     phone = EXCLUDED.phone,
                     company = EXCLUDED.company,
                     role = EXCLUDED.role,
                     preferences = EXCLUDED.preferences,
                     biography = EXCLUDED.biography,
                     custom_data = EXCLUDED.custom_data,
                     updated_at = NOW()`,
      [
        userId,
        data.fullName ?? data.full_name ?? existing.full_name ?? null,
        data.preferredName ?? data.preferred_name ?? existing.preferred_name ?? null,
        data.timezone ?? existing.timezone ?? null,
        data.contactEmail ?? data.contact_email ?? existing.contact_email ?? null,
        data.phone ?? existing.phone ?? null,
        data.company ?? existing.company ?? null,
        data.role ?? existing.role ?? null,
        preferences,
        data.biography ?? existing.biography ?? null,
        mergedCustom
      ]
    );
  } finally {
    client.release();
  }
}
export interface MemoryIngestionRecord {
  id: string;
  userId: string;
  source: string;
  totalFiles: number;
  processedFiles: number;
  chunkedFiles: number;
  indexedChunks: number;
  totalChunks: number;
  status: string;
  error?: string | null;
  createdAt: Date;
  completedAt?: Date | null;
  lastIndexedAt?: Date | null;
  batchName?: string | null;
}

export async function createMemoryIngestion(params: { userId: string; source: string; totalFiles: number; batchName?: string }): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO memory_ingestions (id, user_id, source, total_files, batch_name)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING id`,
      [params.userId, params.source, params.totalFiles, params.batchName ?? null]
    );
    return result.rows[0].id as string;
  } finally {
    client.release();
  }
}

export async function updateMemoryIngestion(params: {
  ingestionId: string;
  processedFiles?: number;
  chunkedFiles?: number;
  indexedChunks?: number;
  status?: string;
  error?: string | null;
  lastIndexedAt?: Date | null;
}) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE memory_ingestions
       SET processed_files = COALESCE($2, processed_files),
           chunked_files = COALESCE($3, chunked_files),
           indexed_chunks = COALESCE($4, indexed_chunks),
           status = COALESCE($5, status),
           error = COALESCE($6, error),
           last_indexed_at = COALESCE($7, last_indexed_at),
           completed_at = CASE WHEN $5 IN ('uploaded', 'failed') THEN NOW() ELSE completed_at END
       WHERE id = $1`,
      [
        params.ingestionId,
        params.processedFiles ?? null,
        params.chunkedFiles ?? null,
        params.indexedChunks ?? null,
        params.status ?? null,
        params.error ?? null,
        params.lastIndexedAt ?? null
      ]
    );
  } finally {
    client.release();
  }
}

export async function getLatestMemoryIngestion(userId: string, source: string): Promise<MemoryIngestionRecord | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT mi.id,
              mi.user_id as "userId",
              mi.source,
              mi.total_files as "totalFiles",
              mi.processed_files as "processedFiles",
              mi.chunked_files as "chunkedFiles",
              mi.indexed_chunks as "indexedChunks",
              mi.status,
              mi.error,
              mi.created_at as "createdAt",
              mi.completed_at as "completedAt",
              mi.last_indexed_at as "lastIndexedAt",
              mi.batch_name as "batchName",
              COALESCE(chunk_counts.total_chunks, 0) as "totalChunks"
       FROM memory_ingestions mi
       LEFT JOIN (
         SELECT ingestion_id, COUNT(*) as total_chunks
         FROM memory_chunks
         GROUP BY ingestion_id
       ) as chunk_counts ON chunk_counts.ingestion_id = mi.id
       WHERE mi.user_id = $1 AND mi.source = $2
       ORDER BY mi.created_at DESC
       LIMIT 1`,
      [userId, source]
    );
    if (result.rowCount === 0) return null;
    return result.rows[0] as MemoryIngestionRecord;
  } finally {
    client.release();
  }
}

export async function listMemoryIngestions(userId: string, limit = 10): Promise<MemoryIngestionRecord[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT mi.id,
              mi.user_id as "userId",
              mi.source,
              mi.total_files as "totalFiles",
              mi.processed_files as "processedFiles",
              mi.chunked_files as "chunkedFiles",
              mi.indexed_chunks as "indexedChunks",
              mi.status,
              mi.error,
              mi.created_at as "createdAt",
              mi.completed_at as "completedAt",
              mi.last_indexed_at as "lastIndexedAt",
              mi.batch_name as "batchName",
              COALESCE(chunk_counts.total_chunks, 0) as "totalChunks"
       FROM memory_ingestions mi
       LEFT JOIN (
         SELECT ingestion_id, COUNT(*) as total_chunks
         FROM memory_chunks
         GROUP BY ingestion_id
       ) as chunk_counts ON chunk_counts.ingestion_id = mi.id
       WHERE mi.user_id = $1
       ORDER BY mi.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows as MemoryIngestionRecord[];
  } finally {
    client.release();
  }
}

export async function deleteMemoryIngestion(ingestionId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM memory_ingestions WHERE id = $1 AND user_id = $2`, [ingestionId, userId]);
  } finally {
    client.release();
  }
}

export async function resetIngestionEmbeddings(ingestionId: string) {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM memory_chunk_embeddings
       WHERE chunk_id IN (
         SELECT id FROM memory_chunks WHERE ingestion_id = $1
       )`,
      [ingestionId]
    );
  } finally {
    client.release();
  }
}

export async function getMemoryIngestionById(ingestionId: string, userId: string): Promise<MemoryIngestionRecord | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT mi.id,
              mi.user_id as "userId",
              mi.source,
              mi.total_files as "totalFiles",
              mi.processed_files as "processedFiles",
              mi.chunked_files as "chunkedFiles",
              mi.indexed_chunks as "indexedChunks",
              mi.status,
              mi.error,
              mi.created_at as "createdAt",
              mi.completed_at as "completedAt",
              mi.last_indexed_at as "lastIndexedAt",
              mi.batch_name as "batchName",
              COALESCE(chunk_counts.total_chunks, 0) as "totalChunks"
       FROM memory_ingestions mi
       LEFT JOIN (
         SELECT ingestion_id, COUNT(*) as total_chunks
         FROM memory_chunks
         GROUP BY ingestion_id
       ) as chunk_counts ON chunk_counts.ingestion_id = mi.id
       WHERE mi.id = $1 AND mi.user_id = $2
       LIMIT 1`,
      [ingestionId, userId]
    );
    if (result.rowCount === 0) return null;
    return result.rows[0] as MemoryIngestionRecord;
  } finally {
    client.release();
  }
}

export async function clearAllMemoryIngestions(userId: string, source: string) {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM memory_ingestions WHERE user_id = $1 AND source = $2', [userId, source]);
  } finally {
    client.release();
  }
}

export async function insertMemoryChunk(params: {
  ingestionId: string;
  userId: string;
  source: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO memory_chunks (id, ingestion_id, user_id, source, file_path, chunk_index, content, metadata)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
      [
        params.ingestionId,
        params.userId,
        params.source,
        params.filePath,
        params.chunkIndex,
        params.content,
        params.metadata ?? {}
      ]
    );
  } finally {
    client.release();
  }
}
