import { google } from 'googleapis';
import { config } from '../config';
import {
  getGmailTokens,
  saveGmailTokens,
  saveGmailThreads,
  GmailThreadRecord,
  upsertGmailEmbedding,
  getGmailThreadBody,
  upsertGmailThreadBody,
  getGmailThreadMetadata,
  getGmailThreadMetadataByGmailId,
  deleteGmailTokens
} from './db';
import { embedEmailText } from './embeddings';
import { areGmailJobsDisabled } from './gmailJobControl';
import { emitGmailStatusUpdate } from './gmailStatus';

export const NO_GMAIL_TOKENS = 'NO_GMAIL_TOKENS';
export const GMAIL_JOBS_DISABLED = 'GMAIL_JOBS_DISABLED';
const THREAD_METADATA_WORKERS = Math.max(
  1,
  parseInt(process.env.GMAIL_THREAD_METADATA_WORKERS || '5', 10)
);

export interface GmailThreadSummary extends GmailThreadRecord {
  link: string;
  sender?: string;
  importanceScore?: number;
  category?: string;
  labelIds?: string[];
  labelNames?: string[];
}

async function ensureGmailUserStillActive(userId: string): Promise<void> {
  if (areGmailJobsDisabled(userId)) {
    const error = new Error(GMAIL_JOBS_DISABLED);
    error.name = GMAIL_JOBS_DISABLED;
    throw error;
  }
  const tokens = await getGmailTokens(userId);
  if (!tokens) {
    const noTokens = new Error(NO_GMAIL_TOKENS);
    noTokens.name = NO_GMAIL_TOKENS;
    throw noTokens;
  }
}

async function getAuthorizedOAuthClient(userId: string) {
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

  return oauth2Client;
}

