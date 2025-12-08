import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Pluto',
  description: 'Personal agent for long-term knowledge and Gmail'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-green-300 font-mono">
        {children}
      </body>
    </html>
  );
}
