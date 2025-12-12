'use client';

interface VideoBackgroundProps {
  videoSrc?: string;
  poster?: string;
}

export function VideoBackground({
  videoSrc = '/EclipsnBg.mp4',
  poster = 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80'
}: VideoBackgroundProps) {
  return (
    <div className="login-video-wrapper">
      <video
        className="login-video"
        autoPlay
        muted
        loop
        playsInline
        poster={poster}
        preload="metadata"
      >
        <source src={videoSrc} type="video/mp4" />
      </video>
      <div className="login-video-overlay" />
      <div className="login-video-gradient" />
    </div>
  );
}
