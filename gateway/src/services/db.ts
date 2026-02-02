import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { GraphEdgeType, GraphNodeType, makeEdgeId, makeNodeId, parseNodeId } from '../graph/types';
import { normalizeProfileNotes } from '../utils/profile';
import { decryptSecret, encryptSecret, EncryptedSecret } from '../utils/crypto';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSSL
    ? {
      rejectUnauthorized: false
    }
    : undefined
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function placeholderEmailFor(userId: string): string {
  return `user+${userId.replace(/[^0-9a-zA-Z]/g, '')}@demo.local`;
}

export async function saveGmailTokens(params: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiry: Date;
}) {
  await ensureUserRecord(params.userId);
  const encryptedAccess = encryptSecret(params.accessToken);
  const encryptedRefresh = encryptSecret(params.refreshToken);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO gmail_tokens (id, user_id, access_token, refresh_token, expiry, access_token_enc, refresh_token_enc, token_key_id)
       VALUES (gen_random_uuid(), $1, NULL, NULL, $2, $3::jsonb, $4::jsonb, $5)
       ON CONFLICT (user_id)
       DO UPDATE SET access_token = NULL,
                     refresh_token = NULL,
                     access_token_enc = EXCLUDED.access_token_enc,
                     refresh_token_enc = EXCLUDED.refresh_token_enc,
                     token_key_id = EXCLUDED.token_key_id,
                     expiry = EXCLUDED.expiry`,
      [params.userId, params.expiry, JSON.stringify(encryptedAccess), JSON.stringify(encryptedRefresh), encryptedAccess.keyId]
    );
  } finally {
    client.release();
  }
}

export async function getGmailTokens(userId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT access_token as "accessToken",
              refresh_token as "refreshToken",
              access_token_enc as "accessTokenEnc",
              refresh_token_enc as "refreshTokenEnc",
              token_key_id as "tokenKeyId",
              expiry,
              initial_sync_started_at as "initialSyncStartedAt",
              initial_sync_completed_at as "initialSyncCompletedAt"
       FROM gmail_tokens
       WHERE user_id = $1`,
      [userId]
    );
    if (result.rowCount === 0) {
      return null;
    }
    const row = result.rows[0];
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    try {
      accessToken = decryptSecret(row.accessTokenEnc as EncryptedSecret | null);
      refreshToken = decryptSecret(row.refreshTokenEnc as EncryptedSecret | null);
    } catch (error) {
      console.error('[gmail] Failed to decrypt tokens, removing credentials', error);
      await deleteGmailTokens(userId);
      return null;
    }
    if ((!accessToken || !refreshToken) && (row.accessToken || row.refreshToken)) {
      accessToken = row.accessToken as string;
      refreshToken = row.refreshToken as string;
      if (accessToken && refreshToken) {
        await saveGmailTokens({
          userId,
          accessToken,
          refreshToken,
          expiry: row.expiry as Date
        });
      }
    }
    if (!accessToken || !refreshToken) {
      return null;
    }
    return {
      accessToken,
      refreshToken,
      expiry: row.expiry as Date,
      initialSyncStartedAt: row.initialSyncStartedAt as Date | null,
      initialSyncCompletedAt: row.initialSyncCompletedAt as Date | null
    };
  } finally {
    client.release();
  }
}

export interface GmailSyncMetadata {
  initialSyncStartedAt: Date | null;
  initialSyncCompletedAt: Date | null;
  initialSyncTotalThreads: number | null;
  initialSyncSyncedThreads: number | null;
}

export async function getGmailSyncMetadata(userId: string): Promise<GmailSyncMetadata | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT initial_sync_started_at as "initialSyncStartedAt",
              initial_sync_completed_at as "initialSyncCompletedAt",
              initial_sync_total_threads as "initialSyncTotalThreads",
              initial_sync_synced_threads as "initialSyncSyncedThreads"
         FROM gmail_tokens
        WHERE user_id = $1`,
      [userId]
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      initialSyncStartedAt: row.initialSyncStartedAt as Date | null,
      initialSyncCompletedAt: row.initialSyncCompletedAt as Date | null,
      initialSyncTotalThreads: row.initialSyncTotalThreads as number | null,
      initialSyncSyncedThreads: row.initialSyncSyncedThreads as number | null
    };
  } finally {
    client.release();
  }
}

export async function markInitialGmailSync(
  userId: string,
  options: { started?: boolean; completed?: boolean; totalThreads?: number | null; syncedThreads?: number | null }
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE gmail_tokens
          SET initial_sync_started_at = CASE WHEN $2 THEN NOW() ELSE initial_sync_started_at END,
              initial_sync_completed_at = CASE
                  WHEN $3 THEN NOW()
                  WHEN $2 THEN NULL
                  ELSE initial_sync_completed_at
              END,
              initial_sync_total_threads = COALESCE($4, initial_sync_total_threads),
              initial_sync_synced_threads = COALESCE($5, initial_sync_synced_threads)
        WHERE user_id = $1`,
      [
        userId,
        options.started ? true : false,
        options.completed ? true : false,
        options.totalThreads ?? null,
        options.syncedThreads ?? null
      ]
    );
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

export async function deleteUserAccount(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM gmail_thread_embeddings WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM gmail_thread_bodies WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM gmail_threads WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM gmail_tokens WHERE user_id = $1`, [userId]);
    await client.query(
      `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = $1)`,
      [userId]
    );
    await client.query(`DELETE FROM conversations WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM feed_cards WHERE user_id = $1 AND type = 'task'`, [userId]);
    await client.query(`DELETE FROM memory_ingestions WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM user_profiles WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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
  mailbox?: 'inbox' | 'sent' | null;
}

