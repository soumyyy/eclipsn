'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleSignInButton } from '@/components/login/GoogleSignInButton';
import { OnboardingPrompt, type OnboardingQuestion } from '@/components/login/OnboardingPrompt';
import { VideoBackground } from '@/components/login/VideoBackground';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:4000';

const QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'fullName',
    label: 'What should Pluto call you?',
    placeholder: 'Full name or callsign',
    helperText: 'Optional — we use this to personalize responses.'
  },
  {
    id: 'personalNote',
    label: 'Anything specific you’d like Pluto to remember?',
    placeholder: 'e.g. Favorite tone, dietary note, VIP clients',
    helperText: 'Optional, but helps Pluto stay in character for you.'
  }
];

type Stage = 'signin' | 'onboarding' | 'success';

export default function LoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('signin');
  const [authLoading, setAuthLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkExistingSession() {
      if (typeof window === 'undefined') return;
      const hasLocalProfile = localStorage.getItem('plutoOnboarded') === 'true';
      try {
        const [gmailResponse, profileResponse] = await Promise.all([
          fetch(`${GATEWAY_URL}/api/gmail/status`),
          fetch(`${GATEWAY_URL}/api/profile`)
        ]);
        const gmailData = gmailResponse.ok ? await gmailResponse.json() : { connected: false };
        const profileData = profileResponse.ok ? await profileResponse.json() : { profile: null };
        if (gmailData.connected && profileData.profile && !cancelled) {
          localStorage.setItem('plutoProfileName', profileData.profile.fullName ?? '');
          localStorage.setItem('plutoProfileNote', profileData.profile.customData?.personalNote ?? '');
          localStorage.setItem('plutoOnboarded', 'true');
          router.replace('/');
          return;
        }
        if (hasLocalProfile && gmailData.connected && !cancelled) {
          router.replace('/');
        }
      } catch {
        if (hasLocalProfile && !cancelled) {
          router.replace('/');
        }
      }
    }
    checkExistingSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    };
  }, []);

  const handleGoogleSignIn = useCallback(() => {
    if (typeof window === 'undefined') return;
    setAuthLoading(true);
    try {
      popupRef.current = window.open(
        `${GATEWAY_URL}/api/gmail/connect?state=pluto`,
        'gmailOAuth',
        'width=520,height=640'
      );
    } catch (error) {
      console.error('Failed to open Gmail auth window', error);
      setAuthLoading(false);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${GATEWAY_URL}/api/gmail/status`);
        if (!response.ok) return;
        const data = await response.json();
        if (data.connected) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
          }
          setStage('onboarding');
          setAuthLoading(false);
        }
      } catch {
        // swallow
      }
    }, 2500);
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
        await fetch(`${GATEWAY_URL}/api/profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => undefined);
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('plutoOnboarded', 'true');
        if (responses.fullName) {
          localStorage.setItem('plutoProfileName', responses.fullName);
        }
      }
      setStage('success');
    } finally {
      setCompleting(false);
    }
  }, [completing, responses]);

  const handleEnterApp = useCallback(() => {
    router.push('/');
  }, [router]);

  return (
    <div className="login-page">
      <VideoBackground />
      <div className="login-content">
        <div className="login-card">
          {stage === 'signin' && (
            <>
              <p className="login-kicker">PLUTO · OPS CONSOLE</p>
              <h1>Reconnect with your orbit.</h1>
              <p className="text-muted">
                Authorize Gmail once, and we&apos;ll keep your bespoke memory bank and inbox intelligence flowing.
              </p>
              <GoogleSignInButton onClick={handleGoogleSignIn} loading={authLoading} />
              <p className="login-footnote">We never send without your direction. One-click disconnect anytime.</p>
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
                Pluto synced your profile. You&apos;re ready to ingest bespoke memories, Gmail threads, and Outlook signals.
              </p>
              <button type="button" className="onboarding-btn primary" onClick={handleEnterApp} disabled={completing}>
                Enter Operator Console
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
