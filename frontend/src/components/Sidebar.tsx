'use client';

import { useEffect, useState, useRef, ChangeEvent, DragEvent, useCallback } from 'react';
import { BespokeMemoryModal, type BespokeStatus } from './BespokeMemoryModal';
import { ProfileModal, type ProfileInfo } from './ProfileModal';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

interface GmailStatus {
  connected: boolean;
  email?: string;
  avatarUrl?: string;
  name?: string;
}

export function Sidebar() {
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailLoading, setGmailLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [isBespokeMemoryModalOpen, setIsBespokeMemoryModalOpen] = useState(false);
  const [localIdentity, setLocalIdentity] = useState<{ name: string }>({
    name: ''
  });
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
    if (typeof window === 'undefined') return;
    const name = localStorage.getItem('plutoProfileName') || '';
    setLocalIdentity({ name });
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
      if (disconnecting) return;
      setDisconnecting(true);
      try {
        const response = await fetch(`${GATEWAY_URL}/api/gmail/disconnect`, {
          method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to disconnect Gmail');
        setGmailStatus({ connected: false });
        if (typeof window !== 'undefined') {
          localStorage.removeItem('plutoOnboarded');
          window.location.href = '/login';
        }
      } catch (error) {
        console.error('Failed to disconnect Gmail', error);
      } finally {
        setDisconnecting(false);
      }
    } else {
      window.open(connectUrl, '_blank', 'width=520,height=620');
    }
  }

  const displayName =
    profile?.preferredName || profile?.fullName || localIdentity.name || gmailStatus?.name || 'Operator';
  const initials = (displayName || 'P')
    .split(' ')
    .map((token) => token.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <div className="sidebar-root">
        <div>
          <h1>PLUTO</h1>
          {/* <p className="text-accent">Operator Console</p> */}
        </div>
      {/* <section className="sidebar-section">
        <h2>Profile</h2>
        <button
          className="profile-launch"
          type="button"
          onClick={() => setIsProfileOpen(true)}
          disabled={profileLoading}
        >
          {profileLoading ? 'Loading…' : 'Open Profile'}
        </button>
      </section> */}
        <section className="sidebar-section">
          {/* <h2>Connections</h2> */}
          <div className="connections-grid">
            <button
              type="button"
              className="connection-button memory"
              onClick={() => setIsBespokeMemoryModalOpen(true)}
            >
              <div>
                <p className="connection-title">Bespoke Memory</p>
                <p className="text-muted connection-subtitle">Ingest your memories.</p>
              </div>
            </button>
          </div>
        </section>
        <section className="profile-identity-card">
          <button type="button" className="profile-identity-button" onClick={() => setIsProfileOpen(true)}>
            <div className="profile-avatar">{initials || 'P'}</div>
            <div>
              <p className="profile-identity-name">{displayName}</p>
              {/* <small className="text-muted">{profile?.role || profile?.company || 'View profile'}</small> */}
            </div>
          </button>
        </section>
      </div>
      {isProfileOpen && (
        <ProfileModal
          profile={profile}
          loading={profileLoading}
          gmailStatus={gmailStatus}
          gmailLoading={gmailLoading}
          onGmailAction={handleGmailAction}
          onOpenBespoke={() => setIsBespokeMemoryModalOpen(true)}
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
