'use client';

import Link from 'next/link';

export default function SettingsPage() {
    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <header>
                <h1 className="text-2xl font-bold text-green-300">Settings</h1>
                <p className="text-green-600 mt-1">Manage memories, accounts, and connections.</p>
            </header>

            <div className="grid gap-4 sm:grid-cols-1">
                <Link
                    href="/settings/memories"
                    className="block p-5 rounded-xl border border-green-800/60 bg-green-950/20 hover:bg-green-900/30 hover:border-green-700/60 transition-colors"
                >
                    <h2 className="text-lg font-semibold text-green-300">Saved Memories</h2>
                    <p className="text-green-600 text-sm mt-1">
                        View and remove what Eclipsn has learned from chat, Gmail, and your Index.
                    </p>
                </Link>
                <Link
                    href="/settings/service-accounts"
                    className="block p-5 rounded-xl border border-green-800/60 bg-green-950/20 hover:bg-green-900/30 hover:border-green-700/60 transition-colors"
                >
                    <h2 className="text-lg font-semibold text-green-300">Service accounts</h2>
                    <p className="text-green-600 text-sm mt-1">
                        Connect secondary Gmail accounts for calendars and document ingestion.
                    </p>
                </Link>
            </div>
        </div>
    );
}