export async function saveGmailThreads(userId: string, threads: GmailThreadRecord[]) {
  if (!threads.length) return [] as string[];
  const client = await pool.connect();
  const rowIds: string[] = [];
  try {
    for (const thread of threads) {
      const result = await client.query(
        `INSERT INTO gmail_threads (id, user_id, thread_id, subject, summary, sender, category, importance_score, expires_at, last_message_at, mailbox)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, thread_id)
         DO UPDATE SET subject = EXCLUDED.subject,
                       summary = EXCLUDED.summary,
                       sender = EXCLUDED.sender,
                       category = EXCLUDED.category,
                       importance_score = EXCLUDED.importance_score,
                       expires_at = EXCLUDED.expires_at,
                       last_message_at = EXCLUDED.last_message_at,
                       mailbox = EXCLUDED.mailbox
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
          thread.lastMessageAt ?? null,
          thread.mailbox ?? null
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
       ORDER BY ge.embedding <-> $2::vector
       LIMIT $3`,
      [params.userId, vectorParam, params.limit ?? 5]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

export async function listUsersWithGmailTokens(): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT DISTINCT user_id
         FROM gmail_tokens
        WHERE expiry IS NULL OR expiry > NOW() - INTERVAL '5 minutes'`
    );
    return result.rows.map((row) => row.user_id as string);
  } finally {
    client.release();
  }
}

/** All user IDs (for scheduled memory extraction) */
export async function listAllUserIds(): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT id FROM users');
    return result.rows.map((row) => row.id as string);
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

/** List thread summaries for extraction (e.g. Phase 4 memory pipeline). Ordered by last_message_at desc. */
export async function listGmailThreadSummaries(userId: string, limit: number): Promise<Array<{
  id: string;
  threadId: string;
  subject: string | null;
  summary: string | null;
  sender: string | null;
  category: string | null;
  lastMessageAt: Date | null;
  expiresAt: Date | null;
  mailbox: string | null;
}>> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id,
              thread_id as "threadId",
              subject,
              summary,
              sender,
              category,
              last_message_at as "lastMessageAt",
              expires_at as "expiresAt",
              mailbox
       FROM gmail_threads
       WHERE user_id = $1
       ORDER BY last_message_at DESC NULLS LAST
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows as Array<{
      id: string;
      threadId: string;
      subject: string | null;
      summary: string | null;
      sender: string | null;
      category: string | null;
      lastMessageAt: Date | null;
      expiresAt: Date | null;
      mailbox: string | null;
    }>;
  } finally {
    client.release();
  }
}

export async function removeExpiredGmailThreads(userId: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const expiredResult = await client.query(
      `SELECT id
         FROM gmail_threads
        WHERE user_id = $1
          AND expires_at IS NOT NULL
          AND expires_at <= NOW()`,
      [userId]
    );
    const ids = expiredResult.rows.map((row) => row.id as string);
    if (!ids.length) {
      await client.query('COMMIT');
      return 0;
    }
    await client.query(
      `DELETE FROM gmail_thread_embeddings
        WHERE user_id = $1
          AND thread_id = ANY($2::uuid[])`,
      [userId, ids]
    );
    await client.query(
      `DELETE FROM gmail_thread_bodies
        WHERE thread_id = ANY($1::uuid[])`,
      [ids]
    );
    await client.query(
      `DELETE FROM gmail_threads
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    await client.query('COMMIT');
    return ids.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
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

export async function ensureConversation(params: {
  userId: string;
  conversationId: string;
  title?: string | null;
}) {
  await ensureUserRecord(params.userId);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO conversations (id, user_id, title)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [params.conversationId, params.userId, params.title ?? null]
    );
  } finally {
    client.release();
  }
}

export function getPool() {
  return pool;
}

export async function attachGmailIdentity(userId: string, gmailEmail: string): Promise<void> {
  const client = await pool.connect();
  try {
    const customDataPatch = {
      gmail_email: gmailEmail
    };
    await client.query(
      `INSERT INTO user_profiles (user_id, contact_email, custom_data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET contact_email = COALESCE($2, user_profiles.contact_email),
           custom_data = jsonb_strip_nulls(user_profiles.custom_data || $3::jsonb),
           updated_at = NOW()`,
      [userId, gmailEmail, JSON.stringify(customDataPatch)]
    );
  } finally {
    client.release();
  }
}

export async function findOrCreateUserByGmailEmail(
  gmailEmail: string
): Promise<{ userId: string; created: boolean }> {
  const client = await pool.connect();
  try {
    // First, try to find existing user by Gmail email in user_profiles custom_data
    const existingUserResult = await client.query(
      `SELECT u.id
       FROM users u
       JOIN user_profiles up ON u.id = up.user_id
       WHERE up.custom_data->>'gmail_email' = $1 OR up.contact_email = $1`,
      [gmailEmail]
    );

    if (existingUserResult.rows.length > 0) {
      return { userId: existingUserResult.rows[0].id, created: false };
    }

    // If no existing user found, create a new one
    const userId = randomUUID();
    const placeholderEmail = placeholderEmailFor(userId);

    await client.query('BEGIN');

    // Insert user record
    await client.query(
      `INSERT INTO users (id, email) VALUES ($1, $2)`,
      [userId, placeholderEmail]
    );

    // Insert basic profile with Gmail email in custom_data
    await client.query(
      `INSERT INTO user_profiles (user_id, custom_data, updated_at)
       VALUES ($1, $2, NOW())`,
      [userId, JSON.stringify({ gmail_email: gmailEmail })]
    );

    await client.query('COMMIT');

    return { userId, created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureUserRecord(
  requestedId?: string
): Promise<{ userId: string; created: boolean }> {
  const userId = isValidUUID(requestedId) ? requestedId : randomUUID();
  const email = placeholderEmailFor(userId);
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [userId, email]
    );
    const inserted = result.rowCount ?? 0;
    return { userId, created: inserted > 0 };
  } finally {
    client.release();
  }
}

export async function getUserProfile(userId: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT document,
              full_name as "fullName",
              preferred_name as "preferredName",
              timezone,
              contact_email as "contactEmail",
              phone,
              company,
              role,
              preferences,
              biography,
              custom_data as "customData",
              updated_at as "updatedAt",
              gmail_onboarded as "gmailOnboarded"
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );
    if (result.rowCount === 0) {
      return null;
    }
    const row = result.rows[0] as {
      document: Record<string, unknown> | null;
      fullName?: string | null;
      preferredName?: string | null;
      timezone?: string | null;
      contactEmail?: string | null;
      phone?: string | null;
      company?: string | null;
      role?: string | null;
      preferences?: unknown;
      biography?: string | null;
      customData?: Record<string, unknown>;
      updatedAt: string;
      gmailOnboarded: boolean;
    };
    const hasDocument = row.document && typeof row.document === 'object' && Object.keys(row.document).length > 0;
    const doc: Record<string, unknown> = hasDocument
      ? { ...row.document }
      : legacyRowToDocument(row);
    const profile = { ...doc, updatedAt: row.updatedAt, gmailOnboarded: row.gmailOnboarded } as Record<string, unknown>;
    if (profile?.customData && typeof profile.customData === 'object' && 'notes' in profile.customData) {
      const cd = profile.customData as { notes?: unknown };
      cd.notes = normalizeProfileNotes(cd.notes);
    }
    return profile;
  } finally {
    client.release();
  }
}

function legacyRowToDocument(row: {
  fullName?: string | null;
  preferredName?: string | null;
  timezone?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  preferences?: unknown;
  biography?: string | null;
  customData?: Record<string, unknown>;
}): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    fullName: row.fullName ?? null,
    preferredName: row.preferredName ?? null,
    timezone: row.timezone ?? null,
    contactEmail: row.contactEmail ?? null,
    phone: row.phone ?? null,
    company: row.company ?? null,
    role: row.role ?? null,
    preferences: row.preferences ?? null,
    biography: row.biography ?? null
  };
  if (row.customData && typeof row.customData === 'object' && Object.keys(row.customData).length > 0) {
    doc.customData = row.customData;
  }
  return doc;
}

