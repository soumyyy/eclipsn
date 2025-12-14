import path from 'node:path';
import dotenv from 'dotenv';

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const isProduction = process.env.NODE_ENV === 'production';

function resolveSameSite(): true | false | 'lax' | 'strict' | 'none' {
  const override = (process.env.USER_COOKIE_SAMESITE || '').toLowerCase();
  if (override === 'strict' || override === 'lax' || override === 'none') {
    return override;
  }
  return isProduction ? 'none' : 'lax';
}

export const config = {
  port: parseInt(process.env.GATEWAY_PORT || '4000', 10),
  brainServiceUrl: process.env.BRAIN_SERVICE_URL || 'http://localhost:8000',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSSL: process.env.DATABASE_SSL === 'true',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  isProduction,
  sessionCookieName: process.env.USER_COOKIE_NAME || 'eclipsn_user_id',
  sessionCookieDomain: process.env.USER_COOKIE_DOMAIN || undefined,
  sessionCookieSameSite: resolveSameSite(),
  sessionCookieSecure:
    process.env.USER_COOKIE_SECURE !== undefined
      ? process.env.USER_COOKIE_SECURE === 'true'
      : isProduction,
  internalApiKey: process.env.INTERNAL_API_KEY || ''
};
