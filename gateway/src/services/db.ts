import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { GraphEdgeType, GraphNodeType, makeEdgeId, makeNodeId, parseNodeId } from '../graph/types';
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
       ORDER BY ge.embedding <-> $2::vector
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