export async function getGmailOnboardingStatus(userId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT gmail_onboarded FROM user_profiles WHERE user_id = $1`,
      [userId]
    );
    if (result.rowCount === 0) {
      return false;
    }
    return result.rows[0].gmail_onboarded === true;
  } finally {
    client.release();
  }
}

export async function setGmailOnboardingStatus(userId: string, onboarded: boolean): Promise<void> {
  await ensureUserRecord(userId);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO user_profiles (user_id, gmail_onboarded, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET gmail_onboarded = EXCLUDED.gmail_onboarded,
                     updated_at = NOW()`,
      [userId, onboarded]
    );
  } finally {
    client.release();
  }
}

/**
 * Deep-merge incoming object into existing document (one level for nested objects).
 * Top-level keys are replaced; nested objects (e.g. customData) are merged.
 */
function mergeIntoDocument(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const out = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (key === 'updatedAt' || key === 'gmailOnboarded') continue;
    const inc = incoming[key];
    const cur = out[key];
    if (inc != null && typeof inc === 'object' && !Array.isArray(inc) && typeof cur === 'object' && cur != null && !Array.isArray(cur)) {
      out[key] = { ...(cur as Record<string, unknown>), ...(inc as Record<string, unknown>) };
    } else {
      out[key] = inc;
    }
  }
  if (out.customData && typeof out.customData === 'object' && 'notes' in (out.customData as object)) {
    const cd = out.customData as { notes?: unknown };
    cd.notes = normalizeProfileNotes(cd.notes);
  }
  return out;
}

