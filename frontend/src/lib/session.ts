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
  onboarded?: boolean;
};

export type SessionSnapshot = {
  gmail: GmailStatus;
  profile: UserProfile | null;
};

function normalizeProfile(payload: unknown): UserProfile | null {
  if (!payload || typeof payload !== 'object') return null;
  return payload as UserProfile;
}

export async function fetchSessionSnapshot(): Promise<SessionSnapshot> {
  const profileResponse = await gatewayFetch('profile').catch(() => null);
  let profilePayload: unknown = null;
  if (profileResponse?.ok) {
    try {
      const body = await profileResponse.json();
      profilePayload = body?.profile ?? null;
    } catch {
      // swallow parse errors
    }
  }
  return {
    gmail: { connected: false, onboarded: false },
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
  const profile = snapshot.profile;
  if (!profile) return false;
  const hasIdentity =
    typeof profile.fullName === 'string' && profile.fullName.trim().length > 0
      ? true
      : typeof profile.preferredName === 'string' && profile.preferredName.trim().length > 0;
  return hasIdentity;
}
