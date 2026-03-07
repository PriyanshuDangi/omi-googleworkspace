import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { PORT } from './config.js';
import { authRouter } from './routes/auth.js';
import { manifestRouter, toolsRouter } from './routes/chat-tools.js';
import { hasTokens } from './services/token-store.js';
import { logger, requestContextStorage } from './utils/logger.js';
import { sanitizeUid } from './utils/sanitize.js';

const app = express();

app.use(express.json());
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const tid = (req.headers['x-request-id'] as string | undefined) || randomUUID();
  requestContextStorage.run({ tid }, () => next());
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  let responseBody: unknown;

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as typeof res.json;

  logger.info(
    {
      method: req.method,
      path: req.path,
      uid: req.body?.uid || req.query.uid,
      body: req.body,
    },
    'incoming request',
  );

  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - startedAt,
        response: responseBody,
      },
      'request completed',
    );
  });

  next();
});

app.use((req, res, next) => {
  const uid = (req.body?.uid as string | undefined) || (req.query.uid as string | undefined);
  if (uid && !sanitizeUid(uid)) {
    res.status(400).json({ error: 'Invalid uid format' });
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/.well-known', manifestRouter);

app.use('/tools', (req, res, next) => {
  const uid = (req.body?.uid as string | undefined) || (req.query.uid as string | undefined);
  if (uid && !hasTokens(uid)) {
    res
      .status(403)
      .json({ error: 'Google account not connected. Please connect your account in app settings.' });
    return;
  }
  next();
});

app.use('/tools', toolsRouter);
app.use('/auth/tools', toolsRouter);

app.listen(PORT, '127.0.0.1', () => {
  logger.info({ port: PORT }, 'Server started');
  console.log('\n  Omi Google Workspace Integration');
  console.log('  ==================================');
  console.log(`  Server running on http://localhost:${PORT}`);
  console.log(`  Auth page:  http://localhost:${PORT}/auth?uid=test`);
  console.log(`  Status:     http://localhost:${PORT}/auth/status?uid=test`);
  console.log('');
});