export async function upsertUserProfile(userId: string, data: Record<string, unknown>) {
  const client = await pool.connect();
  try {
    await ensureUserRecord(userId);
    const existingRes = await client.query(
      `SELECT document FROM user_profiles WHERE user_id = $1`,
      [userId]
    );
    const existingDoc = (existingRes.rows[0]?.document ?? {}) as Record<string, unknown>;
    const merged = mergeIntoDocument(existingDoc, data);
    await client.query(
      `INSERT INTO user_profiles (user_id, document, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET document = EXCLUDED.document, updated_at = NOW()`,
      [userId, JSON.stringify(merged)]
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
  graphMetrics?: Record<string, unknown> | null;
  graphSyncedAt?: Date | null;
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
              mi.graph_metrics as "graphMetrics",
              mi.graph_synced_at as "graphSyncedAt",
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
              mi.graph_metrics as "graphMetrics",
              mi.graph_synced_at as "graphSyncedAt",
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

export interface MemoryFileRecord {
  ingestionId: string;
  filePath: string;
  chunkCount: number;
  createdAt: Date;
  batchName?: string | null;
}

export async function listMemoryFileNodes(userId: string, limit = 400): Promise<MemoryFileRecord[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT mc.ingestion_id as "ingestionId",
              mc.file_path as "filePath",
              COUNT(*) as "chunkCount",
              mi.created_at as "createdAt",
              mi.batch_name as "batchName"
         FROM memory_chunks mc
         JOIN memory_ingestions mi ON mi.id = mc.ingestion_id
        WHERE mi.user_id = $1
          AND mi.source = 'bespoke_memory'
        GROUP BY mc.ingestion_id, mc.file_path, mi.created_at, mi.batch_name
        ORDER BY mi.created_at DESC, mc.file_path ASC
        LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map((row) => ({
      ingestionId: row.ingestionId as string,
      filePath: row.filePath as string,
      chunkCount: Number(row.chunkCount) || 0,
      createdAt: row.createdAt as Date,
      batchName: row.batchName as string | null
    }));
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
      `UPDATE memory_chunks
          SET embedding = NULL,
              graph_metadata = COALESCE(graph_metadata, '{}'::jsonb) - 'similarNeighbors'
        WHERE ingestion_id = $1`,
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
              mi.graph_metrics as "graphMetrics",
              mi.graph_synced_at as "graphSyncedAt",
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

export async function insertMemoryChunks(params: {
  ingestionId: string;
  userId: string;
  source: string;
  filePath: string;
  chunks: Array<{ chunkIndex: number; content: string; metadata?: Record<string, unknown> }>;
}) {
  if (!params.chunks.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const chunk of params.chunks) {
      await client.query(
        `INSERT INTO memory_chunks (id, ingestion_id, user_id, source, file_path, chunk_index, content, metadata)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [
          params.ingestionId,
          params.userId,
          params.source,
          params.filePath,
          chunk.chunkIndex,
          chunk.content,
          chunk.metadata ?? {}
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface GraphNodeRecord {
  id: string;
  nodeType: GraphNodeType;
  displayName?: string | null;
  summary?: string | null;
  sourceUri?: string | null;
  metadata: Record<string, unknown>;
}

export interface GraphEdgeRecord {
  id: string;
  edgeType: GraphEdgeType;
  fromId: string;
  toId: string;
  weight?: number | null;
  score?: number | null;
  confidence?: number | null;
  rank?: number | null;
  metadata: Record<string, unknown>;
}

export interface GraphSliceResult {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  meta: {
    sliceId?: string | null;
    ingestionId?: string | null;
    nodeCount: number;
    edgeCount: number;
    filters: {
      nodeTypes?: GraphNodeType[];
      edgeTypes?: GraphEdgeType[];
      limit: number;
      edgeLimit: number;
      ingestionId?: string;
    };
  };
}

interface IngestionGraphRow {
  id: string;
  userId: string;
  source: string;
  batchName: string | null;
  totalFiles: number | null;
  chunkedFiles: number | null;
  indexedChunks: number | null;
  graphMetrics: Record<string, unknown> | null;
}

interface ChunkGraphRow {
  id: string;
  filePath: string;
  chunkIndex: number;
  content: string;
  displayName: string | null;
  summary: string | null;
  graphMetadata: Record<string, unknown>;
  createdAt: Date;
}

interface IngestionGraphInput {
  ingestion: IngestionGraphRow;
  chunks: ChunkGraphRow[];
}

interface GraphData {
  ingestionId: string;
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  nodeMap: Map<string, GraphNodeRecord>;
  adjacency: Map<string, GraphEdgeRecord[]>;
}

type NodeFilter = Set<GraphNodeType> | null;
type EdgeFilter = Set<GraphEdgeType> | null;

function summarizeText(content: string, limit = 180): string {
  const normalized = (content || '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function loadIngestionGraphInput(
  client: PoolClient,
  userId: string,
  ingestionId: string
): Promise<IngestionGraphInput | null> {
  const ingestionResult = await client.query<IngestionGraphRow>(
    `SELECT id,
            user_id as "userId",
            source,
            batch_name as "batchName",
            total_files as "totalFiles",
            chunked_files as "chunkedFiles",
            indexed_chunks as "indexedChunks",
            graph_metrics as "graphMetrics"
       FROM memory_ingestions
      WHERE id = $1 AND user_id = $2
      LIMIT 1`,
    [ingestionId, userId]
  );
  if (ingestionResult.rowCount === 0) {
    return null;
  }
  const chunkResult = await client.query<ChunkGraphRow>(
    `SELECT id,
            file_path as "filePath",
            chunk_index as "chunkIndex",
            content,
            display_name as "displayName",
            summary,
            graph_metadata as "graphMetadata",
            created_at as "createdAt"
       FROM memory_chunks
      WHERE ingestion_id = $1 AND user_id = $2
      ORDER BY file_path, chunk_index`,
    [ingestionId, userId]
  );
  return {
    ingestion: ingestionResult.rows[0],
    chunks: chunkResult.rows.map((row) => ({
      ...row,
      graphMetadata: asRecord(row.graphMetadata)
    }))
  };
}

function createGraphData(input: IngestionGraphInput): GraphData {
  const nodes: GraphNodeRecord[] = [];
  const edges: GraphEdgeRecord[] = [];
  const nodeMap = new Map<string, GraphNodeRecord>();
  const adjacency = new Map<string, GraphEdgeRecord[]>();
  const metrics = asRecord(input.ingestion.graphMetrics);
  const ingestionId = input.ingestion.id;
  const documentNodeId =
    typeof metrics.documentNodeId === 'string'
      ? (metrics.documentNodeId as string)
      : makeNodeId(GraphNodeType.DOCUMENT, ingestionId);

  const documentNode: GraphNodeRecord = {
    id: documentNodeId,
    nodeType: GraphNodeType.DOCUMENT,
    displayName: input.ingestion.batchName ?? 'Bespoke Upload',
    summary: `Bespoke upload (${input.ingestion.totalFiles ?? input.chunks.length} files)`,
    sourceUri: null,
    metadata: {
      ingestionId,
      source: input.ingestion.source,
      batchName: input.ingestion.batchName,
      totalFiles: input.ingestion.totalFiles,
      chunkCount: input.chunks.length,
      chunkedFiles: input.ingestion.chunkedFiles,
      indexedChunks: input.ingestion.indexedChunks
    }
  };

  nodes.push(documentNode);
  nodeMap.set(documentNode.id, documentNode);
  adjacency.set(documentNode.id, []);

  const sectionEntries = new Map<
    string,
    { node: GraphNodeRecord; chunkNodeIds: string[] }
  >();
  const chunkNodeLookup = new Map<string, string>();
  let nextSectionOrder = 0;

  input.chunks.forEach((row) => {
    const graphMeta = asRecord(row.graphMetadata);
    const sectionNodeId =
      typeof graphMeta.sectionNodeId === 'string'
        ? (graphMeta.sectionNodeId as string)
        : makeNodeId(GraphNodeType.SECTION, ingestionId, row.filePath);
    if (!sectionEntries.has(sectionNodeId)) {
      const sectionOrder =
        typeof graphMeta.sectionOrder === 'number' ? graphMeta.sectionOrder : nextSectionOrder++;
      const sectionNode: GraphNodeRecord = {
        id: sectionNodeId,
        nodeType: GraphNodeType.SECTION,
        displayName: row.filePath,
        summary: '',
        sourceUri: row.filePath,
        metadata: {
          ingestionId,
          filePath: row.filePath,
          sectionOrder,
          documentNodeId: documentNodeId
        }
      };
      sectionEntries.set(sectionNodeId, { node: sectionNode, chunkNodeIds: [] });
      adjacency.set(sectionNodeId, []);
      nodeMap.set(sectionNodeId, sectionNode);
      nodes.push(sectionNode);
    }

    const chunkNodeId =
      typeof graphMeta.chunkNodeId === 'string'
        ? (graphMeta.chunkNodeId as string)
        : makeNodeId(GraphNodeType.CHUNK, row.id);
    chunkNodeLookup.set(row.id, chunkNodeId);

    const chunkNode: GraphNodeRecord = {
      id: chunkNodeId,
      nodeType: GraphNodeType.CHUNK,
      displayName: row.displayName ?? `${row.filePath}#${row.chunkIndex}`,
      summary: row.summary ?? summarizeText(row.content),
      sourceUri: row.filePath,
      metadata: {
        ...graphMeta,
        ingestionId,
        chunkId: row.id,
        filePath: row.filePath,
        chunkIndex: row.chunkIndex,
        sectionNodeId
      }
    };
    nodes.push(chunkNode);
    nodeMap.set(chunkNodeId, chunkNode);
    adjacency.set(chunkNodeId, []);
    const entry = sectionEntries.get(sectionNodeId);
    entry?.chunkNodeIds.push(chunkNodeId);
  });

  sectionEntries.forEach((entry) => {
    const chunkCount = entry.chunkNodeIds.length;
    entry.node.summary = `${chunkCount} chunk${chunkCount === 1 ? '' : 's'}`;
    entry.node.metadata = {
      ...(entry.node.metadata ?? {}),
      chunkCount
    };
  });

  const registerEdge = (edge: GraphEdgeRecord) => {
    edges.push(edge);
    const fromList = adjacency.get(edge.fromId) ?? [];
    fromList.push(edge);
    adjacency.set(edge.fromId, fromList);
    const toList = adjacency.get(edge.toId) ?? [];
    toList.push(edge);
    adjacency.set(edge.toId, toList);
  };

  sectionEntries.forEach((entry, sectionId) => {
    registerEdge({
      id: makeEdgeId(GraphEdgeType.HAS_SECTION, documentNodeId, sectionId),
      edgeType: GraphEdgeType.HAS_SECTION,
      fromId: documentNodeId,
      toId: sectionId,
      metadata: {
        ingestionId,
        filePath: entry.node.metadata?.filePath,
        order: entry.node.metadata?.sectionOrder ?? null
      }
    });
    entry.chunkNodeIds.forEach((chunkNodeId) => {
      registerEdge({
        id: makeEdgeId(GraphEdgeType.HAS_CHUNK, sectionId, chunkNodeId),
        edgeType: GraphEdgeType.HAS_CHUNK,
        fromId: sectionId,
        toId: chunkNodeId,
        metadata: {
          ingestionId,
          filePath: entry.node.metadata?.filePath
        }
      });
    });
  });

  const seenPairs = new Set<string>();
  input.chunks.forEach((row) => {
    const chunkNodeId = chunkNodeLookup.get(row.id);
    if (!chunkNodeId) return;
    const graphMeta = asRecord(row.graphMetadata);
    const neighbors = Array.isArray(graphMeta.similarNeighbors)
      ? (graphMeta.similarNeighbors as Array<Record<string, unknown>>)
      : [];
    neighbors.forEach((neighbor) => {
      const neighborId =
        typeof neighbor.chunkNodeId === 'string' ? (neighbor.chunkNodeId as string) : null;
      if (!neighborId || neighborId === chunkNodeId) return;
      const pairKey = [chunkNodeId, neighborId].sort().join('::');
      if (seenPairs.has(pairKey)) return;
      seenPairs.add(pairKey);
      registerEdge({
        id: makeEdgeId(GraphEdgeType.SIMILAR_TO, chunkNodeId, neighborId),
        edgeType: GraphEdgeType.SIMILAR_TO,
        fromId: chunkNodeId,
        toId: neighborId,
        weight: typeof neighbor.score === 'number' ? (neighbor.score as number) : undefined,
        score: typeof neighbor.score === 'number' ? (neighbor.score as number) : undefined,
        metadata: {
          ingestionId,
          score: neighbor.score ?? null,
          method: 'pgvector_cosine'
        }
      });
    });
  });

  return {
    ingestionId,
    nodes,
    edges,
    nodeMap,
    adjacency
  };
}

function applyNodeFilter(nodes: GraphNodeRecord[], filter: NodeFilter, limit: number) {
  const filtered = filter
    ? nodes.filter((node) => filter.has(node.nodeType))
    : nodes.slice();
  return filtered.slice(0, limit);
}

function applyEdgeFilter(
  edges: GraphEdgeRecord[],
  filter: EdgeFilter,
  limit: number,
  allowedNodeIds: Set<string>
) {
  const filtered = edges.filter((edge) => {
    if (filter && !filter.has(edge.edgeType)) return false;
    if (!allowedNodeIds.has(edge.fromId) && !allowedNodeIds.has(edge.toId)) return false;
    return true;
  });
  return filtered.slice(0, limit);
}

function buildEmptyGraphResult(params: {
  nodeTypes?: GraphNodeType[];
  edgeTypes?: GraphEdgeType[];
  limit: number;
  edgeLimit: number;
  ingestionId?: string;
}): GraphSliceResult {
  return {
    nodes: [],
    edges: [],
    meta: {
      sliceId: params.ingestionId ?? null,
      ingestionId: params.ingestionId ?? null,
      nodeCount: 0,
      edgeCount: 0,
      filters: {
        nodeTypes: params.nodeTypes,
        edgeTypes: params.edgeTypes,
        limit: params.limit,
        edgeLimit: params.edgeLimit,
        ingestionId: params.ingestionId
      }
    }
  };
}

async function resolveIngestionIdForNode(
  client: PoolClient,
  userId: string,
  nodeId: string
): Promise<string | null> {
  const parsed = parseNodeId(nodeId);
  if (!parsed.type) {
    return null;
  }
  if (parsed.type === GraphNodeType.DOCUMENT || parsed.type === GraphNodeType.SECTION) {
    return parsed.ingestionId ?? null;
  }
  if (parsed.type === GraphNodeType.CHUNK) {
    const chunkId = parsed.chunkId;
    if (!chunkId) return null;
    const result = await client.query<{ ingestionId: string }>(
      `SELECT ingestion_id as "ingestionId"
         FROM memory_chunks
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [chunkId, userId]
    );
    if (result.rowCount === 0) return null;
    return result.rows[0].ingestionId;
  }
  return null;
}

export async function fetchGraphSlice(params: {
  userId: string;
  sliceId?: string;
  nodeTypes?: GraphNodeType[];
  edgeTypes?: GraphEdgeType[];
  limit?: number;
  edgeLimit?: number;
  ingestionId?: string;
}): Promise<GraphSliceResult> {
  const limit = params.limit ?? 200;
  const edgeLimit = params.edgeLimit ?? 400;
  const nodeFilter = params.nodeTypes && params.nodeTypes.length ? new Set(params.nodeTypes) : null;
  const edgeFilter = params.edgeTypes && params.edgeTypes.length ? new Set(params.edgeTypes) : null;
  const targetIngestionId = params.ingestionId ?? params.sliceId ?? null;
  if (!targetIngestionId) {
    return buildEmptyGraphResult({
      nodeTypes: params.nodeTypes,
      edgeTypes: params.edgeTypes,
      limit,
      edgeLimit
    });
  }
  const client = await pool.connect();
  try {
    const input = await loadIngestionGraphInput(client, params.userId, targetIngestionId);
    if (!input) {
      return buildEmptyGraphResult({
        nodeTypes: params.nodeTypes,
        edgeTypes: params.edgeTypes,
        limit,
        edgeLimit,
        ingestionId: targetIngestionId
      });
    }
    const graph = createGraphData(input);
    const nodes = applyNodeFilter(graph.nodes, nodeFilter, limit);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = applyEdgeFilter(graph.edges, edgeFilter, edgeLimit, nodeIds);

    return {
      nodes,
      edges,
      meta: {
        sliceId: targetIngestionId,
        ingestionId: targetIngestionId,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        filters: {
          nodeTypes: params.nodeTypes,
          edgeTypes: params.edgeTypes,
          limit,
          edgeLimit,
          ingestionId: params.ingestionId
        }
      }
    };
  } finally {
    client.release();
  }
}

export async function fetchGraphNeighborhood(params: {
  userId: string;
  centerId: string;
  depth?: number;
  nodeTypes?: GraphNodeType[];
  edgeTypes?: GraphEdgeType[];
  nodeLimit?: number;
  edgeLimit?: number;
  ingestionId?: string;
}): Promise<GraphSliceResult> {
  const depth = Math.max(0, params.depth ?? 1);
  const nodeLimit = params.nodeLimit ?? 200;
  const edgeLimit = params.edgeLimit ?? 400;
  const nodeFilter = params.nodeTypes && params.nodeTypes.length ? new Set(params.nodeTypes) : null;
  const edgeFilter = params.edgeTypes && params.edgeTypes.length ? new Set(params.edgeTypes) : null;
  const client = await pool.connect();
  try {
    const inferredIngestionId =
      params.ingestionId ?? (await resolveIngestionIdForNode(client, params.userId, params.centerId));
    if (!inferredIngestionId) {
      return buildEmptyGraphResult({
        nodeTypes: params.nodeTypes,
        edgeTypes: params.edgeTypes,
        limit: nodeLimit,
        edgeLimit
      });
    }
    const input = await loadIngestionGraphInput(client, params.userId, inferredIngestionId);
    if (!input) {
      return buildEmptyGraphResult({
        nodeTypes: params.nodeTypes,
        edgeTypes: params.edgeTypes,
        limit: nodeLimit,
        edgeLimit,
        ingestionId: inferredIngestionId
      });
    }
    const graph = createGraphData(input);
    const queue: Array<{ id: string; depth: number }> = [{ id: params.centerId, depth: 0 }];
    const visited = new Set<string>();
    const visitOrder: GraphNodeRecord[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      const node = graph.nodeMap.get(current.id);
      if (node) {
        visitOrder.push(node);
      }
      if (current.depth >= depth) continue;
      const neighbors = graph.adjacency.get(current.id) ?? [];
      neighbors.forEach((edge) => {
        const neighborId = edge.fromId === current.id ? edge.toId : edge.fromId;
        if (!visited.has(neighborId)) {
          queue.push({ id: neighborId, depth: current.depth + 1 });
        }
      });
    }

    let nodes = visitOrder.filter((node) => (nodeFilter ? nodeFilter.has(node.nodeType) : true));
    if (!nodes.find((node) => node.id === params.centerId)) {
      const centerNode = graph.nodeMap.get(params.centerId);
      if (centerNode) {
        nodes = [centerNode, ...nodes];
      }
    }
    nodes = nodes.slice(0, nodeLimit);
    const allowedNodeIds = new Set(nodes.map((node) => node.id));

    const candidateEdges = graph.edges.filter(
      (edge) => visited.has(edge.fromId) && visited.has(edge.toId)
    );
    const edges = candidateEdges
      .filter((edge) => (edgeFilter ? edgeFilter.has(edge.edgeType) : true))
      .filter((edge) => allowedNodeIds.has(edge.fromId) || allowedNodeIds.has(edge.toId))
      .slice(0, edgeLimit);

    return {
      nodes,
      edges,
      meta: {
        sliceId: null,
        ingestionId: inferredIngestionId,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        filters: {
          nodeTypes: params.nodeTypes,
          edgeTypes: params.edgeTypes,
          limit: nodeLimit,
          edgeLimit,
          ingestionId: params.ingestionId ?? inferredIngestionId
        }
      }
    };
  } finally {
    client.release();
  }
}

export interface ServiceAccount {
  id: string;
  userId: string;
  email: string;
  name?: string;
  provider: string;
  tokens: {
    access_token: string;
    refresh_token: string;
    expiry_date?: number;
    [key: string]: any;
  };
  filterKeywords: string[];
  createdAt: Date;
  updatedAt: Date;
}

export async function createServiceAccount(params: {
  userId: string;
  email: string;
  name?: string;
  tokens: any;
  filterKeywords?: string[];
}): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO service_accounts (user_id, email, tokens, filter_keywords, name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, email) 
       DO UPDATE SET 
         tokens = EXCLUDED.tokens,
         name = COALESCE(EXCLUDED.name, service_accounts.name),
         updated_at = NOW()
       RETURNING id`,
      [
        params.userId,
        params.email,
        JSON.stringify(params.tokens),
        JSON.stringify(params.filterKeywords || []),
        params.name || null
      ]
    );
    return result.rows[0].id as string;
  } finally {
    client.release();
  }
}

export async function getServiceAccounts(userId: string): Promise<ServiceAccount[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, user_id, email, name, provider, tokens, filter_keywords, created_at, updated_at
       FROM service_accounts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      provider: row.provider,
      tokens: row.tokens,
      filterKeywords: row.filter_keywords,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } finally {
    client.release();
  }
}

export async function getServiceAccountById(accountId: string): Promise<ServiceAccount | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, user_id, email, name, provider, tokens, filter_keywords, created_at, updated_at
       FROM service_accounts
       WHERE id = $1`,
      [accountId]
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      provider: row.provider,
      tokens: row.tokens,
      filterKeywords: row.filter_keywords,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } finally {
    client.release();
  }
}

export async function updateServiceAccountTokens(accountId: string, tokens: any) {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE service_accounts
       SET tokens = $2, updated_at = NOW()
       WHERE id = $1`,
      [accountId, JSON.stringify(tokens)]
    );
  } finally {
    client.release();
  }
}

