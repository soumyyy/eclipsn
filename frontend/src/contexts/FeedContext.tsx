'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode
} from 'react';
import { get } from '@/lib/apiClient';
import type { FeedCardProps } from '@/components/feed/FeedCardRegistry';

type FeedContextValue = {
    cards: FeedCardProps[];
    loading: boolean;
    error: string | null;
    loadFeed: () => Promise<void>;
    lastFetched: number | null;
};

const FeedContext = createContext<FeedContextValue | undefined>(undefined);

function normalizeCard(row: Record<string, unknown>): FeedCardProps {
    return {
        id: String(row.id ?? ''),
        type: (row.type as FeedCardProps['type']) ?? 'briefing',
        data: (row.data as FeedCardProps['data']) ?? {},
        priority: Number((row.priority_score ?? row.priority ?? 0)),
        timestamp: row.created_at != null ? String(row.created_at) : undefined
    };
}

export function FeedProvider({ children }: { children: ReactNode }) {
    const [cards, setCards] = useState<FeedCardProps[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastFetched, setLastFetched] = useState<number | null>(null);

    const loadFeed = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await get('feed');
            const raw = Array.isArray(res.feed) ? res.feed : [];
            setCards(raw.map(normalizeCard));
            setLastFetched(Date.now());
        } catch (e) {
            console.error('Failed to load feed', e);
            setError(e instanceof Error ? e.message : 'Failed to load feed');
            setCards([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const value = useMemo(
        () => ({ cards, loading, error, loadFeed, lastFetched }),
        [cards, loading, error, loadFeed, lastFetched]
    );

    return (
        <FeedContext.Provider value={value}>
            {children}
        </FeedContext.Provider>
    );
}

export function useFeed(): FeedContextValue {
    const context = useContext(FeedContext);
    if (!context) {
        throw new Error('useFeed must be used within a FeedProvider');
    }
    return context;
}
