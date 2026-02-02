import { getServiceAccounts } from './db';
import { getAuthorizedServiceGmail } from './serviceAccountClient';
import { buildQuery, computeExpiry, mapLabelIds, scoreThread, type MailboxFilter } from './gmailThreadClassifier';

const THREAD_METADATA_WORKERS = Math.max(
  1,
  parseInt(process.env.SERVICE_ACCOUNT_THREAD_WORKERS || '4', 10)
);

export interface ServiceAccountThreadSummary {
  accountId: string;
  accountEmail: string;
  threadId: string;
  subject: string;
  summary: string;
  sender: string;
  category: string;
  lastMessageAt: Date | null;
  mailbox: MailboxFilter | null;
  expiresAt: Date | null;
}

function formatGmailDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

async function fetchThreadSummariesForAccount(params: {
  accountId: string;
  accountEmail: string;
  mailbox: MailboxFilter;
  startDate: Date;
  endDate: Date;
  limit: number;
}): Promise<ServiceAccountThreadSummary[]> {
  const gmail = await getAuthorizedServiceGmail(params.accountId);
  const query = buildQuery(formatGmailDate(params.startDate), formatGmailDate(params.endDate), false, params.mailbox);
  const threadList = await gmail.users.threads.list({
    userId: 'me',
    maxResults: Math.min(params.limit, 500),
    q: query
  });
  const threadEntries = threadList.data.threads?.map((thread, index) => ({ thread, index })) ?? [];
  if (!threadEntries.length) return [];

  const summarySlots: Array<ServiceAccountThreadSummary | null> = new Array(threadEntries.length).fill(null);
  const queue = [...threadEntries];

  async function buildSummary(entry: { thread: any; index: number }) {
    const { thread, index } = entry;
    if (!thread.id) return;
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
    const lastMessageAt = lastMessage?.internalDate ? new Date(Number(lastMessage.internalDate)) : null;
    const labelIds = lastMessage?.labelIds || detail.data.messages?.[0]?.labelIds || [];
    const labelNames = mapLabelIds(labelIds);
    const { category } = scoreThread(subject, snippet, sender, labelNames || []);
    const expiresAt = lastMessageAt ? computeExpiry(category, lastMessageAt) : null;

    summarySlots[index] = {
      accountId: params.accountId,
      accountEmail: params.accountEmail,
      threadId: thread.id,
      subject,
      summary: snippet,
      sender,
      category,
      lastMessageAt,
      mailbox: params.mailbox,
      expiresAt
    };
  }

  async function runWorker() {
    while (queue.length) {
      const next = queue.shift();
      if (!next) break;
      await buildSummary(next);
    }
  }

  const workerCount = Math.min(THREAD_METADATA_WORKERS, queue.length);
  await Promise.all(Array.from({ length: workerCount || 1 }, () => runWorker()));

  return summarySlots.filter((item): item is ServiceAccountThreadSummary => Boolean(item));
}

export async function listServiceAccountThreadSummaries(params: {
  userId: string;
  lookbackDays?: number;
  limitPerAccount?: number;
}): Promise<ServiceAccountThreadSummary[]> {
  const lookbackDays = params.lookbackDays ?? 365;
  const limitPerAccount = params.limitPerAccount ?? 200;
  const accounts = await getServiceAccounts(params.userId);
  if (!accounts.length) return [];

  const now = new Date();
  const start = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const summaries: ServiceAccountThreadSummary[] = [];

  for (const account of accounts) {
    const [sent, inbox] = await Promise.all([
      fetchThreadSummariesForAccount({
        accountId: account.id,
        accountEmail: account.email,
        mailbox: 'sent',
        startDate: start,
        endDate: now,
        limit: limitPerAccount
      }).catch(() => []),
      fetchThreadSummariesForAccount({
        accountId: account.id,
        accountEmail: account.email,
        mailbox: 'inbox',
        startDate: start,
        endDate: now,
        limit: limitPerAccount
      }).catch(() => [])
    ]);
    summaries.push(...sent, ...inbox);
  }

  return summaries;
}
