import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import chatRouter from './routes/chat';
import gmailRouter from './routes/gmail';
import profileRouter from './routes/profile';
import memoryRouter from './routes/memory';
import graphRouter from './routes/graph';
import { scheduleGmailJobs } from './jobs/gmailJobs';
import { attachUserContext } from './middleware/userContext';
// import { graphqlHTTP } from 'express-graphql';
// import { schema } from './graphql/schema';
// import { rootValue } from './graphql/resolvers';

const app = express();

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser(config.sessionSecret));
app.use(attachUserContext);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/chat', chatRouter);
app.use('/api/gmail', gmailRouter);
app.use('/api/profile', profileRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/graph', graphRouter);

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  const message = err?.message || 'Internal server error';
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: message });
});

// GraphQL stub for future dashboards
// app.use('/graphql', graphqlHTTP({
//   schema,
//   rootValue,
//   graphiql: true
// }));

app.listen(config.port, () => {
  console.log(`Gateway listening on port ${config.port}`);
  scheduleGmailJobs();
});
