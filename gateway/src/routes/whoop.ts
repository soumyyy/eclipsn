import { config } from '../config';
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { saveUserIntegration, getUserIntegration } from '../services/db';
import {
    fetchWhoopRecovery,
    fetchWhoopCycle,
    fetchWhoopSleep,
    fetchWhoopWorkout,
    fetchWhoopProfile,
    fetchWhoopMeasurements,
    fetchWhoopBaselines
} from '../services/whoopClient';

const router = Router();

function getWhoopUserId(req: any): string | null {
    return (req.session as any)?.userId ?? (req as any).userId ?? null;
}

// ... (omitted lines)

// In /connect route:
// const state = randomBytes(16).toString('hex');

// ... (omitted lines)

// ... (omitted lines)

// These credentials should be in .env eventually, but for now we follow the plan.
// User must manually start ngrok on port 4000: `ngrok http 4000`
// And set the redirect URI in Whoop Dev Dashboard to: https://<NGROK_ID>.ngrok-free.app/api/whoop/callback
const CLIENT_ID = config.whoopClientId;
const CLIENT_SECRET = config.whoopClientSecret;

const REDIRECT_URI = config.whoopRedirectUri;

router.get('/connect', (req, res) => {
    const { userId } = req.session as any;
    if (!CLIENT_ID) {
        return res.status(500).send('Missing WHOOP_CLIENT_ID');
    }
    if (!userId) {
        return res.status(401).send('Unauthorized: Please log in first.');
    }

    const scopes = [
        'offline',
        'read:recovery',
        'read:sleep',
        'read:cycles',
        'read:workout',
        'read:profile',
        'read:body_measurement'
    ].join(' ');

    // Embed userId in state to survive cross-domain redirect (Localhost -> Ngrok)
    const nonce = randomBytes(16).toString('hex');
    const stateData = JSON.stringify({ userId, nonce });
    const state = Buffer.from(stateData).toString('base64');

    const authUrl = `https://api.prod.whoop.com/oauth/oauth2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scopes}&state=${state}&response_type=code`;

    res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
    const { code, error, state } = req.query;
    let userId: string | null = null;

    // Attempt to recover userId from session first (if on same domain)
    if ((req.session as any).userId) {
        userId = (req.session as any).userId;
    }

    // Fallback: Recover from state (cross-domain scenario)
    if (!userId && state && typeof state === 'string') {
        try {
            const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
            if (decoded && decoded.userId) {
                userId = decoded.userId;
            }
        } catch (e) {
            console.warn('Failed to decode state:', e);
        }
    }

    if (error) {
        return res.status(400).send(`Whoop auth failed: ${error}`);
    }

    if (!code || typeof code !== 'string') {
        return res.status(400).send('Missing auth code');
    }

    if (!userId) {
        return res.status(401).send('Unauthorized: No user session found. Please try connecting again from the main app.');
    }

    try {
        const tokenResponse = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: CLIENT_ID || '',
                client_secret: CLIENT_SECRET || '',
                redirect_uri: REDIRECT_URI
            })
        });

        if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            throw new Error(`Whoop token exchange failed: ${errText}`);
        }

        const tokens = await tokenResponse.json();

        // Whoop tokens expire in 1 hour usually
        const expiryDate = new Date(Date.now() + (tokens.expires_in * 1000));

        await saveUserIntegration({
            userId,
            provider: 'whoop',
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiry: expiryDate,
            metadata: { scope: tokens.scope }
        });

        res.send('<h1>Whoop Connected!</h1><p>You can close this window and refresh Eclipsn.</p><script>window.close()</script>');

    } catch (err) {
        console.error('Whoop callback error:', err);
        res.status(500).send('Failed to connect Whoop');
    }
});

router.get('/status', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).json({ connected: false });

    const integration = await getUserIntegration(userId, 'whoop');
    res.json({
        connected: !!integration,
        expiresAt: integration?.expiresAt
    });
});

router.delete('/disconnect', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).send('Unauthorized');

    try {
        const { getPool } = require('../services/db');
        const pool = getPool();
        await pool.query('DELETE FROM user_integrations WHERE user_id = $1 AND provider = $2', [userId, 'whoop']);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to disconnect' });
    }
});

router.get('/recovery', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).send('Unauthorized');
    try {
        const data = await fetchWhoopRecovery(userId);
        res.json({ recovery: data });
    } catch (e: any) {
        console.error('Whoop Recovery Error:', e.message);
        res.status(500).json({ error: e.message || 'Failed' });
    }
});

router.get('/cycles', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).send('Unauthorized');
    try {
        const data = await fetchWhoopCycle(userId);
        res.json({ cycle: data });
    } catch (e: any) {
        console.error('Whoop Cycle Error:', e.message);
        res.status(500).json({ error: e.message || 'Failed' });
    }
});

router.get('/sleep', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).send('Unauthorized');
    try {
        const data = await fetchWhoopSleep(userId);
        res.json({ sleep: data });
    } catch (e: any) {
        console.error('Whoop Sleep Error:', e.message);
        res.status(500).json({ error: e.message || 'Failed' });
    }
});

router.get('/workout', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).send('Unauthorized');
    try {
        const data = await fetchWhoopWorkout(userId);
        res.json({ workout: data });
    } catch (e: any) {
        console.error('Whoop Workout Error:', e.message);
        res.status(500).json({ error: e.message || 'Failed' });
    }
});

router.get('/profile', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).send('Unauthorized');
    try {
        const data = await fetchWhoopProfile(userId);
        res.json(data);
    } catch (e: any) {
        console.error('Whoop Profile Error:', e.message);
        res.status(500).json({ error: e.message || 'Failed' });
    }
});

router.get('/measurements', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).send('Unauthorized');
    try {
        const data = await fetchWhoopMeasurements(userId);
        res.json(data);
    } catch (e: any) {
        console.error('Whoop Measurements Error:', e.message);
        res.status(500).json({ error: e.message || 'Failed' });
    }
});

/** Monthly baselines (avg HRV, RHR, sleep) for vitals comparison. Used by brain for vitals card. */
router.get('/baselines', async (req, res) => {
    const userId = getWhoopUserId(req);
    if (!userId) return res.status(401).send('Unauthorized');
    const days = Math.min(90, Math.max(7, parseInt(String(req.query.days || 30), 10) || 30));
    try {
        const baselines = await fetchWhoopBaselines(userId, days);
        if (!baselines) return res.status(503).json({ error: 'Could not compute baselines' });
        res.json(baselines);
    } catch (e: any) {
        console.error('Whoop Baselines Error:', e.message);
        res.status(500).json({ error: e.message || 'Failed' });
    }
});

export default router;
