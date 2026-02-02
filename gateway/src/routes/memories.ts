import { Router } from 'express';
import { listUserMemories, deleteUserMemory } from '../services/brainClient';
import { requireUserId } from '../utils/request';

const router = Router();

/**
 * GET /api/memories
 * List or search user memories (user_memories table). Used by Memory settings UI.
 * Query: q (optional search), limit, offset
 */
router.get('/', async (req, res) => {
  const userId = requireUserId(req);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  try {
    const data = await listUserMemories(userId, { limit, offset, q });
    return res.json(data);
  } catch (error: unknown) {
    console.error('Failed to list memories', error);
    const status = (error as { response?: { status?: number } })?.response?.status ?? 500;
    const message = (error as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ?? (error as Error)?.message ?? 'Failed to list memories.';
    return res.status(status).json({ error: message });
  }
});

/**
 * DELETE /api/memories/:id
 * Soft-delete one user memory. Used by Memory settings UI "Forget" action.
 */
router.delete('/:id', async (req, res) => {
  const userId = requireUserId(req);
  const memoryId = req.params.id;
  if (!memoryId) {
    return res.status(400).json({ error: 'Memory id required.' });
  }
  try {
    await deleteUserMemory(userId, memoryId);
    return res.json({ status: 'deleted' });
  } catch (error: unknown) {
    console.error('Failed to delete memory', error);
    const err = error as { response?: { status?: number; data?: { detail?: string } }; message?: string };
    const status = err?.response?.status ?? 500;
    const message = err?.response?.data?.detail ?? err?.message ?? 'Failed to delete memory.';
    if (status === 404) return res.status(404).json({ error: message });
    return res.status(status).json({ error: message });
  }
});

export default router;
