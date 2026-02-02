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
                    <div key={i} className="h-20 bg-primary/5 border border-primary/20 rounded-lg"></div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6 relative p-1">
            {error && (
                <div className="bg-red-900/20 border border-red-500/50 p-4 rounded text-red-300 text-sm flex items-center gap-2">
                    <span className="text-lg">⚠</span> {error}
                </div>
            )}

            <div className="space-y-4">
                {accounts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 border border-dashed border-primary/20 rounded-xl bg-primary/5 text-center">
                        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-2xl text-primary shadow-lg shadow-primary/5">
                            ✉️
                        </div>
                        <h3 className="text-primary font-semibold mb-2">No accounts connected</h3>
                        <p className="text-primary/60 text-sm max-w-xs mb-6 leading-relaxed">
                            Connect any secondary Gmail account to automatically ingest schedules, documents, and other relevant data.
                        </p>
                        <button
                            onClick={startConnect}
                            className="bg-primary hover:bg-primary/90 text-background font-bold py-2.5 px-6 rounded-lg shadow-[0_0_15px_rgba(215,206,185,0.3)] transition-all transform hover:scale-105 active:scale-95"
                        >
                            Connect Gmail Account
                        </button>
                    </div>
                ) : (
                    accounts.map(account => (
                        <div key={account.id} className="group relative flex flex-col sm:flex-row sm:items-center justify-between p-5 border border-primary/20 bg-gradient-to-br from-primary/5 to-black rounded-xl gap-4 transition-all hover:border-primary/40 hover:shadow-[0_0_20px_rgba(215,206,185,0.05)]">
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-3">
                                    <span className="text-lg font-semibold text-primary tracking-tight">
                                        {(account as any).name ? (account as any).name : 'Service Account'}
                                    </span>
                                    <span className="text-[10px] uppercase font-bold tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded border border-primary/30">
                                        {account.provider}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-primary/80 font-mono">
                                    <span>{account.email}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-primary/50">
                                    <span className="opacity-70">FILTERS:</span>
                                    <span>
                                        {account.filterKeywords?.length ? account.filterKeywords.join(', ') : 'All pdfs (3mo)'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => handleSync(account.id)}
                                    className="flex items-center gap-2 px-4 py-2 text-xs font-bold border border-primary/30 bg-primary/10 hover:bg-primary/20 hover:border-primary rounded-lg text-primary transition-all uppercase tracking-wide hover:shadow-lg"
                                >
                                    <span className="text-primary">⟳</span> Sync
                                </button>
                                <button
                                    onClick={() => handleDisconnect(account.id)}
                                    className="px-3 py-2 text-xs font-bold text-red-400/80 hover:text-red-300 hover:bg-red-950/30 rounded-lg transition-colors uppercase tracking-wide"
                                >
                                    Disconnect
                                </button>
                            </div>
                        </div>
                    ))
                )}

                {accounts.length > 0 && (
                    <div className="flex justify-start pt-4">
                        <button
                            onClick={startConnect}
                            className="flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 transition-colors px-3 py-2 rounded-lg hover:bg-primary/10 border border-transparent hover:border-primary/20"
                        >
                            <span className="text-lg leading-none font-light">+</span> CONNECT ANOTHER ACCOUNT
                        </button>
                    </div>
                )}
            </div>

            {activeJobId && (
                <SyncToast jobId={activeJobId} onClose={() => setActiveJobId(null)} />
            )}

            {showNameModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setShowNameModal(false)}>
                    <div className="bg-[#1f2025] border border-primary/30 w-full max-w-sm rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] p-6 space-y-5" onClick={e => e.stopPropagation()}>
                        <div className="space-y-2">
                            <h3 className="text-xl font-semibold text-primary">Name this account</h3>
                            <p className="text-sm text-primary/70 leading-relaxed">
                                Give this connection a label (e.g. "Personal", "Work") to easily identify it later.
                            </p>
                        </div>
                        <input
                            type="text"
                            className="w-full bg-primary/10 border border-primary/30 rounded-lg px-4 py-3 text-primary placeholder-primary/30 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-medium"
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
                                onClick={() => setShowNameModal(false)}
                                className="px-4 py-2 text-sm font-medium text-primary/70 hover:text-primary transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConnectWithLabel}
                                disabled={!accountName.trim()}
                                className="px-5 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-background text-sm font-bold rounded-lg shadow-lg shadow-primary/20 transition-all transform active:scale-95"
                            >
                                Continue →
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
