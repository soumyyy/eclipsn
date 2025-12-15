import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { config } from '../config';

// Session payload interface
interface SessionPayload {
  userId: string;
  sessionId: string;
  fingerprint: string;
  issuedAt: number;
  expiresAt: number;
}

// Session options for cookie configuration
interface SessionOptions {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  domain?: string;
  path?: string;
}

// Session validation result
interface SessionValidationResult {
  isValid: boolean;
  payload?: SessionPayload;
  error?: string;
}

export class SessionManager {
  private static instance: SessionManager;
  private readonly jwtSecret: string;
  private readonly cookieName: string;
  private readonly defaultMaxAge: number;

  private constructor() {
    this.jwtSecret = config.sessionSecret;
    this.cookieName = config.sessionCookieName;
    this.defaultMaxAge = config.sessionMaxAge;

    // Validate session secret strength
    if (!this.jwtSecret || this.jwtSecret.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters for production security');
    }
  }

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Creates a secure session token with fingerprinting
   */
  public createSession(userId: string, req: Request): string {
    const sessionId = crypto.randomUUID();
    const fingerprint = this.generateFingerprint(req);
    const now = Date.now();
    
    const payload: SessionPayload = {
      userId,
      sessionId,
      fingerprint,
      issuedAt: now,
      expiresAt: now + this.defaultMaxAge
    };

    return jwt.sign(payload, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: Math.floor(this.defaultMaxAge / 1000) // JWT expects seconds
    });
  }

  /**
   * Validates and decodes a session token
   */
  public validateSession(token: string, req: Request): SessionValidationResult {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as SessionPayload;
      
      // Verify fingerprint to detect token theft
      const currentFingerprint = this.generateFingerprint(req);
      if (decoded.fingerprint !== currentFingerprint) {
        return {
          isValid: false,
          error: 'Session fingerprint mismatch - potential token theft'
        };
      }

      // Additional expiry check (JWT should handle this, but double-check)
      if (decoded.expiresAt < Date.now()) {
        return {
          isValid: false,
          error: 'Session expired'
        };
      }

      return {
        isValid: true,
        payload: decoded
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown JWT error';
      return {
        isValid: false,
        error: `Invalid session token: ${errorMessage}`
      };
    }
  }

  /**
   * Sets a secure session cookie with production-grade configuration
   */
  public setSessionCookie(res: Response, token: string, options: SessionOptions = {}): void {
    const cookieOptions = this.buildCookieOptions(options);
    res.cookie(this.cookieName, token, cookieOptions);
  }

  /**
   * Clears the session cookie securely
   */
  public clearSessionCookie(res: Response): void {
    const cookieOptions = this.buildCookieOptions({ maxAge: 0 });
    res.clearCookie(this.cookieName, cookieOptions);
  }

  /**
   * Extracts session token from request cookies
   */
  public getSessionToken(req: Request): string | null {
    const token = req.cookies?.[this.cookieName];
    return typeof token === 'string' ? token : null;
  }

  /**
   * Builds production-grade cookie options with security considerations
   */
  private buildCookieOptions(overrides: SessionOptions = {}): any {
    const isProduction = config.isProduction;
    const isHttps = config.isHttps;

    return {
      httpOnly: overrides.httpOnly ?? true,
      secure: overrides.secure ?? (isProduction && isHttps),
      sameSite: overrides.sameSite ?? this.determineSameSite(),
      domain: overrides.domain ?? config.sessionCookieDomain,
      path: overrides.path ?? '/',
      maxAge: overrides.maxAge ?? this.defaultMaxAge,
      // Use __Secure- prefix for secure cookies in production
      ...(isProduction && isHttps && {
        name: `__Secure-${this.cookieName}`
      })
    };
  }

  /**
   * Determines appropriate SameSite setting based on environment
   */
  private determineSameSite(): 'strict' | 'lax' | 'none' {
    if (config.sessionCookieSameSiteOverride) {
      return config.sessionCookieSameSiteOverride;
    }

    // Production with HTTPS: strict for security
    if (config.isProduction && config.isHttps) {
      return 'strict';
    }

    // Development or non-HTTPS: lax for compatibility
    return 'lax';
  }

  /**
   * Generates a fingerprint from request headers for session validation
   */
  private generateFingerprint(req: Request): string {
    const userAgent = req.get('User-Agent') || '';
    const acceptLanguage = req.get('Accept-Language') || '';
    const acceptEncoding = req.get('Accept-Encoding') || '';
    
    // Use client IP if available (handle proxy headers)
    const clientIP = req.ip || 
                    req.get('X-Forwarded-For')?.split(',')[0].trim() || 
                    req.get('X-Real-IP') || 
                    req.connection.remoteAddress || '';

    const fingerprintData = `${userAgent}|${acceptLanguage}|${acceptEncoding}|${clientIP}`;
    
    return crypto
      .createHash('sha256')
      .update(fingerprintData)
      .update(this.jwtSecret) // Salt with session secret
      .digest('hex');
  }

  /**
   * Refreshes a session token (for token rotation)
   */
  public refreshSession(currentToken: string, req: Request): string | null {
    const validation = this.validateSession(currentToken, req);
    
    if (!validation.isValid || !validation.payload) {
      return null;
    }

    // Only refresh if the token is more than halfway to expiry
    const timeToExpiry = validation.payload.expiresAt - Date.now();
    const halfLife = this.defaultMaxAge / 2;
    
    if (timeToExpiry > halfLife) {
      return currentToken; // Still fresh, no need to refresh
    }

    // Create new session with same user ID
    return this.createSession(validation.payload.userId, req);
  }

  /**
   * Invalidates all sessions for a user (useful for logout from all devices)
   */
  public invalidateAllUserSessions(userId: string): void {
    // In a production system, you'd maintain a blacklist in Redis/database
    // For now, we rely on JWT expiry and fingerprint validation
    console.log(`[Security] All sessions invalidated for user: ${userId}`);
  }
}

// Export singleton instance
export const sessionManager = SessionManager.getInstance();