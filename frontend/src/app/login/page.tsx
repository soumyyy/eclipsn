'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, Suspense } from 'react';
import { GoogleSignInButton } from '@/components/login/GoogleSignInButton';
import { OnboardingPrompt, type OnboardingQuestion } from '@/components/login/OnboardingPrompt';
import { VideoBackground } from '@/components/login/VideoBackground';
import { useSessionContext } from '@/components/SessionProvider';
import { useGmailStatus } from '@/hooks/useGmailStatus';
import { hasActiveSession } from '@/lib/session';
import { gatewayFetch } from '@/lib/gatewayFetch';
import { getAbsoluteApiUrl } from '@/lib/api';

const QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'fullName',
    label: 'What should Eclipsn call you?',
    placeholder: 'Full name/callsign'
  },
  {
    id: 'personalNote',
    label: 'Anything specific you’d like Eclipsn to remember?',
    placeholder: 'Optional, but something to start with...'
  }
];

type Stage = 'signin' | 'onboarding' | 'success';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading: sessionLoading, refreshSession } = useSessionContext();
  const { status: gmailStatus } = useGmailStatus();

  const [stage, setStage] = useState<Stage>(() => {
    const stageParam = searchParams.get('stage');
    return stageParam === 'onboarding' ? 'onboarding' : 'signin';
  });

  const [authLoading, setAuthLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
    const error = searchParams.get('error');
    return error ? `Authentication failed: ${error}` : null;
  });

  useEffect(() => {
    if (sessionLoading) return;
    if (session && hasActiveSession(session)) {
      router.replace('/');
      return;
    }
    if (gmailStatus.connected && !session?.profile) {
      setStage((prev) => (prev === 'signin' ? 'onboarding' : prev));
    }
  }, [router, session, sessionLoading, gmailStatus.connected]);


  const handleGoogleSignIn = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Simple linear flow: redirect current window to OAuth
    setAuthLoading(true);
    window.location.href = `${getAbsoluteApiUrl('gmail/connect')}?state=Eclipsn`;
  }, []);

  const handleResponseChange = useCallback((id: string, value: string) => {
    setResponses((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, QUESTIONS.length - 1));
  }, []);

  const handleBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleFinish = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    try {
      const payload: Record<string, unknown> = {};
      if (responses.fullName) {
        payload.fullName = responses.fullName;
        payload.preferredName = responses.fullName;
      }
      if (responses.personalNote) {
        payload.customData = {
          notes: [
            {
              text: responses.personalNote,
              timestamp: new Date().toISOString()
            }
          ]
        };
      }
      if (Object.keys(payload).length > 0) {
        await gatewayFetch('profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => undefined);
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('EclipsnOnboarded', 'true');
        if (responses.fullName) {
          localStorage.setItem('EclipsnProfileName', responses.fullName);
        }
      }
      await refreshSession();
      setStage('success');
    } finally {
      setCompleting(false);
    }
  }, [completing, refreshSession, responses]);

  const handleEnterApp = useCallback(() => {
    router.push('/');
  }, [router]);

  if (!sessionLoading && session && hasActiveSession(session)) {
    return (
      <div className="login-page">
        <VideoBackground />
        <div className="login-content">
          <div className="login-card">
            <p className="login-footnote">Redirecting to your console…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <VideoBackground />
      <div className="login-content">
        <div className="login-card">
          {stage === 'signin' && (
            <>
              <p className="login-kicker">ECLIPSN</p>
              <h1>Connect with your orbit.</h1>
              {errorMessage && (
                <p style={{ color: '#ff6b6b', marginBottom: '1rem' }}>
                  {errorMessage}
                </p>
              )}
              <GoogleSignInButton onClick={handleGoogleSignIn} loading={authLoading} />
              <p className="login-footnote">Privacy-first</p>
            </>
          )}
          {stage === 'onboarding' && (
            <OnboardingPrompt
              questions={QUESTIONS}
              currentStep={currentStep}
              responses={responses}
              onResponseChange={handleResponseChange}
              onBack={handleBack}
              onNext={handleNext}
              onFinish={handleFinish}
            />
          )}
          {stage === 'success' && (
            <div className="onboarding-card success">
              <h2>Launch window secured.</h2>
              <p className="text-muted">
                Eclipsn synced your profile. You&apos;re ready to ingest bespoke memories and Gmail threads.
              </p>
              <button type="button" className="onboarding-btn primary" onClick={handleEnterApp} disabled={completing}>
                Enter Eclipsn
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="login-page"><div className="login-content"><p>Loading...</p></div></div>}>
      <LoginContent />
    </Suspense>
  );
}
