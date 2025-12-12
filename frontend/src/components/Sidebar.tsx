'use client';

import { useEffect, useState } from 'react';
import { BespokeMemoryModal } from './BespokeMemoryModal';
import { ProfileModal } from './ProfileModal';
import { useSessionContext } from '@/components/SessionProvider';
import type { GmailStatus } from '@/lib/session';
import type { UserProfile } from '@/lib/profile';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

export function Sidebar() {
  const { session, refreshSession, updateGmailStatus } = useSessionContext();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [isBespokeMemoryModalOpen, setIsBespokeMemoryModalOpen] = useState(false);
  const [localIdentity, setLocalIdentity] = useState<{ name: string }>({ name: '' });
  const connectUrl = `${GATEWAY_URL}/api/gmail/connect`;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const name = localStorage.getItem('plutoProfileName') || '';
    setLocalIdentity({ name });
  }, []);

  useEffect(() => {
    if (isProfileOpen) {
      refreshSession();
    }
  }, [isProfileOpen, refreshSession]);

  const gmailStatus: GmailStatus = session?.gmail ?? { connected: false };
  const profile: UserProfile | null = session?.profile ?? null;

  async function handleGmailAction() {
    if (gmailStatus.connected) {
      if (disconnecting) return;
      setDisconnecting(true);
      try {
        const response = await fetch(`${GATEWAY_URL}/api/gmail/disconnect`, {
          method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to disconnect Gmail');
        updateGmailStatus({ connected: false });
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
      const poll = setInterval(async () => {
        try {
          const snapshot = await refreshSession();
          if (snapshot?.gmail.connected) {
            clearInterval(poll);
          }
        } catch {
          // swallow
        }
      }, 2500);
    }
  }

  const displayName =
    profile?.preferredName || profile?.fullName || localIdentity.name || gmailStatus.name || 'Operator';
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
        </div>
        <section className="sidebar-section">
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
            </div>
          </button>
        </section>
      </div>
      {isProfileOpen && (
        <ProfileModal
          onGmailAction={handleGmailAction}
          onOpenBespoke={() => setIsBespokeMemoryModalOpen(true)}
          onClose={() => setIsProfileOpen(false)}
          gmailActionPending={disconnecting}
        />
      )}
      {isBespokeMemoryModalOpen && (
        <BespokeMemoryModal onClose={() => setIsBespokeMemoryModalOpen(false)} />
      )}
    </>
  );
}
