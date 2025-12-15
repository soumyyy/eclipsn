import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ensureSessionUser } from '../services/userService';
import { isValidUUID } from '../services/db';

const SKIP_PATH_PREFIXES = ['/api/gmail/callback'];

function extractExplicitUserId(req: Request): string | undefined {
  const queryId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
  if (isValidUUID(queryId)) return queryId;
  if (req.body && typeof req.body === 'object' && req.body !== null) {
    const bodyId = (req.body as Record<string, unknown>).user_id;
    if (typeof bodyId === 'string' && isValidUUID(bodyId)) {
      return bodyId;
    }
  }
  return undefined;
}

function hasInternalAccess(req: Request): boolean {
  if (!config.internalApiKey) return false;
  const token = req.header('x-internal-secret');
  return typeof token === 'string' && token === config.internalApiKey;
}

export async function attachUserContext(req: Request, res: Response, next: NextFunction) {
  try {
    if (SKIP_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      return next();
    }
    const explicitId = extractExplicitUserId(req);
    const explicitAllowed = explicitId && hasInternalAccess(req);
    const userId = await ensureSessionUser(req, res, {
      explicitUserId: explicitAllowed ? explicitId : undefined
    });
    if (!userId && !explicitAllowed) {
      console.warn(`[auth] No session for ${req.method} ${req.path}`, { cookies: req.headers.cookie });
    }
    if (userId) {
      req.userId = userId;
    }
    next();
  } catch (error) {
    next(error);
  }
}
