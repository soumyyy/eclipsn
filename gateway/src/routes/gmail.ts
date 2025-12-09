import { Router } from 'express';
import { getAuthUrl, exchangeCodeForTokens } from '../services/gmailOAuth';
import { saveGmailTokens, removeExpiredGmailThreads, searchGmailEmbeddings } from '../services/db';
import { fetchRecentThreads, getGmailProfile, NO_GMAIL_TOKENS } from '../services/gmailClient';
import { embedEmailText } from '../services/embeddings';
import { TEST_USER_ID } from '../constants';

const router = Router();

router.get('/connect', (req, res) => {
  const state = req.query.state?.toString() || 'pluto-dev';
  const authUrl = getAuthUrl(state);
  return res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing code parameter');
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const expiry = new Date(Date.now() + tokens.expires_in * 1000);
    await saveGmailTokens({
      userId: TEST_USER_ID,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiry
    });

    return res.send('Gmail connected successfully. You can close this window.');
  } catch (error) {
    console.error('Failed to exchange Gmail code', error);
    return res.status(500).send('Failed to connect Gmail.');
  }
});

router.get('/threads', async (req, res) => {
  const maxResults = parseInt(req.query.limit as string, 10) || 20;
  const importanceOnly = req.query.importance_only === 'true';
  try {
    const { threads } = await fetchRecentThreads(TEST_USER_ID, maxResults, { importanceOnly });
    const importantCount = threads.filter((thread) => (thread.importanceScore ?? 0) >= 0).length;
    const promoCount = threads.length - importantCount;
    return res.json({
      threads,
      meta: {
        total: threads.length,
        important: importantCount,
        promotions: promoCount
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

router.get('/status', async (_req, res) => {
  try {
    const profile = await getGmailProfile(TEST_USER_ID);
    return res.json({ connected: true, email: profile.email, avatarUrl: profile.avatarUrl, name: profile.name });
  } catch (error) {
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      return res.json({ connected: false });
    }
    console.error('Failed to fetch Gmail status', error);
    return res.json({ connected: false });
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

  try {
    let pageToken: string | undefined;
    let synced = 0;
    const categoryCounts: Record<string, number> = {};
    do {
      const result = await fetchRecentThreads(TEST_USER_ID, 1000, {
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

router.post('/threads/cleanup', async (_req, res) => {
  try {
    await removeExpiredGmailThreads(TEST_USER_ID);
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
  try {
    const embedding = await embedEmailText(query);
    const matches = await searchGmailEmbeddings({ userId: TEST_USER_ID, embedding, limit: limit ?? 5 });
    return res.json({ threads: matches });
  } catch (error) {
    console.error('Semantic gmail search failed', error);
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      return res.status(401).json({ error: 'Gmail not connected' });
    }
    return res.status(500).json({ error: 'Failed to search Gmail' });
  }
});
