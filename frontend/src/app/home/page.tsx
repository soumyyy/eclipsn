'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { post } from '@/lib/apiClient';
import { useFeed } from '@/contexts/FeedContext';
import FeedTimeline from '@/components/feed/FeedTimeline';

export default function HomeFeedPage() {
    const { cards, loading, loadFeed } = useFeed();
    const pathname = usePathname();

    useEffect(() => {
        loadFeed();
    }, [loadFeed]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && pathname === '/home') {
                loadFeed();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [loadFeed, pathname]);

    async function handleGenerateBriefing() {
        try {
            await post('feed/generate/briefing', {});
            await loadFeed();
        } catch (e) {
            console.error('Failed to generate briefing', e);
        }
    }

    return (
        <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
            <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-primary/20 px-6 py-4 flex justify-between items-center">
                <h1 className="text-xl font-bold text-primary tracking-tight">Today</h1>
                <div className="flex gap-2">
                    <Link
                        href="/"
                        className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded border border-white/10 transition-all font-medium"
                    >
                        Chat
                    </Link>
                    <button
                        onClick={handleGenerateBriefing}
                        className="px-3 py-1.5 text-xs bg-primary/10 hover:bg-primary/20 text-primary rounded border border-primary/30 transition-all font-medium"
                    >
                        Regenerate Briefing
                    </button>
                </div>
            </div>

            <div className="flex-1 p-6 space-y-6 max-w-3xl mx-auto w-full">
                {loading ? (
                    <div className="animate-pulse space-y-4">
                        <div className="h-40 bg-primary/5 rounded-xl border border-primary/10" />
                        <div className="h-24 bg-primary/5 rounded-xl border border-primary/10" />
                    </div>
                ) : cards.length > 0 ? (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <FeedTimeline cards={cards} />
                    </div>
                ) : (
                    <div className="text-center py-20">
                        <p className="text-primary/60 text-sm">No updates for today.</p>
                        <button onClick={handleGenerateBriefing} className="mt-4 text-primary hover:text-primary/80 text-sm underline">
                            Generate Morning Briefing
                        </button>
                    </div>
                )}

                <div className="h-20" />
            </div>
        </div>
    );
}
