import { Router } from 'express';
import { listTaskCards, createTaskCard } from '../services/db';
import { requireUserId } from '../utils/request';

const router = Router();

/** GET /api/tasks – list task cards (feed_cards with type='task') */
router.get('/', async (req, res) => {
  const userId = requireUserId(req);
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  try {
    const tasks = await listTaskCards(userId, limit);
    return res.json({ tasks });
  } catch (error) {
    console.error('List tasks failed', error);
    return res.status(500).json({ error: 'Failed to list tasks.' });
  }
});

/** POST /api/tasks – create a task (insert feed_card type='task') */
router.post('/', async (req, res) => {
  const userId = requireUserId(req);
  const body = (req.body ?? {}) as { description?: string; due_date?: string | null; status?: string; source?: string; thread_id?: string | null };
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return res.status(400).json({ error: 'description is required.' });
  }
  try {
    const id = await createTaskCard(userId, {
      description,
      due_date: body.due_date ?? null,
      status: body.status ?? 'open',
      source: body.source ?? 'chat',
      thread_id: body.thread_id ?? null
    });
    return res.status(201).json({ id, description, status: body.status ?? 'open' });
  } catch (error) {
    console.error('Create task failed', error);
    return res.status(500).json({ error: 'Failed to create task.' });
  }
});

export default router;