async function getAuthorizedGmail(userId: string) {
  const oauth2Client = await getAuthorizedOAuthClient(userId);
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

export interface FetchThreadsResult {
  threads: GmailThreadSummary[];
  nextPageToken?: string;
  counts: Record<string, number>;
  resultSizeEstimate?: number;
}

export async function estimateThreadCount(
  userId: string,
  filters: ThreadFilters = {}
): Promise<number | null> {
  try {
    const gmail = await getAuthorizedGmail(userId);
    const query = filters.customQuery
      ? filters.customQuery
      : buildQuery(filters.startDate, filters.endDate, filters.importanceOnly !== false);
    const response = await gmail.users.threads.list({
      userId: 'me',
      maxResults: 1,
      q: query
    });
    const estimate = response.data.resultSizeEstimate;
    return typeof estimate === 'number' ? estimate : null;
  } catch (error) {
    await handleGmailAuthError(userId, error);
    throw error;
  }
}

export async function fetchRecentThreads(
  userId: string,
  maxResults = 20,
  filters: ThreadFilters = {}
): Promise<FetchThreadsResult> {
  try {
    await ensureGmailUserStillActive(userId);
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
    const resultSizeEstimate =
      typeof threadList.data.resultSizeEstimate === 'number' ? threadList.data.resultSizeEstimate : undefined;
    const counts: Record<string, number> = {};
    const threadEntries = threadList.data.threads?.map((thread, index) => ({ thread, index })) ?? [];

    if (!threadEntries.length) {
      console.log(`[Gmail Sync] Gmail returned 0 threads for user ${userId} (pageToken=${filters.pageToken ?? 'start'})`);
      return { threads: [], nextPageToken: threadList.data.nextPageToken ?? undefined, counts, resultSizeEstimate };
    }

    console.log(
      `[Gmail Sync] Preparing metadata for ${threadEntries.length} Gmail threads for user ${userId} (pageToken=${filters.pageToken ?? 'start'})`
    );

    const summarySlots: Array<GmailThreadSummary | null> = new Array(threadEntries.length).fill(null);
    let skippedThreads = 0;

    async function buildSummary(entry: { thread: any; index: number }) {
      const { thread, index } = entry;
      if (!thread.id) {
        skippedThreads += 1;
        return;
      }
      try {
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
        const lastMessageAt = lastMessage?.internalDate ? new Date(Number(lastMessage.internalDate)) : undefined;
        const labelIds = lastMessage?.labelIds || detail.data.messages?.[0]?.labelIds || [];
        const labelNames = mapLabelIds(labelIds);
        const { importanceScore, category, isPromotional } = scoreThread(subject, snippet, sender, labelNames || []);

        if (filters.importanceOnly && isPromotional) {
          skippedThreads += 1;
          return;
        }

        const summary: GmailThreadSummary = {
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
        };
        summarySlots[index] = summary;
        counts[category] = (counts[category] || 0) + 1;
      } catch (threadError) {
        skippedThreads += 1;
        console.error(`[Gmail Sync] Failed to fetch Gmail thread ${thread.id} for user ${userId}`, threadError);
      }
    }

    const queue = [...threadEntries];
    async function runWorker() {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        await buildSummary(next);
      }
    }

    const workerCount = Math.min(THREAD_METADATA_WORKERS, queue.length);
    await Promise.all(Array.from({ length: workerCount || 1 }, () => runWorker()));

    const summaries = summarySlots.filter((item): item is GmailThreadSummary => Boolean(item));

    console.log(
      `[Gmail Sync] Processed ${summaries.length}/${threadEntries.length} Gmail threads for user ${userId} (skipped ${skippedThreads})`
    );

    await ensureGmailUserStillActive(userId);
    const rowIds = await saveGmailThreads(userId, summaries);
    await ensureGmailUserStillActive(userId);
    const persisted = rowIds.filter((id) => Boolean(id)).length;
    console.log(`[Gmail Sync] Saved ${persisted}/${summaries.length} Gmail thread rows for user ${userId}`);
    for (let idx = 0; idx < summaries.length; idx += 1) {
      if (areGmailJobsDisabled(userId)) {
        console.info(`[gmail] Skipping remaining Gmail embedding writes for user ${userId} (jobs disabled)`);
        break;
      }
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
    return {
      threads: summaries,
      nextPageToken: threadList.data.nextPageToken ?? undefined,
      counts,
      resultSizeEstimate
    };
  } catch (error) {
    await handleGmailAuthError(userId, error);
    throw error;
  }
}

export async function fetchThreadBody(userId: string, gmailThreadId: string) {
  const metadata = await getGmailThreadMetadataByGmailId(userId, gmailThreadId);
  if (!metadata) {
    throw new Error('Thread not found');
  }
  const cached = await getGmailThreadBody(metadata.id);
  if (cached) {
    return {
      gmailThreadId: metadata.gmailThreadId,
      subject: metadata.subject,
      summary: metadata.summary,
      sender: metadata.sender,
      lastMessageAt: metadata.lastMessageAt,
      body: cached,
      link: `https://mail.google.com/mail/u/0/#inbox/${metadata.gmailThreadId}`
    };
  }

  try {
    const gmail = await getAuthorizedGmail(userId);
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: metadata.gmailThreadId,
      format: 'full'
    });
    const messages = response.data.messages || [];
    let bodyText = '';
    const attachments: Array<{ id: string; messageId: string; filename: string; mimeType: string; size: number }> = [];

    // Process messages (chronological for attachments, reverse for body text priority if needed)
    for (const message of messages) {
      if (message.payload && message.id) {
        const msgAttachments = extractAttachments(message.payload, message.id);
        attachments.push(...msgAttachments);
      }
    }

    for (const message of messages.reverse()) {
      const text = extractPlainText(message.payload);
      if (text) {
        bodyText += text.trim() + '\n\n';
      }
    }
    bodyText = bodyText.trim() || metadata.summary || '';

    // We don't upsert body here if we want to keep it simple, or we proceed usually.
    await upsertGmailThreadBody({ userId, threadRowId: metadata.id, body: bodyText });

    return {
      gmailThreadId: metadata.gmailThreadId,
      subject: metadata.subject,
      summary: metadata.summary,
      sender: metadata.sender,
      lastMessageAt: metadata.lastMessageAt,
      body: bodyText,
      link: `https://mail.google.com/mail/u/0/#inbox/${metadata.gmailThreadId}`,
      attachments
    };
  } catch (error) {
    await handleGmailAuthError(userId, error);
    throw error;
  }
}

