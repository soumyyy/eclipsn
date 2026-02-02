'use client';

import { useEffect, useState } from 'react';
import { get, post, del } from '@/lib/apiClient';
import { getAbsoluteApiUrl } from '@/lib/api';
import { SyncToast } from '@/components/SyncToast';

interface ServiceAccount {
    id: string;
    email: string;
    provider: string;
    filterKeywords: string[];
    createdAt: string;
}

export function ServiceAccountsSettings() {
    const [accounts, setAccounts] = useState<ServiceAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [showNameModal, setShowNameModal] = useState(false);
    const [accountName, setAccountName] = useState('');

    useEffect(() => {
        loadAccounts();
        const params = new URLSearchParams(window.location.search);
        if (params.get('success')) {
            window.history.replaceState({}, '', window.location.pathname);
        }
        if (params.get('error')) {
            setError(decodeURIComponent(params.get('error')!));
        }
    }, []);

    async function loadAccounts() {
        try {
            console.log('Fetching service accounts...');
            const data = await get('service-accounts');
            console.log('Fetched accounts:', data);
            setAccounts(data);
        } catch (e) {
            console.error(e);
            setError('Failed to load accounts');
        } finally {
            setLoading(false);
        }
    }

    function startConnect() {
        setShowNameModal(true);
        setAccountName('');
    }

    async function handleConnectWithLabel() {
        if (!accountName.trim()) return;
        const label = encodeURIComponent(accountName.trim());
        window.location.href = getAbsoluteApiUrl(`service-accounts/connect?label=${label}`);
    }

    async function handleDisconnect(id: string) {
        if (!confirm('Disconnect this account?')) return;
        try {
            await del(`service-accounts/${id}`);
            setAccounts(prev => prev.filter(a => a.id !== id));
        } catch (e) {
            alert('Failed to disconnect');
        }
    }

    async function handleSync(id: string) {
        try {
            const res = await post(`service-accounts/${id}/sync`, {});
            if (res.jobId) {
                setActiveJobId(res.jobId);
            }
        } catch (e) {
            alert('Failed to start sync');
        }
    }

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse p-4">
                {[1, 2].map(i => (
                    <div key={i} className="h-20 bg-[var(--surface)] border border-[var(--border)] rounded-xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6 relative p-1">
            {error && (
                <div className="p-4 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-muted)] text-sm flex items-center gap-2">
                    <span>⚠</span> {error}
                </div>
            )}

            <div className="space-y-4">
                {accounts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface)] text-center">
                        <h3 className="text-[var(--text)] font-semibold mb-2">No accounts connected</h3>
                        <p className="text-[var(--text-muted)] text-sm max-w-xs mb-6 leading-relaxed">
                            Connect a secondary Gmail account to ingest calendars and documents.
                        </p>
                        <button
                            onClick={startConnect}
                            className="btn btn-primary"
                        >
                            Connect Gmail
                        </button>
                    </div>
                ) : (
                    accounts.map(account => (
                        <div key={account.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-[var(--border)] bg-[var(--surface)] rounded-xl gap-4">
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-3">
                                    <span className="text-[15px] font-medium text-[var(--text)]">
                                        {(account as any).name ? (account as any).name : 'Service Account'}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] px-2 py-0.5 rounded border border-[var(--border)]">
                                        {account.provider}
                                    </span>
                                </div>
                                <div className="text-sm text-[var(--text-muted)] font-mono">{account.email}</div>
                                <div className="text-xs text-[var(--text-tertiary)]">
                                    {account.filterKeywords?.length ? account.filterKeywords.join(', ') : 'All pdfs (3mo)'}
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => handleSync(account.id)}
                                    className="connection-manage"
                                >
                                    Sync
                                </button>
                                <button
                                    onClick={() => handleDisconnect(account.id)}
                                    className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg transition-colors"
                                >
                                    Disconnect
                                </button>
                            </div>
                        </div>
                    ))
                )}

                {accounts.length > 0 && (
                    <div className="flex justify-start pt-2">
                        <button
                            onClick={startConnect}
                            className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-3 py-2 rounded-lg"
                        >
                            + Add account
                        </button>
                    </div>
                )}
            </div>

            {activeJobId && (
                <SyncToast jobId={activeJobId} onClose={() => setActiveJobId(null)} />
            )}

            {showNameModal && (
                <div className="modal-overlay" onClick={() => setShowNameModal(false)}>
                    <div className="modal-panel p-6 space-y-5" onClick={e => e.stopPropagation()}>
                        <div className="space-y-2">
                            <h3 className="text-[17px] font-semibold text-[var(--text)]">Name this account</h3>
                            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                                Give this connection a label (e.g. Personal, Work).
                            </p>
                        </div>
                        <input
                            type="text"
                            className="chat-input w-full"
                            placeholder="e.g. College"
                            autoFocus
                            value={accountName}
                            onChange={e => setAccountName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleConnectWithLabel();
                                if (e.key === 'Escape') setShowNameModal(false);
                            }}
                        />
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowNameModal(false)}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleConnectWithLabel}
                                disabled={!accountName.trim()}
                                className="btn btn-primary"
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
