import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.GATEWAY_PORT || '4000', 10),
  brainServiceUrl: process.env.BRAIN_SERVICE_URL || 'http://localhost:8000',
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSSL: process.env.DATABASE_SSL === 'true',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000'
};
