import { google } from 'googleapis';
import { config } from '../config';
import {
  getGmailTokens,
  saveGmailTokens,
  saveGmailThreads,
  GmailThreadRecord,
  upsertGmailEmbedding
} from './db';
import { embedEmailText } from './embeddings';

export const NO_GMAIL_TOKENS = 'NO_GMAIL_TOKENS';

export interface GmailThreadSummary extends GmailThreadRecord {
  link: string;
  sender?: string;
  importanceScore?: number;
  category?: string;
  labelIds?: string[];
  labelNames?: string[];
}

async function getAuthorizedGmail(userId: string) {
  const tokens = await getGmailTokens(userId);
  if (!tokens) {
    const error = new Error(NO_GMAIL_TOKENS);
    error.name = NO_GMAIL_TOKENS;
    throw error;
  }

  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );

  oauth2Client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken
  });

  oauth2Client.on('tokens', async (newTokens) => {
    if (!newTokens.access_token) return;
    try {
      await saveGmailTokens({
        userId,
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || tokens.refreshToken,
        expiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : tokens.expiry
      });
    } catch (error) {
      console.warn('Failed to persist refreshed Gmail tokens', error);
    }
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

interface ThreadFilters {
  importanceOnly?: boolean;
  maxResults?: number;
  startDate?: string;
  endDate?: string;
  pageToken?: string;
  customQuery?: string;
}

export async function fetchRecentThreads(
  userId: string,
  maxResults = 20,
  filters: ThreadFilters = {}
): Promise<{ threads: GmailThreadSummary[]; nextPageToken?: string; counts: Record<string, number> }> {
  const gmail = await getAuthorizedGmail(userId);
  const fetchLimit = Math.min(filters.maxResults ?? maxResults ?? 20, 1000);
  const query = filters.customQuery
    ? filters.customQuery
    : buildQuery(filters.startDate, filters.endDate, filters.importanceOnly !== false);
  const threadList = await gmail.users.threads.list({
    userId: 'me',
    maxResults: fetchLimit,
    pageToken: filters.pageToken,
    q: query
  });
  const summaries: GmailThreadSummary[] = [];
  const counts: Record<string, number> = {};

  if (!threadList.data.threads) {
    return { threads: summaries, nextPageToken: undefined, counts };
  }

  for (const thread of threadList.data.threads) {
    if (!thread.id) continue;
    const detail = await gmail.users.threads.get({
      userId: 'me',
      id: thread.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date', 'To']
    });

    const lastMessage = detail.data.messages?.[detail.data.messages.length - 1];
    const headers = lastMessage?.payload?.headers || [];
    const subject = headers.find((h) => h.name === 'Subject')?.value || '(no subject)';
    const sender = headers.find((h) => h.name === 'From')?.value || 'Unknown sender';
    const snippet = detail.data.snippet || lastMessage?.snippet || '';
    const lastMessageAt = lastMessage?.internalDate
      ? new Date(Number(lastMessage.internalDate))
      : undefined;
    const labelIds = lastMessage?.labelIds || detail.data.messages?.[0]?.labelIds || [];
    const labelNames = mapLabelIds(labelIds);
    const { importanceScore, category, isPromotional } = scoreThread(subject, snippet, sender, labelNames || []);

    if (filters.importanceOnly && isPromotional) {
      continue;
    }

    summaries.push({
      threadId: thread.id,
      subject,
      snippet,
      sender,
      category,
      importanceScore,
      lastMessageAt: lastMessageAt ?? null,
      link: `https://mail.google.com/mail/u/0/#inbox/${thread.id}`,
      labelIds,
      labelNames,
      expiresAt: computeExpiry(category, lastMessageAt ?? new Date())
    });
    counts[category] = (counts[category] || 0) + 1;
  }

  const rowIds = await saveGmailThreads(userId, summaries);
  for (let idx = 0; idx < summaries.length; idx += 1) {
    const summary = summaries[idx];
    const rowId = rowIds[idx];
    if (!rowId) continue;
    try {
      const textForEmbedding = `${summary.subject}\n${summary.snippet}\nFrom: ${summary.sender ?? ''}`;
      const embedding = await embedEmailText(textForEmbedding);
      await upsertGmailEmbedding({ userId, threadRowId: rowId, embedding });
    } catch (embedError) {
      console.warn('Failed to embed gmail thread', embedError);
    }
  }
  return { threads: summaries, nextPageToken: threadList.data.nextPageToken, counts };
}

export async function getGmailProfile(userId: string): Promise<{ email: string; avatarUrl: string; name: string }> {
  const gmail = await getAuthorizedGmail(userId);
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.data.emailAddress || '';
  const name = email ? email.split('@')[0] : 'Gmail user';
  const avatarUrl = email
    ? `https://www.google.com/s2/photos/public/${encodeURIComponent(email)}?sz=96`
    : '';
  return { email, avatarUrl, name };
}

const PROMO_KEYWORDS = ['unsubscribe', 'sale', '% off', 'deal', 'promo', 'special offer'];
const IMPORTANT_KEYWORDS = ['invoice', 'meeting', 'urgent', 'action required', 'payment', 'schedule'];
const PROMO_LABELS = new Set([
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS'
]);

const LABEL_NAME_MAP: Record<string, string> = {
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
  IMPORTANT: 'Important'
};

function mapLabelIds(ids: string[]): string[] {
  return ids
    .filter(Boolean)
    .map((id) => LABEL_NAME_MAP[id] || id.replace('CATEGORY_', '').toLowerCase());
}

function buildQuery(startDate?: string, endDate?: string, importanceOnly = true) {
  const parts: string[] = [];
  if (startDate) {
    parts.push(`after:${startDate}`);
  }
  if (endDate) {
    parts.push(`before:${endDate}`);
  }
  if (importanceOnly) {
    parts.push('category:primary OR label:important');
  }
  return parts.join(' ');
}

function scoreThread(subject: string, snippet: string, sender: string, labelNames: string[]) {
  let score = 0;
  let category = 'primary';
  let isPromotional = false;

  if (labelNames.some((label) => PROMO_LABELS.has(`CATEGORY_${label.toUpperCase()}`))) {
    category = 'promotions';
    score -= 2;
    isPromotional = true;
  }
  if (labelNames.includes('Important')) {
    score += 2;
  }

  const lowered = (subject + ' ' + snippet).toLowerCase();
  if (IMPORTANT_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
    score += 2;
    category = 'orders';
  }
  if (PROMO_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
    score -= 1;
    isPromotional = true;
  }
  if (/noreply|no-reply|notification/i.test(sender)) {
    score -= 1;
  }

  return { importanceScore: score, category, isPromotional };
}

function computeExpiry(category: string, referenceDate: Date): Date {
  const base = referenceDate.getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (category === 'primary' || category === 'personal') {
    return new Date(base + 365 * oneDay);
  }
  if (category === 'orders') {
    return new Date(base + 30 * oneDay);
  }
  if (category === 'promotions') {
    return new Date(base + 7 * oneDay);
  }

  return new Date(base + 30 * oneDay);
}
