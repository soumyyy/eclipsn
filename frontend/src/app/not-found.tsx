'use client';

type Props = {
  error?: Error;
  reset?: () => void;
};

export default function NotFoundPage({ reset }: Props) {
  return (
    <div className="login-page">
      <div className="login-content" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="login-card" style={{ textAlign: 'center' }}>
          <p className="login-kicker">PLUTO</p>
          <h1>Signal lost</h1>
          <p className="text-muted">We couldn&apos;t find that transmission.</p>
          <button
            type="button"
            className="onboarding-btn primary"
            onClick={reset ? () => reset() : () => (window.location.href = '/')}
          >
            Return home
          </button>
        </div>
      </div>
    </div>
  );
}
