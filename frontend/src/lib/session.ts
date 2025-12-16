'use client';

import {
  firstProfileNoteText,
  normalizeProfileNotes,
  type UserProfile
} from '@/lib/profile';
import { gatewayFetch } from './gatewayFetch';

export type GmailStatus = {
  connected: boolean;
  email?: string;
  avatarUrl?: string;
  name?: string;
  initialSyncStartedAt?: string | null;
  initialSyncCompletedAt?: string | null;
  initialSyncTotalThreads?: number | null;
  initialSyncSyncedThreads?: number | null;
};

export type SessionSnapshot = {
  gmail: GmailStatus;
  profile: UserProfile | null;
};

function normalizeProfile(payload: unknown): UserProfile | null {
  if (!payload || typeof payload !== 'object') return null;
  return payload as UserProfile;
}

function normalizeGmailStatus(payload: unknown): GmailStatus {
  if (!payload || typeof payload !== 'object') {
    return { connected: false };
  }
  const record = payload as Record<string, unknown>;
  return {
    connected: Boolean(record.connected),
    email: typeof record.email === 'string' ? record.email : undefined,
    avatarUrl: typeof record.avatarUrl === 'string' ? record.avatarUrl : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    initialSyncStartedAt:
      typeof record.initialSyncStartedAt === 'string' ? (record.initialSyncStartedAt as string) : null,
    initialSyncCompletedAt:
      typeof record.initialSyncCompletedAt === 'string' ? (record.initialSyncCompletedAt as string) : null,
    initialSyncTotalThreads:
      typeof record.initialSyncTotalThreads === 'number'
        ? (record.initialSyncTotalThreads as number)
        : record.initialSyncTotalThreads === null
          ? null
          : undefined,
    initialSyncSyncedThreads:
      typeof record.initialSyncSyncedThreads === 'number'
        ? (record.initialSyncSyncedThreads as number)
        : record.initialSyncSyncedThreads === null
          ? null
          : undefined
  };
}

export async function fetchSessionSnapshot(): Promise<SessionSnapshot> {
  const [gmailResult, profileResult] = await Promise.allSettled([
    gatewayFetch('gmail/status'),
    gatewayFetch('profile')
  ]);

  let gmailPayload: unknown = null;
  if (gmailResult.status === 'fulfilled') {
    try {
      if (gmailResult.value.ok) {
        gmailPayload = await gmailResult.value.json();
      }
    } catch {
      // swallow parse errors
    }
  }

  let profilePayload: unknown = null;
  if (profileResult.status === 'fulfilled') {
    try {
      if (profileResult.value.ok) {
        const body = await profileResult.value.json();
        profilePayload = body?.profile ?? null;
      }
    } catch {
      // swallow parse errors
    }
  }

  return {
    gmail: normalizeGmailStatus(gmailPayload),
    profile: normalizeProfile(profilePayload)
  };
}

export function cacheProfileLocally(profile: UserProfile | null) {
  if (typeof window === 'undefined') return;
  if (!profile) return;
  const preferred = profile.preferredName ?? profile.fullName ?? '';
  if (preferred) {
    localStorage.setItem('EclipsnProfileName', preferred);
  }
  const notes = normalizeProfileNotes(profile.customData?.notes ?? []);
  const memo =
    typeof profile.customData?.personalNote === 'string' && profile.customData.personalNote.trim().length > 0
      ? profile.customData.personalNote
      : firstProfileNoteText(notes) ?? undefined;
  if (memo) {
    localStorage.setItem('EclipsnProfileNote', memo);
  }
  localStorage.setItem('EclipsnOnboarded', 'true');
}

export function hasActiveSession(snapshot: SessionSnapshot): boolean {
  return Boolean(snapshot.gmail.connected && snapshot.profile);
}
