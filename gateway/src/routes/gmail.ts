import { Router } from 'express';
import { google } from 'googleapis';
import { getAuthUrl, exchangeCodeForTokens, revokeToken } from '../services/gmailOAuth';
import {
  saveGmailTokens,
  removeExpiredGmailThreads,
  searchGmailEmbeddings,
  getGmailTokens,
  deleteGmailTokens,
  findOrCreateUserByGmailEmail,
  getUserProfile,
  markInitialGmailSync
} from '../services/db';
import { fetchRecentThreads, getGmailProfile, NO_GMAIL_TOKENS, fetchThreadBody, getGmailAttachment } from '../services/gmailClient';
import { embedEmailText } from '../services/embeddings';
import { getUserId, requireUserId } from '../utils/request';
import { ensureInitialGmailSync, formatGmailDate } from '../jobs/gmailInitialSync';
import { config } from '../config';
import { attachGmailIdentity, establishSession, ensureSessionUser, getSessionUserId } from '../services/userService';
import { generatePopupResponse } from '../utils/popupResponse';
import {
  addGmailStatusListener,
  DEFAULT_GMAIL_STATUS,
  emitGmailStatusUpdate,
  getGmailSyncStatus
} from '../services/gmailStatus';

const router = Router();
const DEFAULT_LOOKBACK_HOURS = 48;

router.get('/connect', (req, res) => {
  try {
    const state = req.query.state?.toString() || 'Eclipsn-dev';
    const authUrl = getAuthUrl(state);

    console.log('[Gmail OAuth] Redirecting to:', authUrl);
    return res.redirect(authUrl);
  } catch (error) {
    console.error('[Gmail OAuth] Connect error:', error);
    return res.status(500).json({ error: 'Failed to initiate Gmail connection' });
  }
});

router.get('/callback', async (req, res) => {
  const { code, error: oauthError, error_description } = req.query;

  // Handle OAuth errors
  if (oauthError) {
    console.error('[Gmail OAuth] OAuth error:', oauthError, error_description);
    return res.redirect(`${config.frontendOrigin}/login?error=${encodeURIComponent(String(oauthError))}`);
  }

  // Intercept Service Account Flow
  const state = req.query.state as string;
  if (state && state.startsWith('SERVICE_ACCOUNT:')) {
    console.log('[Gmail OAuth] Detected Service Account flow, redirecting to dedicated handler');
    const params = new URLSearchParams(req.query as any);
    return res.redirect(`/api/service-accounts/callback?${params.toString()}`);
  }

  if (!code || typeof code !== 'string') {
    console.error('[Gmail OAuth] Missing authorization code');
    return res.status(400).send('Missing authorization code parameter');
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token) {
      throw new Error('No access token received from Google');
    }

    // Get Gmail profile to identify the user
    const oauth2Client = new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      config.googleRedirectUri
    );

    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const gmailEmail = userInfo.email;

    // Validate email
    if (!gmailEmail) {
      throw new Error('Missing Gmail email from OAuth response');
    }

    let userId: string | null = null;

    // Check for existing session using centralized session management
    const existingUserId = await ensureSessionUser(req, res);

    if (existingUserId) {
      // User has existing session - attach Gmail to existing account
      userId = existingUserId;
      await attachGmailIdentity(userId, gmailEmail);
      console.log('[Gmail OAuth] Attached Gmail to existing user:', userId);
    } else {
      // No existing session - find or create user by Gmail email
      const result = await findOrCreateUserByGmailEmail(gmailEmail);
      userId = result.userId;
      console.log('[Gmail OAuth] Found/created user:', userId);
    }

    // Validate user ID
    if (!userId) {
      throw new Error('Failed to resolve user ID');
    }

    // Save Gmail tokens for this user
    const expiry = new Date(Date.now() + (tokens.expires_in * 1000));
    await saveGmailTokens({
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiry
    });
    void emitGmailStatusUpdate(userId);

    // Establish secure session
    await establishSession(req, res, userId);

    // Start background Gmail sync
    ensureInitialGmailSync(userId).catch((err) => {
      console.error('[Gmail OAuth] Failed to run initial Gmail sync:', err);
    });

    console.log('[Gmail OAuth] Successfully connected Gmail for user:', userId);

    // Check if user needs onboarding or can go directly to main app
    try {
      const profile = await getUserProfile(userId);

      if (profile && (profile as any).fullName) {
        // User has profile → redirect to main app
        console.log('[Gmail OAuth] User has profile, redirecting to main app');
        return res.redirect(`${config.frontendOrigin}/`);
      } else {
        // User needs onboarding
        console.log('[Gmail OAuth] User needs onboarding, redirecting to onboarding');
        return res.redirect(`${config.frontendOrigin}/login?stage=onboarding`);
      }
    } catch (error) {
      console.error('[Gmail OAuth] Error checking user profile:', error);
      // Fallback to onboarding if we can't determine profile status
      return res.redirect(`${config.frontendOrigin}/login?stage=onboarding`);
    }

  } catch (error) {
    console.error('[Gmail OAuth] Callback error:', error);

    // Clear any partial session state
    try {
      await ensureSessionUser(req, res); // This will clear invalid sessions
    } catch {
      // Ignore cleanup errors
    }

    // Redirect back to login page on error
    return res.redirect(`${config.frontendOrigin}/login?error=oauth_failed`);
  }
});

