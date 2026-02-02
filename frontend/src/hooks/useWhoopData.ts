'use client';

import { useState, useEffect, useCallback } from 'react';
import { get } from '@/lib/apiClient';

/** Normalized Whoop data per developer.whoop.com: recovery, cycle, sleep, workout, profile, body measurements */
export interface WhoopDataNormalized {
    title: string;
    content: string;
    metadata: {
        /** Recovery score 0–100 */
        score: number;
        /** Sleep performance % (from sleep record when available) */
        sleep: number;
        /** HRV RMSSD in ms (from recovery) */
        hrv: number;
        /** Resting heart rate (from recovery.score.resting_heart_rate) */
        rhr: number | null;
        /** SpO2 % (4.0 members, from recovery) */
        spo2: number | null;
        /** Skin temp °C (4.0 members, from recovery) */
        skinTempCelsius: number | null;
        state: number;
        cycle?: Record<string, unknown>;
        sleep_data?: Record<string, unknown>;
        workout?: Record<string, unknown>;
        profile?: Record<string, unknown>;
        /** Body: height_meter, weight_kilogram, max_heart_rate */
        measurements?: Record<string, unknown>;
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

            // Recovery (v2): score.resting_heart_rate, hrv_rmssd_milli, recovery_score, spo2_percentage, skin_temp_celsius
            const recoveryRecord = recovery?.recovery ?? null;
            const scoreObj = recoveryRecord?.score && typeof recoveryRecord.score === 'object'
                ? (recoveryRecord.score as Record<string, unknown>)
                : null;

            const cycleRecord = cycle?.cycle ?? cycle?.cycles?.[0] ?? null;
            const sleepRecord = sleep?.sleep ?? (Array.isArray(sleep?.sleep) ? sleep.sleep[0] : null) ?? null;
            const workoutRecord = workout?.workout ?? workout?.workouts?.[0] ?? null;

            // Sleep performance % from sleep record (v2: score.sleep_performance_percentage)
            const sleepScoreObj = sleepRecord?.score && typeof sleepRecord.score === 'object'
                ? (sleepRecord.score as Record<string, unknown>)
                : null;
            const sleepPct = sleepScoreObj?.sleep_performance_percentage != null
                ? Number(sleepScoreObj.sleep_performance_percentage)
                : Number(scoreObj?.sleep_performance_percentage ?? 0);

            const combined: WhoopDataNormalized = {
                title: 'Whoop Metrics',
                content: 'Your health dashboard',
                metadata: {
                    score: Number(scoreObj?.recovery_score ?? 0),
                    sleep: sleepPct,
                    hrv: Number(scoreObj?.hrv_rmssd_milli ?? 0),
                    rhr: scoreObj?.resting_heart_rate != null ? Number(scoreObj.resting_heart_rate) : null,
                    spo2: scoreObj?.spo2_percentage != null ? Number(scoreObj.spo2_percentage) : null,
                    skinTempCelsius: scoreObj?.skin_temp_celsius != null ? Number(scoreObj.skin_temp_celsius) : null,
                    state: Number(scoreObj?.recovery_score_state_id ?? scoreObj?.state ?? 0),
                    cycle: cycleRecord && typeof cycleRecord === 'object' ? (cycleRecord as Record<string, unknown>) : undefined,
                    sleep_data: sleepRecord && typeof sleepRecord === 'object' ? (sleepRecord as Record<string, unknown>) : undefined,
                    workout: workoutRecord && typeof workoutRecord === 'object' ? (workoutRecord as Record<string, unknown>) : undefined,
                    profile: profile && typeof profile === 'object' ? (profile as Record<string, unknown>) : undefined,
                    measurements: measurements && typeof measurements === 'object' ? (measurements as Record<string, unknown>) : undefined
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
