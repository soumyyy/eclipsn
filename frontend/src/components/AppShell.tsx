'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ProfileModal } from './ProfileModal';
import { BespokeMemoryModal } from './BespokeMemoryModal';
import { ModalPortal } from './ModalPortal';
import { useSessionContext } from '@/components/SessionProvider';
import { useGmailStatus } from '@/hooks/useGmailStatus';
import { gatewayFetch } from '@/lib/gatewayFetch';
import { getAbsoluteApiUrl } from '@/lib/api';
import type { UserProfile } from '@/lib/profile';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, refreshSession } = useSessionContext();
  const { status: gmailStatus, refresh: refreshGmailStatus } = useGmailStatus();
  const [profileOpen, setProfileOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const profile: UserProfile | null = session?.profile ?? null;
  const displayName = profile?.preferredName || profile?.fullName || gmailStatus?.name || 'Account';
  const initials = (displayName || '?')
    .split(' ')
    .map((s) => s.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

  async function handleGmailAction() {
    if (gmailStatus?.connected) {
      if (disconnecting) return;
      setDisconnecting(true);
      try {
        const res = await gatewayFetch('gmail/disconnect', { method: 'POST' });
        if (!res.ok) throw new Error('Failed to disconnect');
        await gatewayFetch('profile/logout', { method: 'POST' }).catch(() => undefined);
        if (typeof window !== 'undefined') {
          localStorage.removeItem('EclipsnOnboarded');
          localStorage.removeItem('EclipsnProfileName');
          localStorage.removeItem('EclipsnProfileNote');
          window.location.href = '/login';
        }
        await refreshGmailStatus();
      } catch (e) {
        console.error('Gmail disconnect', e);
      } finally {
        setDisconnecting(false);
      }
    } else {
      window.location.href = getAbsoluteApiUrl('gmail/connect');
    }
  }

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="top-nav-left">
          <Link href="/" className="text-[17px] font-semibold text-[var(--text)] no-underline">
            Eclipsn
          </Link>
          <Link href="/" className={`top-nav-link ${pathname === '/' ? 'active' : ''}`}>
            Home
          </Link>
          <Link href="/chat" className={`top-nav-link ${pathname === '/chat' ? 'active' : ''}`}>
            Chat
          </Link>
        </div>
        <button
          type="button"
          className="profile-identity-button"
          onClick={() => setProfileOpen(true)}
          aria-label="Account"
        >
          <div className="profile-avatar">{initials}</div>
          <span className="profile-identity-name hidden sm:inline">{displayName}</span>
        </button>
      </header>
      <main className="main-content">{children}</main>

      {profileOpen && (
        <ModalPortal>
          <ProfileModal
            onGmailAction={handleGmailAction}
            onOpenBespoke={() => { setProfileOpen(false); setMemoryOpen(true); }}
            onClose={() => setProfileOpen(false)}
            gmailActionPending={disconnecting}
          />
        </ModalPortal>
      )}
      {memoryOpen && (
        <ModalPortal>
          <BespokeMemoryModal onClose={() => setMemoryOpen(false)} />
        </ModalPortal>
      )}
    </div>
  );
}
