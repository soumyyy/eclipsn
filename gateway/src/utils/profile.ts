export type ProfileNoteInput = string | { text?: string | null; timestamp?: string | null };

export type ProfileNote = {
  text: string;
  timestamp: string | null;
};

export function normalizeProfileNotes(value: unknown): ProfileNote[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const notes: ProfileNote[] = [];
  value.forEach((entry) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (!trimmed) return;
      const key = `${trimmed}-null`;
      if (seen.has(key)) return;
      seen.add(key);
      notes.push({ text: trimmed, timestamp: null });
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
      notes.push({ text: trimmed, timestamp });
    }
  });
  return notes;
}
