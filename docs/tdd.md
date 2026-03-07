# Technical Design Document

Step-by-step implementation guide. Each step is self-contained and testable before moving to the next. Follow in order.

Reference: [prd.md](./prd.md) | [tech-stack.md](./tech-stack.md) | [omi_whatsapp](https://github.com/PriyanshuDangi/omi_whatsapp)

---

## Prerequisites

Before writing any code, do these manually:

1. **Install gws CLI globally:**
   ```bash
   npm install -g @googleworkspace/cli
   ```

2. **Create a Google Cloud project:**
   - Go to https://console.cloud.google.com
   - Create a new project (e.g. `omi-google-workspace`)
   - Enable **Gmail API** and **Google Calendar API**

3. **Create OAuth 2.0 credentials for the server (Web app):**
   - Go to APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:3000/auth/callback` (dev) and your production URL
   - Save `client_id` and `client_secret` for `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)

4. **Create OAuth 2.0 credentials for local gws CLI (Desktop app):**
   - Go to APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: **Desktop app**
   - Download the JSON and save it as `~/.config/gws/client_secret.json`
   - The JSON should have top-level `installed` (not `web`)

5. **Configure OAuth consent screen:**
   - User type: External
   - Add scopes: `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/calendar`
   - Add yourself as a test user (required while app is in "Testing" mode)

6. **Test gws CLI manually** (verifies CLI auth works on your machine):
   ```bash
   gws auth login -s gmail,calendar
   gws gmail +triage --max 3
   gws calendar +agenda --today
   ```

---

## Step 1: Project Scaffolding

Create the project skeleton. No application logic yet — just config files.

### 1.1 Initialize npm project

```bash
npm init -y
```

Set `"type": "module"` in package.json (same as omi_whatsapp).

### 1.2 Install dependencies

```bash
npm install express better-sqlite3 google-auth-library pino dotenv
npm install -D typescript tsx @types/express @types/better-sqlite3 @types/node vitest
```

### 1.3 Create files

Create these files with the content specified below:

**tsconfig.json** — Copy exactly from omi_whatsapp:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**package.json scripts:**
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc && rm -rf dist/views && mkdir -p dist/views && cp -r src/views/. dist/views/",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```

**.env.example:**
```
PORT=3000
BASE_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
ENCRYPTION_KEY=
LOG_LEVEL=info
```

**.gitignore:**
```
node_modules/
dist/
data/
logs/
.env
*.js.map
```

**ecosystem.config.cjs:**
```js
module.exports = {
  apps: [{
    name: 'omi-googleworkspace',
    script: 'dist/index.js',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
  }]
};
```

### 1.4 Create directory structure

```
mkdir -p src/routes src/services src/utils src/types src/views
```

### 1.5 Verify

```bash
npx tsc --noEmit  # Should succeed with zero errors (no source files yet is fine)
```

---

## Step 2: Utils (logger + sanitize)

These are lifted from omi_whatsapp with minimal changes.

### 2.1 src/utils/logger.ts

Copy the logger from omi_whatsapp but **remove all Baileys-specific code** (the `baileysLogger` export, the `BAILEYS_NOISE` array, and the `console.log/error` overrides). Keep:
- `requestContextStorage` (AsyncLocalStorage for tid)
- `LOGS_DIR` creation
- `DAILY_LOG_FILE` with daily rotation
- `multistream` (stdout + file)
- `logger` export with `mixin` for tid

### 2.2 src/utils/sanitize.ts

Copy exactly from omi_whatsapp:
```typescript
const UID_REGEX = /^[a-zA-Z0-9_-]+$/;
export function sanitizeUid(uid: string): boolean {
  return UID_REGEX.test(uid);
}
```

### 2.3 Verify

```bash
npx tsc --noEmit
```

---

## Step 3: Config

### 3.1 src/config.ts

Load environment variables and export them as typed constants. Fail fast if required vars are missing.

```typescript
import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const PORT = parseInt(process.env.PORT || '3000', 10);
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
export const GOOGLE_CLIENT_ID = required('GOOGLE_CLIENT_ID');
export const GOOGLE_CLIENT_SECRET = required('GOOGLE_CLIENT_SECRET');
export const GOOGLE_REDIRECT_URI = required('GOOGLE_REDIRECT_URI');
export const ENCRYPTION_KEY = required('ENCRYPTION_KEY');
```

