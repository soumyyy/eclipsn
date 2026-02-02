import express from 'express';
import cors from 'cors';
import { config } from './config';
import chatRouter from './routes/chat';
import gmailRouter from './routes/gmail';
import profileRouter from './routes/profile';
import memoryRouter from './routes/memory';
import memoriesRouter from './routes/memories';
import graphRouter from './routes/graph';
import feedRouter from './routes/feed';
import tasksRouter from './routes/tasks';
import whoopRouter from './routes/whoop';
import calendarRouter from './routes/calendar';
import internalProfileRouter from './routes/internal/profile';
import internalGmailRouter from './routes/internal/gmail';
import cron from 'node-cron';
import { scheduleGmailJobs } from './jobs/gmailJobs';
import { attachUserContext } from './middleware/userContext';
import { getExtractLastRun, triggerMemoryExtract } from './services/brainClient';
import { listAllUserIds } from './services/db';

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
app.use('/internal/gmail', internalGmailRouter);

// 6. User context (only for frontend API routes)
app.use(attachUserContext);

/**
 * FRONTEND API ROUTES (with user context)
 */
app.use('/api/chat', chatRouter);
app.use('/api/profile', profileRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/memories', memoriesRouter);
// app.use('/api/graph', graphRouter); // Disabled per user request
app.use('/api/feed', feedRouter);
app.use('/api/tasks', tasksRouter);
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

  // Scheduled memory extraction: run if not done in last 24h (local dev); nightly at 2am
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  async function runExtractionIfNeeded() {
    try {
      const { last_run_at } = await getExtractLastRun();
      const now = Date.now();
      const lastRun = last_run_at ? new Date(last_run_at).getTime() : 0;
      if (now - lastRun < TWENTY_FOUR_HOURS_MS && lastRun > 0) return;
      const userIds = await listAllUserIds();
      if (userIds.length === 0) return;
      console.log(`[Extraction] Running for ${userIds.length} user(s)...`);
      for (const uid of userIds) {
        try {
          await triggerMemoryExtract(uid);
        } catch (err) {
          console.warn('[Extraction] Failed for user', uid, err);
        }
      }
      console.log('[Extraction] Done.');
    } catch (err) {
      console.warn('[Extraction] Check/run failed:', err);
    }
  }
  setTimeout(() => runExtractionIfNeeded(), 5000);
  cron.schedule('0 2 * * *', () => runExtractionIfNeeded(), { timezone: 'UTC' });

  if (config.whoopClientId) {
    console.log(`🏃 Whoop OAuth redirect_uri (must match Whoop Dev Dashboard exactly): ${config.whoopRedirectUri}`);
  }
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