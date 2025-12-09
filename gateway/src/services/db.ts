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

export async function removeExpiredGmailThreads(userId: string) {
  const client = await pool.connect();
  try {
    await client.query(
      `DELETE FROM gmail_threads
       WHERE user_id = $1
         AND expires_at IS NOT NULL
         AND expires_at < NOW()`,
      [userId]
    );
  } finally {
    client.release();
  }
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