export async function deleteServiceAccount(accountId: string) {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM service_accounts WHERE id = $1`, [accountId]);
  } finally {
    client.release();
  }
}

export async function createServiceAccountJob(accountId: string): Promise<string> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO service_account_jobs (account_id, status, progress, logs, message)
       VALUES ($1, 'pending', 0, '{}', 'Job started')
       RETURNING id`,
      [accountId]
    );
    return result.rows[0].id as string;
  } finally {
    client.release();
  }
}

export async function updateServiceAccountJob(params: {
  jobId: string;
  status?: string;
  progress?: number;
  message?: string;
  log?: string;
}) {
  const client = await pool.connect();
  try {
    const updates: string[] = [];
    const values: any[] = [params.jobId];
    let idx = 2;

    if (params.status) {
      updates.push(`status = $${idx++}`);
      values.push(params.status);
    }
    if (params.progress !== undefined) {
      updates.push(`progress = $${idx++}`);
      values.push(params.progress);
    }
    if (params.message) {
      updates.push(`message = $${idx++}`);
      values.push(params.message);
    }
    if (params.log) {
      updates.push(`logs = array_append(logs, $${idx++})`);
      values.push(params.log);
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) return; // Only updated_at

    await client.query(
      `UPDATE service_account_jobs SET ${updates.join(', ')} WHERE id = $1`,
      values
    );
  } finally {
    client.release();
  }
}

