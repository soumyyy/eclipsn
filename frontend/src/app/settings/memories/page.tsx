'use client';

import { useEffect, useState } from 'react';
import { get, del } from '@/lib/apiClient';

interface UserMemory {
    id: string;
    content: string;
    source_type?: string;
    source_id?: string | null;
    scope?: string | null;
    confidence?: number | null;
}

export default function MemoriesPage() {
    const [memories, setMemories] = useState<UserMemory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [forgettingId, setForgettingId] = useState<string | null>(null);

    async function loadMemories() {
        try {
            setError(null);
            const params = new URLSearchParams({ limit: '50', offset: '0' });
            if (search.trim()) params.set('q', search.trim());
            const data = await get(`memories?${params.toString()}`);
            setMemories(Array.isArray(data.memories) ? data.memories : []);
        } catch (e) {
            console.error(e);
            setError('Failed to load memories.');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadMemories();
    }, []);

    useEffect(() => {
        const onMemoriesSaved = () => loadMemories();
        window.addEventListener('memories-saved', onMemoriesSaved);
        return () => window.removeEventListener('memories-saved', onMemoriesSaved);
    }, []);

    useEffect(() => {
        const onFocus = () => loadMemories();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, []);

    async function handleForget(id: string) {
        if (!confirm('Remove this memory? It will no longer be used for recall.')) return;
        try {
            setForgettingId(id);
            await del(`memories/${id}`);
            setMemories(prev => prev.filter(m => m.id !== id));
        } catch (e) {
            console.error(e);
            alert('Failed to remove memory.');
        } finally {
            setForgettingId(null);
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <header className="border-b border-green-800 pb-4">
                <h1 className="text-2xl font-bold text-green-300">Saved Memories</h1>
                <p className="text-green-600 mt-1">
                    Saved facts and extracted context used for recall. Remove any you no longer want.
                </p>
            </header>

            <div className="flex flex-col sm:flex-row gap-3">
                <input
                    type="search"
                    placeholder="Search memories..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadMemories()}
                    className="flex-1 px-3 py-2 rounded-lg border border-green-800 bg-black/40 text-green-200 placeholder-green-700 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
                <button
                    type="button"
                    onClick={loadMemories}
                    className="px-4 py-2 rounded-lg border border-green-700 bg-green-900/30 text-green-300 hover:bg-green-800/40 focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                    Search
                </button>
            </div>

            {error && (
                <div className="p-4 rounded-xl border border-red-900/50 bg-red-950/20 text-red-300 text-sm flex items-center gap-2">
                    <span>⚠</span> {error}
                </div>
            )}

            {loading ? (
                <div className="space-y-4 animate-pulse p-4">
                    {[1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="h-24 bg-green-950/20 border border-green-800/50 rounded-xl"
                        />
                    ))}
                </div>
            ) : memories.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 border border-dashed border-green-800 rounded-xl bg-green-950/10 text-center">
                    <h3 className="text-green-300 font-semibold mb-2">No memories yet</h3>
                    <p className="text-green-600 text-sm max-w-xs leading-relaxed">
                        Memories are added when you say “remember this” in chat or when we extract them from Gmail and documents. Try searching with a different query.
                    </p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {memories.map((m) => (
                        <li
                            key={m.id}
                            className="p-4 border border-green-800/60 bg-green-950/20 rounded-xl flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                        >
                            <div className="min-w-0 flex-1">
                                <p className="text-green-200 text-sm leading-relaxed whitespace-pre-wrap break-words">
                                    {m.content}
                                </p>
                                {(m.source_type || m.scope) && (
                                    <p className="mt-1.5 text-green-600 text-xs">
                                        {[m.source_type, m.scope].filter(Boolean).join(' · ')}
                                    </p>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => handleForget(m.id)}
                                disabled={forgettingId === m.id}
                                className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-green-700/60 text-green-400 hover:bg-green-900/40 hover:text-green-300 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-green-500"
                            >
                                {forgettingId === m.id ? 'Removing…' : 'Forget'}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
