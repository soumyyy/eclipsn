import { config } from '../config';
import { getUserIntegration, saveUserIntegration } from './db';

const CLIENT_ID = config.whoopClientId;
const CLIENT_SECRET = config.whoopClientSecret;

// Whoop API v2 – all endpoints (v1 deprecated per https://developer.whoop.com/docs/developing/v1-v2-migration)
export const WHOOP_API_V2_BASE = 'https://api.prod.whoop.com/developer/v2';

export async function getValidAccessToken(userId: string): Promise<string | null> {
    const integration = await getUserIntegration(userId, 'whoop');
    if (!integration) return null;

    // Check if expired (buffer 5 mins)
    if (new Date() >= new Date(integration.expiresAt!.getTime() - 5 * 60000)) {
        try {
            const tokenResponse = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: integration.refreshToken || '',
                    client_id: CLIENT_ID || '',
                    client_secret: CLIENT_SECRET || ''
                })
            });

            if (!tokenResponse.ok) throw new Error(`Refresh failed: ${await tokenResponse.text()}`);
            const tokens = await tokenResponse.json();

            const expiryDate = new Date(Date.now() + (tokens.expires_in * 1000));
            await saveUserIntegration({
                userId,
                provider: 'whoop',
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiry: expiryDate,
                metadata: { scope: tokens.scope }
            });
            return tokens.access_token;
        } catch (e) {
            console.error('[WhoopClient] Refresh error:', e);
            return null;
        }
    }
    return integration.accessToken;
}

async function fetchWhoop(endpoint: string, token: string) {
    const response = await fetch(endpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

// Recovery: recovery_score, resting_heart_rate, hrv_rmssd_milli, spo2_percentage, skin_temp_celsius (4.0)
export async function fetchWhoopRecovery(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const data = await fetchWhoop(`${WHOOP_API_V2_BASE}/recovery?limit=1`, token);
    return data.records?.[0] ?? null;
}

// Cycle: strain, kilojoule, average_heart_rate, max_heart_rate
export async function fetchWhoopCycle(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const data = await fetchWhoop(`${WHOOP_API_V2_BASE}/cycle?limit=1`, token);
    return data.records?.[0] ?? null;
}

// Sleep: stage_summary, sleep_needed, respiratory_rate, sleep_performance_percentage, sleep_efficiency_percentage
export async function fetchWhoopSleep(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const data = await fetchWhoop(`${WHOOP_API_V2_BASE}/activity/sleep?limit=1`, token);
    return data.records?.[0] ?? null;
}

// Workout: strain, average_heart_rate, max_heart_rate, kilojoule, sport_name, zone_durations, distance_meter, etc.
export async function fetchWhoopWorkout(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const data = await fetchWhoop(`${WHOOP_API_V2_BASE}/activity/workout?limit=1`, token);
    return data.records?.[0] ?? null;
}

// Profile: user_id, email, first_name, last_name
export async function fetchWhoopProfile(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    return fetchWhoop(`${WHOOP_API_V2_BASE}/user/profile/basic`, token);
}

// Body measurements: height_meter, weight_kilogram, max_heart_rate
export async function fetchWhoopMeasurements(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    return fetchWhoop(`${WHOOP_API_V2_BASE}/user/measurement/body`, token);
}

/** Recovery history for baselines (last N days). Whoop API: start/end ISO, limit ≤ 25 */
export async function fetchWhoopRecoveryHistory(userId: string, days: number = 30) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
        limit: '25',
        start: start.toISOString(),
        end: end.toISOString()
    });
    const data = await fetchWhoop(`${WHOOP_API_V2_BASE}/recovery?${params}`, token);
    return data.records ?? [];
}

/** Sleep history for baselines (last N days). Whoop API: start/end ISO, limit ≤ 25 */
export async function fetchWhoopSleepHistory(userId: string, days: number = 30) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
        limit: '25',
        start: start.toISOString(),
        end: end.toISOString()
    });
    const data = await fetchWhoop(`${WHOOP_API_V2_BASE}/activity/sleep?${params}`, token);
    return data.records ?? [];
}

export interface WhoopBaselines {
    avgHrvMs: number;
    avgRhr: number;
    avgSleepMinutes: number;
    sampleCount: number;
}

/** Compute monthly baselines from recovery + sleep history for vitals comparison */
export async function fetchWhoopBaselines(userId: string, days: number = 30): Promise<WhoopBaselines | null> {
    try {
        const [recoveryRecords, sleepRecords] = await Promise.all([
            fetchWhoopRecoveryHistory(userId, days),
            fetchWhoopSleepHistory(userId, days)
        ]);

        let sumHrv = 0;
        let countHrv = 0;
        let sumRhr = 0;
        let countRhr = 0;
        for (const r of recoveryRecords) {
            const score = r?.score;
            if (score && typeof score === 'object') {
                const hrv = (score as any).hrv_rmssd_milli;
                const rhr = (score as any).resting_heart_rate;
                if (typeof hrv === 'number' && !Number.isNaN(hrv)) {
                    sumHrv += hrv;
                    countHrv++;
                }
                if (typeof rhr === 'number' && !Number.isNaN(rhr)) {
                    sumRhr += rhr;
                    countRhr++;
                }
            }
        }

        let sumSleepMinutes = 0;
        let countSleep = 0;
        for (const s of sleepRecords) {
            const score = s?.score;
            const stageSummary = score?.stage_summary;
            const totalBedMs = stageSummary?.total_in_bed_time_milli;
            if (typeof totalBedMs === 'number' && !Number.isNaN(totalBedMs)) {
                sumSleepMinutes += totalBedMs / (60 * 1000);
                countSleep++;
            }
        }

        const avgHrvMs = countHrv > 0 ? sumHrv / countHrv : 0;
        const avgRhr = countRhr > 0 ? Math.round(sumRhr / countRhr) : 0;
        const avgSleepMinutes = countSleep > 0 ? sumSleepMinutes / countSleep : 0;
        const sampleCount = Math.max(countHrv, countRhr, countSleep);

        return {
            avgHrvMs,
            avgRhr,
            avgSleepMinutes,
            sampleCount
        };
    } catch (e) {
        console.error('[WhoopClient] Baselines error:', e);
        return null;
    }
}
