import path from 'node:path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const isProduction = process.env.NODE_ENV === 'production';
const isHttps = process.env.HTTPS === 'true' || process.env.NODE_ENV === 'production';

// Validate environment configuration
function validateEnvironment() {
  const errors: string[] = [];

  if (isProduction) {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      errors.push('SESSION_SECRET must be at least 32 characters in production');
    }
    if (!process.env.DATABASE_URL) {
      errors.push('DATABASE_URL is required in production');
    }
    if (!process.env.GMAIL_TOKEN_ENC_KEY || process.env.GMAIL_TOKEN_ENC_KEY.length < 32) {
      errors.push('GMAIL_TOKEN_ENC_KEY is required in production (32+ hex characters)');
    }
    if (!isHttps) {
      console.warn('⚠️  HTTPS not detected in production - cookies may not work properly');
    }
    if (!process.env.UPSTASH_REDIS_URL && !process.env.REDIS_URL) {
      console.warn('⚠️  Redis URL not configured; sessions will be in-memory only');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }
}

function resolveSameSite(): 'lax' | 'strict' | 'none' {
  const override = (process.env.USER_COOKIE_SAMESITE || '').toLowerCase();
  if (override === 'strict' || override === 'lax' || override === 'none') {
    return override as 'strict' | 'lax' | 'none';
  }

  // Smart defaults based on environment
  if (isProduction && isHttps) {
    return 'lax'; // OAuth redirects require Lax (Strict blocks cookies on redirect)
  }
  return 'lax'; // Compatible with development
}

function resolveSessionMaxAge(): number {
  const envValue = process.env.SESSION_MAX_AGE_HOURS;
  if (envValue) {
    const hours = parseInt(envValue, 10);
    if (hours > 0 && hours <= 168) { // Max 1 week
      return hours * 60 * 60 * 1000;
    }
  }
  return 7 * 24 * 60 * 60 * 1000; // default: 7 days
}

// Validate on module load
validateEnvironment();

export const config = {
  // Server configuration
  port: parseInt(process.env.GATEWAY_PORT || '4000', 10),
  brainServiceUrl: process.env.BRAIN_SERVICE_URL || 'http://localhost:8000',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  redisUrl: process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL || '',
  redisToken: process.env.UPSTASH_REDIS_TOKEN || process.env.REDIS_TOKEN || '',
  redisUseTls: (process.env.REDIS_TLS ?? 'true').toLowerCase() !== 'false',

  // Database configuration
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSSL: process.env.DATABASE_SSL === 'true',

  // Google OAuth configuration
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',

  // Whoop OAuth configuration
  whoopClientId: process.env.WHOOP_CLIENT_ID || '',
  whoopClientSecret: process.env.WHOOP_CLIENT_SECRET || '',

  // Environment flags
  isProduction,
  isHttps,

  // Session configuration
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  sessionMaxAge: resolveSessionMaxAge(),
  sessionCookieName: process.env.USER_COOKIE_NAME || 'eclipsn_session',
  sessionCookieDomain: process.env.USER_COOKIE_DOMAIN || undefined,
  sessionCookieSameSite: resolveSameSite(),
  sessionCookieSameSiteOverride: process.env.USER_COOKIE_SAMESITE as 'strict' | 'lax' | 'none' | undefined,
  sessionCookieSecure: process.env.USER_COOKIE_SECURE === 'true' || (isProduction && isHttps),
  sessionStorePrefix: process.env.SESSION_STORE_PREFIX || 'eclipsn:',

  gmailTokenEncKey: process.env.GMAIL_TOKEN_ENC_KEY || '',
  gmailTokenKeyId: process.env.GMAIL_TOKEN_KEY_ID || 'v1',

  // URL validation whitelist
  allowedOrigins: [
    process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
    ...(process.env.ADDITIONAL_ALLOWED_ORIGINS || '').split(',').filter(Boolean)
  ],

  // Security headers
  enableSecurityHeaders: process.env.ENABLE_SECURITY_HEADERS !== 'false'
};