### 3.2 Verify

Create a `.env` file from `.env.example`, fill in dummy values. Run:
```bash
npx tsx src/config.ts  # Should not throw
```

---

## Step 4: Token Store (SQLite + Encryption)

This is the most critical new service compared to omi_whatsapp. Get it right before anything else.

### 4.1 src/services/token-store.ts

**SQLite schema** — single table:
```sql
CREATE TABLE IF NOT EXISTS tokens (
  uid TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expiry_date INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Encryption functions** using Node.js `crypto`:
- `encrypt(plaintext: string): string` — AES-256-GCM. Returns `iv:authTag:ciphertext` (all hex-encoded).
- `decrypt(encrypted: string): string` — Splits on `:`, decrypts.
- Use `ENCRYPTION_KEY` from config (must be 32 bytes / 64 hex chars). Validate length at startup.

**Exported functions:**
- `saveTokens(uid: string, tokens: { access_token: string; refresh_token: string; expiry_date: number }): void`
  - Encrypts both tokens before storing. Uses `INSERT OR REPLACE`.
- `getTokens(uid: string): { access_token: string; refresh_token: string; expiry_date: number } | null`
  - Reads row, decrypts both tokens, returns. Returns `null` if uid not found.
- `deleteTokens(uid: string): void`
- `hasTokens(uid: string): boolean`

**Database file location:** `data/tokens.db`. Create the `data/` directory at startup.

**Important:** `better-sqlite3` is synchronous. No async/await needed for DB calls.

### 4.2 Generate an encryption key

Provide a helper in the README or .env.example comment:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4.3 Test the token store

Write `tests/token-store.test.ts`:
- Save tokens for a uid, retrieve them, verify they match.
- Verify stored values in SQLite are NOT plaintext (encrypted).
- Verify `getTokens` returns `null` for unknown uid.
- Verify `deleteTokens` works.

```bash
npm test
```

---

## Step 5: OAuth Flow

### 5.1 src/services/auth.ts

Create an OAuth2 client using `google-auth-library`:

```typescript
import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from '../config.js';

export const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
];

export function getAuthUrl(uid: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: uid,
  });
}
```

Key details:
- `access_type: 'offline'` — required to get a refresh token.
- `prompt: 'consent'` — forces consent screen every time, ensuring we always get a refresh token (Google only sends refresh_token on first consent otherwise).
- `state: uid` — we pass the Omi uid through the OAuth flow so the callback knows which user to associate the tokens with.

### 5.2 src/services/auth.ts — token refresh

Add a function to get a valid access token for a uid:

```typescript
export async function getValidAccessToken(uid: string): Promise<string>
```

Logic:
1. Call `getTokens(uid)` from token-store.
2. If `null`, throw an error (user not authenticated).
3. Check if `expiry_date` is in the past (with 5-minute buffer: `Date.now() + 5 * 60 * 1000`).
4. If expired:
   a. Set credentials on a **new** OAuth2Client instance: `client.setCredentials({ refresh_token })`.
   b. Call `client.getAccessToken()` — this uses the refresh token to get a new access token.
   c. Save the new `access_token` and `expiry_date` to the token store.
   d. Return the new access token.
5. If not expired, return the stored access token.

**Important:** Create a new `OAuth2Client` instance for each refresh call (not the shared one) to avoid race conditions between users.

### 5.3 src/routes/auth.ts

Three routes:

**GET /auth/login?uid=...:**
1. Validate `uid` is present and passes `sanitizeUid`.
2. If no uid, return 400.
3. Redirect to `getAuthUrl(uid)`.

**GET /auth/callback:**
1. Extract `code` and `state` (uid) from query params.
2. Exchange the code for tokens: `oauth2Client.getToken(code)`.
3. The response contains `access_token`, `refresh_token`, `expiry_date`.
4. Save to token store using uid from `state`.
5. Serve `success.html` (or redirect to it).
6. On any error, serve `error.html` with a user-friendly message.

**GET /auth/status?uid=...:**
1. Validate uid.
2. Return `{ is_setup_completed: hasTokens(uid) }`.

This matches the omi_whatsapp setup/status pattern that Omi polls.

### 5.4 Verify

1. Start dev server: `npm run dev`
2. Open `http://localhost:3000/auth/login?uid=test123`
3. Should redirect to Google consent screen.
4. After consent, should redirect back to `/auth/callback`.
5. Should see success page.
6. Check `http://localhost:3000/auth/status?uid=test123` returns `{ "is_setup_completed": true }`.
7. Check `data/tokens.db` exists and the token values are encrypted (not readable plaintext).

