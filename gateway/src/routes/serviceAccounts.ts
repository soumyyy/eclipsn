import { Router } from 'express';
import { google } from 'googleapis';
import { getServiceAccountAuthUrl, exchangeCodeForServiceTokens } from '../services/serviceAccountOAuth';
import {
    createServiceAccount,
    getServiceAccounts,
    deleteServiceAccount,
    createServiceAccountJob,
    getServiceAccountJob,
    getServiceAccountById
} from '../services/db';
import { getAuthorizedServiceGmail } from '../services/serviceAccountClient';
import { runServiceAccountSync } from '../jobs/serviceAccountSync';
import { requireUserId } from '../utils/request';
import { ensureSessionUser } from '../services/userService';
import { config } from '../config';

const router = Router();

// 1. Connect (Start OAuth)
router.get('/connect', (req, res) => {
    try {
        const label = req.query.label?.toString() || '';
        const nonce = Math.random().toString(36).substring(7);
        const stateData = JSON.stringify({ nonce, label });
        const stateBase64 = Buffer.from(stateData).toString('base64');

        const authUrl = getServiceAccountAuthUrl(stateBase64);
        return res.redirect(authUrl);
    } catch (error) {
        console.error('[ServiceAccount] Connect error:', error);
        return res.status(500).json({ error: 'Failed to initiate connection' });
    }
});

// 2. Callback (Finish OAuth)
router.get('/callback', async (req, res) => {
    const { code, error, state } = req.query;

    if (error) {
        return res.redirect(`${config.frontendOrigin}/?openProfile=connections&error=${encodeURIComponent(String(error))}`);
    }

    if (!code || typeof code !== 'string') {
        return res.status(400).send('Missing code');
    }

    try {
        // Parse state to get label
        let label = '';
        if (state && typeof state === 'string') {
            const cleanState = state.replace('SERVICE_ACCOUNT:', '');
            try {
                const data = JSON.parse(Buffer.from(cleanState, 'base64').toString());
                if (data && data.label) {
                    label = data.label;
                }
            } catch (e) {
                console.warn('[ServiceAccount] Failed to parse state:', e);
            }
        }

        // 1. Exchange code
        const tokens = await exchangeCodeForServiceTokens(code);

        // 2. Identify email
        const oauth2Client = new google.auth.OAuth2(
            config.googleClientId,
            config.googleClientSecret,
            config.googleRedirectUri
        );
        oauth2Client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data: userInfo } = await oauth2.userinfo.get();

        if (!userInfo.email) {
            throw new Error('No email found in OAuth response');
        }

        // 3. Identify User (Session)
        const userId = await ensureSessionUser(req, res);
        if (!userId) {
            throw new Error('User not authenticated during callback');
        }

        // 4. Save to DB
        await createServiceAccount({
            userId,
            email: userInfo.email,
            name: label || undefined,
            tokens,
            filterKeywords: [] // Default empty
        });

        res.redirect(`${config.frontendOrigin}/?openProfile=connections&success=true`);

    } catch (e) {
        console.error('[ServiceAccount] Callback error:', e);
        res.redirect(`${config.frontendOrigin}/?openProfile=connections&error=${encodeURIComponent(String(e))}`);
    }
});

// 3. List Accounts
router.get('/', async (req, res) => {
    const userId = requireUserId(req);
    const accounts = await getServiceAccounts(userId);
    // Redact tokens
    const safeAccounts = accounts.map(a => ({
        ...a,
        tokens: undefined
    }));
    res.json(safeAccounts);
});

// 4. Disconnect
router.delete('/:id', async (req, res) => {
    const userId = requireUserId(req);
    const { id } = req.params;
    const account = await getServiceAccountById(id);

    if (!account || account.userId !== userId) {
        return res.status(404).json({ error: 'Account not found' });
    }

    await deleteServiceAccount(id);
    res.json({ success: true });
});

// 5. Trigger Sync (Async Job)
router.post('/:id/sync', async (req, res) => {
    const userId = requireUserId(req);
    const { id } = req.params;
    const account = await getServiceAccountById(id);

    if (!account || account.userId !== userId) {
        return res.status(404).json({ error: 'Account not found' });
    }

    const jobId = await createServiceAccountJob(id);

    // Fire and forget (Async)
    runServiceAccountSync(jobId).catch(err => console.error(`Sync job ${jobId} crashed:`, err));

    res.json({ jobId });
});

