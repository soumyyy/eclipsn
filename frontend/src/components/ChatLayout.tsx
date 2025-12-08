import { ReactNode } from 'react';

interface ChatLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function ChatLayout({ sidebar, children }: ChatLayoutProps) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-72 border-r border-slate-800 bg-slate-900 p-4">{sidebar}</aside>
      <main className="flex-1 bg-slate-950">{children}</main>
    </div>
  );
}
