'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSessionContext } from '@/components/SessionProvider';
import { hasActiveSession } from '@/lib/session';

export function useSessionGuard(): boolean {
  const router = useRouter();
  const { session, loading } = useSessionContext();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (session && hasActiveSession(session)) {
      setAuthorized(true);
      return;
    }
    setAuthorized(false);
    router.replace('/login');
  }, [loading, router, session]);

  return authorized;
}
