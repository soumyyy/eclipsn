import axios from 'axios';
import { config } from '../config';

interface ChatPayload {
  userId: string;
  conversationId: string;
  message: string;
  history?: Array<{ role: string; content: string }>;
  profile?: Record<string, unknown> | null;
}

export async function sendChat(payload: ChatPayload) {
  const response = await axios.post(`${config.brainServiceUrl}/chat`, {
    user_id: payload.userId,
    conversation_id: payload.conversationId,
    message: payload.message,
    history: payload.history ?? [],
    profile: payload.profile ?? null
  });

  return response.data;
}

export async function triggerMemoryIndexing() {
  try {
    await axios.post(`${config.brainServiceUrl}/memory/index`, {});
  } catch (error) {
    console.error('Failed to trigger memory indexing', error);
  }
}
