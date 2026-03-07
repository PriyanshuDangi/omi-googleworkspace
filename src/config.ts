import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
export const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
export const GOOGLE_CLIENT_ID = required('GOOGLE_CLIENT_ID');
export const GOOGLE_CLIENT_SECRET = required('GOOGLE_CLIENT_SECRET');
export const GOOGLE_REDIRECT_URI = required('GOOGLE_REDIRECT_URI');
export const ENCRYPTION_KEY = required('ENCRYPTION_KEY');
