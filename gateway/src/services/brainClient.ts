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

/** Phase 5: List or search user_memories for Memory UI */
export async function listUserMemories(
  userId: string,
  params: { limit?: number; offset?: number; q?: string } = {}
): Promise<{ memories: Array<{ id: string; content: string; source_type?: string; source_id?: string | null; scope?: string | null; confidence?: number | null }>; total?: number }> {
  const { limit = 20, offset = 0, q } = params;
  const searchParams = new URLSearchParams({
    user_id: userId,
    limit: String(limit),
    offset: String(offset)
  });
  if (q?.trim()) searchParams.set('q', q.trim());
  const response = await axios.get(`${config.brainServiceUrl}/memory/user-memories?${searchParams.toString()}`);
  return response.data;
}

/** Phase 5: Soft-delete one user_memory */
export async function deleteUserMemory(userId: string, memoryId: string): Promise<{ status: string }> {
  const response = await axios.delete(
    `${config.brainServiceUrl}/memory/user-memories/${encodeURIComponent(memoryId)}`,
    { params: { user_id: userId } }
  );
  return response.data;
}

/** Scheduled extraction: last run time (for 24h check + nightly cron) */
export async function getExtractLastRun(): Promise<{ last_run_at: string | null }> {
  const response = await axios.get(`${config.brainServiceUrl}/memory/extract-last-run`);
  return response.data;
}

/** Trigger memory extraction for one user (Gmail + bespoke → user_memories) */
export async function triggerMemoryExtract(userId: string): Promise<{ gmail_candidates: number; bespoke_candidates: number; inserted: number; skipped: number }> {
  const response = await axios.post(`${config.brainServiceUrl}/memory/extract`, { user_id: userId });
  return response.data;
}
