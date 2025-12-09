'use client';

import { useEffect, useState } from 'react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

interface GmailStatus {
  connected: boolean;
  email?: string;
  avatarUrl?: string;
  name?: string;
}

export function Sidebar() {
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
        setIsLoading(false);
      }
    }

    loadStatus();
  }, []);

  return (
    <div>
      <div>
        <h1>PLUTO</h1>
        <p className="text-accent">Operator Console</p>
      </div>
      <section className="sidebar-section">
        <h2>Activity</h2>
        <p>Awaiting mission data…</p>
      </section>
      <section className="sidebar-section">
        <h2>Tasks</h2>
        <p>Gmail-derived tasks will materialize here.</p>
      </section>
      <section className="sidebar-section">
        <h2>Gmail</h2>
        {isLoading ? (
          <p className="text-muted">Checking Gmail status…</p>
        ) : gmailStatus?.connected ? (
          <div className="gmail-card">
            <div className="gmail-connected">
              <div className="gmail-avatar">
                {gmailStatus.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={gmailStatus.avatarUrl} alt="Gmail avatar" />
                ) : (
                  <span>G</span>
                )}
              </div>
              <div>
                <p className="gmail-email">{gmailStatus.name ?? gmailStatus.email ?? 'Gmail account'}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="gmail-card">
            <p className="text-muted">Link Gmail so Pluto can summarize your inbox.</p>
            <a href={connectUrl} className="gmail-button">
              Connect Gmail
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