export interface ServiceAccountJob {
  id: string;
  accountId: string;
  status: string;
  progress: number;
  logs: string[];
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getServiceAccountJob(jobId: string): Promise<ServiceAccountJob | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, account_id, status, progress, logs, message, created_at, updated_at
       FROM service_account_jobs
       WHERE id = $1`,
      [jobId]
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      accountId: row.account_id,
      status: row.status,
      progress: row.progress,
      logs: row.logs || [],
      message: row.message,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  } finally {
    client.release();
  }
}

export async function saveUserIntegration(params: {
  userId: string;
  provider: string;
  accessToken: string;
  refreshToken: string;
  expiry: Date | null;
  metadata?: any;
}) {
  await ensureUserRecord(params.userId);
  const encryptedAccess = encryptSecret(params.accessToken);
  const encryptedRefresh = encryptSecret(params.refreshToken);

  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO user_integrations (id, user_id, provider, access_token_enc, refresh_token_enc, expires_at, metadata, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, NOW())
      ON CONFLICT (user_id, provider)
      DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc,
                    refresh_token_enc = EXCLUDED.refresh_token_enc,
                    expires_at = EXCLUDED.expires_at,
                    metadata = COALESCE(user_integrations.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                    updated_at = NOW()
    `;
    await client.query(query, [
      params.userId,
      params.provider,
      JSON.stringify(encryptedAccess),
      JSON.stringify(encryptedRefresh),
      params.expiry,
      JSON.stringify(params.metadata || {})
    ]);
  } finally {
    client.release();
  }
}

