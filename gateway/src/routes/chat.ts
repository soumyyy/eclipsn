import { Router } from 'express';
import { sendChat } from '../services/brainClient';
import { TEST_USER_ID, DEFAULT_CONVERSATION_ID } from '../constants';
import { getUserProfile } from '../services/db';

const router = Router();

router.post('/', async (req, res) => {
  const { message, history } = req.body as {
    message?: string;
    history?: Array<{ role: string; content: string }>;
  };

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const profile = await getUserProfile(TEST_USER_ID);
    const response = await sendChat({
      userId: TEST_USER_ID,
      conversationId: DEFAULT_CONVERSATION_ID,
      message,
      history,
      profile
    });

    return res.json(response);
  } catch (error) {
    console.error('Chat proxy failed', error);
    return res.status(502).json({ error: 'Failed to reach brain service' });
  }
});

export default router;
