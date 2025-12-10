'use client';

import { useEffect, useState, useRef, ChangeEvent, DragEvent } from 'react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

interface GmailStatus {
  connected: boolean;
  email?: string;
  avatarUrl?: string;
  name?: string;
}

interface OutlookStatus {
  connected: boolean;
  scope?: string;
}

interface ProfileNote {
  text?: string;
  timestamp?: string | null;
}

interface ProfileHistoryEntry {
  value?: string | null;
  timestamp?: string | null;
}

interface ProfileInfo {
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

interface BespokeStatus {
  id: string;
  status: string;
  statusLabel: string;
  totalFiles: number;
  chunkedFiles: number;
  indexedChunks: number;
  totalChunks: number;
  createdAt: string;
  completedAt?: string | null;
  error?: string | null;
  batchName?: string | null;
}

export function Sidebar() {
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailLoading, setGmailLoading] = useState(true);
  const [outlookStatus, setOutlookStatus] = useState<OutlookStatus | null>(null);
  const [outlookLoading, setOutlookLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [outlookDisconnecting, setOutlookDisconnecting] = useState(false);
  const [isBespokeMemoryModalOpen, setIsBespokeMemoryModalOpen] = useState(false);
  const connectUrl = `${GATEWAY_URL}/api/gmail/connect`;

  useEffect(() => {
    async function loadStatus() {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/gmail/status`);
        if (!response.ok) throw new Error('Failed to load Gmail status');
        const data = await response.json();
        setGmailStatus({
          connected: Boolean(data.connected),
          email: data.email,
          avatarUrl: data.avatarUrl,
          name: data.name
        });
      } catch (error) {
        console.error('Failed to load Gmail status', error);
        setGmailStatus({ connected: false });
      } finally {
        setGmailLoading(false);
      }
    }

    loadStatus();
  }, []);

  useEffect(() => {
    async function loadOutlookStatus() {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/outlook/status`);
        if (!response.ok) throw new Error('Failed to load Outlook status');
        const data = await response.json();
        setOutlookStatus({
          connected: Boolean(data.connected),
          scope: data.scope
        });
      } catch (error) {
        console.error('Failed to load Outlook status', error);
        setOutlookStatus({ connected: false });
      } finally {
        setOutlookLoading(false);
      }
    }

    loadOutlookStatus();
  }, []);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let stopped = false;

    async function loadProfile() {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/profile`);
        if (!response.ok) throw new Error('Failed to load profile');
        const data = await response.json();
        setProfile(data.profile ?? null);
      } catch (error) {
        console.error('Failed to load profile', error);
        setProfile(null);
      } finally {
        if (!stopped) {
          setProfileLoading(false);
        }
      }
    }

    loadProfile();
    intervalId = setInterval(loadProfile, 5000);

    return () => {
      stopped = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  async function handleGmailAction() {
    if (gmailStatus?.connected) {
      const confirmed = window.confirm('Disconnect Gmail? You can reconnect any time.');
      if (!confirmed) return;
      if (disconnecting) return;
      setDisconnecting(true);
      try {
        const response = await fetch(`${GATEWAY_URL}/api/gmail/disconnect`, {
          method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to disconnect Gmail');
        setGmailStatus({ connected: false });
      } catch (error) {
        console.error('Failed to disconnect Gmail', error);
      } finally {
        setDisconnecting(false);
      }
    } else {
      window.open(connectUrl, '_blank', 'width=520,height=620');
    }
  }

  async function handleOutlookAction() {
    if (outlookStatus?.connected) {
      const confirmed = window.confirm('Disconnect Outlook? You can reconnect whenever you are ready.');
      if (!confirmed) return;
      if (outlookDisconnecting) return;
      setOutlookDisconnecting(true);
      try {
        const response = await fetch(`${GATEWAY_URL}/api/outlook/disconnect`, {
          method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to disconnect Outlook');
        setOutlookStatus({ connected: false });
      } catch (error) {
        console.error('Failed to disconnect Outlook', error);
      } finally {
        setOutlookDisconnecting(false);
      }
    } else {
      window.open(`${GATEWAY_URL}/api/outlook/connect`, '_blank', 'width=520,height=620');
    }
  }

  return (
    <>
      <div>
      <div>
        <h1>PLUTO</h1>
        <p className="text-accent">Operator Console</p>
      </div>
      <section className="sidebar-section">
        <h2>Profile</h2>
        <button
          className="profile-launch"
          type="button"
          onClick={() => setIsProfileOpen(true)}
          disabled={profileLoading}
        >
          {profileLoading ? 'Loading…' : 'Open Profile'}
        </button>
      </section>
      <section className="sidebar-section">
        <h2>Connections</h2>
        <div className="connections-grid">
          <button
            type="button"
            className={`connection-button ${gmailStatus?.connected ? 'connected' : ''}`}
            onClick={handleGmailAction}
            disabled={gmailLoading || disconnecting}
          >
            <div>
              <p className="connection-title">Gmail</p>
              <p className="text-muted connection-subtitle">
                {gmailLoading
                  ? 'Checking…'
                  : gmailStatus?.connected
                    ? gmailStatus.name ?? gmailStatus.email ?? 'Connected'
                    : 'Connect to ingest inbox'}
              </p>
            </div>
            <span className="connection-action">
              {gmailLoading ? '...' : gmailStatus?.connected ? (disconnecting ? 'Disconnecting…' : 'Disconnect') : 'Connect'}
            </span>
          </button>
          <button
            type="button"
            className={`connection-button ${outlookStatus?.connected ? 'connected' : ''}`}
            onClick={handleOutlookAction}
            disabled={outlookLoading || outlookDisconnecting}
          >
            <div>
              <p className="connection-title">Outlook</p>
              <p className="text-muted connection-subtitle">
                {outlookLoading
                  ? 'Checking…'
                  : outlookStatus?.connected
                    ? 'Connected to Microsoft Graph'
                    : 'Connect your Outlook mail'}
              </p>
            </div>
            <span className="connection-action">
              {outlookLoading ? '...' : outlookStatus?.connected ? (outlookDisconnecting ? 'Disconnecting…' : 'Disconnect') : 'Connect'}
            </span>
          </button>
          <button
            type="button"
            className="connection-button memory"
            onClick={() => setIsBespokeMemoryModalOpen(true)}
          >
            <div>
              <p className="connection-title">Bespoke Memory</p>
              <p className="text-muted connection-subtitle">
                Upload local text repositories for RAG
              </p>
            </div>
            <span className="connection-action">Open</span>
          </button>

        </div>
      </section>
    </div>
      {isProfileOpen && (
        <ProfileModal
          profile={profile}
          loading={profileLoading}
          onClose={() => setIsProfileOpen(false)}
          onProfileUpdated={(nextProfile) => setProfile(nextProfile)}
        />
      )}
      {isBespokeMemoryModalOpen && (
        <BespokeMemoryModal onClose={() => setIsBespokeMemoryModalOpen(false)} />
      )}
    </>
  );
}

interface ProfileModalProps {
  profile: ProfileInfo | null;
  loading: boolean;
  onClose: () => void;
  onProfileUpdated: (profile: ProfileInfo | null) => void;
}

function ProfileModal({ profile, loading, onClose, onProfileUpdated }: ProfileModalProps) {
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

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(evt) => evt.stopPropagation()}>
        <div className="profile-modal-header">
          <div>
            <p className="profile-name">
              {profile?.preferredName ?? profile?.fullName ?? 'User profile'}
            </p>
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

        {loading ? (
          <p className="text-muted">Loading profile…</p>
        ) : !profile ? (
          <p className="text-muted">Share personal details and Pluto will remember them.</p>
        ) : (
          <div className="profile-modal-body">
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
                              {note.timestamp && (
                                <small className="text-muted">{new Date(note.timestamp).toLocaleString()}</small>
                              )}
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

            {historyEntries && Object.keys(historyEntries).length > 0 && (
              <section>
                <h3>Change History</h3>
                <div className="profile-history">
                  {Object.entries(historyEntries).map(([fieldKey, entries]) => {
                    if (!Array.isArray(entries) || entries.length === 0) return null;
                    return (
                      <div key={fieldKey} className="profile-history-field">
                        <p className="profile-history-label">{fieldKey}</p>
                        <ul>
                          {entries.map((entry, idx) => (
                            <li key={`${fieldKey}-${idx}`}>
                              <strong>{entry?.value ?? '—'}</strong>
                              {entry?.timestamp && (
                                <small>
                                  {new Date(entry.timestamp).toLocaleString()}
                                </small>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface BespokeMemoryModalProps {
  onClose: () => void;
}

type UploadStage = 'idle' | 'confirm' | 'uploading';

function BespokeMemoryModal({ onClose }: BespokeMemoryModalProps) {
  const [fileQueue, setFileQueue] = useState<{ name: string; size: number }[]>([]);
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<BespokeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [history, setHistory] = useState<BespokeStatus[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const allowedExtensions = ['.md'];

  useEffect(() => {
    loadStatus();
    loadHistory();
    const interval = setInterval(() => {
      loadStatus();
      loadHistory();
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  async function loadStatus() {
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory/status`);
      if (!response.ok) throw new Error('Failed to load status');
      const data = await response.json();
      setStatusData(data.ingestion ?? null);
    } catch (error) {
      console.error('Failed to load memory status', error);
    } finally {
      setStatusLoading(false);
    }
  }

  async function loadHistory(limit = 6) {
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory/history?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to load history');
      const data = await response.json();
      setHistory(data.history ?? []);
    } catch (error) {
      console.error('Failed to load ingestion history', error);
    } finally {
      setHistoryLoading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    const validFiles = files.filter((file) =>
      allowedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
    );
    const queue = validFiles.map((file) => ({
      name: file.webkitRelativePath || file.name,
      size: file.size
    }));
    setFileQueue(queue);
    setUploadError(null);
    setUploadStage(queue.length ? 'confirm' : 'idle');
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files || []);
    const filtered = files.filter((file) =>
      allowedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
    );
    const queue = filtered.map((file) => ({
      name: file.webkitRelativePath || file.name,
      size: file.size
    }));
    setFileQueue(queue);
    setUploadError(null);
    setUploadStage(queue.length ? 'confirm' : 'idle');
  }

  async function handleUpload() {
    if (!fileQueue.length || isUploading || !fileInputRef.current?.files) return;
    setUploadStage('uploading');
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      Array.from(fileInputRef.current.files).forEach((file) => {
        formData.append('files', file, file.name);
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        formData.append('paths', relativePath || file.name);
      });
      const response = await fetch(`${GATEWAY_URL}/api/memory/upload`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }
      await loadStatus();
      await loadHistory();
      setFileQueue([]);
      setUploadStage('idle');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to upload bespoke memory', error);
      setUploadError((error as Error).message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleReindex(ingestionId: string) {
    setActionLoading(ingestionId);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory/${ingestionId}/reindex`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to queue re-index');
      await loadStatus();
      await loadHistory();
    } catch (error) {
      console.error('Failed to reindex ingestion', error);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(ingestionId: string) {
    setActionLoading(ingestionId);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory/${ingestionId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete ingestion');
      await loadStatus();
      await loadHistory();
    } catch (error) {
      console.error('Failed to delete ingestion', error);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleClearAll() {
    if (clearingAll) return;
    setClearingAll(true);
    try {
      const response = await fetch(`${GATEWAY_URL}/api/memory`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to clear bespoke memories');
      await loadStatus();
      await loadHistory();
      setFileQueue([]);
      setUploadStage('idle');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      console.error('Failed to clear bespoke memories', error);
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal memory-modal" onClick={(evt) => evt.stopPropagation()}>
        <div className="profile-modal-header">
          <div>
            <p className="profile-name">Bespoke Memory</p>
          </div>
          <button className="profile-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="profile-modal-body">
          <section>
            <h3>Upload Local Folder</h3>
            <div className={`memory-dropzone ${dragActive ? 'active' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
              <input
                type="file"
                multiple
                ref={fileInputRef}
                // allow folder selection when supported
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                webkitdirectory="true"
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                directory="true"
                onChange={handleFileChange}
                accept={allowedExtensions.join(',')}
              />
              {uploadStage === 'confirm' && fileQueue.length > 0 && (
                <div className="memory-confirmation">
                  <p>Upload {fileQueue.length} Markdown file{fileQueue.length === 1 ? '' : 's'}?</p>
                  <ul className="memory-file-queue">
                    {fileQueue.slice(0, 6).map((file) => (
                      <li key={file.name}>{file.name}</li>
                    ))}
                    {fileQueue.length > 6 && <li>+ {fileQueue.length - 6} more</li>}
                  </ul>
                  <div className="memory-actions">
                    <button type="button" className="memory-upload-btn primary" onClick={handleUpload} disabled={isUploading}>
                      {isUploading ? 'Uploading…' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      className="memory-upload-btn secondary"
                      onClick={() => {
                        setFileQueue([]);
                        setUploadStage('idle');
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      disabled={isUploading}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {uploadStage === 'uploading' && (
                <div className="memory-upload-progress">
                  <div className="progress-track">
                    <div className="progress-value active" style={{ width: '60%' }} />
                  </div>
                  <p>Uploading…</p>
                </div>
              )}
              {uploadStage !== 'confirm' && uploadStage !== 'uploading' && statusData && statusData.status !== 'uploaded' && statusData.status !== 'failed' && (
                <MemoryProgress status={statusData} />
              )}
              {uploadStage !== 'uploading' && statusData && statusData.status === 'failed' && (
                <p className="profile-error">{statusData.error || 'Ingestion failed'}</p>
              )}
              {uploadStage === 'idle' && statusLoading && (
                <p className="text-muted">Checking status…</p>
              )}
              {uploadStage === 'idle' && !statusLoading && (!statusData || statusData.status === 'uploaded' || statusData.status === 'failed') && (
                <>
                  <p>Drop Markdown files or click Upload.</p>
                  <button type="button" className="memory-upload-btn primary" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                    Upload
                  </button>
                </>
              )}
            </div>
            {uploadError && <p className="profile-error">{uploadError}</p>}
          </section>
          <section>
            <div className="memory-history-header">
              <h3>History</h3>
              {history.length > 0 && (
                <button
                  type="button"
                  className="memory-upload-btn secondary"
                  onClick={handleClearAll}
                  disabled={clearingAll}
                >
                  {clearingAll ? 'Clearing…' : 'Clear All'}
                </button>
              )}
            </div>
            {historyLoading ? (
              <p className="text-muted">Loading history…</p>
            ) : history.length === 0 ? (
              <p className="text-muted">No uploads yet.</p>
            ) : (
              <ul className="memory-history-list">
                {history.map((item) => (
                  <li key={item.id} className="memory-history-item">
                    <div>
                      <p className="memory-history-title">{item.batchName || `${item.totalFiles} file${item.totalFiles === 1 ? '' : 's'}`}</p>
                      <small>{item.statusLabel} · {new Date(item.createdAt).toLocaleString()}</small>
                    </div>
                    <div className="memory-history-actions">
                      {/* Re-index button commented out per request */}
                      {/* {item.status === 'uploaded' && (
                        <button
                          type="button"
                          className="memory-upload-btn secondary"
                          onClick={() => handleReindex(item.id)}
                          disabled={actionLoading === item.id}
                        >
                          {actionLoading === item.id ? 'Queueing…' : 'Re-index'}
                        </button>
                      )} */}
                      <button
                        type="button"
                        className="memory-upload-btn secondary"
                        onClick={() => handleDelete(item.id)}
                        disabled={actionLoading === item.id}
                      >
                        {actionLoading === item.id ? 'Removing…' : 'Delete'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function MemoryProgress({ status }: { status: BespokeStatus }) {
  const isIndexing = status.status !== 'chunking' && status.status !== 'failed' && status.status !== 'uploaded';
  const total = isIndexing ? status.totalChunks || status.totalFiles || 0 : status.totalFiles || 0;
  const current = isIndexing ? status.indexedChunks : status.chunkedFiles;
  const progress = total ? Math.min(100, (current / total) * 100) : 0;
  const label = isIndexing
    ? `${status.statusLabel} · ${status.indexedChunks}/${status.totalChunks || '—'} chunks`
    : `${status.statusLabel} · ${status.chunkedFiles}/${status.totalFiles} files`;
  return (
    <div className="memory-upload-progress">
      <div className="progress-track">
        <div className="progress-value active" style={{ width: `${progress}%` }} />
      </div>
      <p>{label}</p>
    </div>
  );
}
