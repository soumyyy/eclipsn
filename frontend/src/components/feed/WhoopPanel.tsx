'use client';

import { WhoopCard } from './cards/WhoopCard';
import { useWhoopData } from '@/hooks/useWhoopData';
import { useWhoopStatus } from '@/hooks/useWhoopStatus';

export function WhoopPanel() {
    const { status: whoopStatus } = useWhoopStatus();
    const { data: whoopData, loading, error, refresh } = useWhoopData(Boolean(whoopStatus?.connected));

    return (
        <div className="flex flex-col h-full bg-[var(--bg)]">
            <div className="p-4 border-b border-[var(--border)]">
                <h2 className="text-[13px] font-medium text-[var(--text-muted)]">Health</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <span className="text-[13px] text-[var(--text-tertiary)]">Loading…</span>
                    </div>
                ) : error ? (
                    <div className="text-center text-[var(--text-muted)] text-[13px] mt-8">
                        <p>{error}</p>
                        <button type="button" onClick={refresh} className="mt-2 text-[var(--text)] underline">Retry</button>
                    </div>
                ) : whoopData ? (
                    <WhoopCard data={whoopData} />
                ) : (
                    <div className="text-center text-[var(--text-muted)] text-[13px] mt-8">
                        No Whoop data. Connect in Settings.
                    </div>
                )}
            </div>
        </div>
    );
}
