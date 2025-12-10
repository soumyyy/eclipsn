import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { TEST_USER_ID } from '../constants';
import {
  createMemoryIngestion,
  getLatestMemoryIngestion,
  insertMemoryChunk,
  updateMemoryIngestion,
  listMemoryIngestions,
  deleteMemoryIngestion,
  resetIngestionEmbeddings,
  getMemoryIngestionById,
  clearAllMemoryIngestions,
  fetchGraphSlice
} from '../services/db';
import { triggerMemoryIndexing } from '../services/brainClient';
import { GraphNodeType } from '../graph/types';

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

  try {
    const ingestionId = await createMemoryIngestion({
      userId: TEST_USER_ID,
      source: 'bespoke_memory',
      totalFiles: files.length,
      batchName
    });
    await updateMemoryIngestion({ ingestionId, status: 'chunking', processedFiles: 0, chunkedFiles: 0, error: null });
    processMemoryIngestion(files, relativePaths, ingestionId).catch((error) => {
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

router.get('/status', async (_req, res) => {
  try {
    const latest = await getLatestMemoryIngestion(TEST_USER_ID, 'bespoke_memory');
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
  try {
    const rows = await listMemoryIngestions(TEST_USER_ID, limit);
    return res.json({ history: rows.map(formatIngestion) });
  } catch (error) {
    console.error('Failed to load ingestion history', error);
    return res.status(500).json({ error: 'Failed to load history.' });
  }
});

router.post('/:ingestionId/reindex', async (req, res) => {
  const ingestionId = req.params.ingestionId;
  try {
    const record = await getMemoryIngestionById(ingestionId, TEST_USER_ID);
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
    await triggerMemoryIndexing(TEST_USER_ID);
    return res.json({ status: 'queued' });
  } catch (error) {
    console.error('Failed to reindex ingestion', error);
    return res.status(500).json({ error: 'Failed to reindex ingestion.' });
  }
});

router.delete('/:ingestionId', async (req, res) => {
  const ingestionId = req.params.ingestionId;
  try {
    await deleteMemoryIngestion(ingestionId, TEST_USER_ID);
    await triggerMemoryIndexing(TEST_USER_ID);
    return res.json({ status: 'deleted' });
  } catch (error) {
    console.error('Failed to delete ingestion', error);
    return res.status(500).json({ error: 'Failed to delete ingestion.' });
  }
});

router.delete('/', async (_req, res) => {
  try {
    await clearAllMemoryIngestions(TEST_USER_ID, 'bespoke_memory');
    await triggerMemoryIndexing(TEST_USER_ID);
    return res.json({ status: 'cleared' });
  } catch (error) {
    console.error('Failed to clear bespoke memories', error);
    return res.status(500).json({ error: 'Failed to clear bespoke memories.' });
  }
});

router.get('/:ingestionId/graph', async (req, res) => {
  const ingestionId = req.params.ingestionId;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const edgeLimit = req.query.edgeLimit ? Number(req.query.edgeLimit) : undefined;
  try {
    const ingestion = await getMemoryIngestionById(ingestionId, TEST_USER_ID);
    if (!ingestion) {
      return res.status(404).json({ error: 'Ingestion not found.' });
    }
    const graph = await fetchGraphSlice({
      userId: TEST_USER_ID,
      ingestionId,
      nodeTypes: [GraphNodeType.DOCUMENT, GraphNodeType.SECTION, GraphNodeType.CHUNK],
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

async function processMemoryIngestion(files: Express.Multer.File[], relativePaths: string[], ingestionId: string) {
  let processed = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const content = await fsPromises.readFile(file.path, 'utf-8');
        const relPath = relativePaths[index] || file.originalname;
        const chunks = chunkMarkdown(content);
        let chunkIndex = 0;
        for (const chunk of chunks) {
          await insertMemoryChunk({
            ingestionId,
            userId: TEST_USER_ID,
            source: 'bespoke_memory',
            filePath: relPath,
            chunkIndex,
            content: chunk,
            metadata: { size: chunk.length }
          });
          chunkIndex += 1;
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
    await triggerMemoryIndexing(TEST_USER_ID);
  } catch (error) {
    await updateMemoryIngestion({
      ingestionId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

function chunkMarkdown(content: string, chunkSize = 1200, overlap = 200): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
    start = end - overlap;
  }
  return chunks;
}
