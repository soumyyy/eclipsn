import express from 'express';
import cors from 'cors';
import { config } from './config';
import chatRouter from './routes/chat';
import gmailRouter from './routes/gmail';
import profileRouter from './routes/profile';
import memoryRouter from './routes/memory';
import graphRouter from './routes/graph';
import feedRouter from './routes/feed';
import whoopRouter from './routes/whoop';
import calendarRouter from './routes/calendar';
import internalProfileRouter from './routes/internal/profile';
import { scheduleGmailJobs } from './jobs/gmailJobs';
import { attachUserContext } from './middleware/userContext';

// Production-grade security using proven frameworks
import { securityHeaders, rateLimiter, authRateLimiter } from './middleware/security';
import { sessionConfig } from './middleware/session';

const app = express();

// Trust proxy in production
if (config.isProduction) {
  app.set('trust proxy', 1);
}

/**
 * ESSENTIAL MIDDLEWARE STACK
 * Using only battle-tested frameworks
 */

// 1. Security headers (Helmet.js)
app.use(securityHeaders);

// 2. Rate limiting (express-rate-limit)
app.use(rateLimiter);

// 3. Session management (express-session)
app.use(sessionConfig);

// 4. CORS
app.use(cors({
  origin: config.allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// 5. Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * HEALTH CHECKS
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.isProduction ? 'production' : 'development'
  });
});

/**
 * INTERNAL API ROUTES (before user context middleware)
 */
app.use('/internal/profile', internalProfileRouter);

// 6. User context (only for frontend API routes)
app.use(attachUserContext);

/**
 * FRONTEND API ROUTES (with user context)
 */
app.use('/api/chat', chatRouter);
app.use('/api/profile', profileRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/memory', memoryRouter);
// app.use('/api/graph', graphRouter); // Disabled per user request
app.use('/api/feed', feedRouter);
app.use('/api/feed', feedRouter);
app.use('/api/whoop', whoopRouter);
app.use('/api/calendar', calendarRouter);

// Gmail with auth rate limiting
app.use('/api/gmail', authRateLimiter, gmailRouter);

import serviceAccountRouter from './routes/serviceAccounts';
app.use('/api/service-accounts', rateLimiter, serviceAccountRouter);

/**
 * ERROR HANDLING
 */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status || 500;
  const message = err?.message || 'Internal server error';

  if (status >= 500) {
    console.error('[Error]', err);
  }

  res.status(status).json({ error: message });
});

/**
 * SERVER STARTUP
 */
const server = app.listen(config.port, () => {
  console.log(`🚀 Eclipsn Gateway on port ${config.port}`);
  console.log(`📦 Security: Helmet.js + express-rate-limit + express-session`);
  console.log(`🌍 Environment: ${config.isProduction ? 'production' : 'development'}`);

  scheduleGmailJobs();
  console.log('✅ Startup complete');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('🛑 Shutting down...');
  server.close(() => process.exit(0));
});