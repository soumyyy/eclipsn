import './globals.css';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/SessionProvider';
import { FeedProvider } from '@/contexts/FeedContext';

export const metadata = {
  title: 'Eclipsn',
  description: 'Personal agent for long-term knowledge and Gmail',
  icons: {
    icon: '/eclipsn.png'
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--bg)] text-[var(--text)] antialiased">
        <SessionProvider>
          <FeedProvider>{children}</FeedProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
