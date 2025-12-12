'use client';

import { useState } from 'react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

export interface ProfileNote {
  text?: string;
  timestamp?: string | null;
}

export interface ProfileHistoryEntry {
  value?: string | null;
  timestamp?: string | null;
}

export interface ProfileInfo {
  fullName?: string;
  preferredName?: string;
  timezone?: string;
  contactEmail?: string;
  phone?: string;
  company?: string;
  role?: string;
  biography?: string;
  customData?: {
    notes?: (string | ProfileNote)[];
    previousValues?: Record<string, ProfileHistoryEntry[]>;
    [key: string]: unknown;
  };
}

interface GmailStatus {
  connected: boolean;
  email?: string;
  avatarUrl?: string;
  name?: string;
}

interface ProfileModalProps {
  profile: ProfileInfo | null;
  loading: boolean;
  gmailStatus: GmailStatus | null;
  gmailLoading: boolean;
  onGmailAction: () => void;
  onOpenBespoke: () => void;
  onClose: () => void;
  onProfileUpdated: (profile: ProfileInfo | null) => void;
}

const TABS: Array<{ id: 'profile' | 'connections' | 'history'; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'connections', label: 'Connections' },
  { id: 'history', label: 'History' }
];

export function ProfileModal({
  profile,
  loading,
  gmailStatus,
  gmailLoading,
  onGmailAction,
  onOpenBespoke,
  onClose,
  onProfileUpdated
}: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'connections' | 'history'>('profile');
  const [activeNoteIndex, setActiveNoteIndex] = useState<number | null>(null);
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [draftNoteText, setDraftNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedNotes: ProfileNote[] = (profile?.customData?.notes ?? [])
    .map((note) => (typeof note === 'string' ? { text: note, timestamp: null } : note ?? { text: '', timestamp: null }))
    .filter((note) => Boolean(note.text));

  const historyEntries = profile?.customData?.previousValues ?? {};
  const customExtras = Object.entries(profile?.customData ?? {}).filter(
    ([key, value]) =>
      key !== 'notes' &&
      key !== 'previousValues' &&
      value !== null &&
      value !== undefined &&
      value !== ''
  );

  const baseSections = [
    {
      title: 'Identity',
      items: [
        { label: 'Full name', value: profile?.fullName },
        { label: 'Preferred name', value: profile?.preferredName }
      ]
    },
    {
      title: 'Contact',
      items: [
        { label: 'Contact email', value: profile?.contactEmail },
        { label: 'Phone', value: profile?.phone },
        { label: 'Timezone', value: profile?.timezone }
      ]
    },
    {
      title: 'Work',
      items: [
        { label: 'Company', value: profile?.company },
        { label: 'Role', value: profile?.role }
      ]
    }
  ];

  const sections = baseSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.value)
    }))
    .filter((section) => section.items.length > 0);

  if (customExtras.length > 0) {
    sections.push({
      title: 'Custom fields',
      items: customExtras.map(([label, value]) => ({
        label,
        value: typeof value === 'string' ? value : JSON.stringify(value)
      }))
    });
  }

  const handleNoteClick = (index: number) => {
    if (editingNoteIndex !== null) {
      if (editingNoteIndex !== index) {
        return;
      }
      return;
    }
    setError(null);
    setEditingNoteIndex(null);
    setDraftNoteText('');
    setActiveNoteIndex((prev) => (prev === index ? null : index));
  };

  const startEditNote = (index: number) => {
    const target = normalizedNotes[index];
    if (!target) return;
    setEditingNoteIndex(index);
    setDraftNoteText(target.text ?? '');
    setActiveNoteIndex(index);
  };

  const persistNotes = async (nextNotes: ProfileNote[]) => {
    if (!profile) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customData: {
            ...(profile.customData ?? {}),
            notes: nextNotes
          }
        })
      });
      if (!response.ok) {
        throw new Error('Failed to persist notes');
      }
      const data = await response.json();
      onProfileUpdated(data.profile ?? null);
      setEditingNoteIndex(null);
      setDraftNoteText('');
      setActiveNoteIndex(null);
    } catch (err) {
      console.error('Failed to update note', err);
      setError('Could not update note. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteNote = async (index: number) => {
    const filtered = normalizedNotes.filter((_, idx) => idx !== index);
    await persistNotes(filtered);
  };

  const handleSaveNote = async () => {
    if (editingNoteIndex === null) return;
    const trimmed = draftNoteText.trim();
    if (!trimmed) {
      setError('Note cannot be empty.');
      return;
    }
    const updated = normalizedNotes.map((note, idx) =>
      idx === editingNoteIndex ? { ...note, text: trimmed } : note
    );
    await persistNotes(updated);
  };

  const handleCancelEdit = () => {
    setEditingNoteIndex(null);
    setDraftNoteText('');
    setError(null);
  };

  const renderProfileContent = () => {
    if (loading) {
      return <p className="text-muted">Loading profile…</p>;
    }
    if (!profile) {
      return <p className="text-muted">Share personal details and Pluto will remember them.</p>;
    }
    return (
      <div className="profile-tab-stack">
        {profile.biography && (
          <section>
            <h3>Biography</h3>
            <p className="text-muted">{profile.biography}</p>
          </section>
        )}

        {sections.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <div className="profile-grid">
              {section.items.map((item) => (
                <div className="profile-field" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>
        ))}

        {normalizedNotes.length > 0 && (
          <section>
            <h3>Notes</h3>
            <ul className="profile-notes-modal">
              {normalizedNotes.map((note, index) => {
                const isActive = activeNoteIndex === index;
                const isEditing = editingNoteIndex === index;
                return (
                  <li
                    key={`${note.text}-${note.timestamp}-${index}`}
                    className={`profile-note-row ${isActive ? 'active' : ''} ${isEditing ? 'editing' : ''}`}
                    onClick={() => handleNoteClick(index)}
                  >
                    <div className="profile-note-content">
                      {isEditing ? (
                        <textarea
                          value={draftNoteText}
                          onChange={(evt) => setDraftNoteText(evt.target.value)}
                          rows={3}
                          disabled={isSubmitting}
                        />
                      ) : (
                        <>
                          <p>{note.text}</p>
                          {note.timestamp && <small className="text-muted">{new Date(note.timestamp).toLocaleString()}</small>}
                        </>
                      )}
                    </div>
                    <div className="profile-note-actions">
                      <button
                        type="button"
                        className="profile-note-action delete"
                        disabled={isSubmitting}
                        onClick={(evt) => {
                          evt.stopPropagation();
                          if (isEditing) {
                            handleCancelEdit();
                          } else {
                            handleDeleteNote(index);
                          }
                        }}
                      >
                        {isEditing ? 'Cancel' : 'Delete'}
                      </button>
                      <button
                        type="button"
                        className="profile-note-action edit"
                        disabled={isSubmitting}
                        onClick={(evt) => {
                          evt.stopPropagation();
                          if (isEditing) {
                            handleSaveNote();
                          } else {
                            startEditNote(index);
                          }
                        }}
                      >
                        {isEditing ? (isSubmitting ? 'Saving…' : 'Save') : 'Edit'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {error && <p className="profile-error">{error}</p>}
          </section>
        )}
      </div>
    );
  };

  const renderConnectionsContent = () => {
    return (
      <div className="profile-tab-stack">
        <section>
          <h3>Gmail</h3>
          <p className="text-muted">
            {gmailStatus?.connected
              ? `Connected as ${gmailStatus.name ?? gmailStatus.email ?? 'operator'}.`
              : 'Connect your Gmail account to ingest threads and bespoke context.'}
          </p>
          <button type="button" className="profile-quick-btn" onClick={onGmailAction} disabled={gmailLoading}>
            <span className="quick-label">Gmail</span>
            <strong>{gmailStatus?.connected ? 'Disconnect' : 'Connect'}</strong>
          </button>
        </section>
        <section>
          <h3>Bespoke Memory</h3>
          <button type="button" className="profile-quick-btn" onClick={onOpenBespoke}>
            <span className="quick-label">Bespoke memory</span>
            <strong>Open modal</strong>
          </button>
        </section>
      </div>
    );
  };

  const renderHistoryContent = () => {
    if (!profile || !historyEntries || Object.keys(historyEntries).length === 0) {
      return <p className="text-muted">No profile changes recorded yet.</p>;
    }
    return (
      <section className="profile-history">
        {Object.entries(historyEntries).map(([fieldKey, entries]) => {
          if (!Array.isArray(entries) || entries.length === 0) return null;
          return (
            <div key={fieldKey} className="profile-history-field">
              <p className="profile-history-label">{fieldKey}</p>
              <ul>
                {entries.map((entry, idx) => (
                  <li key={`${fieldKey}-${idx}`}>
                    <strong>{entry?.value ?? '—'}</strong>
                    {entry?.timestamp && <small>{new Date(entry.timestamp).toLocaleString()}</small>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    );
  };

  const renderActiveContent = () => {
    if (activeTab === 'connections') return renderConnectionsContent();
    if (activeTab === 'history') return renderHistoryContent();
    return renderProfileContent();
  };

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(evt) => evt.stopPropagation()}>
        <div className="profile-modal-header">
          <div>
            <p className="profile-name">{profile?.preferredName ?? profile?.fullName ?? 'User profile'}</p>
            {profile?.role && profile?.company && (
              <p className="text-muted">
                {profile.role} @ {profile.company}
              </p>
            )}
          </div>
          <button className="profile-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="profile-modal-body-grid">
          <aside className="profile-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`profile-tab-button ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
              </button>
            ))}
          </aside>
          <div className="profile-tab-content">{renderActiveContent()}</div>
        </div>
      </div>
    </div>
  );
}
