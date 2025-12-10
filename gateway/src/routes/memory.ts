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
  updateMemoryIngestion
} from '../services/db';
import { triggerMemoryIndexing } from '../services/brainClient';

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

  try {
    const ingestionId = await createMemoryIngestion({
      userId: TEST_USER_ID,
      source: 'bespoke_memory',
      totalFiles: files.length
    });

    processMemoryIngestion(files, relativePaths, ingestionId).catch((error) => {
      console.error('Memory ingestion processing failed', error);
    });

    return res.json({ ingestionId, totalFiles: files.length });
  } catch (error) {
    console.error('Failed to start memory ingestion', error);
    return res.status(500).json({ error: 'Failed to start ingestion.' });
  }
});

router.get('/status', async (_req, res) => {
  try {
    const latest = await getLatestMemoryIngestion(TEST_USER_ID, 'bespoke_memory');
    return res.json({ ingestion: latest });
  } catch (error) {
    console.error('Failed to load memory ingestion status', error);
    return res.status(500).json({ error: 'Failed to load status.' });
  }
});

export default router;

async function processMemoryIngestion(files: Express.Multer.File[], relativePaths: string[], ingestionId: string) {
  await updateMemoryIngestion({ ingestionId, status: 'processing', processedFiles: 0 });
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
        await updateMemoryIngestion({ ingestionId, processedFiles: processed });
        try {
          await fsPromises.unlink(file.path);
        } catch {
          // ignore cleanup errors
        }
      }
    }
    await updateMemoryIngestion({ ingestionId, status: 'completed', processedFiles: processed });
    await triggerMemoryIndexing();
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