---

## Step 6: gws CLI Wrapper

### 6.1 src/services/gws.ts

This module wraps `child_process.execFile` to call the `gws` binary.

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const GWS_BIN = process.env.GWS_BIN || 'gws';
const TIMEOUT_MS = 30_000;
```

**Main function:**
```typescript
export async function executeGws(args: string[], token: string): Promise<unknown>
```

Implementation:
1. Call `execFileAsync(GWS_BIN, args, { env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token }, timeout: TIMEOUT_MS })`.
2. Parse `stdout` as JSON.
3. Check if the parsed result has an `error` field (gws returns errors as JSON too). If so, throw a descriptive error.
4. Return the parsed result.
5. If `execFile` throws (non-zero exit, timeout), log the `stderr` and throw a user-friendly error.

**Important notes:**
- Use `execFile`, NOT `exec`. `execFile` does not spawn a shell, which avoids command injection risks.
- Pass `args` as an array — never concatenate user input into a command string.
- The `GOOGLE_WORKSPACE_CLI_TOKEN` env var tells gws to use this access token directly (highest priority in gws auth precedence).
- Add `GWS_BIN` env var so tests can point to a mock binary.

### 6.2 Verify

Write a quick manual test (not automated — requires real tokens):
```bash
npx tsx -e "
import { executeGws } from './src/services/gws.js';
const token = 'paste-a-valid-access-token-here';
const result = await executeGws(['gmail', 'users', 'labels', 'list', '--params', JSON.stringify({ userId: 'me' })], token);
console.log(result);
"
```

---

## Step 7: Gmail Tool Endpoints

### 7.1 Common pattern

Every tool endpoint in `src/routes/chat-tools.ts` follows this pattern (same as omi_whatsapp):

```typescript
toolsRouter.post('/tool_name', async (req, res) => {
  const uid = req.body?.uid || (req.query.uid as string);

  // 1. Validate uid
  if (!uid) { res.status(400).json({ error: 'Missing uid parameter' }); return; }

  // 2. Validate required params
  const param = req.body?.param;
  if (!param) { res.status(400).json({ error: 'Missing required parameter: param' }); return; }

  // 3. Get valid access token (handles refresh)
  let token: string;
  try {
    token = await getValidAccessToken(uid);
  } catch {
    res.status(401).json({ error: 'Google account not connected. Please connect your account in app settings.' });
    return;
  }

  // 4. Execute gws command
  try {
    const result = await executeGws([...args], token);
    // 5. Format and return result
    res.json({ result: formatResult(result) });
  } catch (err) {
    logger.error({ uid, err }, 'Tool failed');
    res.status(500).json({ error: 'Failed to ... Please try again.' });
  }
});
```

### 7.2 search_emails

**gws command:**
```
gws gmail users messages list --params '{"userId":"me","q":"<query>","maxResults":10}'
```

**Response handling:**
- gws returns `{ messages: [{ id, threadId }], resultSizeEstimate }`.
- The list only returns IDs. To get subjects/snippets, we need to fetch each message.
- For MVP: fetch up to 5 messages in parallel using `gws gmail users messages get` with `format: 'metadata'` and `metadataHeaders: ['Subject','From','Date']`.
- Format as a readable list: "1) Subject — From (Date)".

**Implementation detail:**
```typescript
// Step 1: Search
const listResult = await executeGws([
  'gmail', 'users', 'messages', 'list',
  '--params', JSON.stringify({ userId: 'me', q: query, maxResults: 10 }),
], token);

