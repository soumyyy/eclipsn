import { fetchRecentThreads, NO_GMAIL_TOKENS, estimateThreadCount } from '../services/gmailClient';
import { getGmailSyncMetadata, markInitialGmailSync, getGmailTokens } from '../services/db';

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_SYNC_LOOKBACK_DAYS = parseInt(process.env.GMAIL_INITIAL_SYNC_DAYS || '365', 10);

export function formatGmailDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export async function ensureInitialGmailSync(userId: string): Promise<void> {
  const tokens = await getGmailTokens(userId);
  if (!tokens) {
    return;
  }
  const metadata = await getGmailSyncMetadata(userId);
  if (metadata?.initialSyncCompletedAt) {
    return;
  }
  void runInitialGmailSync(userId);
}

export async function runInitialGmailSync(userId: string): Promise<void> {
  try {
    console.log(`[Gmail Sync] Initial sync started for user ${userId}`);
    const now = new Date();
    const start = new Date(now.getTime() - INITIAL_SYNC_LOOKBACK_DAYS * DAY_MS);
    const estimatedTotal = await estimateThreadCount(userId, {
      startDate: formatGmailDate(start),
      endDate: formatGmailDate(now),
      importanceOnly: false
    }).catch(() => null);
    if (estimatedTotal) {
      console.log(`[Gmail Sync] Estimated ${estimatedTotal} threads for user ${userId}`);
    } else {
      console.log(`[Gmail Sync] Could not determine thread estimate for user ${userId}`);
    }
    await markInitialGmailSync(userId, {
      started: true,
      completed: false,
      totalThreads: estimatedTotal ?? 0,
      syncedThreads: 0
    });
    let pageToken: string | undefined;
    let totalSynced = 0;
    do {
      const result = await fetchRecentThreads(userId, 1000, {
        maxResults: 1000,
        startDate: formatGmailDate(start),
        endDate: formatGmailDate(now),
        pageToken,
        importanceOnly: false
      });
      totalSynced += result.threads.length;
      await markInitialGmailSync(userId, { syncedThreads: totalSynced });
      const denom = estimatedTotal ?? result.resultSizeEstimate ?? 0;
      if (denom) {
        console.log(
          `[Gmail Sync] user ${userId} synced ${Math.min(totalSynced, denom)}/${denom} threads (batch ${result.threads.length})`
        );
      } else {
        console.log(`[Gmail Sync] user ${userId} synced ${totalSynced} threads (indeterminate total)`);
      }
      pageToken = result.nextPageToken;
    } while (pageToken);
    await markInitialGmailSync(userId, {
      completed: true,
      totalThreads: estimatedTotal ?? totalSynced,
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
