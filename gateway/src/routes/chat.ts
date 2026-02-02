import { Router } from 'express';
import multer from 'multer';
import { sendChat } from '../services/brainClient';
import { DEFAULT_CONVERSATION_ID } from '../constants';
import { ensureConversation, getUserProfile, insertMessage } from '../services/db';
import { requireUserId } from '../utils/request';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  }
});

function sanitizeProfile(profile: Record<string, unknown> | null) {
  if (!profile) return null;
  const cloned = JSON.parse(JSON.stringify(profile));
  if (cloned?.customData?.notes) {
    const seen = new Set<string>();
    const normalized: Array<{ text: string; timestamp: string | null }> = [];
    cloned.customData.notes.forEach((entry: any) => {
      if (!entry) return false;
      const text = typeof entry.text === 'string' ? entry.text : typeof entry === 'string' ? entry : null;
      if (!text) return;
      const timestamp =
        entry && typeof entry.timestamp === 'string'
          ? entry.timestamp
          : entry && entry.timestamp === null
            ? null
            : null;
      const key = `${text}-${timestamp ?? 'null'}`;
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push({ text, timestamp });
    });
    cloned.customData.notes = normalized;
  }
  return cloned;
}

router.post('/', upload.array('attachments'), async (req, res) => {
  const rawMessage = req.body?.message;
  const message = typeof rawMessage === 'string' ? rawMessage : '';
  const historyRaw = req.body?.history;
  let history: Array<{ role: string; content: string }> | undefined;
  if (Array.isArray(historyRaw)) {
    history = historyRaw as Array<{ role: string; content: string }>;
  } else if (typeof historyRaw === 'string' && historyRaw.trim()) {
    try {
      history = JSON.parse(historyRaw) as Array<{ role: string; content: string }>;
    } catch {
      history = undefined;
    }
  }
  const files = (req.files || []) as Express.Multer.File[];
  const attachments = files.map((file) => ({
    filename: file.originalname,
    mime_type: file.mimetype,
    data_base64: file.buffer.toString('base64')
  }));

  if (!message && attachments.length === 0) {
    return res.status(400).json({ error: 'message or attachments are required' });
  }

  try {
    const userId = requireUserId(req);
    const profile = sanitizeProfile(await getUserProfile(userId));
    await ensureConversation({ userId, conversationId: DEFAULT_CONVERSATION_ID });
    await insertMessage({
      userId,
      conversationId: DEFAULT_CONVERSATION_ID,
      role: 'user',
      text: message || '[Attachment]'
    });
    const response = await sendChat({
      userId,
      conversationId: DEFAULT_CONVERSATION_ID,
      message: message || 'Shared an attachment.',
      history,
      profile,
      attachments
    });
    if (response?.reply) {
      await insertMessage({
        userId,
        conversationId: DEFAULT_CONVERSATION_ID,
        role: 'assistant',
        text: response.reply
      });
    }

    return res.json(response);
  } catch (error) {
    console.error('Chat proxy failed', error);
    return res.status(502).json({ error: 'Failed to reach brain service' });
  }
});

export default router;
