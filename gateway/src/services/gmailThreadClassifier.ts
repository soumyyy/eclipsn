export type MailboxFilter = 'inbox' | 'sent';

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

export function mapLabelIds(ids: string[]): string[] {
  return ids
    .filter(Boolean)
    .map((id) => LABEL_NAME_MAP[id] || id.replace('CATEGORY_', '').toLowerCase());
}

export function scoreThread(subject: string, snippet: string, sender: string, labelNames: string[]) {
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

export function computeExpiry(category: string, referenceDate: Date): Date {
  const base = referenceDate.getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (category === 'promotions') {
    return new Date(base + 30 * oneDay);
  }

  return new Date(base + 365 * oneDay);
}

export function buildQuery(
  startDate?: string,
  endDate?: string,
  importanceOnly = true,
  mailbox?: MailboxFilter
) {
  const parts: string[] = [];
  if (startDate) {
    parts.push(`after:${startDate}`);
  }
  if (endDate) {
    parts.push(`before:${endDate}`);
  }
  if (mailbox === 'sent') {
    parts.push('in:sent');
  }
  if (mailbox === 'inbox') {
    parts.push('in:inbox');
  }
  if (importanceOnly) {
    parts.push('category:primary OR label:important');
  }
  return parts.join(' ');
}
