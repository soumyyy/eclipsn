import { ReactNode } from 'react';
import { SidebarNav } from '@/components/feed/SidebarNav';
import { WhoopPanel } from '@/components/feed/WhoopPanel';

export default function HomeLayout({ children }: { children: ReactNode }) {
    // Mobile-Responsive 3-Column Layout
    // - SidebarNav (Left): Hidden on mobile, 20% on desktop
    // - FeedStream (Center): Full width on mobile, 60% on desktop
    // - ContextPanel (Right): Hidden on mobile, 20% on desktop

    return (
        <div className="flex h-screen overflow-hidden bg-background text-primary">

            {/* Left Sidebar - Navigation */}
            <aside className="hidden md:flex w-[20%] border-r border-primary/20 flex-col bg-panel">
                <SidebarNav />
            </aside>

            {/* Center - Main Content (Feed) */}
            <main className="flex-1 flex flex-col md:w-[60%] relative z-10 bg-background shadow-2xl shadow-black">
                {children}
            </main>

            {/* Right Sidebar - Health Dashboard */}
            <aside className="hidden md:flex w-[20%] border-l border-primary/20 flex-col bg-panel">
                <WhoopPanel />
            </aside>

        </div>
    );
}
