import { Router } from 'express';
import { getUserProfile, upsertUserProfile } from '../services/db';
import { getUserId, requireUserId } from '../utils/request';
import { deleteAccount, logoutUser } from '../services/userService';

const router = Router();

router.get('/', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.json({ profile: null });
  }
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
  console.info('[profile] update request', { userId, hasUpdateKeys: Object.keys(update).length > 0 });
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
    await deleteAccount(userId, req, res);
    return res.json({ status: 'deleted' });
  } catch (error) {
    console.error('Failed to delete account', error);
    return res.status(500).json({ error: 'Failed to delete account' });
  }
});

router.post('/logout', (req, res) => {
  logoutUser(req, res);
  return res.json({ status: 'signed_out' });
});

export default router;
