import { OAuth2Client } from 'google-auth-library';
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
} from '../config.js';
import { getTokens, saveTokens } from './token-store.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
];

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export type AuthErrorKind = 'not_connected' | 'session_expired';

export class AuthError extends Error {
  readonly kind: AuthErrorKind;

  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

export function getAuthUrl(uid: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: uid,
  });
}

export async function getValidAccessToken(uid: string): Promise<string> {
  const tokens = getTokens(uid);
  if (!tokens) {
    throw new AuthError(
      'not_connected',
      'Google account not connected. Please connect your account in app settings.',
    );
  }

  const isExpired = tokens.expiry_date <= Date.now() + EXPIRY_BUFFER_MS;
  if (!isExpired) {
    return tokens.access_token;
  }

  try {
    const refreshClient = new OAuth2Client(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI,
    );
    refreshClient.setCredentials({ refresh_token: tokens.refresh_token });

    const { token } = await refreshClient.getAccessToken();
    const credentials = refreshClient.credentials;
    const refreshedToken = token ?? credentials.access_token;

    if (!refreshedToken) {
      throw new Error('No refreshed access token returned by provider');
    }

    saveTokens(uid, {
      access_token: refreshedToken,
      refresh_token: credentials.refresh_token ?? tokens.refresh_token,
      expiry_date: credentials.expiry_date ?? Date.now() + 60 * 60 * 1000,
    });

    return refreshedToken;
  } catch {
    throw new AuthError(
      'session_expired',
      'Google session expired. Please reconnect your Google account in app settings.',
    );
  }
}
