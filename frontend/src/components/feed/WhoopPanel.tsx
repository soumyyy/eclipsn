'use client';

import { WhoopCard } from './cards/WhoopCard';
import { useWhoopData } from '@/hooks/useWhoopData';
import { useWhoopStatus } from '@/hooks/useWhoopStatus';

export function WhoopPanel() {
    const { status: whoopStatus } = useWhoopStatus();
    const { data: whoopData, loading, error, refresh } = useWhoopData(Boolean(whoopStatus?.connected));

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="p-4 border-b border-white/5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-white/60">Health</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-white/40 text-sm animate-pulse">Loading metrics...</div>
                    </div>
                ) : error ? (
                    <div className="text-center text-white/40 mt-20 text-sm">
                        <p>{error}</p>
                        <button onClick={refresh} className="mt-2 text-primary/80 text-xs underline">Retry</button>
                    </div>
                ) : whoopData ? (
                    <WhoopCard data={whoopData} />
                ) : (
                    <div className="text-center text-white/40 mt-20 text-sm">
                        No Whoop data available.
                        <br />
                        <span className="text-xs text-white/20">Connect your Whoop account in Settings.</span>
                    </div>
                )}
            </div>
        </div>
    );
}
