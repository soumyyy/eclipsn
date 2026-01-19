const disabledUsers = new Set<string>();

export function disableGmailJobsForUser(userId: string): void {
  if (!userId) return;
  disabledUsers.add(userId);
}

export function enableGmailJobsForUser(userId: string): void {
  if (!userId) return;
  disabledUsers.delete(userId);
}

export function areGmailJobsDisabled(userId: string): boolean {
  if (!userId) return false;
  return disabledUsers.has(userId);
}
