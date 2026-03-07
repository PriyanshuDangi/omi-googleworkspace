import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const TEST_UID = `test_uid_${Date.now()}`;
beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? 'test-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/callback';
    process.env.ENCRYPTION_KEY =
        process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});
describe('token-store', () => {
    it('saves and retrieves encrypted tokens', async () => {
        const tokenStore = await import('../src/services/token-store.js');
        tokenStore.saveTokens(TEST_UID, {
            access_token: 'access-plaintext',
            refresh_token: 'refresh-plaintext',
            expiry_date: Date.now() + 60_000,
        });
        const tokens = tokenStore.getTokens(TEST_UID);
        expect(tokens).not.toBeNull();
        expect(tokens?.access_token).toBe('access-plaintext');
        expect(tokens?.refresh_token).toBe('refresh-plaintext');
        const dbPath = path.resolve(process.cwd(), 'data', 'tokens.db');
        const db = new Database(dbPath, { readonly: true });
        const row = db
            .prepare('SELECT access_token, refresh_token FROM tokens WHERE uid = ?')
            .get(TEST_UID);
        db.close();
        expect(row).toBeDefined();
        expect(row?.access_token).not.toContain('access-plaintext');
        expect(row?.refresh_token).not.toContain('refresh-plaintext');
    });
    it('returns null for unknown uid', async () => {
        const tokenStore = await import('../src/services/token-store.js');
        const tokens = tokenStore.getTokens('unknown_uid_123');
        expect(tokens).toBeNull();
    });
    it('deletes tokens', async () => {
        const tokenStore = await import('../src/services/token-store.js');
        tokenStore.deleteTokens(TEST_UID);
        expect(tokenStore.hasTokens(TEST_UID)).toBe(false);
    });
});
afterAll(async () => {
    const tokenStore = await import('../src/services/token-store.js');
    tokenStore.deleteTokens(TEST_UID);
});
//# sourceMappingURL=token-store.test.js.map