import cron from 'node-cron';
import { fetchRecentThreads, GMAIL_JOBS_DISABLED } from '../services/gmailClient';
import { listUsersWithGmailTokens, removeExpiredGmailThreads } from '../services/db';
import { areGmailJobsDisabled } from '../services/gmailJobControl';

async function runIncrementalSync(windowMinutes: number) {
  const query = `newer_than:${windowMinutes}m (category:primary OR label:important)`;
  const userIds = await listUsersWithGmailTokens();
  if (!userIds.length) {
    console.log('[Gmail Sync] Skipping incremental sync (no connected users)');
    return;
  }
  for (const userId of userIds) {
    if (areGmailJobsDisabled(userId)) {
      console.log(`[Gmail Sync] Skipping incremental sync for user ${userId} (jobs disabled)`);
      continue;
    }
    try {
      const result = await fetchRecentThreads(userId, 200, {
        customQuery: query,
        importanceOnly: false
      });
      console.log(
        `[Gmail Sync] Incremental sync fetched ${result.threads.length} threads for user ${userId} (categories:`,
        result.counts,
        ')'
      );
    } catch (error) {
      if (error instanceof Error && error.message === GMAIL_JOBS_DISABLED) {
        console.info(`[Gmail Sync] Incremental sync aborted for user ${userId} (jobs disabled)`);
        continue;
      }
      console.error(`[Gmail Sync] Incremental sync failed for user ${userId}`, error);
    }
  }
}

async function runCleanup() {
  const userIds = await listUsersWithGmailTokens();
  if (!userIds.length) {
    console.log('[Gmail Cleanup] Skipping cleanup (no connected users)');
    return;
  }
  for (const userId of userIds) {
    if (areGmailJobsDisabled(userId)) {
      console.log('[Gmail Cleanup] Skipping cleanup (jobs disabled) for user', userId);
      continue;
    }
    try {
      await removeExpiredGmailThreads(userId);
      console.log('[Gmail Cleanup] Removed expired Gmail threads for user', userId);
    } catch (error) {
      console.error('[Gmail Cleanup] Failed to remove expired threads for user', userId, error);
    }
  }
}

export function scheduleGmailJobs() {
  cron.schedule('*/10 * * * *', () => {
    runIncrementalSync(10);
  });

  cron.schedule('0 0 * * *', () => {
    runCleanup();
  });

  console.log('[Gmail Jobs] Scheduled incremental sync and cleanup');
}
