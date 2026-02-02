'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChatLayout } from '@/components/ChatLayout';
import { Sidebar } from '@/components/Sidebar';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isSubPage = pathname !== '/settings' && pathname !== '/settings/';
    return (
        <ChatLayout sidebar={<Sidebar />}>
            <div className="h-full overflow-y-auto bg-black p-8 text-green-400">
                {isSubPage && (
                    <Link
                        href="/settings"
                        className="inline-block text-sm text-green-500 hover:text-green-400 mb-4"
                    >
                        ← Settings
                    </Link>
                )}
                {children}
            </div>
        </ChatLayout>
    );
}
