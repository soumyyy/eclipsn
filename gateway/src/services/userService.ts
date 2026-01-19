import type { Request, Response } from 'express';
import {
  ensureUserRecord,
  attachGmailIdentity as attachGmailIdentityDb,
  deleteUserAccount as deleteUserAccountDb,
  isValidUUID
} from './db';
import { disableGmailJobsForUser } from './gmailJobControl';
import { sessionHelpers } from '../middleware/session';

/**
 * Simple user service using express-session
 * Replaces 200+ lines of custom JWT code with proven session management
 */

export async function ensureSessionUser(
  req: Request,
  res: Response,
  options?: { explicitUserId?: string }
): Promise<string | undefined> {
  try {
    // Handle internal service calls
    if (options?.explicitUserId) {
      if (!isValidUUID(options.explicitUserId)) {
        return undefined;
      }
      await ensureUserRecord(options.explicitUserId);
      return options.explicitUserId;
    }

    // Get user from session
    const userId = sessionHelpers.getUserId(req);
    if (userId) {
      await ensureUserRecord(userId);
      return userId;
    }

    return undefined;
  } catch (error) {
    console.error('[auth] Session error:', error);
    return undefined;
  }
}

export async function establishSession(req: Request, res: Response, userId: string) {
  try {
    if (!isValidUUID(userId)) {
      throw new Error('Invalid user ID');
    }

    await ensureUserRecord(userId);
    sessionHelpers.setUserId(req, userId);
    console.log('[auth] Session established:', userId);
  } catch (error) {
    console.error('[auth] Failed to establish session:', error);
    throw error;
  }
}

export async function attachGmailIdentity(userId: string, gmailEmail: string) {
  await ensureUserRecord(userId);
  await attachGmailIdentityDb(userId, gmailEmail);
}

export async function deleteAccount(userId: string, req: Request, res: Response) {
  try {
    disableGmailJobsForUser(userId);
    await deleteUserAccountDb(userId);
    sessionHelpers.destroySession(req);
    console.log('[auth] Account deleted:', userId);
  } catch (error) {
    console.error('[auth] Delete account failed:', error);
    throw error;
  }
}

export function getSessionUserId(req: Request): string | undefined {
  return sessionHelpers.getUserId(req);
}

export function logoutUser(req: Request, res: Response): void {
  sessionHelpers.destroySession(req);
}
