import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import crypto from 'node:crypto';
import {
  createMemoryIngestion,
  getLatestMemoryIngestion,
  insertMemoryChunks,
  updateMemoryIngestion,
  listMemoryIngestions,
  deleteMemoryIngestion,
  resetIngestionEmbeddings,
  getMemoryIngestionById,
  clearAllMemoryIngestions,
  fetchGraphSlice,
  listMemoryFileNodes,
  type MemoryFileRecord
} from '../services/db';
import { triggerMemoryIndexing } from '../services/brainClient';
import { GraphNodeType, GraphEdgeType } from '../graph/types';
import { requireUserId } from '../utils/request';

const router = Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dest = path.join(process.cwd(), 'tmp', 'memory_uploads');
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.md')) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

router.post('/upload', upload.array('files'), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No Markdown files uploaded.' });
  }
  const pathsField = req.body.paths;
  const relativePaths: string[] = Array.isArray(pathsField)
    ? pathsField
    : typeof pathsField === 'string'
      ? [pathsField]
      : [];

  let batchName = 'Upload';
  if (relativePaths.length) {
    const firstPath = relativePaths[0];
    if (firstPath.includes('/')) {
      batchName = firstPath.split('/')[0] || batchName;
    } else {
      batchName = firstPath || batchName;
    }
  }

  const userId = requireUserId(req);
  try {
    const ingestionId = await createMemoryIngestion({
      userId,
      source: 'bespoke_memory',
      totalFiles: files.length,
      batchName
    });
    await updateMemoryIngestion({ ingestionId, status: 'chunking', processedFiles: 0, chunkedFiles: 0, error: null });
    processMemoryIngestion(files, relativePaths, ingestionId, userId).catch((error) => {
      console.error('Memory ingestion processing failed', error);
    });

    return res.json({ ingestionId, totalFiles: files.length });
  } catch (error) {
    console.error('Failed to start memory ingestion', error);
    return res.status(500).json({ error: 'Failed to start ingestion.' });
  }
});

const STATUS_LABELS: Record<string, string> = {
  chunking: 'Uploading',
  chunked: 'Ready to index',
  indexing: 'Indexing',
  uploaded: 'Uploaded',
  failed: 'Failed'
};

function formatIngestion(record: any) {
  const chunkedFiles = record.chunkedFiles ?? record.processedFiles ?? 0;
  return {
    id: record.id,
    status: record.status,
    statusLabel: STATUS_LABELS[record.status] ?? record.status,
    totalFiles: record.totalFiles ?? 0,
    chunkedFiles,
    indexedChunks: record.indexedChunks ?? 0,
    totalChunks: record.totalChunks ?? 0,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    lastIndexedAt: record.lastIndexedAt,
    batchName: record.batchName,
    error: record.error,
    graphMetrics: record.graphMetrics ?? null,
    graphSyncedAt: record.graphSyncedAt ?? null
  };
}

router.get('/status', async (req, res) => {
  const userId = requireUserId(req);
  try {
    const latest = await getLatestMemoryIngestion(userId, 'bespoke_memory');
    if (!latest) {
      return res.json({ ingestion: null });
    }
    return res.json({ ingestion: formatIngestion(latest) });
  } catch (error) {
    console.error('Failed to load memory ingestion status', error);
    return res.status(500).json({ error: 'Failed to load status.' });
  }
});

router.get('/history', async (req, res) => {
  const limit = Number(req.query.limit) || 10;
  const userId = requireUserId(req);
  try {
    const rows = await listMemoryIngestions(userId, limit);
    return res.json({ history: rows.map(formatIngestion) });
  } catch (error) {
    console.error('Failed to load ingestion history', error);
    return res.status(500).json({ error: 'Failed to load history.' });
  }
});

