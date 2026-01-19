'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { gatewayFetch } from '@/lib/gatewayFetch';
import { getAbsoluteApiUrl } from '@/lib/api';

type GmailStatusPayload = {
  connected: boolean;
  email?: string;
  avatarUrl?: string;
  name?: string;
  initialSyncStartedAt?: string | null;
  initialSyncCompletedAt?: string | null;
  initialSyncTotalThreads?: number | null;
  initialSyncSyncedThreads?: number | null;
  onboarded?: boolean;
};

type GmailStatusContextValue = {
  status: GmailStatusPayload;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const DEFAULT_STATUS: GmailStatusPayload = {
  connected: false,
  onboarded: false,
  initialSyncStartedAt: null,
  initialSyncCompletedAt: null,
  initialSyncTotalThreads: null,
  initialSyncSyncedThreads: null
};

const GmailStatusContext = createContext<GmailStatusContextValue | undefined>(undefined);

function normalizeStatus(payload: unknown): GmailStatusPayload {
  if (!payload || typeof payload !== 'object') {
    return DEFAULT_STATUS;
  }
  const record = payload as Record<string, unknown>;
  return {
    connected: Boolean(record.connected),
    email: typeof record.email === 'string' ? record.email : undefined,
    avatarUrl: typeof record.avatarUrl === 'string' ? record.avatarUrl : undefined,
    name: typeof record.name === 'string' ? record.name : undefined,
    initialSyncStartedAt:
      typeof record.initialSyncStartedAt === 'string' ? (record.initialSyncStartedAt as string) : null,
    initialSyncCompletedAt:
      typeof record.initialSyncCompletedAt === 'string' ? (record.initialSyncCompletedAt as string) : null,
    initialSyncTotalThreads:
      typeof record.initialSyncTotalThreads === 'number'
        ? (record.initialSyncTotalThreads as number)
        : record.initialSyncTotalThreads === null
          ? null
          : undefined,
    initialSyncSyncedThreads:
      typeof record.initialSyncSyncedThreads === 'number'
        ? (record.initialSyncSyncedThreads as number)
        : record.initialSyncSyncedThreads === null
          ? null
          : undefined,
    onboarded: Boolean(record.onboarded)
  };
}

export function GmailStatusProvider({
  children,
  isAuthenticated
}: {
  children: ReactNode;
  isAuthenticated: boolean;
}) {
  const [status, setStatus] = useState<GmailStatusPayload>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const visibilityRef = useRef(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const fetchStatus = useCallback(async () => {
    if (!isAuthenticated) {
      clearPoll();
      setStatus(DEFAULT_STATUS);
      setLoading(false);
      setError(null);
      return;
    }
    try {
      const response = await gatewayFetch('gmail/status');
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }
      const payload = await response.json();
      setStatus(normalizeStatus(payload));
      setError(null);
    } catch (err) {
      console.error('Failed to fetch Gmail status', err);
      setError('Failed to load Gmail status');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  const clearStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectStream = useCallback(() => {
    if (!isAuthenticated || typeof window === 'undefined') {
      clearStream();
      return;
    }
    if (eventSourceRef.current) {
      return;
    }
    const streamUrl = getAbsoluteApiUrl('gmail/status/stream');
    try {
      const source = new EventSource(streamUrl, { withCredentials: true } as EventSourceInit);
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const patch = normalizeStatus(payload);
          setStatus((prev) => ({
            ...prev,
            ...patch,
            email: patch.email ?? prev.email,
            avatarUrl: patch.avatarUrl ?? prev.avatarUrl,
            name: patch.name ?? prev.name
          }));
          setError(null);
        } catch (parseError) {
          console.error('Failed to parse Gmail status stream payload', parseError);
        }
      };
      source.onerror = () => {
        source.close();
        eventSourceRef.current = null;
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connectStream();
          }, 5000);
        }
      };
      eventSourceRef.current = source;
    } catch (error) {
      console.error('Failed to connect to Gmail status stream', error);
    }
  }, [clearStream, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchStatus();
      connectStream();
    } else {
      clearPoll();
      setStatus(DEFAULT_STATUS);
      setLoading(false);
      clearStream();
    }
    return () => {
      clearStream();
    };
  }, [clearStream, connectStream, fetchStatus, isAuthenticated]);

  useEffect(() => {
    const shouldPoll =
      isAuthenticated &&
      visibilityRef.current &&
      status.connected &&
      (!status.onboarded ||
        (status.initialSyncStartedAt && !status.initialSyncCompletedAt));
    if (!shouldPoll) {
      clearPoll();
      return;
    }
    clearPoll();
    pollRef.current = setInterval(fetchStatus, 10000);
    return () => {
      clearPoll();
    };
  }, [fetchStatus, isAuthenticated, status]);

  useEffect(() => {
    function handleVisibility() {
      visibilityRef.current = document.visibilityState === 'visible';
      if (visibilityRef.current) {
        fetchStatus();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchStatus]);

  const value = useMemo<GmailStatusContextValue>(
    () => ({
      status,
      loading,
      error,
      refresh: fetchStatus
    }),
    [error, fetchStatus, loading, status]
  );

  return <GmailStatusContext.Provider value={value}>{children}</GmailStatusContext.Provider>;
}

export function useGmailStatus() {
  const context = useContext(GmailStatusContext);
  if (!context) {
    throw new Error('useGmailStatus must be used within a GmailStatusProvider');
  }
  const { status, loading, error, refresh } = context;
  const syncPercent = useMemo(() => {
    const total = status.initialSyncTotalThreads;
    const synced = status.initialSyncSyncedThreads;
    if (typeof total === 'number' && total > 0 && typeof synced === 'number') {
      const safeSynced = Math.min(synced, total);
      return Math.min(100, Math.round((safeSynced / total) * 100));
    }
    return null;
  }, [status.initialSyncSyncedThreads, status.initialSyncTotalThreads]);
  const syncLabel = useMemo(() => {
    if (
      typeof status.initialSyncSyncedThreads === 'number' &&
      typeof status.initialSyncTotalThreads === 'number' &&
      status.initialSyncTotalThreads > 0
    ) {
      return `${Math.min(status.initialSyncSyncedThreads, status.initialSyncTotalThreads).toLocaleString()} / ${status.initialSyncTotalThreads.toLocaleString()} threads`;
    }
    if (typeof status.initialSyncSyncedThreads === 'number') {
      return `${status.initialSyncSyncedThreads.toLocaleString()} threads synced`;
    }
    return 'Syncing Gmail…';
  }, [status.initialSyncSyncedThreads, status.initialSyncTotalThreads]);
  const shouldShowSetupBanner =
    status.connected &&
    (!status.onboarded ||
      (status.initialSyncStartedAt && !status.initialSyncCompletedAt));

  return { status, loading, error, refresh, syncPercent, syncLabel, shouldShowSetupBanner };
}
