'use client';

import { useState, useEffect, useCallback } from 'react';
import { get } from '@/lib/apiClient';

export interface WhoopDataNormalized {
    title: string;
    content: string;
    metadata: {
        score: number;
        sleep: number;
        hrv: number;
        state: number;
        cycle?: Record<string, unknown>;
        sleep_data?: Record<string, unknown>;
        workout?: Record<string, unknown>;
        profile?: Record<string, unknown>;
        measurements?: unknown;
    };
}

export function useWhoopData(enabled: boolean = true) {
    const [data, setData] = useState<WhoopDataNormalized | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchWhoopData = useCallback(async () => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            setError(null);
            const [recoveryRes, sleepRes, cyclesRes, workoutRes, profileRes, measurementsRes] = await Promise.allSettled([
                get('whoop/recovery'),
                get('whoop/sleep'),
                get('whoop/cycles'),
                get('whoop/workout'),
                get('whoop/profile'),
                get('whoop/measurements')
            ]);

            const recovery = recoveryRes.status === 'fulfilled' ? recoveryRes.value : null;
            const sleep = sleepRes.status === 'fulfilled' ? sleepRes.value : null;
            const cycle = cyclesRes.status === 'fulfilled' ? cyclesRes.value : null;
            const workout = workoutRes.status === 'fulfilled' ? workoutRes.value : null;
            const profile = profileRes.status === 'fulfilled' ? profileRes.value : null;
            const measurements = measurementsRes.status === 'fulfilled' ? measurementsRes.value : null;

            const recoveryScore = recovery?.recovery?.score ?? recovery?.recovery ?? null;
            const scoreObj = recoveryScore && typeof recoveryScore === 'object' ? recoveryScore as Record<string, unknown> : null;

            const cycleRecord = cycle?.cycle ?? cycle?.cycles?.[0] ?? null;
            const sleepRecord = sleep?.sleep ?? (Array.isArray(sleep?.sleep) ? sleep.sleep[0] : null) ?? null;
            const workoutRecord = workout?.workout ?? workout?.workouts?.[0] ?? null;

            const combined: WhoopDataNormalized = {
                title: 'Whoop Metrics',
                content: 'Your health dashboard',
                metadata: {
                    score: Number(scoreObj?.recovery_score ?? 0),
                    sleep: Number(scoreObj?.sleep_performance_percentage ?? 0),
                    hrv: Number(scoreObj?.hrv_rmssd_milli ?? scoreObj?.hrv ?? 0),
                    state: Number(scoreObj?.recovery_score_state_id ?? scoreObj?.state ?? 0),
                    cycle: cycleRecord && typeof cycleRecord === 'object' ? (cycleRecord as Record<string, unknown>) : undefined,
                    sleep_data: sleepRecord && typeof sleepRecord === 'object' ? (sleepRecord as Record<string, unknown>) : undefined,
                    workout: workoutRecord && typeof workoutRecord === 'object' ? (workoutRecord as Record<string, unknown>) : undefined,
                    profile: profile && typeof profile === 'object' ? (profile as Record<string, unknown>) : undefined,
                    measurements: measurements ?? undefined
                }
            };

            setData(combined);
        } catch (err) {
            console.error('Failed to fetch Whoop data', err);
            setError(err instanceof Error ? err.message : 'Failed to fetch Whoop data');
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [enabled]);

    useEffect(() => {
        fetchWhoopData();
        if (!enabled) return;
        const interval = setInterval(fetchWhoopData, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchWhoopData, enabled]);

    return {
        data,
        loading,
        error,
        refresh: fetchWhoopData
    };
}
