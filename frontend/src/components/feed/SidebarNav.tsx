'use client';

import { useState } from 'react';
import { useGmailStatus } from '@/hooks/useGmailStatus';
import { useWhoopStatus } from '@/hooks/useWhoopStatus';
import { useSessionContext } from '@/components/SessionProvider';
import { gatewayFetch } from '@/lib/gatewayFetch';
import { getAbsoluteApiUrl } from '@/lib/api';
import { ModalPortal } from '../ModalPortal';
import { ProfileModal } from '../ProfileModal';
// import { BespokeMemoryModal } from '../BespokeMemoryModal'; // If needed

export function SidebarNav() {
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    // const [isBespokeOpen, setIsBespokeOpen] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);

    const { status: gmailStatus, refresh: refreshGmailStatus } = useGmailStatus();
    const { status: whoopStatus } = useWhoopStatus();
    const { refreshSession } = useSessionContext();

    const connectUrl = getAbsoluteApiUrl('gmail/connect');

    async function handleGmailAction() {
        if (gmailStatus.connected) {
            if (disconnecting) return;
            setDisconnecting(true);
            try {
                const response = await gatewayFetch('gmail/disconnect', { method: 'POST' });
                if (!response.ok) throw new Error('Failed to disconnect Gmail');
                await gatewayFetch('profile/logout', { method: 'POST' }).catch(() => undefined);
                if (typeof window !== 'undefined') {
                    localStorage.removeItem('EclipsnOnboarded');
                    localStorage.removeItem('EclipsnProfileName');
                    localStorage.removeItem('EclipsnProfileNote');
                    window.location.href = '/login';
                }
                await refreshGmailStatus();
            } catch (error) {
                console.error('Failed to disconnect Gmail', error);
            } finally {
                setDisconnecting(false);
            }
        } else {
            window.location.href = connectUrl;
        }
    }

    return (
        <>
            <div className="flex flex-col h-full p-4 space-y-6">
                <div className="text-xs font-bold text-green-500 uppercase tracking-widest opacity-60">
                    Navigation
                </div>

                <nav className="flex flex-col space-y-2">
                    {['Home', 'Focus', 'Memories', 'Graph'].map(item => (
                        <button key={item} className="text-left py-2 px-3 rounded hover:bg-green-900/20 text-green-300 hover:text-green-100 transition-colors text-sm font-medium">
                            {item}
                        </button>
                    ))}
                </nav>

                <div className="mt-8">
                    <div className="flex justify-between items-center mb-4">
                        <div className="text-xs font-bold text-green-500 uppercase tracking-widest opacity-60">
                            Status
                        </div>
                        <button
                            onClick={() => setIsProfileOpen(true)}
                            className="text-[10px] uppercase font-bold text-green-600 hover:text-green-400 border border-green-900/40 px-2 py-0.5 rounded hover:bg-green-900/20 transition-all"
                        >
                            Manage
                        </button>
                    </div>

                    <div className="p-3 bg-green-900/10 rounded border border-green-900/30 text-xs space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-green-600">Gmail</span>
                            <span className={`flex items-center gap-1.5 ${gmailStatus.connected ? 'text-green-400' : 'text-green-700/60'}`}>
                                {gmailStatus.connected && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
                                {gmailStatus.connected ? 'Connected' : 'Offline'}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-green-600">Whoop</span>
                            <span className={`flex items-center gap-1.5 ${whoopStatus?.connected ? 'text-green-400' : 'text-green-700/60'}`}>
                                {whoopStatus?.connected && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
                                {whoopStatus?.connected ? '89% Rec' : 'Offline'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {isProfileOpen && (
                <ModalPortal>
                    <ProfileModal
                        onGmailAction={handleGmailAction}
                        onOpenBespoke={() => { }} // Not implemented yet in this view
                        onClose={() => setIsProfileOpen(false)}
                        gmailActionPending={disconnecting}
                        initialTab="connections"
                    />
                </ModalPortal>
            )}
        </>
    );
}
