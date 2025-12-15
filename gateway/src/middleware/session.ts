import session from 'express-session';
import { config } from '../config';

/**
 * Production session management using express-session
 * Replaces 200+ lines of custom JWT code with proven solution
 */

export const sessionConfig = session({
  name: config.sessionCookieName,
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Fix: Disable secure cookies for development
    httpOnly: true,
    maxAge: config.sessionMaxAge,
    sameSite: 'lax', // Fix: Use 'lax' for development compatibility
    domain: config.isProduction ? config.sessionCookieDomain : 'localhost', // Fix: Share cookies across localhost subdomains
  },
  // In production: add Redis store here
  // store: new RedisStore({ client: redisClient })
});

/**
 * Simple session helpers - no complex fingerprinting needed
 */
export const sessionHelpers = {
  setUserId: (req: any, userId: string) => {
    req.session.userId = userId;
  },
  
  getUserId: (req: any): string | undefined => {
    return req.session?.userId;
  },
  
  destroySession: (req: any, callback?: (err?: any) => void) => {
    req.session.destroy(callback || (() => {}));
  },
};