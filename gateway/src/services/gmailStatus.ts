import {
  getGmailTokens,
  getGmailSyncMetadata,
  getGmailOnboardingStatus
} from './db';

export interface GmailStatusPayload {
  connected: boolean;
  email?: string;
  avatarUrl?: string;
  name?: string;
  initialSyncStartedAt: string | null;
  initialSyncCompletedAt: string | null;
  initialSyncTotalThreads: number | null;
  initialSyncSyncedThreads: number | null;
  onboarded: boolean;
}

export const DEFAULT_GMAIL_STATUS: GmailStatusPayload = {
  connected: false,
  initialSyncStartedAt: null,
  initialSyncCompletedAt: null,
  initialSyncTotalThreads: null,
  initialSyncSyncedThreads: null,
  onboarded: false
};

type StatusListener = (payload: GmailStatusPayload) => void;

const listeners = new Map<string, Set<StatusListener>>();

export async function getGmailSyncStatus(userId: string): Promise<GmailStatusPayload> {
  const [tokens, syncMeta, onboardedFlag] = await Promise.all([
    getGmailTokens(userId),
    getGmailSyncMetadata(userId),
    getGmailOnboardingStatus(userId)
  ]);

  if (!tokens) {
    return {
      ...DEFAULT_GMAIL_STATUS,
      onboarded: onboardedFlag
    };
  }

  const startedAt = syncMeta?.initialSyncStartedAt;
  const completedAt = syncMeta?.initialSyncCompletedAt;
  const effectiveOnboarded = Boolean(onboardedFlag || completedAt);

  return {
    connected: true,
    initialSyncStartedAt: startedAt ? startedAt.toISOString() : null,
    initialSyncCompletedAt: completedAt ? completedAt.toISOString() : null,
    initialSyncTotalThreads: syncMeta?.initialSyncTotalThreads ?? null,
    initialSyncSyncedThreads: syncMeta?.initialSyncSyncedThreads ?? null,
    onboarded: effectiveOnboarded
  };
}

export function addGmailStatusListener(userId: string, listener: StatusListener): () => void {
  const existing = listeners.get(userId);
  if (existing) {
    existing.add(listener);
  } else {
    listeners.set(userId, new Set([listener]));
  }
  return () => {
    const current = listeners.get(userId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(userId);
    }
  };
}

export async function emitGmailStatusUpdate(userId: string): Promise<void> {
  const userListeners = listeners.get(userId);
  if (!userListeners || userListeners.size === 0) {
    return;
  }
  try {
    const snapshot = await getGmailSyncStatus(userId);
    for (const listener of userListeners) {
      try {
        listener(snapshot);
      } catch (listenerError) {
        console.warn('[Gmail Status] Listener error', listenerError);
      }
    }
  } catch (error) {
    console.error('[Gmail Status] Failed to emit update', error);
  }
}
