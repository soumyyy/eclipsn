'use client';

import { ServiceAccountsSettings } from '@/components/ServiceAccountsSettings';

export default function ServiceAccountsPage() {
    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <header className="border-b border-green-800 pb-4">
                <h1 className="text-2xl font-bold text-green-300">Service Accounts</h1>
                <p className="text-green-600 mt-1">Manage secondary accounts for schedule ingestion.</p>
            </header>

            <ServiceAccountsSettings />
        </div>
    );
}