router.post('/:ingestionId/reindex', async (req, res) => {
  const ingestionId = req.params.ingestionId;
  const userId = requireUserId(req);
  try {
    const record = await getMemoryIngestionById(ingestionId, userId);
    if (!record) {
      return res.status(404).json({ error: 'Ingestion not found.' });
    }
    await resetIngestionEmbeddings(ingestionId);
    await updateMemoryIngestion({
      ingestionId,
      indexedChunks: 0,
      status: 'chunked',
      error: null,
      lastIndexedAt: null
    });
    await triggerMemoryIndexing(userId);
    return res.json({ status: 'queued' });
  } catch (error) {
    console.error('Failed to reindex ingestion', error);
    return res.status(500).json({ error: 'Failed to reindex ingestion.' });
  }
});

router.delete('/:ingestionId', async (req, res) => {
  const ingestionId = req.params.ingestionId;
  const userId = requireUserId(req);
  try {
    await deleteMemoryIngestion(ingestionId, userId);
    await triggerMemoryIndexing(userId);
    return res.json({ status: 'deleted' });
  } catch (error) {
    console.error('Failed to delete ingestion', error);
    return res.status(500).json({ error: 'Failed to delete ingestion.' });
  }
});

router.delete('/', async (req, res) => {
  const userId = requireUserId(req);
  try {
    await clearAllMemoryIngestions(userId, 'bespoke_memory');
    await triggerMemoryIndexing(userId);
    return res.json({ status: 'cleared' });
  } catch (error) {
    console.error('Failed to clear bespoke memories', error);
    return res.status(500).json({ error: 'Failed to clear bespoke memories.' });
  }
});

router.get('/graph', async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const userId = requireUserId(req);
  try {
    const files = await listMemoryFileNodes(userId, limit ?? 400);
    const nodeKeyMap = new Map<string, string>();
    const groupedByIngestion = new Map<string, MemoryFileRecord[]>();
    files.forEach((file) => {
      const key = `${file.ingestionId}::${file.filePath}`;
      const nodeId = makeFileGraphNodeId(file.ingestionId, file.filePath);
      nodeKeyMap.set(key, nodeId);
      const existing = groupedByIngestion.get(file.ingestionId) ?? [];
      existing.push(file);
      groupedByIngestion.set(file.ingestionId, existing);
    });
    const nodes = files.map((file) => {
      const id = nodeKeyMap.get(`${file.ingestionId}::${file.filePath}`) as string;
      return {
        id,
        label: deriveFileLabel(file.filePath),
        filePath: file.filePath,
        ingestionId: file.ingestionId,
        batchName: file.batchName ?? null,
        createdAt: file.createdAt.toISOString()
      };
    });
    const edges: { id: string; source: string; target: string; ingestionId: string }[] = [];
    groupedByIngestion.forEach((records, ingestionId) => {
      const sorted = records
        .slice()
        .sort((a, b) => a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' }));
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const currentKey = `${ingestionId}::${sorted[index].filePath}`;
        const nextKey = `${ingestionId}::${sorted[index + 1].filePath}`;
        const source = nodeKeyMap.get(currentKey);
        const target = nodeKeyMap.get(nextKey);
        if (!source || !target) continue;
        edges.push({
          id: makeFileGraphEdgeId(source, target),
          source,
          target,
          ingestionId
        });
      }
    });
    return res.json({
      graph: {
        nodes,
        edges,
        meta: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          ingestionCount: groupedByIngestion.size
        }
      }
    });
  } catch (error) {
    console.error('Failed to load file graph', error);
    return res.status(500).json({ error: 'Failed to load file graph.' });
  }
});

