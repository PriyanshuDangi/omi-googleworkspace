import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { oauth2Client, getAuthUrl } from '../services/auth.js';
import { getTokens, hasTokens, saveTokens } from '../services/token-store.js';
import { logger } from '../utils/logger.js';
import { sanitizeUid } from '../utils/sanitize.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viewsDir = path.resolve(__dirname, '../views');

export const authRouter = Router();

authRouter.get('/', (_req, res) => {
  res.sendFile(path.join(viewsDir, 'login.html'));
});

authRouter.get('/login', (req, res) => {
  const uid = req.query.uid as string | undefined;
  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }

  if (!sanitizeUid(uid)) {
    res.status(400).json({ error: 'Invalid uid format' });
    return;
  }

  res.redirect(getAuthUrl(uid));
});

authRouter.get('/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !state || !sanitizeUid(state)) {
    res.status(400).send('Invalid OAuth callback request.');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const current = getTokens(state);

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token ?? current?.refresh_token;
    const expiryDate = tokens.expiry_date;

    if (!accessToken || !refreshToken || !expiryDate) {
      throw new Error('Missing required token fields in OAuth callback');
    }

    saveTokens(state, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: expiryDate,
    });

    res.sendFile(path.join(viewsDir, 'success.html'));
  } catch (error) {
    logger.error({ err: error }, 'OAuth callback failed');
    res
      .status(500)
      .send('Failed to connect your Google account. Please retry from Omi app settings.');
  }
});

authRouter.get('/status', (req, res) => {
  const uid = req.query.uid as string | undefined;

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }

  if (!sanitizeUid(uid)) {
    res.status(400).json({ error: 'Invalid uid format' });
    return;
  }

  res.json({ is_setup_completed: hasTokens(uid) });
});
