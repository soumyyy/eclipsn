'use client';

import {
  firstProfileNoteText,
  normalizeProfileNotes,
  type UserProfile
} from '@/lib/profile';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

export type GmailStatus = {
  connected: boolean;
  email?: string;
  avatarUrl?: string;
  name?: string;
};

export type SessionSnapshot = {
  gmail: GmailStatus;
  profile: UserProfile | null;
};

function normalizeGmailStatus(payload: unknown): GmailStatus {
  if (!payload || typeof payload !== 'object') {
    return { connected: false };
  }
  const record = payload as Record<string, unknown>;
  return {
    connected: Boolean(record.connected),
    email: typeof record.email === 'string' ? record.email : undefined,
    avatarUrl: typeof record.avatarUrl === 'string' ? record.avatarUrl : undefined,
    name: typeof record.name === 'string' ? record.name : undefined
  };
}

function normalizeProfile(payload: unknown): UserProfile | null {
  if (!payload || typeof payload !== 'object') return null;
  return payload as UserProfile;
}

export async function fetchSessionSnapshot(): Promise<SessionSnapshot> {
  const [gmailResult, profileResult] = await Promise.allSettled([
    fetch(`${GATEWAY_URL}/api/gmail/status`),
    fetch(`${GATEWAY_URL}/api/profile`)
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
    localStorage.setItem('plutoProfileName', preferred);
  }
  const notes = normalizeProfileNotes(profile.customData?.notes ?? []);
  const memo =
    typeof profile.customData?.personalNote === 'string' && profile.customData.personalNote.trim().length > 0
      ? profile.customData.personalNote
      : firstProfileNoteText(notes) ?? undefined;
  if (memo) {
    localStorage.setItem('plutoProfileNote', memo);
  }
  localStorage.setItem('plutoOnboarded', 'true');
}

export function hasActiveSession(snapshot: SessionSnapshot): boolean {
  return Boolean(snapshot.gmail.connected && snapshot.profile);
}
