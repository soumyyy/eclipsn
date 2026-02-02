'use client';

import { useState } from 'react';

type Tab = 'chat' | 'graph' | 'memory';

export function ContextPanel() {
    const [activeTab, setActiveTab] = useState<Tab>('chat');

    return (
        <div className="flex flex-col h-full bg-background border-l border-primary/20">
            {/* Tabs */}
            <div className="flex border-b border-primary/20">
                {(['chat', 'memory'] as Tab[]).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === tab
                            ? 'text-primary border-b-2 border-primary bg-primary/10'
                            : 'text-primary/60 hover:text-primary'
                            }`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4">
                {activeTab === 'chat' && (
                    <div className="text-center text-primary/60 mt-20 text-sm">
                        Chat context unavailable.
                    </div>
                )}
                {/* Visual Graph disabled per user request
                {activeTab === 'graph' && (
                    <div className="text-center text-green-700 mt-20 text-sm">
                        Knowledge Graph Visualization
                    </div>
                )} 
                */}
            </div>
        </div>
    );
}