router.get('/:ingestionId/graph', async (req, res) => {
  const ingestionId = req.params.ingestionId;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const edgeLimit = req.query.edgeLimit ? Number(req.query.edgeLimit) : undefined;
  const edgeTypesParam = typeof req.query.edgeTypes === 'string' ? req.query.edgeTypes : undefined;
  const edgeTypes = edgeTypesParam
    ? (edgeTypesParam.split(',').map((token) => token.trim().toUpperCase()) as GraphEdgeType[])
    : undefined;
  const userId = requireUserId(req);
  try {
    const ingestion = await getMemoryIngestionById(ingestionId, userId);
    if (!ingestion) {
      return res.status(404).json({ error: 'Ingestion not found.' });
    }
    const graph = await fetchGraphSlice({
      userId,
      ingestionId,
      nodeTypes: [GraphNodeType.DOCUMENT, GraphNodeType.SECTION, GraphNodeType.CHUNK],
      edgeTypes,
      limit,
      edgeLimit
    });
    return res.json({ ingestion: formatIngestion(ingestion), graph });
  } catch (error) {
    console.error('Failed to load ingestion graph', error);
    return res.status(500).json({ error: 'Failed to load graph.' });
  }
});

export default router;

async function processMemoryIngestion(
  files: Express.Multer.File[],
  relativePaths: string[],
  ingestionId: string,
  userId: string
) {
  let processed = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const content = await fsPromises.readFile(file.path, 'utf-8');
        const relPath = relativePaths[index] || file.originalname;
        const chunks = chunkMarkdown(content);
        if (chunks.length) {
          await insertMemoryChunks({
            ingestionId,
            userId,
            source: 'bespoke_memory',
            filePath: relPath,
            chunks: chunks.map((chunk, chunkIndex) => ({
              chunkIndex,
              content: chunk,
              metadata: { size: chunk.length }
            }))
          });
        }
      } finally {
        processed += 1;
        await updateMemoryIngestion({
          ingestionId,
          processedFiles: processed,
          chunkedFiles: processed,
          status: 'chunking'
        });
        try {
          await fsPromises.unlink(file.path);
        } catch {
          // ignore cleanup errors
        }
      }
    }
    await updateMemoryIngestion({
      ingestionId,
      status: 'chunked',
      processedFiles: processed,
      chunkedFiles: processed
    });
    await triggerMemoryIndexing(userId);
  } catch (error) {
    await updateMemoryIngestion({
      ingestionId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

function chunkMarkdown(content: string, chunkSize = 1200, overlap = 200, minChunkSize = 120): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks = splitMarkdownBlocks(normalized);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
    current = '';
  };

  for (const block of blocks) {
    if (!current) {
      if (block.length > chunkSize) {
        chunks.push(...splitLargeBlock(block, chunkSize, overlap));
        continue;
      }
      current = block;
      continue;
    }
    const candidate = `${current}\n\n${block}`;
    if (candidate.length <= chunkSize) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (block.length > chunkSize) {
      chunks.push(...splitLargeBlock(block, chunkSize, overlap));
    } else {
      current = block;
    }
  }

  if (current) {
    pushCurrent();
  }

  const filtered = chunks.filter((chunk) => chunk.length >= minChunkSize);
  return filtered.length ? filtered : chunks;
}

function splitMarkdownBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inCode = false;

  const flush = () => {
    if (!current.length) return;
    const block = current.join('\n').trim();
    if (block) blocks.push(block);
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isFence = trimmed.startsWith('```');
    const isHeading = !inCode && /^#{1,6}\s+/.test(trimmed);

    if (isFence) {
      inCode = !inCode;
      current.push(line);
      continue;
    }

    if (isHeading) {
      flush();
      current.push(line);
      continue;
    }

    if (!inCode && trimmed === '') {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks;
}

function splitLargeBlock(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const slice = text.slice(start, end).trim();
    if (slice) chunks.push(slice);
    if (end >= text.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function makeFileGraphNodeId(ingestionId: string, filePath: string): string {
  return `FILE_${crypto.createHash('sha1').update(`${ingestionId}::${filePath}`).digest('hex')}`;
}

function makeFileGraphEdgeId(source: string, target: string): string {
  const parts = [source, target].sort();
  return `EDGE_${crypto.createHash('sha1').update(parts.join('::')).digest('hex')}`;
}

function deriveFileLabel(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.pop() || normalized;
}
