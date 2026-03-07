import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ENCRYPTION_KEY } from '../config.js';
import { sanitizeUid } from '../utils/sanitize.js';

type StoredTokens = {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
};

type TokenRow = {
  uid: string;
  access_token: string;
  refresh_token: string;
  expiry_date: number;
};

const ENCRYPTION_KEY_BUFFER = Buffer.from(ENCRYPTION_KEY, 'hex');
if (ENCRYPTION_KEY.length !== 64 || ENCRYPTION_KEY_BUFFER.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'tokens.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    uid TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expiry_date INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY_BUFFER, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(encrypted: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY_BUFFER, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function saveTokens(uid: string, tokens: StoredTokens): void {
  if (!sanitizeUid(uid)) {
    throw new Error('Invalid uid format');
  }

  const stmt = db.prepare(`
    INSERT INTO tokens (uid, access_token, refresh_token, expiry_date, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(uid) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expiry_date = excluded.expiry_date,
      updated_at = unixepoch()
  `);

  stmt.run(
    uid,
    encrypt(tokens.access_token),
    encrypt(tokens.refresh_token),
    tokens.expiry_date,
  );
}

export function getTokens(uid: string): StoredTokens | null {
  if (!sanitizeUid(uid)) {
    throw new Error('Invalid uid format');
  }

  const stmt = db.prepare('SELECT uid, access_token, refresh_token, expiry_date FROM tokens WHERE uid = ?');
  const row = stmt.get(uid) as TokenRow | undefined;

  if (!row) {
    return null;
  }

  return {
    access_token: decrypt(row.access_token),
    refresh_token: decrypt(row.refresh_token),
    expiry_date: row.expiry_date,
  };
}

export function deleteTokens(uid: string): void {
  if (!sanitizeUid(uid)) {
    throw new Error('Invalid uid format');
  }

  const stmt = db.prepare('DELETE FROM tokens WHERE uid = ?');
  stmt.run(uid);
}

export function hasTokens(uid: string): boolean {
  if (!sanitizeUid(uid)) {
    throw new Error('Invalid uid format');
  }

  const stmt = db.prepare('SELECT 1 FROM tokens WHERE uid = ? LIMIT 1');
  return Boolean(stmt.get(uid));
}
