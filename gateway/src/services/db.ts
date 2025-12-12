import { Pool } from 'pg';
import { config } from '../config';
import { GraphEdgeType, GraphNodeType } from '../graph/types';
import { normalizeProfileNotes } from '../utils/profile';

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
    const profile = result.rows[0] as {
      customData?: {
        notes?: Array<string | { text?: string; timestamp?: string | null }>;
        [key: string]: unknown;
      };
    };
    if (profile?.customData?.notes) {
      profile.customData.notes = normalizeProfileNotes(profile.customData.notes);
    }
    return profile;
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
    const existingNotes = normalizeProfileNotes(existingCustom.notes);
    const incomingNotes = normalizeProfileNotes(incomingCustom.notes);
    const notesProvided = Object.prototype.hasOwnProperty.call(incomingCustom, 'notes');
    if (notesProvided) {
      if (incomingNotes.length > 0) {
        mergedCustom.notes = incomingNotes;
      } else {
        delete mergedCustom.notes;
      }
    } else if (existingNotes.length > 0) {
      mergedCustom.notes = existingNotes;
    } else {
      delete mergedCustom.notes;
    }
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

export async function fetchGraphSlice(params: {
  userId: string;
  sliceId?: string;
  nodeTypes?: GraphNodeType[];
  edgeTypes?: GraphEdgeType[];
  limit?: number;
  edgeLimit?: number;
  ingestionId?: string;
}): Promise<GraphSliceResult> {
  const client = await pool.connect();
  const limit = params.limit ?? 200;
  const edgeLimit = params.edgeLimit ?? 400;
  const nodeTypeFilter =
    params.nodeTypes && params.nodeTypes.length > 0 ? params.nodeTypes.map((type) => type) : null;
  const edgeTypeFilter =
    params.edgeTypes && params.edgeTypes.length > 0 ? params.edgeTypes.map((type) => type) : null;
  const sliceFilter = params.sliceId ?? null;
  const ingestionFilter = params.ingestionId ?? null;
  try {
    const nodesResult = await client.query(
      `SELECT id,
              node_type::text as "nodeType",
              display_name as "displayName",
              summary,
              source_uri as "sourceUri",
              metadata
         FROM graph_nodes
        WHERE user_id = $1
          AND ($2::text IS NULL OR metadata->>'slice_id' = $2)
          AND ($3::text[] IS NULL OR node_type::text = ANY($3::text[]))
          AND ($4::uuid IS NULL OR metadata->>'ingestion_id' = $4::text)
        ORDER BY updated_at DESC
        LIMIT $5`,
      [params.userId, sliceFilter, nodeTypeFilter, ingestionFilter, limit]
    );
    const nodes = nodesResult.rows as GraphNodeRecord[];
    let edges: GraphEdgeRecord[] = [];
    if (nodes.length > 0) {
      const nodeIds = nodes.map((node) => node.id);
      const edgesResult = await client.query(
        `SELECT id,
                edge_type::text as "edgeType",
                from_id as "fromId",
                to_id as "toId",
                weight,
                score,
                confidence,
                rank,
                metadata
           FROM graph_edges
          WHERE user_id = $1
            AND ($2::text IS NULL OR metadata->>'slice_id' = $2)
            AND ($3::text IS NULL OR metadata->>'ingestion_id' = $3)
            AND (from_id = ANY($4::text[]) OR to_id = ANY($4::text[]))
            AND ($5::text[] IS NULL OR edge_type::text = ANY($5::text[]))
          LIMIT $6`,
        [params.userId, sliceFilter, ingestionFilter, nodeIds, edgeTypeFilter, edgeLimit]
      );
      edges = edgesResult.rows as GraphEdgeRecord[];
    }
    return {
      nodes,
      edges,
      meta: {
        sliceId: sliceFilter,
        ingestionId: ingestionFilter,
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

export async function fetchGraphNodesByIds(params: {
  userId: string;
  nodeIds: string[];
  nodeTypes?: GraphNodeType[];
  ingestionId?: string;
  limit?: number;
}): Promise<GraphNodeRecord[]> {
  if (params.nodeIds.length === 0) return [];
  const client = await pool.connect();
  const nodeTypeFilter =
    params.nodeTypes && params.nodeTypes.length > 0 ? params.nodeTypes.map((type) => type) : null;
  const ingestionFilter = params.ingestionId ?? null;
  const limit = params.limit ?? params.nodeIds.length;
  try {
    const result = await client.query(
      `SELECT id,
              node_type::text as "nodeType",
              display_name as "displayName",
              summary,
              source_uri as "sourceUri",
              metadata
         FROM graph_nodes
        WHERE user_id = $1
          AND id = ANY($2::text[])
          AND ($3::text[] IS NULL OR node_type::text = ANY($3::text[]))
          AND ($4::text IS NULL OR metadata->>'ingestion_id' = $4)
        LIMIT $5`,
      [params.userId, params.nodeIds, nodeTypeFilter, ingestionFilter, limit]
    );
    return result.rows as GraphNodeRecord[];
  } finally {
    client.release();
  }
}

export async function fetchGraphEdgesForNodes(params: {
  userId: string;
  nodeIds: string[];
  edgeTypes?: GraphEdgeType[];
  ingestionId?: string;
  limit?: number;
}): Promise<GraphEdgeRecord[]> {
  if (params.nodeIds.length === 0) return [];
  const client = await pool.connect();
  const edgeTypeFilter =
    params.edgeTypes && params.edgeTypes.length > 0 ? params.edgeTypes.map((type) => type) : null;
  const ingestionFilter = params.ingestionId ?? null;
  const limit = params.limit ?? 200;
  try {
    const result = await client.query(
      `SELECT id,
              edge_type::text as "edgeType",
              from_id as "fromId",
              to_id as "toId",
              weight,
              score,
              confidence,
              rank,
              metadata
         FROM graph_edges
        WHERE user_id = $1
          AND (from_id = ANY($2::text[]) OR to_id = ANY($2::text[]))
          AND ($3::text[] IS NULL OR edge_type::text = ANY($3::text[]))
          AND ($4::text IS NULL OR metadata->>'ingestion_id' = $4)
        LIMIT $5`,
      [params.userId, params.nodeIds, edgeTypeFilter, ingestionFilter, limit]
    );
    return result.rows as GraphEdgeRecord[];
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
  const depth = params.depth ?? 1;
  const nodeLimit = params.nodeLimit ?? 200;
  const edgeLimit = params.edgeLimit ?? 400;
  const visited = new Set<string>();
  const nodeMap = new Map<string, GraphNodeRecord>();
  const edgeMap = new Map<string, GraphEdgeRecord>();
  let frontier = new Set<string>([params.centerId]);
  let remainingNodes = nodeLimit;
  let remainingEdges = edgeLimit;

  for (let i = 0; i < depth; i += 1) {
    const batchIds = Array.from(frontier).filter((id) => !visited.has(id));
    if (!batchIds.length || remainingNodes <= 0) break;
    const nodes = await fetchGraphNodesByIds({
      userId: params.userId,
      nodeIds: batchIds,
      nodeTypes: params.nodeTypes,
      ingestionId: params.ingestionId,
      limit: remainingNodes
    });
    nodes.forEach((node) => {
      if (nodeMap.has(node.id)) return;
      nodeMap.set(node.id, node);
      visited.add(node.id);
      remainingNodes = Math.max(0, remainingNodes - 1);
    });
    const nodeIdsForEdges = nodes.map((node) => node.id);
    if (!nodeIdsForEdges.length || remainingEdges <= 0) break;
    const edges = await fetchGraphEdgesForNodes({
      userId: params.userId,
      nodeIds: nodeIdsForEdges,
      edgeTypes: params.edgeTypes,
      ingestionId: params.ingestionId,
      limit: remainingEdges
    });
    const nextFrontier = new Set<string>();
    edges.forEach((edge) => {
      if (!edgeMap.has(edge.id)) {
        edgeMap.set(edge.id, edge);
        remainingEdges = Math.max(0, remainingEdges - 1);
      }
      if (!visited.has(edge.fromId)) nextFrontier.add(edge.fromId);
      if (!visited.has(edge.toId)) nextFrontier.add(edge.toId);
    });
    frontier = nextFrontier;
    if (remainingEdges <= 0) {
      break;
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    meta: {
      sliceId: null,
      ingestionId: params.ingestionId ?? null,
      nodeCount: nodeMap.size,
      edgeCount: edgeMap.size,
      filters: {
        nodeTypes: params.nodeTypes,
        edgeTypes: params.edgeTypes,
        limit: nodeLimit,
        edgeLimit,
        ingestionId: params.ingestionId
      }
    }
  };
}
