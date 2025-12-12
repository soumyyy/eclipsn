'use client';

interface GoogleSignInButtonProps {
  onClick: () => void;
  loading?: boolean;
}

export function GoogleSignInButton({ onClick, loading }: GoogleSignInButtonProps) {
  return (
    <button className="google-signin-btn" onClick={onClick} disabled={loading}>
      <span className="google-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 48 48" fill="none">
          <path
            d="M43.6 20H42V20H24V28H35.4C33.8 32.8 29.3 36 24 36C16.8 36 11 30.2 11 23C11 15.8 16.8 10 24 10C27.4 10 30.5 11.3 32.8 13.4L38.5 7.7C34.6 3.9 29.6 1.5 24 1.5C12.4 1.5 3 10.9 3 22.5C3 34.1 12.4 43.5 24 43.5C35.6 43.5 45 34.1 45 22.5C45 21.3 44.9 20.6 44.8 19.8L43.6 20Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span>{loading ? 'Connecting…' : 'Sign in with Google'}</span>
    </button>
  );
}