export async function getUserIntegration(userId: string, provider: string) {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT access_token_enc, refresh_token_enc, expires_at, metadata
       FROM user_integrations
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );

    if (result.rowCount === 0) return null;

    const row = result.rows[0];
    let accessTokenEnc = row.access_token_enc;
    if (typeof accessTokenEnc === 'string') {
      try { accessTokenEnc = JSON.parse(accessTokenEnc); } catch (e) { }
    }

    let refreshTokenEnc = row.refresh_token_enc;
    if (typeof refreshTokenEnc === 'string') {
      try { refreshTokenEnc = JSON.parse(refreshTokenEnc); } catch (e) { }
    }

    const accessToken = decryptSecret(accessTokenEnc);
    const refreshToken = decryptSecret(refreshTokenEnc);

    return {
      accessToken,
      refreshToken,
      expiresAt: row.expires_at as Date | null,
      metadata: row.metadata
    };
  } catch (error) {
    console.error(`Failed to get integration tokens for provider ${provider}`, error);
    return null;
  } finally {
    client.release();
  }
}

// Whoop Persistence Helpers

export async function saveWhoopCycle(userId: string, data: any) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO whoop_cycles (user_id, whoop_id, start_time, end_time, score_state, strain, kilojoules, average_heart_rate, max_heart_rate, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (whoop_id) DO UPDATE SET
         end_time = EXCLUDED.end_time,
         score_state = EXCLUDED.score_state,
         strain = EXCLUDED.strain,
         kilojoules = EXCLUDED.kilojoules,
         average_heart_rate = EXCLUDED.average_heart_rate,
         max_heart_rate = EXCLUDED.max_heart_rate,
         raw_data = EXCLUDED.raw_data,
         updated_at = NOW()`,
      [
        userId,
        data.id,
        data.start,
        data.end || null,
        data.score_state,
        data.score?.strain,
        data.score?.kilojoule,
        data.score?.average_heart_rate,
        data.score?.max_heart_rate,
        JSON.stringify(data)
      ]
    );
  } finally {
    client.release();
  }
}

export async function saveWhoopRecovery(userId: string, data: any) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO whoop_recoveries (user_id, cycle_id, whoop_id, score, rhr, hrv_rmssd_milli, spo2_percentage, skin_temp_celsius, sleep_state, score_state, timestamp, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (whoop_id) DO UPDATE SET
         score = EXCLUDED.score,
         rhr = EXCLUDED.rhr,
         hrv_rmssd_milli = EXCLUDED.hrv_rmssd_milli,
         spo2_percentage = EXCLUDED.spo2_percentage,
         skin_temp_celsius = EXCLUDED.skin_temp_celsius,
         sleep_state = EXCLUDED.sleep_state,
         score_state = EXCLUDED.score_state,
         raw_data = EXCLUDED.raw_data`,
      [
        userId,
        data.cycle_id,
        data.id || (data.cycle_id ? data.cycle_id * 10 : undefined),
        data.score?.recovery_score,
        data.score?.resting_heart_rate,
        data.score?.hrv_rmssd_milli,
        data.score?.spo2_percentage,
        data.score?.skin_temp_celsius,
        data.sleep_state,
        data.score_state,
        data.timestamp,
        JSON.stringify(data)
      ]
    );
  } finally {
    client.release();
  }
}

