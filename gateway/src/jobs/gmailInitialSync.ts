import { fetchRecentThreads, NO_GMAIL_TOKENS, estimateThreadCount, GMAIL_JOBS_DISABLED } from '../services/gmailClient';
import {
  getGmailSyncMetadata,
  markInitialGmailSync,
  getGmailTokens,
  setGmailOnboardingStatus
} from '../services/db';
import { areGmailJobsDisabled } from '../services/gmailJobControl';
import { emitGmailStatusUpdate } from '../services/gmailStatus';

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_SYNC_LOOKBACK_DAYS = parseInt(process.env.GMAIL_INITIAL_SYNC_DAYS || '365', 10);
const INITIAL_SYNC_PAGE_SIZE = parseInt(process.env.GMAIL_INITIAL_SYNC_PAGE_SIZE || '100', 10);

/** Ingestion order: 1) main account sent (1y), 2) main account inbox (1y). Other accounts (service accounts) are synced separately. */
type SyncPhase = 'sent' | 'inbox';

type SyncAbortReason = 'disabled' | 'no-tokens';

async function resolveSyncAbortReason(userId: string): Promise<SyncAbortReason | null> {
  if (areGmailJobsDisabled(userId)) {
    return 'disabled';
  }
  const tokens = await getGmailTokens(userId);
  if (!tokens) {
    return 'no-tokens';
  }
  return null;
}

function describeAbortReason(reason: SyncAbortReason): string {
  if (reason === 'disabled') {
    return 'Gmail jobs disabled';
  }
  return 'Gmail tokens missing';
}

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
    let abortReason: SyncAbortReason | null = null;
    const shouldAbort = async (stage: string): Promise<boolean> => {
      if (abortReason) {
        return true;
      }
      const reason = await resolveSyncAbortReason(userId);
      if (reason) {
        abortReason = reason;
        console.info(
          `[Gmail Sync] Aborting initial sync for user ${userId} (${stage}) - ${describeAbortReason(reason)}`
        );
        return true;
      }
      return false;
    };

    if (await shouldAbort('initialization')) {
      return;
    }

    const dateFilters = {
      startDate: formatGmailDate(start),
      endDate: formatGmailDate(now),
      importanceOnly: false
    };
    const [sentEst, inboxEst] = await Promise.all([
      estimateThreadCount(userId, { ...dateFilters, mailbox: 'sent' }).catch(() => null),
      estimateThreadCount(userId, { ...dateFilters, mailbox: 'inbox' }).catch(() => null)
    ]);
    const estimatedTotal = (sentEst ?? 0) + (inboxEst ?? 0);
    if (sentEst != null || inboxEst != null) {
      console.log(
        `[Gmail Sync] Estimated for user ${userId}: sent=${sentEst ?? '?'} inbox=${inboxEst ?? '?'} total=${estimatedTotal}`
      );
    } else {
      console.log(`[Gmail Sync] Could not determine thread estimate for user ${userId}`);
    }

    if (await shouldAbort('pre-sync state update')) {
      return;
    }

    await markInitialGmailSync(userId, {
      started: true,
      completed: false,
      totalThreads: estimatedTotal || 0,
      syncedThreads: 0
    });
    void emitGmailStatusUpdate(userId);

    let totalSynced = 0;

    const runPhase = async (phase: SyncPhase) => {
      let pageToken: string | undefined;
      let phaseSynced = 0;
      do {
        if (await shouldAbort(`before ${phase} batch fetch`)) {
          break;
        }
        const result = await fetchRecentThreads(userId, INITIAL_SYNC_PAGE_SIZE, {
          maxResults: INITIAL_SYNC_PAGE_SIZE,
          ...dateFilters,
          mailbox: phase,
          pageToken
        });
        if (await shouldAbort(`before ${phase} batch progress update`)) {
          break;
        }
        phaseSynced += result.threads.length;
        totalSynced += result.threads.length;
        await markInitialGmailSync(userId, { syncedThreads: totalSynced });
        void emitGmailStatusUpdate(userId);
        const denom = estimatedTotal || result.resultSizeEstimate || 0;
        if (denom) {
          console.log(
            `[Gmail Sync] user ${userId} ${phase} synced ${totalSynced}/${denom} (batch ${result.threads.length})`
          );
        } else {
          console.log(`[Gmail Sync] user ${userId} ${phase} synced ${phaseSynced} (batch ${result.threads.length})`);
        }
        pageToken = result.nextPageToken;
      } while (pageToken);
    };

    console.log(`[Gmail Sync] user ${userId} phase 1: sent (last ${INITIAL_SYNC_LOOKBACK_DAYS} days)`);
    await runPhase('sent');
    if (await shouldAbort('between phases')) {
      return;
    }
    console.log(`[Gmail Sync] user ${userId} phase 2: inbox (last ${INITIAL_SYNC_LOOKBACK_DAYS} days)`);
    await runPhase('inbox');

    if (abortReason) {
      console.log(
        `[Gmail Sync] Initial sync stopped early for user ${userId} (${describeAbortReason(
          abortReason
        )}, threads=${totalSynced})`
      );
      return;
    }

    if (await shouldAbort('before completion update')) {
      return;
    }

    await markInitialGmailSync(userId, {
      completed: true,
      totalThreads: estimatedTotal ?? totalSynced,
      syncedThreads: totalSynced
    });
    void emitGmailStatusUpdate(userId);
    await setGmailOnboardingStatus(userId, true);
    void emitGmailStatusUpdate(userId);
    console.log(`[Gmail Sync] Initial sync completed for user ${userId} (threads=${totalSynced})`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === NO_GMAIL_TOKENS) {
        console.info(`[Gmail Sync] Initial sync skipped for user ${userId} (no Gmail tokens)`);
        return;
      }
      if (error.message === GMAIL_JOBS_DISABLED) {
        console.info(`[Gmail Sync] Initial sync skipped for user ${userId} (jobs disabled)`);
        return;
      }
    }
    console.error(`[Gmail Sync] Initial sync failed for user ${userId}`, error);
  }
}
