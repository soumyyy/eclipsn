import cron from 'node-cron';
import { fetchRecentThreads } from '../services/gmailClient';
import { removeExpiredGmailThreads } from '../services/db';
import { TEST_USER_ID } from '../constants';

async function runIncrementalSync(windowMinutes: number) {
  const query = `newer_than:${windowMinutes}m (category:primary OR label:important)`;
  try {
    const result = await fetchRecentThreads(TEST_USER_ID, 200, {
      customQuery: query,
      importanceOnly: false
    });
    console.log(
      `[Gmail Sync] Incremental sync fetched ${result.threads.length} threads (categories:`,
      result.counts,
      ')'
    );
  } catch (error) {
    console.error('[Gmail Sync] Incremental sync failed', error);
  }
}

async function runCleanup() {
  try {
    await removeExpiredGmailThreads(TEST_USER_ID);
    console.log('[Gmail Cleanup] Removed expired Gmail threads');
  } catch (error) {
    console.error('[Gmail Cleanup] Failed to remove expired threads', error);
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
