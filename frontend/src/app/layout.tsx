import './globals.css';
import type { ReactNode } from 'react';
import { Source_Sans_3 } from 'next/font/google';
import { SessionProvider } from '@/components/SessionProvider';
import { FeedProvider } from '@/contexts/FeedContext';

const sourceSans = Source_Sans_3({ subsets: ['latin'] });

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
      <body className={`min-h-screen bg-black text-green-300 ${sourceSans.className}`}>
        <SessionProvider>
          <FeedProvider>{children}</FeedProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
