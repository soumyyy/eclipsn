import type { NextFunction, Response } from 'express';
import { ensureSessionUser } from '../services/userService';
import type { AuthenticatedRequest } from './internalAuth';
import { InternalAuthService } from './internalAuth';

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
  '/api/memories',
  '/api/tasks',
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

function hasInternalHeaders(req: AuthenticatedRequest): boolean {
  return Boolean(req.header('x-internal-secret') || req.header('x-internal-service'));
}

export async function attachUserContext(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Skip user context for certain paths
    if (shouldSkipUserContext(req.path)) {
      return next();
    }
    
    // Handle internal API calls with strict validation
    if (hasInternalHeaders(req)) {
      const context = InternalAuthService.validateRequest(req);
      if (!context) {
        console.warn(`[Auth] Internal authentication failed for ${req.method} ${req.path}`);
        return res.status(401).json({
          error: 'Internal authentication required',
          code: 'INTERNAL_AUTH_FAILED',
          timestamp: new Date().toISOString()
        });
      }

      req.internal = context;

      if (context.userId) {
        req.userId = context.userId;
        console.log(
          `[Auth] Internal API call to ${req.path} (service: ${context.serviceId}, user: ${context.userId})`
        );
      } else {
        console.warn(
          `[Auth] Internal API call to ${req.path} (service: ${context.serviceId}) without user context`
        );
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
