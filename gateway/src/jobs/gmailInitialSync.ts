import { fetchRecentThreads, NO_GMAIL_TOKENS } from '../services/gmailClient';
import { getGmailSyncMetadata, markInitialGmailSync } from '../services/db';

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_SYNC_LOOKBACK_DAYS = parseInt(process.env.GMAIL_INITIAL_SYNC_DAYS || '365', 10);

export function formatGmailDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export async function ensureInitialGmailSync(userId: string): Promise<void> {
  const metadata = await getGmailSyncMetadata(userId);
  if (metadata?.initialSyncCompletedAt) {
    return;
  }
  void runInitialGmailSync(userId);
}

export async function runInitialGmailSync(userId: string): Promise<void> {
  try {
    console.log(`[Gmail Sync] Initial sync started for user ${userId}`);
    await markInitialGmailSync(userId, { started: true, completed: false, totalThreads: 0, syncedThreads: 0 });
    const now = new Date();
    const start = new Date(now.getTime() - INITIAL_SYNC_LOOKBACK_DAYS * DAY_MS);
    let pageToken: string | undefined;
    let totalSynced = 0;
    let totalEstimate: number | null = null;
    do {
      const result = await fetchRecentThreads(userId, 1000, {
        maxResults: 1000,
        startDate: formatGmailDate(start),
        endDate: formatGmailDate(now),
        pageToken,
        importanceOnly: false
      });
      if (totalEstimate === null && typeof result.resultSizeEstimate === 'number') {
        totalEstimate = result.resultSizeEstimate;
        await markInitialGmailSync(userId, { totalThreads: totalEstimate });
      }
      totalSynced += result.threads.length;
      await markInitialGmailSync(userId, { syncedThreads: totalSynced });
      pageToken = result.nextPageToken;
    } while (pageToken);
    await markInitialGmailSync(userId, {
      completed: true,
      totalThreads: totalEstimate ?? totalSynced,
      syncedThreads: totalSynced
    });
    console.log(`[Gmail Sync] Initial sync completed for user ${userId} (threads=${totalSynced})`);
  } catch (error) {
    if (error instanceof Error && error.message === NO_GMAIL_TOKENS) {
      console.info(`[Gmail Sync] Initial sync skipped for user ${userId} (no Gmail tokens)`);
      return;
    }
    console.error(`[Gmail Sync] Initial sync failed for user ${userId}`, error);
  }
}