// Step 2: Fetch details for each message (up to 5)
const messages = (listResult as any).messages?.slice(0, 5) || [];
const details = await Promise.all(
  messages.map((m: any) =>
    executeGws([
      'gmail', 'users', 'messages', 'get',
      '--params', JSON.stringify({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      }),
    ], token)
  )
);
```

### 7.3 read_email

**gws command:**
```
gws gmail users messages get --params '{"userId":"me","id":"<message_id>","format":"full"}'
```

**Response handling:**
- Extract headers (Subject, From, To, Date) from `payload.headers`.
- Extract body: check `payload.parts` for `text/plain` part, base64url-decode the `body.data` field.
- If no parts, check `payload.body.data` directly.
- Return formatted: "From: ... | Subject: ... | Date: ...\n\n<body>"

### 7.4 send_email

**Use the helper command** (handles RFC 2822 + base64 encoding automatically):
```
gws gmail +send --to <to> --subject <subject> --body <body>
```

**gws args:**
```typescript
['gmail', '+send', '--to', to, '--subject', subject, '--body', body]
```

**Response:** `{ result: "Email sent to <to> with subject '<subject>'" }`

### 7.5 list_labels

**gws command:**
```
gws gmail users labels list --params '{"userId":"me"}'
```

**Response handling:**
- Returns `{ labels: [{ id, name, type }] }`.
- Filter to `type === 'user'` labels only (skip system labels like INBOX, SPAM).
- Format as comma-separated list.

### 7.6 trash_email

**gws command:**
```
gws gmail users messages trash --params '{"userId":"me","id":"<message_id>"}'
```

**Response:** `{ result: "Email moved to trash." }`

### 7.7 Verify Gmail tools

Start dev server. Use curl to test each tool:
```bash
# Search
curl -X POST http://localhost:3000/tools/search_emails \
  -H 'Content-Type: application/json' \
  -d '{"uid":"test123","query":"is:unread"}'

# List labels
curl -X POST http://localhost:3000/tools/list_labels \
  -H 'Content-Type: application/json' \
  -d '{"uid":"test123"}'
```

---

## Step 8: Calendar Tool Endpoints

### 8.1 list_events

**Use the helper command:**
```
gws calendar +agenda --today
```
or for a specific day, use raw API:
```
gws calendar events list --params '{"calendarId":"primary","timeMin":"<start>","timeMax":"<end>","maxResults":<n>,"singleEvents":true,"orderBy":"startTime"}'
```

**Implementation:**
- If `date` param provided, compute `timeMin` as start of that day (ISO 8601) and `timeMax` as end of that day.
- If no `date`, default to today.
- `singleEvents: true` expands recurring events.
- `orderBy: 'startTime'` requires `singleEvents: true`.

**Response handling:**
- Returns `{ items: [{ id, summary, start: { dateTime }, end: { dateTime }, ... }] }`.
- Format each event: "Title — HH:MM to HH:MM".
- If `items` is empty: "No events found for this day."

### 8.2 create_event

**Use the helper command:**
```
gws calendar +insert --summary <summary> --start <start_time> --end <end_time> [--description <desc>] [--attendee <email>]
```

**gws args:**
```typescript
const args = ['calendar', '+insert', '--summary', summary, '--start', start_time, '--end', end_time];
if (description) args.push('--description', description);
if (attendees) {
  // attendees is comma-separated — split and add each
  for (const email of attendees.split(',').map(e => e.trim())) {
    args.push('--attendee', email);
  }
}
```

**Response:** `{ result: "Event '<summary>' created for <start_time>." }`

### 8.3 get_event

**gws command:**
```
gws calendar events get --params '{"calendarId":"primary","eventId":"<event_id>"}'
```

**Response handling:**
- Returns full event object.
- Extract and format: summary, start/end times, location, description, attendees list, status.

### 8.4 update_event

**gws command** — use `patch` (partial update, not full `update`):
```
gws calendar events patch --params '{"calendarId":"primary","eventId":"<event_id>"}' --json '<body>'
```

**Build JSON body** only from provided (non-null) fields:
```typescript
const body: Record<string, unknown> = {};
if (summary) body.summary = summary;
if (start_time) body.start = { dateTime: start_time };
if (end_time) body.end = { dateTime: end_time };
```

**Response:** `{ result: "Event updated." }`

### 8.5 delete_event

**gws command:**
```
gws calendar events delete --params '{"calendarId":"primary","eventId":"<event_id>"}'
```

Note: delete returns empty response on success (HTTP 204). gws may return empty stdout. Handle this — if no stdout and no error, it's a success.

**Response:** `{ result: "Event deleted." }`

### 8.6 Verify Calendar tools

```bash
# List events
curl -X POST http://localhost:3000/tools/list_events \
  -H 'Content-Type: application/json' \
  -d '{"uid":"test123"}'

# Create event
curl -X POST http://localhost:3000/tools/create_event \
  -H 'Content-Type: application/json' \
  -d '{"uid":"test123","summary":"Test Meeting","start_time":"2026-03-08T10:00:00-05:00","end_time":"2026-03-08T11:00:00-05:00"}'
