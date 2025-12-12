import './globals.css';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/components/SessionProvider';

export const metadata = {
  title: 'Pluto',
  description: 'Personal agent for long-term knowledge and Gmail',
  icons: {
    icon: '/plutologo.png'
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-green-300 font-mono">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
