'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionContext } from '@/components/SessionProvider';
import {
  normalizeProfileNotes,
  type ProfileHistoryEntry,
  type ProfileNote,
  type UserProfile
} from '@/lib/profile';
import type { GmailStatus } from '@/lib/session';
import { gatewayFetch } from '@/lib/gatewayFetch';

interface ProfileModalProps {
  onGmailAction: () => void;
  onOpenBespoke: () => void;
  onClose: () => void;
  gmailActionPending: boolean;
}

const tabsOrder = ['profile', 'notes', 'connections', 'history', 'settings'] as const;
type TabId = (typeof tabsOrder)[number];

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'notes', label: 'Notes' },
  { id: 'connections', label: 'Connections' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
];

export function ProfileModal({ onGmailAction, onOpenBespoke, onClose, gmailActionPending }: ProfileModalProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [activeNoteIndex, setActiveNoteIndex] = useState<number | null>(null);
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [draftNoteText, setDraftNoteText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletePhrase = 'delete account';
  const deleteInputMatches = deleteConfirmationText.trim().toLowerCase() === deletePhrase;
  const { session, loading, updateProfile, updateGmailStatus } = useSessionContext();
  const profile: UserProfile | null = session?.profile ?? null;
  const gmailStatus: GmailStatus | null = session?.gmail ?? null;
  const gmailLoading = loading || gmailActionPending;
  const lastUpdated = profile?.updatedAt ? new Date(profile.updatedAt).toLocaleString() : null;
  const [profileDraft, setProfileDraft] = useState<UserProfile | null>(profile);
  const tabContentRef = useRef<HTMLDivElement | null>(null);
  const scrollMomentumRef = useRef(0);

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
      const response = await gatewayFetch('/api/profile', {
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
      const response = await gatewayFetch('/api/profile', {
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

  const handleDeleteAccount = async () => {
    if (!deleteInputMatches) {
      setDeleteError('Type "delete account" to confirm.');
      return;
    }
    setIsDeletingAccount(true);
    setDeleteError(null);
    try {
      const response = await gatewayFetch('/api/profile/account', {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to delete account');
      }
      updateProfile(null);
      updateGmailStatus({ connected: false });
      if (typeof window !== 'undefined') {
        localStorage.removeItem('EclipsnOnboarded');
        localStorage.removeItem('EclipsnProfileName');
        localStorage.removeItem('EclipsnProfileNote');
      }
      onClose();
      router.replace('/login');
      setShowDeleteConfirmation(false);
      setDeleteConfirmationText('');
    } catch (err) {
      console.error('Failed to delete account', err);
      setDeleteError('Failed to delete account. Please try again.');
    } finally {
      setIsDeletingAccount(false);
    }
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
              <h4>{group.title}</h4>
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
        action: gmailStatus?.connected ? 'Logout' : 'Connect',
        onClick: onGmailAction,
        loading: gmailLoading
      },
      {
        title: 'Bespoke memory',
        description: 'Upload markdown notes and files.',
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

  const renderSettingsContent = () => {
    return (
      <section className="profile-settings">
        <div className="profile-settings-danger-zone">
          <h4>Danger Zone</h4>
          <p className="text-muted">
            Once you delete your account, there is no going back. All emails, bespoke memories, and chat
            history will be removed permanently.
          </p>
          {!showDeleteConfirmation ? (
            <button
              type="button"
              className="profile-delete-account-btn"
              onClick={() => {
                setShowDeleteConfirmation(true);
                setDeleteConfirmationText('');
                setDeleteError(null);
              }}
            >
              Delete Account
            </button>
          ) : (
            <div className="profile-delete-confirm">
              <label htmlFor="delete-confirmation">Type &quot;delete account&quot; to confirm</label>
              <input
                id="delete-confirmation"
                type="text"
                value={deleteConfirmationText}
                placeholder="delete account"
                onChange={(event) => setDeleteConfirmationText(event.target.value)}
                disabled={isDeletingAccount}
              />
              {deleteError && <p className="profile-error">{deleteError}</p>}
              <div className="profile-delete-actions">
                <button
                  type="button"
                  className="profile-cancel-delete"
                  onClick={() => {
                    setShowDeleteConfirmation(false);
                    setDeleteConfirmationText('');
                    setDeleteError(null);
                  }}
                  disabled={isDeletingAccount}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="profile-delete-account-btn"
                  onClick={handleDeleteAccount}
                  disabled={isDeletingAccount || !deleteInputMatches}
                >
                  {isDeletingAccount ? 'Deleting…' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  };

  const renderActiveContent = () => {
    if (activeTab === 'connections') return renderConnectionsContent();
    if (activeTab === 'notes') return renderNotesContent();
    if (activeTab === 'history') return renderHistoryContent();
    if (activeTab === 'settings') return renderSettingsContent();
    return renderProfileContent();
  };

  const handleTabScroll = (event: React.WheelEvent<HTMLDivElement>) => {
    const container = tabContentRef.current;
    if (!container) return;
    const { deltaY } = event;
    const canScrollUp = container.scrollTop > 0;
    const canScrollDown = container.scrollTop + container.clientHeight < container.scrollHeight - 1;
    const idx = tabsOrder.indexOf(activeTab);
    const threshold = 180;

    if (deltaY > 0 && !canScrollDown) {
      scrollMomentumRef.current += deltaY;
      if (scrollMomentumRef.current >= threshold && idx < tabsOrder.length - 1) {
        event.preventDefault();
        scrollMomentumRef.current = 0;
        setActiveTab(tabsOrder[idx + 1]);
        requestAnimationFrame(() => {
          if (tabContentRef.current) {
            tabContentRef.current.scrollTop = 0;
          }
        });
      }
    } else if (deltaY < 0 && !canScrollUp) {
      scrollMomentumRef.current += deltaY;
      if (scrollMomentumRef.current <= -threshold && idx > 0) {
        event.preventDefault();
        scrollMomentumRef.current = 0;
        setActiveTab(tabsOrder[idx - 1]);
        requestAnimationFrame(() => {
          if (tabContentRef.current) {
            tabContentRef.current.scrollTop = tabContentRef.current.scrollHeight;
          }
        });
      }
    } else {
      scrollMomentumRef.current = 0;
    }
  };

  return (
    <>
      {showDeleteConfirmation && (
        <div className="delete-confirmation-overlay" onClick={() => setShowDeleteConfirmation(false)}>
          <div className="delete-confirmation-dialog" onClick={(evt) => evt.stopPropagation()}>
            <h3>Delete Account</h3>
            <p className="text-muted">
              This action cannot be undone. This will permanently delete your account and remove all of your data from our servers.
            </p>
            <p className="delete-warning">
              Please type <strong>delete account</strong> to confirm:
            </p>
            <input
              type="text"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder="Type 'delete account' here"
              className="delete-confirmation-input"
              autoFocus
            />
            <div className="delete-confirmation-actions">
              <button
                type="button"
                className="delete-confirmation-cancel"
                onClick={() => {
                  setShowDeleteConfirmation(false);
                  setDeleteConfirmationText('');
                }}
                disabled={isDeletingAccount}
              >
                Cancel
              </button>
              <button
                type="button"
                className="delete-confirmation-confirm"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmationText !== 'delete account' || isDeletingAccount}
              >
                {isDeletingAccount ? 'Deleting…' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="profile-modal-overlay" onClick={onClose}>
        <div className="profile-modal" onClick={(evt) => evt.stopPropagation()}>
        <div className="profile-modal-header">
          <div>
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
          <div className="profile-tab-content" ref={tabContentRef} onWheel={handleTabScroll}>
            {renderActiveContent()}
          </div>
        </div>
        <div className="profile-modal-footer">
          <div className="footer-left">
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
                  Edit
                </button>
              )}
            </div>
          </div>
          <div className="footer-right">
            <button className="profile-done-btn" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
