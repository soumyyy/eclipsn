import { config } from '../config';
import { getUserIntegration, saveUserIntegration } from './db';

const CLIENT_ID = config.whoopClientId;
const CLIENT_SECRET = config.whoopClientSecret;

export const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v1'; // v1 base
// Recovery is v2

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

export async function fetchWhoopRecovery(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const data = await fetchWhoop(`https://api.prod.whoop.com/developer/v2/recovery?limit=1`, token);
    return data.records?.[0] || null;
}

export async function fetchWhoopCycle(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const data = await fetchWhoop(`${WHOOP_API_BASE}/cycle?limit=1`, token);
    return data.records?.[0] || null;
}

export async function fetchWhoopSleep(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const data = await fetchWhoop(`${WHOOP_API_BASE}/activity/sleep?limit=1`, token);
    return data.records?.[0] || null;
}

export async function fetchWhoopWorkout(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    const data = await fetchWhoop(`${WHOOP_API_BASE}/activity/workout?limit=1`, token);
    return data.records?.[0] || null;
}

export async function fetchWhoopProfile(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    return fetchWhoop(`${WHOOP_API_BASE}/user/profile/basic`, token);
}

export async function fetchWhoopMeasurements(userId: string) {
    const token = await getValidAccessToken(userId);
    if (!token) throw new Error('No valid token');
    return fetchWhoop(`${WHOOP_API_BASE}/user/BodyMeasurement`, token);
}