export async function saveWhoopSleep(userId: string, data: any) {
  const client = await pool.connect();
  try {
    const s = data.score;
    await client.query(
      `INSERT INTO whoop_sleeps (user_id, whoop_id, cycle_id, start_time, end_time, score_state, performance_percentage, consistency_percentage, efficiency_percentage, time_in_bed_milli, light_sleep_milli, slow_wave_sleep_milli, rem_sleep_milli, awake_milli, sleep_need_milli, respiratory_rate, sleep_debt_milli, wake_count, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (whoop_id) DO UPDATE SET
         end_time = EXCLUDED.end_time,
         score_state = EXCLUDED.score_state,
         performance_percentage = EXCLUDED.performance_percentage,
         efficiency_percentage = EXCLUDED.efficiency_percentage,
         light_sleep_milli = EXCLUDED.light_sleep_milli,
         slow_wave_sleep_milli = EXCLUDED.slow_wave_sleep_milli,
         rem_sleep_milli = EXCLUDED.rem_sleep_milli,
         awake_milli = EXCLUDED.awake_milli,
         respiratory_rate = EXCLUDED.respiratory_rate,
         raw_data = EXCLUDED.raw_data`,
      [
        userId,
        data.id,
        data.cycle_id,
        data.start,
        data.end,
        data.score_state,
        s?.stage_summary?.total_in_bed_time_milli ? (data.score?.sleep_performance_percentage) : null,
        s?.sleep_consistency_percentage,
        s?.sleep_efficiency_percentage,
        s?.stage_summary?.total_in_bed_time_milli,
        s?.stage_summary?.light_sleep_milli,
        s?.stage_summary?.slow_wave_sleep_milli,
        s?.stage_summary?.rem_sleep_milli,
        s?.stage_summary?.awake_milli,
        s?.sleep_needed?.baseline_milli,
        s?.respiratory_rate,
        s?.sleep_needed?.debt_milli,
        s?.stage_summary?.wake_count || 0,
        JSON.stringify(data)
      ]
    );
  } finally {
    client.release();
  }
}

export async function saveWhoopWorkout(userId: string, data: any) {
  const client = await pool.connect();
  try {
    const s = data.score;
    await client.query(
      `INSERT INTO whoop_workouts (user_id, whoop_id, cycle_id, sport_id, start_time, end_time, score_state, strain, average_heart_rate, max_heart_rate, kilojoules, distance_meter, altitude_gain_meter, altitude_change_meter, zone_durations, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (whoop_id) DO UPDATE SET
         end_time = EXCLUDED.end_time,
         score_state = EXCLUDED.score_state,
         strain = EXCLUDED.strain,
         average_heart_rate = EXCLUDED.average_heart_rate,
         max_heart_rate = EXCLUDED.max_heart_rate,
         kilojoules = EXCLUDED.kilojoules,
         raw_data = EXCLUDED.raw_data`,
      [
        userId,
        data.id,
        data.cycle_id,
        data.sport_id,
        data.start,
        data.end,
        data.score_state,
        s?.strain,
        s?.average_heart_rate,
        s?.max_heart_rate,
        s?.kilojoule,
        s?.distance_meter,
        s?.altitude_gain_meter,
        s?.altitude_change_meter,
        JSON.stringify(s?.zone_duration || {}),
        JSON.stringify(data)
      ]
    );
  } finally {
    client.release();
  }
}

export async function saveWhoopMeasurement(userId: string, data: any) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO whoop_measurements (user_id, height_meter, weight_kg, max_heart_rate, raw_data)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId,
        data.height_meter,
        data.weight_kg,
        data.max_heart_rate,
        JSON.stringify(data)
      ]
    );
  } finally {
    client.release();
  }
}

export async function listUsersWithWhoopIntegration(): Promise<string[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT DISTINCT user_id FROM user_integrations WHERE provider = 'whoop'`
    );
    return result.rows.map(r => r.user_id);
  } finally {
    client.release();
  }
}

/** Task cards: feed_cards with type='task'; data = { description, due_date?, status?, source?, thread_id? } */
export interface TaskCardData {
  description: string;
  due_date?: string | null;
  status?: string;
  source?: string;
  thread_id?: string | null;
}

export async function listTaskCards(userId: string, limit = 50): Promise<Array<{ id: string; data: TaskCardData; status: string; created_at: Date }>> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, data, status, created_at
       FROM feed_cards
       WHERE user_id = $1 AND type = 'task'
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      data: row.data && typeof row.data === 'object' ? row.data : { description: '', status: 'open' },
      status: row.status ?? 'active',
      created_at: row.created_at
    }));
  } finally {
    client.release();
  }
}

export async function createTaskCard(userId: string, data: TaskCardData): Promise<string> {
  const client = await pool.connect();
  try {
    const payload = {
      description: data.description || '',
      due_date: data.due_date ?? null,
      status: data.status ?? 'open',
      source: data.source ?? 'chat',
      thread_id: data.thread_id ?? null
    };
    const result = await client.query(
      `INSERT INTO feed_cards (user_id, type, priority_score, data, status)
       VALUES ($1, 'task', 0, $2::jsonb, 'active')
       RETURNING id`,
      [userId, JSON.stringify(payload)]
    );
    return result.rows[0].id as string;
  } finally {
    client.release();
  }
}
