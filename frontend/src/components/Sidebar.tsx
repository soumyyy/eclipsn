'use client';

import { useEffect, useState } from 'react';
import { BespokeMemoryModal } from './BespokeMemoryModal';
import { ProfileModal } from './ProfileModal';
import { ModalPortal } from './ModalPortal';
import { useSessionContext } from '@/components/SessionProvider';
import { useGmailStatus } from '@/hooks/useGmailStatus';
import type { UserProfile } from '@/lib/profile';
import { gatewayFetch } from '@/lib/gatewayFetch';
import { getAbsoluteApiUrl } from '@/lib/api';

export function Sidebar() {
  const { session, refreshSession } = useSessionContext();
  const {
    status: gmailStatus,
    refresh: refreshGmailStatus,
    syncPercent,
    syncLabel,
    shouldShowSetupBanner
  } = useGmailStatus();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profile: UserProfile | null = session?.profile ?? null;
  const [disconnecting, setDisconnecting] = useState(false);
  const [isBespokeMemoryModalOpen, setIsBespokeMemoryModalOpen] = useState(false);
  const [localIdentity, setLocalIdentity] = useState<{ name: string }>({ name: '' });
  const connectUrl = getAbsoluteApiUrl('gmail/connect');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const name = localStorage.getItem('EclipsnProfileName') || '';
    setLocalIdentity({ name });
  }, []);

  useEffect(() => {
    if (isProfileOpen) {
      refreshSession();
    }
  }, [isProfileOpen, refreshSession]);
  async function handleGmailAction() {
    if (gmailStatus.connected) {
      if (disconnecting) return;
      setDisconnecting(true);
      try {
        const response = await gatewayFetch('gmail/disconnect', {
          method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to disconnect Gmail');
        await gatewayFetch('profile/logout', { method: 'POST' }).catch(() => undefined);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('EclipsnOnboarded');
          localStorage.removeItem('EclipsnProfileName');
          localStorage.removeItem('EclipsnProfileNote');
          window.location.href = '/login';
        }
        await refreshGmailStatus();
      } catch (error) {
        console.error('Failed to disconnect Gmail', error);
      } finally {
        setDisconnecting(false);
      }
    } else {
      // Linear OAuth flow: redirect current window to OAuth
      window.location.href = connectUrl;
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
          <h1>Eclipsn</h1>
        </div>
        <section>
          <div className='chathistory'>
            <p>History</p>
          </div>
        </section>
        <section className="profile-identity-card">
          <div className="connections-grid">
            {/* <p className="connection-subtitle">Your bespoke knowledge</p> */}
            <button
              type="button"
              className="connection-button memory"
              onClick={() => setIsBespokeMemoryModalOpen(true)}
            >
              <div>
                <p className="connection-title">Index</p>
                <p className="text-muted connection-subtitle">Your Bespoke Archive</p>
              </div>
            </button>
          </div>
          {shouldShowSetupBanner && (
            <div className="gmail-sync-card">
              <div className="gmail-sync-header">
                <p className="gmail-sync-title">Setting up</p>
                {/* <p className="gmail-sync-subtitle">{disconnecting ? 'Disconnecting Gmail…' : syncLabel}</p> */}
              </div>
              <div className={`gmail-sync-progress ${syncPercent === null ? 'indeterminate' : ''}`}>
                <div
                  className="gmail-sync-progress-bar"
                  style={syncPercent !== null ? { width: `${syncPercent}%` } : undefined}
                />
              </div>
            </div>
          )}
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
        <ModalPortal>
          <ProfileModal
            onGmailAction={handleGmailAction}
            onOpenBespoke={() => setIsBespokeMemoryModalOpen(true)}
            onClose={() => setIsProfileOpen(false)}
            gmailActionPending={disconnecting}
          />
        </ModalPortal>
      )}
      {isBespokeMemoryModalOpen && (
        <ModalPortal>
          <BespokeMemoryModal onClose={() => setIsBespokeMemoryModalOpen(false)} />
        </ModalPortal>
      )}
    </>
  );
}
