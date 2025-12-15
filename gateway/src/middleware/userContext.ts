import type { NextFunction, Request, Response } from 'express';
import { ensureSessionUser } from '../services/userService';
import { sessionHelpers } from './session';

/**
 * Simplified user context middleware using express-session
 * Replaces 100+ lines of custom JWT/fingerprinting code
 */

// Paths that don't require user context
const SKIP_PATH_PREFIXES = [
  '/api/gmail/callback',
  '/health',
  '/ready'
];

// Paths that require authentication
const PROTECTED_PATHS = [
  '/api/chat',
  '/api/profile',
  '/api/memory', 
  '/api/graph',
  '/api/gmail/threads',
  '/api/gmail/disconnect',
  '/api/gmail/status'
];

function shouldSkipUserContext(path: string): boolean {
  return SKIP_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
}

function requiresAuthentication(path: string): boolean {
  return PROTECTED_PATHS.some(protectedPath => path.startsWith(protectedPath));
}

function hasInternalAccess(req: Request): boolean {
  const token = req.header('x-internal-secret');
  return token === process.env.INTERNAL_API_KEY;
}

export async function attachUserContext(req: Request, res: Response, next: NextFunction) {
  try {
    // Skip user context for certain paths
    if (shouldSkipUserContext(req.path)) {
      return next();
    }
    
    // Handle internal API calls
    if (hasInternalAccess(req)) {
      const headerUserId = req.header('x-user-id');
      const queryUserId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
      const bodyUserId =
        req.body && typeof req.body === 'object' && typeof (req.body as any).user_id === 'string'
          ? (req.body as any).user_id
          : undefined;
      const internalUserId = headerUserId || queryUserId || bodyUserId;

      if (internalUserId) {
        req.userId = internalUserId;
        console.log(`[Auth] Internal API call to ${req.path} (user: ${internalUserId})`);
      } else {
        console.warn(`[Auth] Internal API call to ${req.path} without user context`);
      }
      return next();
    }
    
    // Get user ID from session
    const userId = await ensureSessionUser(req, res);
    
    // Check if authentication is required
    const authRequired = requiresAuthentication(req.path);
    
    if (authRequired && !userId) {
      console.warn(`[Auth] Authentication required for ${req.method} ${req.path}`);
      return res.status(401).json({
        error: 'Authentication required',
        path: req.path,
        timestamp: new Date().toISOString()
      });
    }
    
    // Attach user ID to request
    if (userId) {
      req.userId = userId;
      console.log(`[Auth] Session validated for user: ${userId}`);
    }
    
    next();
  } catch (error) {
    console.error('[Auth] User context error:', error);
    
    // For protected paths, return auth error
    if (requiresAuthentication(req.path)) {
      return res.status(401).json({
        error: 'Authentication failed',
        timestamp: new Date().toISOString()
      });
    }
    
    // For non-protected paths, continue without user context
    next();
  }
}
