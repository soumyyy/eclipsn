'use client';

import { ChatLayout } from '@/components/ChatLayout';
import { Sidebar } from '@/components/Sidebar';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    return (
        <ChatLayout sidebar={<Sidebar />}>
            <div className="h-full overflow-y-auto bg-black p-8 text-green-400">
                {children}
            </div>
        </ChatLayout>
    );
}
