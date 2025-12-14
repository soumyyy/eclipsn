import { Router } from 'express';
import { getUserProfile, upsertUserProfile } from '../services/db';
import { requireUserId } from '../utils/request';
import { deleteAccount } from '../services/userService';

const router = Router();

router.get('/', async (req, res) => {
  const userId = requireUserId(req);
  try {
    const profile = await getUserProfile(userId);
    return res.json({ profile });
  } catch (error) {
    console.error('Failed to load profile', error);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.post('/', async (req, res) => {
  const update = req.body ?? {};
  const userId = requireUserId(req);
  try {
    await upsertUserProfile(userId, update);
    const profile = await getUserProfile(userId);
    return res.json({ profile });
  } catch (error) {
    console.error('Failed to update profile', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.delete('/account', async (req, res) => {
  const userId = requireUserId(req);
  try {
    await deleteAccount(userId, res);
    return res.json({ status: 'deleted' });
  } catch (error) {
    console.error('Failed to delete account', error);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
