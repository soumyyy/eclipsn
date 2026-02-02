'use client';

import { useEffect } from 'react';
import { post } from '@/lib/apiClient';
import { useFeed } from '@/contexts/FeedContext';
import FeedTimeline from '@/components/feed/FeedTimeline';
import { WhoopPanel } from '@/components/feed/WhoopPanel';

export default function HomePage() {
  const { cards, loading, loadFeed } = useFeed();

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  async function handleGenerateBriefing() {
    try {
      await post('feed/generate/briefing', {});
      await loadFeed();
    } catch (e) {
      console.error('Failed to generate briefing', e);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 md:flex-row gap-0">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="flex-shrink-0 bg-[var(--bg)] border-b border-[var(--border)] px-5 py-3 flex justify-between items-center">
          <h1 className="text-[20px] font-semibold text-[var(--text)]">Today</h1>
          <button
            type="button"
            onClick={handleGenerateBriefing}
            className="text-[13px] font-500 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            Refresh
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 md:p-6">
          <div className="max-w-2xl mx-auto w-full">
            {loading ? (
              <div className="space-y-4">
                <div className="h-32 rounded-2xl bg-[var(--surface)] border border-[var(--border)] animate-pulse" />
                <div className="h-24 rounded-2xl bg-[var(--surface)] border border-[var(--border)] animate-pulse" />
              </div>
            ) : cards.length > 0 ? (
              <FeedTimeline cards={cards} />
            ) : (
              <div className="py-16 text-center">
                <p className="text-[var(--text-muted)] text-[15px]">Nothing for today yet.</p>
                <button
                  type="button"
                  onClick={handleGenerateBriefing}
                  className="mt-3 text-[var(--text)] text-[15px] font-500 hover:underline"
                >
                  Generate briefing
                </button>
              </div>
            )}
            <div className="h-16" />
          </div>
        </div>
      </div>
      <aside className="hidden md:flex w-[280px] flex-shrink-0 border-l border-[var(--border)]">
        <WhoopPanel />
      </aside>
    </div>
  );
}
