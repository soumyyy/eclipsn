'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchSessionSnapshot } from '@/lib/session';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      const success = searchParams.get('success');

      if (success === 'true') {
        try {
          // Wait a moment for cookies to be set, then fetch session
          await new Promise(resolve => setTimeout(resolve, 1000));

          const session = await fetchSessionSnapshot();

          if (session.gmail.connected) {
            if (session.profile) {
              // User has profile, redirect to main app
              router.replace('/');
            } else {
              // User needs onboarding
              router.replace('/login?stage=onboarding');
            }
          } else {
            // Something went wrong, redirect to login
            router.replace('/login');
          }
        } catch (error) {
          console.error('Auth callback error:', error);
          router.replace('/login');
        }
      } else {
        // Error case
        router.replace('/login');
      }
    };

    handleCallback();
  }, [router, searchParams]);

  return (
    <div className="auth-callback">
      <div className="auth-callback-content">
        <h2>Completing authentication...</h2>
        <p>Please wait while we set up your account.</p>
      </div>
    </div>
  );
}