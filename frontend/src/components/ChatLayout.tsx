import { ReactNode } from 'react';

interface ChatLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
}

export function ChatLayout({ sidebar, children }: ChatLayoutProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">{sidebar}</aside>
      <main className="chat-main">{children}</main>
    </div>
  );
}