router.get('/threads', async (req, res) => {
  const maxResults = parseInt(req.query.limit as string, 10) || 20;
  const importanceOnly = req.query.importance_only === 'true';
  const lookbackHours = parseInt(req.query.hours as string, 10) || DEFAULT_LOOKBACK_HOURS;
  const startDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const userId = requireUserId(req);
  const isInternalRequest = Boolean((req as any).internal);
  if (!isInternalRequest) {
    const sessionUserId = getSessionUserId(req);
    if (!sessionUserId || sessionUserId !== userId) {
      return res.status(401).json({ error: 'Session expired' });
    }
  }
  try {
    const { threads } = await fetchRecentThreads(userId, maxResults, {
      importanceOnly,
      startDate: formatGmailDate(startDate)
    });
    const importantCount = threads.filter((thread) => (thread.importanceScore ?? 0) >= 0).length;
    const promoCount = threads.length - importantCount;
    return res.json({
      threads,
      meta: {
        total: threads.length,
        important: importantCount,
        promotions: promoCount,
        lookbackHours
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      return res.status(401).json({ error: 'Gmail not connected' });
    }
    console.error('Failed to fetch Gmail threads', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/status', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.json(DEFAULT_GMAIL_STATUS);
  }
  try {
    const baseStatus = await getGmailSyncStatus(userId);
    if (!baseStatus.connected) {
      return res.json(baseStatus);
    }
    const profile = await getGmailProfile(userId);
    return res.json({
      ...baseStatus,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      name: profile.name
    });
  } catch (error) {
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      return res.json(DEFAULT_GMAIL_STATUS);
    }
    console.error('Failed to fetch Gmail status', error);
    return res.json(DEFAULT_GMAIL_STATUS);
  }
});

router.get('/status/stream', async (req, res) => {
  const userId = requireUserId(req);
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  const streamRes = res as any;
  if (typeof streamRes.flushHeaders === 'function') {
    streamRes.flushHeaders();
  } else if (typeof streamRes.flush === 'function') {
    streamRes.flush();
  }

  const send = (payload: any) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const unsubscribe = addGmailStatusListener(userId, send);
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });

  try {
    const snapshot = await getGmailSyncStatus(userId);
    send(snapshot);
  } catch (error) {
    console.error('Failed to send initial Gmail status snapshot', error);
    send(DEFAULT_GMAIL_STATUS);
  }
});