// 6. Job Log Stream (SSE)
router.get('/jobs/:jobId/stream', async (req, res) => {
    const userId = requireUserId(req);
    const { jobId } = req.params;
    const job = await getServiceAccountJob(jobId);

    // Security check: ensure the job belongs to an account owned by the user
    if (!job) return res.status(404).end();
    const account = await getServiceAccountById(job.accountId);
    if (!account || account.userId !== userId) return res.status(403).end();

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Initial state
    res.write(`data: ${JSON.stringify(job)}\n\n`);

    if (job.status === 'completed' || job.status === 'failed') {
        res.end();
        return;
    }

    // Poll DB for updates (Simple solution for now, Postgres Listen/Notify is better but harder to setup quickly)
    const interval = setInterval(async () => {
        const updatedJob = await getServiceAccountJob(jobId);
        if (updatedJob) {
            res.write(`data: ${JSON.stringify(updatedJob)}\n\n`);
            if (updatedJob.status === 'completed' || updatedJob.status === 'failed') {
                clearInterval(interval);
                res.end();
            }
        } else {
            clearInterval(interval);
            res.end();
        }
    }, 1000);

    req.on('close', () => clearInterval(interval));
});

// Search across all service accounts
router.get('/search', async (req, res) => {
    const userId = requireUserId(req);
    const query = req.query.q as string;

    if (!query) {
        return res.status(400).json({ error: 'Missing query parameter q' });
    }

    try {
        const accounts = await getServiceAccounts(userId);
        const results: any[] = [];

        await Promise.all(accounts.map(async (account) => {
            try {
                const gmail = await getAuthorizedServiceGmail(account.id);
                const resp = await gmail.users.threads.list({
                    userId: 'me',
                    q: query,
                    maxResults: 5
                });

                const threads = resp.data.threads || [];

                // Fetch snippets for context
                for (const t of threads) {
                    if (!t.id) continue;
                    const detail = await gmail.users.threads.get({
                        userId: 'me',
                        id: t.id,
                        format: 'metadata'
                    });

                    results.push({
                        id: t.id,
                        accountId: account.id,
                        accountEmail: account.email,
                        snippet: detail.data.snippet,
                        historyId: detail.data.historyId,
                        link: `https://mail.google.com/mail/u/${account.email}/#inbox/${t.id}` // Approximation
                    });
                }
            } catch (err) {
                console.error(`Failed to search account ${account.email}`, err);
            }
        }));

        return res.json({ threads: results });
    } catch (error) {
        console.error('Service account search failed', error);
        return res.status(500).json({ error: 'Search failed' });
    }
});


// 7. Get Thread Details
router.get('/:accountId/threads/:threadId', async (req, res) => {
    const userId = requireUserId(req);
    const { accountId, threadId } = req.params;

    // Security check
    try {
        // Security check
        const account = await getServiceAccountById(accountId);
        if (!account || account.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { fetchServiceAccountThreadBody } = await import('../services/serviceAccountClient');
        const detail = await fetchServiceAccountThreadBody(accountId, threadId);
        return res.json(detail);
    } catch (error) {
        console.error('Failed to fetch service account thread', error);
        return res.status(500).json({ error: 'Failed to fetch thread' });
    }
});

// 8. Download Attachment
router.get('/:accountId/messages/:messageId/attachments/:attachmentId', async (req, res) => {
    const userId = requireUserId(req);
    const { accountId, messageId, attachmentId } = req.params;

    try {
        // Security check
        const account = await getServiceAccountById(accountId);
        if (!account || account.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const { getServiceAccountAttachment } = await import('../services/serviceAccountClient');
        const attachment = await getServiceAccountAttachment(accountId, messageId, attachmentId);

        if (!attachment || !attachment.data) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const fileData = Buffer.from(attachment.data, 'base64');
        res.setHeader('Content-Type', 'application/pdf'); // Default to PDF
        res.setHeader('Content-Length', fileData.length);
        res.send(fileData);
    } catch (error) {
        console.error('Failed to download service account attachment', error);
        return res.status(500).json({ error: 'Failed to download attachment' });
    }
});

export default router;

