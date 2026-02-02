export type ProfileNoteInput = string | { text?: string | null; timestamp?: string | null };

export type ProfileNote = {
  text: string;
  timestamp: string | null;
};

export type ProfileHistoryEntry = {
  value?: string | null;
  timestamp?: string | null;
};

export type ProfileCustomData = {
  notes?: ProfileNoteInput[];
  previousValues?: Record<string, ProfileHistoryEntry[]>;
  personalNote?: string;
  [key: string]: unknown;
};

/**
 * User profile is document-based: any key can exist. These are common keys;
 * the backend stores everything in a single JSONB document so memory can grow without schema changes.
 */
export type UserProfile = {
  fullName?: string;
  preferredName?: string;
  timezone?: string;
  contactEmail?: string;
  phone?: string;
  company?: string;
  role?: string;
  biography?: string;
  preferences?: Record<string, unknown> | string | null;
  updatedAt?: string | null;
  gmailOnboarded?: boolean;
  customData?: ProfileCustomData;
  [key: string]: unknown;
};

export function normalizeProfileNotes(value: unknown): ProfileNote[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: ProfileNote[] = [];
  value.forEach((entry) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (!trimmed) return;
      const key = `${trimmed}-null`;
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push({ text: trimmed, timestamp: null });
      return;
    }
    if (typeof entry === 'object' && 'text' in entry) {
      const maybe = entry as { text?: unknown; timestamp?: unknown };
      const trimmed = typeof maybe.text === 'string' ? maybe.text.trim() : '';
      if (!trimmed) return;
      const timestamp =
        typeof maybe.timestamp === 'string' ? maybe.timestamp : maybe.timestamp === null ? null : null;
      const key = `${trimmed}-${timestamp ?? 'null'}`;
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push({ text: trimmed, timestamp });
    }
  });
  return normalized;
}

export function firstProfileNoteText(value: unknown): string | null {
  const normalized = normalizeProfileNotes(value);
  if (normalized.length === 0) return null;
  return normalized[0]?.text ?? null;
}
