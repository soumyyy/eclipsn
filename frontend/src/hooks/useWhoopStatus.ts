
import { useState, useEffect, useCallback } from 'react';
import { get, del } from '@/lib/apiClient';

interface WhoopStatus {
    connected: boolean;
    expiresAt?: string;
}

export function useWhoopStatus() {
    const [status, setStatus] = useState<WhoopStatus | null>(null);
    const [loading, setLoading] = useState(true);

    const checkStatus = useCallback(async () => {
        try {
            const data = await get('whoop/status');
            setStatus(data);
        } catch (err) {
            console.error('Failed to check Whoop status', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        checkStatus();
    }, [checkStatus]);

    const disconnect = async () => {
        try {
            setLoading(true);
            await del('whoop/disconnect');
            await checkStatus();
        } catch (err) {
            console.error('Failed to disconnect Whoop', err);
        } finally {
            setLoading(false);
        }
    };

    return {
        status,
        loading,
        refresh: checkStatus,
        disconnect
    };
}
