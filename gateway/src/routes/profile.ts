import { Router } from 'express';
import { TEST_USER_ID } from '../constants';
import { getUserProfile, upsertUserProfile } from '../services/db';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const profile = await getUserProfile(TEST_USER_ID);
    return res.json({ profile });
  } catch (error) {
    console.error('Failed to load profile', error);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.post('/', async (req, res) => {
  const update = req.body ?? {};
  try {
    await upsertUserProfile(TEST_USER_ID, update);
    const profile = await getUserProfile(TEST_USER_ID);
    return res.json({ profile });
  } catch (error) {
    console.error('Failed to update profile', error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
