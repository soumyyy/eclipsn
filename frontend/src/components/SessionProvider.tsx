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
import {
  cacheProfileLocally,
  fetchSessionSnapshot,
  type GmailStatus,
  type SessionSnapshot
} from '@/lib/session';
import { type UserProfile } from '@/lib/profile';

type RefreshOptions = {
  showSpinner?: boolean;
};

type SessionContextValue = {
  session: SessionSnapshot | null;
  loading: boolean;
  refreshSession: (options?: RefreshOptions) => Promise<SessionSnapshot | null>;
  updateProfile: (profile: UserProfile | null) => void;
  updateGmailStatus: (status: GmailStatus) => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(
    async (options?: RefreshOptions): Promise<SessionSnapshot | null> => {
      const showSpinner = options?.showSpinner ?? false;
      if (showSpinner) {
        setLoading(true);
      }
      try {
        const snapshot = await fetchSessionSnapshot();
        setSession(snapshot);
        cacheProfileLocally(snapshot.profile);
        return snapshot;
      } catch (error) {
        console.error('Failed to refresh session', error);
        if (showSpinner) {
          setSession(null);
        }
        return null;
      } finally {
        if (showSpinner) {
          setLoading(false);
        }
      }
    },
    []
  );

  const updateProfile = useCallback((profile: UserProfile | null) => {
    setSession((prev) => {
      if (!prev) {
        return {
          gmail: { connected: false },
          profile
        };
      }
      return {
        ...prev,
        profile
      };
    });
    cacheProfileLocally(profile);
  }, []);

  const updateGmailStatus = useCallback((status: GmailStatus) => {
    setSession((prev) => {
      const profile = prev?.profile ?? null;
      return {
        gmail: status,
        profile
      };
    });
  }, []);

  useEffect(() => {
    refreshSession({ showSpinner: true });
  }, [refreshSession]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        refreshSession();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshSession]);

  const value = useMemo(
    () => ({
      session,
      loading,
      refreshSession,
      updateProfile,
      updateGmailStatus
    }),
    [loading, refreshSession, session, updateGmailStatus, updateProfile]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessionContext must be used within a SessionProvider');
  }
  return context;
}
