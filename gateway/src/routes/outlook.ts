import { Router } from 'express';
import { TEST_USER_ID } from '../constants';
import { getOutlookAuthUrl, exchangeOutlookCodeForTokens } from '../services/outlookOAuth';
import { saveOutlookTokens, getOutlookTokens, deleteOutlookTokens } from '../services/db';

const router = Router();

router.get('/connect', (_req, res) => {
  if (!process.env.OUTLOOK_CLIENT_ID || !process.env.OUTLOOK_REDIRECT_URI) {
    return res.status(400).send('Outlook OAuth is not configured.');
  }
  const authUrl = getOutlookAuthUrl('Eclipsn-outlook');
  return res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  const { code, error, error_description: errorDescription } = req.query;
  if (error) {
    return res.status(400).send(`Outlook authorization failed: ${errorDescription || error}`);
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const tokenResponse = await exchangeOutlookCodeForTokens(code);
    const expiry = new Date(Date.now() + (tokenResponse.expires_in - 60) * 1000);
    await saveOutlookTokens({
      userId: TEST_USER_ID,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiry,
      scope: tokenResponse.scope
    });
    return res.send('Outlook connected successfully. You can close this window.');
  } catch (err) {
    console.error('Failed to exchange Outlook code', err);
    return res.status(500).send('Failed to connect Outlook.');
  }
});

router.get('/status', async (_req, res) => {
  try {
    const tokens = await getOutlookTokens(TEST_USER_ID);
    if (!tokens) {
      return res.json({ connected: false });
    }
    return res.json({ connected: true, scope: tokens.scope });
  } catch (error) {
    console.error('Failed to fetch Outlook status', error);
    return res.json({ connected: false });
  }
});

router.post('/disconnect', async (_req, res) => {
  try {
    await deleteOutlookTokens(TEST_USER_ID);
    return res.json({ status: 'disconnected' });
  } catch (error) {
    console.error('Failed to disconnect Outlook', error);
    return res.status(500).json({ error: 'Failed to disconnect Outlook' });
  }
});

export default router;
