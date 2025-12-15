import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import {
  ensureUserRecord,
  attachGmailIdentity as attachGmailIdentityDb,
  deleteUserAccount as deleteUserAccountDb,
  isValidUUID
} from './db';

const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const USER_COOKIE_SOURCE = 'oauth';

interface SessionTicket {
  userId: string;
}

function parseSessionTicket(raw: string | undefined): SessionTicket | null {
  if (!raw) return null;
  if (!isValidUUID(raw)) return null;
  return { userId: raw };
}

function createSessionTicket(userId: string): string {
  return userId;
}

function setSessionCookie(res: Response, userId: string) {
  res.cookie(config.sessionCookieName, createSessionTicket(userId), {
    httpOnly: true,
    sameSite: config.sessionCookieSameSite,
    secure: config.sessionCookieSecure,
    domain: config.sessionCookieDomain,
    maxAge: COOKIE_MAX_AGE_MS
  });
}

export async function ensureSessionUser(
  req: Request,
  res: Response,
  options?: { explicitUserId?: string }
): Promise<string | undefined> {
  if (options?.explicitUserId) {
    await ensureUserRecord(options.explicitUserId);
    return options.explicitUserId;
  }

  const ticket = parseSessionTicket(
    typeof req.cookies?.[config.sessionCookieName] === 'string'
      ? (req.cookies[config.sessionCookieName] as string)
      : undefined
  );
  if (ticket) {
    await ensureUserRecord(ticket.userId);
    return ticket.userId;
  }

  return undefined;
}

export async function establishSession(res: Response, userId: string) {
  await ensureUserRecord(userId);
  setSessionCookie(res, userId);
}

export async function attachGmailIdentity(userId: string, gmailEmail: string) {
  await ensureUserRecord(userId);
  await attachGmailIdentityDb(userId, gmailEmail);
}

export async function deleteAccount(userId: string, res: Response) {
  await deleteUserAccountDb(userId);
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: config.sessionCookieSameSite,
    secure: config.sessionCookieSecure,
    domain: config.sessionCookieDomain,
    path: '/'
  });
}
