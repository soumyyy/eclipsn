'use client';

import { useEffect, useState } from 'react';
import { useSessionContext } from '@/components/SessionProvider';
import {
  normalizeProfileNotes,
  type ProfileHistoryEntry,
  type ProfileNote,
  type UserProfile
} from '@/lib/profile';
import type { GmailStatus } from '@/lib/session';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

interface ProfileModalProps {
  onGmailAction: () => void;
  onOpenBespoke: () => void;
  onClose: () => void;
  gmailActionPending: boolean;
}

const TABS: Array<{ id: 'profile' | 'connections' | 'notes' | 'history'; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'connections', label: 'Connections' },
  { id: 'notes', label: 'Notes' },
  { id: 'history', label: 'History' }
];

export function ProfileModal({ onGmailAction, onOpenBespoke, onClose, gmailActionPending }: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'connections' | 'notes' | 'history'>('profile');
  const [activeNoteIndex, setActiveNoteIndex] = useState<number | null>(null);
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [draftNoteText, setDraftNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const { session, loading, updateProfile } = useSessionContext();
  const profile: UserProfile | null = session?.profile ?? null;
  const gmailStatus: GmailStatus | null = session?.gmail ?? null;
  const gmailLoading = loading || gmailActionPending;
  const lastUpdated = profile?.updatedAt ? new Date(profile.updatedAt).toLocaleString() : null;
  const [profileDraft, setProfileDraft] = useState<UserProfile | null>(profile);

  useEffect(() => {
    if (!isEditingProfile) {
      setProfileDraft(profile);
    }
  }, [profile, isEditingProfile]);

  const normalizedNotes: ProfileNote[] = normalizeProfileNotes(profile?.customData?.notes ?? []);

  const historyEntries = profile?.customData?.previousValues ?? {};
  const customExtras = Object.entries(profile?.customData ?? {}).filter(
    ([key, value]) =>
      key !== 'notes' &&
      key !== 'previousValues' &&
      value !== null &&
      value !== undefined &&
      value !== ''
  );

  type EditableFieldKey =
    | 'fullName'
    | 'preferredName'
    | 'contactEmail'
    | 'phone'
    | 'timezone'
    | 'company'
    | 'role'
    | 'biography';

  const fieldGroups: Array<{
    title: string;
    fields: Array<{ key: EditableFieldKey; label: string; placeholder?: string; type?: 'textarea' }>;
  }> = [
    {
      title: 'Identity',
      fields: [
        { key: 'fullName', label: 'Full name', placeholder: 'Jane Doe' },
        { key: 'preferredName', label: 'Preferred name', placeholder: 'Callsign' }
      ]
    },
    {
      title: 'Contact',
      fields: [
        { key: 'contactEmail', label: 'Contact email', placeholder: 'you@example.com' },
        { key: 'phone', label: 'Phone', placeholder: '+1 555 0100' },
        { key: 'timezone', label: 'Timezone', placeholder: 'America/Los_Angeles' }
      ]
    },
    {
      title: 'Work',
      fields: [
        { key: 'company', label: 'Company', placeholder: 'Company' },
        { key: 'role', label: 'Role', placeholder: 'Founder, Operator' }
      ]
    },
    {
      title: 'Biography',
      fields: [{ key: 'biography', label: 'Bio', placeholder: 'Tell Eclipsn about your focus', type: 'textarea' }]
    }
  ];

  const editableKeys: EditableFieldKey[] = [
    'fullName',
    'preferredName',
    'contactEmail',
    'phone',
    'timezone',
    'company',
    'role',
    'biography'
  ];

  const handleProfileFieldChange = (key: EditableFieldKey, value: string) => {
    setProfileDraft((prev) => ({ ...(prev ?? {}), [key]: value }));
  };

  const handleProfileSave = async () => {
    if (!profileDraft) return;
    setSavingProfile(true);
    try {
      const payload: Record<string, unknown> = {};
      editableKeys.forEach((key) => {
        payload[key] = profileDraft[key] ?? '';
      });
      const response = await fetch(`${GATEWAY_URL}/api/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error('Failed to update profile');
      }
      const data = await response.json();
      updateProfile(data.profile ?? null);
      setIsEditingProfile(false);
    } catch (err) {
      console.error('Profile update failed', err);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleProfileCancel = () => {
    setProfileDraft(profile);
    setIsEditingProfile(false);
  };

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
      setEditingNoteIndex(null);
      setDraftNoteText('');
      setActiveNoteIndex(null);
      updateProfile(data.profile ?? null);
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
      return <p className="text-muted">Share personal details and Eclipsn will remember them.</p>;
    }
    const draft = profileDraft ?? profile;
    return (
      <div className="profile-tab-stack">
        {fieldGroups.map((group) => (
          <section key={group.title} className="profile-section">
            <div className="profile-section-header">
              <h3>{group.title}</h3>
            </div>
            <div className={`profile-grid ${group.title === 'Biography' ? 'stacked' : ''}`}>
              {group.fields.map((field) => {
                const value = (draft as Record<string, unknown>)?.[field.key];
                const displayValue =
                  typeof value === 'string' && value.trim().length > 0 ? value : '—';
                return (
                  <div className={`profile-field ${isEditingProfile ? 'editing' : ''}`} key={`${group.title}-${field.key}`}>
                    <span>{field.label}</span>
                    {isEditingProfile ? (
                      field.type === 'textarea' ? (
                        <textarea
                          value={typeof value === 'string' ? value : ''}
                          placeholder={field.placeholder}
                          onChange={(event) => handleProfileFieldChange(field.key, event.target.value)}
                          className="profile-field-input textarea"
                        />
                      ) : (
                        <input
                          type="text"
                          value={typeof value === 'string' ? value : ''}
                          placeholder={field.placeholder}
                          onChange={(event) => handleProfileFieldChange(field.key, event.target.value)}
                          className="profile-field-input"
                        />
                      )
                    ) : (
                      <strong>{displayValue}</strong>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {customExtras.length > 0 && (
          <section className="profile-section">
            <div className="profile-section-header">
              <h3>Custom fields</h3>
            </div>
            <div className="profile-grid stacked">
              {customExtras.map(([label, value]) => (
                <div className="profile-field" key={label}>
                  <span>{label}</span>
                  <strong>{typeof value === 'string' ? value : JSON.stringify(value)}</strong>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderNotesContent = () => {
    if (normalizedNotes.length === 0) {
      return <p className="text-muted">No notes saved yet.</p>;
    }
    return (
      <section>
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
    );
  };

  const renderConnectionsContent = () => {
    const cards = [
      {
        title: 'Gmail',
        description: gmailStatus?.connected
          ? `Signed in as ${gmailStatus.name ?? gmailStatus.email ?? 'operator'}.`
          : 'Connect Gmail to ingest threads and summaries.',
        status: gmailStatus?.connected ? 'Online' : 'Offline',
        action: gmailStatus?.connected ? 'Logout' : 'Connect',
        onClick: onGmailAction,
        loading: gmailLoading
      },
      {
        title: 'Bespoke memory',
        description: 'Upload markdown notes and files.',
        status: 'Ready',
        action: 'Open',
        onClick: onOpenBespoke,
        loading: false
      }
    ];
    return (
      <div className="connection-list">
        {cards.map((card) => (
          <div className="connection-item" key={card.title}>
            <div className="connection-meta">
              <div>
                <p className="connection-name">{card.title}</p>
                <p className="connection-desc">{card.description}</p>
              </div>
            </div>
            <div className="connection-actions">
              <span className={`connection-status ${card.status === 'Online' ? 'online' : card.status === 'Offline' ? 'offline' : 'ready'}`}>
                {card.status}
              </span>
              <button type="button" onClick={card.onClick} disabled={card.loading} className="connection-manage">
                {card.action}
              </button>
            </div>
          </div>
        ))}
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
            {profile && (profile.role || profile.company) && (
              <p className="text-muted">
                {[profile.role, profile.company].filter(Boolean).join(' @ ')}
              </p>
            )}
          </div>
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
        <div className="profile-modal-footer">
        <div className="profile-header-actions">
            {isEditingProfile ? (
              <>
                <button type="button" className="profile-edit-btn secondary" onClick={handleProfileCancel} disabled={savingProfile}>
                  Cancel
                </button>
                <button type="button" className="profile-edit-btn primary" onClick={handleProfileSave} disabled={savingProfile}>
                  {savingProfile ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : (
              <button type="button" className="profile-edit-btn primary" onClick={() => setIsEditingProfile(true)}>
                Edit profile
              </button>
            )}
          </div>
          <button className="profile-done-btn" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