```

---

## Step 9: Chat Tools Manifest

### 9.1 src/routes/chat-tools.ts — manifest

Follow the omi_whatsapp pattern: build manifest dynamically using the request's base URL.

```typescript
function buildManifest(baseUrl: string) {
  return {
    tools: [
      {
        name: 'search_emails',
        description: 'Use this when the user wants to search their Gmail inbox. ...',
        endpoint: `${baseUrl}/tools/search_emails`,
        method: 'POST',
        parameters: { ... },
        auth_required: true,
        status_message: 'Searching your emails...',
      },
      // ... all 10 tools
    ],
  };
}
```

Use `BASE_URL` env var with fallback to `${req.protocol}://${req.get('host')}` (same as omi_whatsapp).

**Full manifest content:** Copy the tools array from `docs/prd.md` (the JSON block). Update the `endpoint` values to use `${baseUrl}/tools/...` (not `/api/tools/...` — match the route prefix).

### 9.2 Mount

```typescript
manifestRouter.get('/omi-tools.json', (req, res) => {
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json(buildManifest(baseUrl));
});
```

---

## Step 10: HTML Views

### 10.1 src/views/login.html

Simple page with:
- Dark theme (match omi_whatsapp style: `background: #0a0a0a`, `color: #f5f5f5`).
- "Omi + Google Workspace" title with a gradient (use Google blue `#4285f4` to green `#34a853`).
- "Connect your Google account to manage Gmail and Calendar from Omi chat."
- A "Sign in with Google" button that redirects to `/auth/login?uid=<uid>`.
- The uid is read from the URL query param: `new URLSearchParams(window.location.search).get('uid')`.
- If no uid, show error message.

### 10.2 src/views/success.html

Simple page with:
- Checkmark icon (same style as omi_whatsapp success view).
- "Google Account Connected!" heading.
- "You're all set. You can now use Gmail and Calendar from Omi chat. You can close this page."
- A "Disconnect" button that could call a logout endpoint (optional for MVP).

---

## Step 11: Main Entry Point

### 11.1 src/index.ts

Wire everything together. Follow the exact omi_whatsapp pattern:

```typescript
import 'dotenv/config';
import { randomUUID } from 'crypto';
import express from 'express';
import { logger, requestContextStorage } from './utils/logger.js';
import { authRouter } from './routes/auth.js';
import { manifestRouter, toolsRouter } from './routes/chat-tools.js';
import { sanitizeUid } from './utils/sanitize.js';
import { PORT } from './config.js';
```

**Middleware stack (in order):**

1. `express.json()` — parse JSON bodies.
2. `app.set('trust proxy', 1)` — if behind nginx.
3. **tid middleware** — copy from omi_whatsapp (request-scoped tid via AsyncLocalStorage).
4. **Request logging middleware** — copy from omi_whatsapp (logs method, path, uid, body on request; logs status, ms, response body on finish).
5. **uid sanitization middleware** — copy from omi_whatsapp (validates uid format).

**Routes:**

```typescript
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/auth', authRouter);
app.use('/.well-known', manifestRouter);
app.use('/tools', toolsRouter);
// Also mount under /auth/tools for Omi (Omi resolves relative to App Home URL)
app.use('/auth/tools', toolsRouter);
```

**Session validation middleware** on `/tools` (before routes mount or as route-level middleware):
```typescript
app.use('/tools', (req, res, next) => {
  const uid = req.body?.uid || (req.query.uid as string);
  if (uid && !hasTokens(uid)) {
    res.status(403).json({ error: 'Google account not connected. Please connect your account in app settings.' });
    return;
  }
  next();
});
```