router.post('/disconnect', async (req, res) => {
  const userId = requireUserId(req);
  try {
    console.log('[Gmail Disconnect] Disconnecting Gmail for user:', userId);

    const tokens = await getGmailTokens(userId);

    // Revoke tokens with Google
    if (tokens?.accessToken) {
      try {
        await revokeToken(tokens.accessToken);
        console.log('[Gmail Disconnect] Access token revoked');
      } catch (revokeError) {
        console.warn('[Gmail Disconnect] Failed to revoke access token:', revokeError);
        // Continue with disconnection even if revocation fails
      }
    } else if (tokens?.refreshToken) {
      try {
        await revokeToken(tokens.refreshToken);
        console.log('[Gmail Disconnect] Refresh token revoked');
      } catch (revokeError) {
        console.warn('[Gmail Disconnect] Failed to revoke refresh token:', revokeError);
      }
    }

    // Delete tokens from database
    await deleteGmailTokens(userId);
    await markInitialGmailSync(userId, {
      started: false,
      completed: false,
      totalThreads: 0,
      syncedThreads: 0
    });
    void emitGmailStatusUpdate(userId);

    console.log('[Gmail Disconnect] Gmail successfully disconnected for user:', userId);
    return res.json({ status: 'disconnected', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[Gmail Disconnect] Failed to disconnect Gmail:', error);
    return res.status(500).json({
      error: 'Failed to disconnect Gmail',
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/threads/full-sync', async (req, res) => {
  const { startDate, endDate } = req.body as { startDate?: string; endDate?: string };
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  if (diffMs <= 0 || diffMs > oneYearMs) {
    return res.status(400).json({ error: 'Window must be positive and at most 1 year' });
  }

  const userId = requireUserId(req);
  const isInternalRequest = Boolean((req as any).internal);
  if (!isInternalRequest) {
    const sessionUserId = getSessionUserId(req);
    if (!sessionUserId || sessionUserId !== userId) {
      return res.status(401).json({ error: 'Session expired' });
    }
  }
  try {
    let pageToken: string | undefined;
    let synced = 0;
    const categoryCounts: Record<string, number> = {};
    do {
      const result = await fetchRecentThreads(userId, 1000, {
        maxResults: 1000,
        startDate,
        endDate,
        importanceOnly: false,
        pageToken
      });
      synced += result.threads.length;
      pageToken = result.nextPageToken;
      Object.entries(result.counts).forEach(([category, count]) => {
        categoryCounts[category] = (categoryCounts[category] || 0) + count;
      });
      console.log(`[Gmail Sync] fetched ${result.threads.length} threads (categories:`, result.counts, ')');
    } while (pageToken);

    return res.json({ synced, categories: categoryCounts });
  } catch (error) {
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      return res.status(401).json({ error: 'Gmail not connected' });
    }
    console.error('Full sync failed', error);
    return res.status(500).json({ error: 'Failed to sync Gmail threads' });
  }
});

export default router;

router.post('/threads/cleanup', async (req, res) => {
  const userId = requireUserId(req);
  try {
    await removeExpiredGmailThreads(userId);
    return res.json({ status: 'ok' });
  } catch (error) {
    console.error('Gmail cleanup failed', error);
    return res.status(500).json({ error: 'Failed to cleanup Gmail threads' });
  }
});

router.post('/threads/search', async (req, res) => {
  const { query, limit } = req.body as { query?: string; limit?: number };
  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }
  const userId = requireUserId(req);
  try {
    const embedding = await embedEmailText(query);
    const matches = await searchGmailEmbeddings({ userId, embedding, limit: limit ?? 5 });
    return res.json({ threads: matches });
  } catch (error) {
    console.error('Semantic gmail search failed', error);
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      return res.status(401).json({ error: 'Gmail not connected' });
    }
    return res.status(500).json({ error: 'Failed to search Gmail' });
  }
});

router.get('/threads/:threadId', async (req, res) => {
  const threadId = req.params.threadId;
  const userId = requireUserId(req);
  try {
    const detail = await fetchThreadBody(userId, threadId);
    return res.json(detail);
  } catch (error) {
    if (error instanceof Error && error.message === 'Thread not found') {
      return res.status(404).json({ error: 'Thread not found' });
    }
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      return res.status(401).json({ error: 'Gmail not connected' });
    }
    console.error('Failed to fetch Gmail thread body', error);
    return res.status(500).json({ error: 'Failed to fetch Gmail thread' });
  }
});

router.get('/messages/:messageId/attachments/:attachmentId', async (req, res) => {
  const { messageId, attachmentId } = req.params;
  const userId = requireUserId(req);

  try {
    const attachment = await getGmailAttachment(userId, messageId, attachmentId);

    if (!attachment || !attachment.data) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const fileData = Buffer.from(attachment.data, 'base64');

    res.setHeader('Content-Type', 'application/pdf'); // Default to PDF or octet-stream
    res.setHeader('Content-Length', fileData.length);
    res.send(fileData);
  } catch (error) {
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      return res.status(401).json({ error: 'Gmail not connected' });
    }
    console.error('Failed to download attachment', error);
    return res.status(500).json({ error: 'Failed to download attachment' });
  }
});
