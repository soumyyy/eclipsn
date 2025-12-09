import { Router } from 'express';
import { sendChat } from '../services/brainClient';

const router = Router();
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_CONVERSATION_ID = '00000000-0000-0000-0000-000000000002';

router.post('/', async (req, res) => {
  const { message, history } = req.body as {
    message?: string;
    history?: Array<{ role: string; content: string }>;
  };

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const response = await sendChat({
      userId: TEST_USER_ID,
      conversationId: DEFAULT_CONVERSATION_ID,
      message,
      history
    });

    return res.json(response);
  } catch (error) {
    console.error('Chat proxy failed', error);
    return res.status(502).json({ error: 'Failed to reach brain service' });
  }
});

export default router;
