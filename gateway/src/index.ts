import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import chatRouter from './routes/chat';
import gmailRouter from './routes/gmail';
import profileRouter from './routes/profile';
import outlookRouter from './routes/outlook';
import { scheduleGmailJobs } from './jobs/gmailJobs';
import memoryRouter from './routes/memory';
import graphRouter from './routes/graph';
// import { graphqlHTTP } from 'express-graphql';
// import { schema } from './graphql/schema';
// import { rootValue } from './graphql/resolvers';

const app = express();

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser(config.sessionSecret));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/chat', chatRouter);
app.use('/api/gmail', gmailRouter);
app.use('/api/outlook', outlookRouter);
app.use('/api/profile', profileRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/graph', graphRouter);

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