**Start server:**
```typescript
app.listen(PORT, '127.0.0.1', () => {
  logger.info({ port: PORT }, 'Server started');
  console.log(`\n  Omi Google Workspace Integration`);
  console.log(`  ==================================`);
  console.log(`  Server running on http://localhost:${PORT}`);
  console.log(`  Auth page:  http://localhost:${PORT}/auth/login?uid=test`);
  console.log(`  Status:     http://localhost:${PORT}/auth/status?uid=test`);
  console.log('');
});
```

### 11.2 Verify full server

```bash
npm run dev
```

1. `GET /health` → `{ "status": "ok" }`
2. `GET /.well-known/omi-tools.json` → full manifest with 10 tools
3. `GET /auth/login?uid=test123` → redirects to Google
4. Complete OAuth flow → `GET /auth/status?uid=test123` → `{ "is_setup_completed": true }`
5. `POST /tools/list_labels` with `{"uid":"test123"}` → returns Gmail labels
6. `POST /tools/list_events` with `{"uid":"test123"}` → returns today's events

---

## Step 12: Deploy Config

### 12.1 deploy.sh

Copy from omi_whatsapp, change the app name:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_NAME="omi-googleworkspace"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[deploy] $*"; }

cd "$REPO_DIR"

log "Pulling latest code..."
git pull origin main

log "Installing dependencies..."
npm ci

log "Building..."
npm run build

log "Reloading pm2 process..."
if pm2 list | grep -q "$APP_NAME"; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi

pm2 save

log "Deploy complete. Status:"
pm2 show "$APP_NAME"
```

### 12.2 Server setup

On the VPS:
1. Install Node.js 22, pm2, gws CLI.
2. Clone the repo.
3. Copy `.env` with production values (production `BASE_URL`, `GOOGLE_REDIRECT_URI` with real domain).
4. Run `bash deploy.sh`.
5. Set up nginx reverse proxy (same as omi_whatsapp server).

---

## Step 13: Omi App Registration

1. Go to https://omi.me/developer (or the Omi developer dashboard).
2. Create a new app.
3. Set capability: `external_integration`.
4. Set App Home URL: `https://your-domain.com/auth` (this is where users land to set up).
5. Set Setup Completed URL: `https://your-domain.com/auth/status` (Omi polls this).
6. Tool manifest will be discovered at `https://your-domain.com/.well-known/omi-tools.json`.
7. Test the app by installing it on your Omi account.

---

## Error Handling Patterns

Follow omi_whatsapp conventions consistently:

| Scenario | HTTP Status | Error message pattern |
|---|---|---|
| Missing uid | 400 | `"Missing uid parameter"` |
| Missing required param | 400 | `"Missing required parameter: <name>"` |
| Invalid uid format | 400 | `"Invalid uid format"` |
| Not authenticated | 401 | `"Google account not connected. Please connect your account in app settings."` |
| Token refresh failed | 401 | `"Google session expired. Please reconnect your Google account in app settings."` |
| gws CLI error | 500 | `"Failed to <action>. Please try again."` |
| gws timeout | 500 | `"Request timed out. Please try again."` |

Never expose raw error messages, stack traces, or gws stderr to the user.

---

## Gotchas and Pitfalls

1. **Refresh tokens are only sent on first consent.** Using `prompt: 'consent'` in the OAuth URL forces re-consent, ensuring we always get a refresh token. Without this, returning users may only get an access token.

2. **Access tokens expire in ~1 hour.** Always call `getValidAccessToken()` before every gws call. Never cache tokens in memory beyond the request lifecycle.

3. **gws fetches Discovery docs on first run.** The first gws call for a service may take 2-3 seconds. Subsequent calls within 24 hours use the cached discovery doc. Plan for slightly slower first-call latency.

4. **`better-sqlite3` requires native compilation.** If `npm install` fails on the server, ensure `build-essential` / `python3` are installed. On macOS it typically works out of the box.

5. **Gmail `messages.list` only returns IDs.** You must make a second call to `messages.get` for each message to get headers/body. Batch these with `Promise.all` but limit to 5-10 to avoid rate limits.

6. **Calendar `events.delete` returns empty response.** Don't try to JSON.parse empty stdout. Check for empty string before parsing.

7. **gws errors are returned as JSON on stdout.** A non-zero exit code with `{"error": {...}}` on stdout is a normal gws error. Parse it and extract the error message.

8. **The `state` parameter in OAuth must be validated.** When the callback fires, the `state` query param contains the uid. Validate it with `sanitizeUid` before using it.

9. **File paths for views.** In ESM, `__dirname` is not available. Use `path.dirname(fileURLToPath(import.meta.url))` to resolve relative paths to HTML files (same as omi_whatsapp setup route).

10. **Omi resolves tool endpoints relative to the App Home URL.** If your App Home URL is `https://domain.com/auth`, Omi might call `https://domain.com/auth/tools/send_email`. Mount your tools router at both `/tools` and `/auth/tools` to handle this (same pattern as omi_whatsapp mounts under both `/` and `/setup`).