function extractAttachments(payload: any, messageId: string): Array<{ id: string; messageId: string; filename: string; mimeType: string; size: number }> {
  const attachments: Array<{ id: string; messageId: string; filename: string; mimeType: string; size: number }> = [];

  if (payload.body?.attachmentId) {
    attachments.push({
      id: payload.body.attachmentId,
      messageId: messageId,
      filename: payload.filename || 'unknown',
      mimeType: payload.mimeType || 'application/octet-stream',
      size: payload.body.size || 0
    });
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      attachments.push(...extractAttachments(part, messageId));
    }
  }

  return attachments;
}

export async function getGmailAttachment(userId: string, messageId: string, attachmentId: string) {
  try {
    const gmail = await getAuthorizedGmail(userId);
    const response = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId
    });
    return response.data;
  } catch (error) {
    await handleGmailAuthError(userId, error);
    throw error;
  }
}

function extractPlainText(payload: any): string {
  if (!payload) return '';
  const { mimeType, body, parts } = payload;
  if (mimeType === 'text/plain' && body?.data) {
    return decodeBase64(body.data);
  }
  if (mimeType === 'text/html' && body?.data) {
    return stripHtml(decodeBase64(body.data));
  }
  if (parts && parts.length) {
    for (const part of parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  if (body?.data) {
    return decodeBase64(body.data);
  }
  return '';
}

function decodeBase64(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

export async function getGmailProfile(userId: string): Promise<{ email: string; avatarUrl: string; name: string }> {
  try {
    const oauthClient = await getAuthorizedOAuthClient(userId);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
    let email = '';
    let avatarUrl = '';
    let name = '';

    try {
      const { data } = await oauth2.userinfo.get();
      email = data.email || '';
      avatarUrl = data.picture || '';
      name = data.name || data.given_name || (email ? email.split('@')[0] : '');
    } catch (error) {
      console.warn('Failed to fetch userinfo profile', error);
      if (isInvalidGrantError(error)) {
        throw error;
      }
    }

    if (!avatarUrl || !name) {
      try {
        const people = google.people({ version: 'v1', auth: oauthClient });
        const { data } = await people.people.get({
          resourceName: 'people/me',
          personFields: 'photos,names'
        });
        if (!avatarUrl) {
          avatarUrl = data.photos?.find((photo) => photo.url)?.url || avatarUrl;
        }
        if (!name) {
          name = data.names?.[0]?.displayName || data.names?.[0]?.givenName || name;
        }
      } catch (error) {
        console.warn('Failed to fetch People API profile', error);
        if (isInvalidGrantError(error)) {
          throw error;
        }
      }
    }

    if (!email || (!avatarUrl && !name)) {
      const gmail = google.gmail({ version: 'v1', auth: oauthClient });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      email = email || profile.data.emailAddress || '';
      if (!name) {
        name = email ? email.split('@')[0] : 'Gmail user';
      }
      if (!avatarUrl && email) {
        avatarUrl = `https://www.google.com/s2/photos/profile/${encodeURIComponent(email)}?sz=96`;
      }
    }

    return { email, avatarUrl, name: name || 'Gmail user' };
  } catch (error) {
    await handleGmailAuthError(userId, error);
    throw error;
  }
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

function extractErrorReason(error: any): string | undefined {
  if (error?.response?.data?.error) {
    return error.response.data.error;
  }
  if (typeof error?.message === 'string' && error.message.includes('invalid_grant')) {
    return 'invalid_grant';
  }
  if (error?.error === 'invalid_grant') {
    return 'invalid_grant';
  }
  return undefined;
}

function isInvalidGrantError(error: unknown): boolean {
  return extractErrorReason(error) === 'invalid_grant';
}

async function handleGmailAuthError(userId: string, error: unknown): Promise<never> {
  if (isInvalidGrantError(error)) {
    console.warn(`[Gmail] OAuth tokens revoked for user ${userId}, removing credentials`);
    try {
      await deleteGmailTokens(userId);
      void emitGmailStatusUpdate(userId);
    } catch (cleanupError) {
      console.warn('[Gmail] Failed to delete invalid tokens', cleanupError);
    }
    const authError = new Error(NO_GMAIL_TOKENS);
    authError.name = NO_GMAIL_TOKENS;
    throw authError;
  }
  throw error instanceof Error ? error : new Error(String(error));
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
