'use client';

import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../lib/gatewayFetch';

interface SyncToastProps {
    jobId: string;
    onClose: () => void;
}

interface JobState {
    status: string;
    progress: number;
    message: string;
    logs: string[];
}

export function SyncToast({ jobId, onClose }: SyncToastProps) {
    const [job, setJob] = useState<JobState>({
        status: 'pending',
        progress: 0,
        message: 'Initializing...',
        logs: []
    });
    const [expanded, setExpanded] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // We cannot use native EventSource easily with custom headers (Authorization).
        // So we use a fetch loop or a specialized library.
        // However, for this demo, we implemented a custom solution in Gateway:
        // GET /jobs/:id/stream with requireUserId cookie/header.
        // If our auth uses Cookies, native EventSource works.
        // If it uses Headers, we need `event-source-polyfill` or just simple polling.
        // Given `gatewayFetch` logic isn't fully visible but usually implies custom headers,
        // let's use a robust Polling fallback or a simple `fetch` reader if possible.
        // But wait, the backend sends text/event-stream.

        // Let's try native EventSource first. If cookies are set, it works.
        const url = `http://localhost:3001/api/service-accounts/jobs/${jobId}/stream`;

        // NOTE: If your API requires Authorization header, native EventSource WILL FAIL.
        // In that case, we should use a fetch stream reader.

        const es = new EventSource(url, { withCredentials: true });

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                setJob(prev => ({
                    status: data.status,
                    progress: data.progress,
                    message: data.message,
                    logs: data.logs || []
                }));

                if (data.status === 'completed' || data.status === 'failed') {
                    es.close();
                }
            } catch (e) {
                console.error('SSE Parse Error', e);
            }
        };

        es.onerror = (e) => {
            console.error('SSE Error', e);
            es.close();
            // Optional: fallback to polling if SSE fails
        };

        return () => {
            es.close();
        };
    }, [jobId]);

    // Auto-scroll logs
    useEffect(() => {
        if (expanded && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [job.logs, expanded]);

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end">
            {/* Expanded Drawer */}
            {expanded && (
                <div className="mb-2 w-96 bg-black border border-green-800 rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in">
                    <div className="p-3 border-b border-green-900 bg-green-950/50 flex justify-between items-center">
                        <span className="text-xs font-bold text-green-300 uppercase tracking-wider">Sync Logs</span>
                        <button onClick={() => setExpanded(false)} className="text-green-600 hover:text-green-400">
                            ▼
                        </button>
                    </div>
                    <div className="h-64 overflow-y-auto p-3 bg-black/90 font-mono text-xs space-y-1">
                        {job.logs.length === 0 && <span className="text-green-900 italic">Waiting for logs...</span>}
                        {job.logs.map((log, i) => (
                            <div key={i} className="text-green-500 border-l-2 border-green-900 pl-2">
                                {log}
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>
                </div>
            )}

            {/* Main Toast */}
            <div className="w-96 bg-green-950 text-green-100 rounded shadow-lg border border-green-700 flex flex-col overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                    {job.status === 'processing' || job.status === 'pending' ? (
                        <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                    ) : job.status === 'completed' ? (
                        <div className="text-green-400 text-lg">✓</div>
                    ) : (
                        <div className="text-red-400 text-lg">✕</div>
                    )}

                    <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-sm truncate">
                            {job.status === 'completed' ? 'Sync Complete' : job.status === 'failed' ? 'Sync Failed' : 'Syncing...'}
                        </h4>
                        <div className="text-xs text-green-400/80 truncate">{job.message}</div>
                    </div>

                    <div className="flex items-center gap-2">
                        {!expanded && (
                            <button onClick={() => setExpanded(true)} className="text-xs text-green-300 hover:text-white underline">
                                Details
                            </button>
                        )}
                        {(job.status === 'completed' || job.status === 'failed') && (
                            <button onClick={onClose} className="text-green-500 hover:text-white px-2">
                                ✕
                            </button>
                        )}
                    </div>
                </div>

                {/* Progress Line */}
                {(job.status === 'processing' || job.status === 'pending') && (
                    <div className="h-1 bg-green-900 w-full">
                        <div
                            className="h-full bg-green-400 transition-all duration-500 ease-out"
                            style={{ width: `${job.progress}%` }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
