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

export async function triggerMemoryIndexing(userId?: string) {
  try {
    const options = userId ? { params: { user_id: userId } } : undefined;
    await axios.post(`${config.brainServiceUrl}/memory/index`, {}, options);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Failed to trigger memory indexing', error.response?.data || error.message);
    } else {
      console.error('Failed to trigger memory indexing', error);
    }
  }
}


export async function ingestSchedulePdf(params: { userId: string; fileData: string; filename: string }) {
  // params.fileData is base64 string
  await axios.post(`${config.brainServiceUrl}/schedule/ingest`, {
    user_id: params.userId,
    file_data: params.fileData,
    filename: params.filename
  });
}
