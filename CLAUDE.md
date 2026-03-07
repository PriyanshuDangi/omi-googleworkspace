# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Rules

- Document code with comments and a README.
- Keep the codebase very clean and organized.
- Try reusing the code if possible.
- You are a senior software engineer, write code like one.
- No need to create separate docs or markdown files after every implementation, only create when asked.
- After adding a major feature or completing a milestone, update docs/architecture.md.

## Project Overview

Omi Chat Tools App for Google Workspace — a Node.js/Express server that bridges Gmail and Google Calendar into the Omi chat interface. Users authenticate via Google OAuth through a web UI, and the server exposes Omi-compatible chat tool endpoints that execute `gws` CLI commands on behalf of authenticated users.

Reference docs: `docs/prd.md` | `docs/tech-stack.md` | `docs/tdd.md`

Reference project (same patterns): [omi_whatsapp](https://github.com/PriyanshuDangi/omi_whatsapp)

## Tech Stack

- **Runtime:** Node.js 22 LTS + TypeScript 5 (strict)
- **Framework:** Express 4
- **CLI:** `@googleworkspace/cli` (`gws`) — invoked via `child_process.execFile` per request, authenticated with `GOOGLE_WORKSPACE_CLI_TOKEN` env var
- **Database:** SQLite via `better-sqlite3` — encrypted token storage (AES-256-GCM)
- **OAuth:** `google-auth-library` — handles OAuth2 flow + token refresh
- **Logging:** pino — structured JSON logs with request-scoped tid
- **Testing:** vitest
- **Deploy:** pm2 + deploy.sh (no Docker)

## Commands

```bash
npm run dev        # tsx watch src/index.ts
npm run build      # tsc && copy views to dist/
npm run start      # node dist/index.js
npm test           # vitest run
```

Deploy:
```bash
bash deploy.sh     # git pull -> npm ci -> build -> pm2 reload
```

## Project Structure

```
src/
  index.ts              # Express app entry point, middleware stack, route mounting
  config.ts             # Env vars with fail-fast validation
  routes/
    auth.ts             # OAuth login/callback/status routes
    chat-tools.ts       # Omi manifest + all tool endpoints (same file, like omi_whatsapp)
  services/
    auth.ts             # OAuth2 client, getAuthUrl(), getValidAccessToken()
    gws.ts              # gws CLI wrapper (execFile + JSON parse)
    token-store.ts      # SQLite encrypted token CRUD
  utils/
    logger.ts           # pino logger with AsyncLocalStorage tid
    sanitize.ts         # uid format validation
  types/
    omi.ts              # Omi request/response types
  views/
    login.html          # Google Sign-in page (dark theme)
    success.html        # Post-auth confirmation page
```

## Architecture

Three concerns:

1. **OAuth flow** (`/auth/*`) — login page serves HTML, `/auth/login` redirects to Google, `/auth/callback` exchanges code for tokens and stores them encrypted in SQLite, `/auth/status` returns `{ is_setup_completed }` for Omi polling.

2. **Tool endpoints** (`/tools/*`) — each POST endpoint receives `uid` from Omi, looks up encrypted tokens, refreshes if expired, calls `gws` CLI with the access token in env, parses JSON output, returns formatted result. Also mounted at `/auth/tools/*` (Omi resolves relative to App Home URL).

3. **Manifest** (`/.well-known/omi-tools.json`) — declares all 10 tools with dynamic base URL.

## Conventions

### Code Style

- One concern per file. Routes in `src/routes/`, services in `src/services/`, types in `src/types/`.
- Use `async/await` over raw promises. Prefer `const` over `let`. Never use `var`.
- Use explicit return types on exported functions.
- Define shared types in `src/types/`. Import from there, don't inline.
- Use `import`/`export` (ESM style), not `require`. All imports use `.js` extension.
- Use `try/catch` with meaningful error messages. Never swallow errors silently.
- Log with pino (`logger` from `src/utils/logger.ts`). Use `info` level in production, `debug` for local dev.

### Omi Chat Tool Endpoint Pattern

Every tool endpoint follows this exact pattern (same as omi_whatsapp):

```typescript
toolsRouter.post('/tool_name', async (req, res) => {
  const uid = req.body?.uid || (req.query.uid as string);
  if (!uid) { res.status(400).json({ error: 'Missing uid parameter' }); return; }

  const param = req.body?.param;
  if (!param) { res.status(400).json({ error: 'Missing required parameter: param' }); return; }

  let token: string;
  try {
    token = await getValidAccessToken(uid);
  } catch {
    res.status(401).json({ error: 'Google account not connected. Please connect your account in app settings.' });
    return;
  }

  try {
    const result = await executeGws([...args], token);
    res.json({ result: formatResult(result) });
  } catch (err) {
    logger.error({ uid, err }, 'Tool: tool_name failed');
    res.status(500).json({ error: 'Failed to <action>. Please try again.' });
  }
});
```

### Error Messages

- Always return `{ result: "..." }` on success, `{ error: "..." }` on failure.
- Error messages must be user-friendly — Omi's AI relays them to the user.
- Never expose raw error messages, stack traces, or gws stderr.
- Follow these patterns:

| Scenario | Status | Message |
|---|---|---|
| Missing uid | 400 | `"Missing uid parameter"` |
| Missing param | 400 | `"Missing required parameter: <name>"` |
| Invalid uid | 400 | `"Invalid uid format"` |
| Not authenticated | 401 | `"Google account not connected. Please connect your account in app settings."` |
| Token refresh failed | 401 | `"Google session expired. Please reconnect your Google account in app settings."` |
| gws CLI error | 500 | `"Failed to <action>. Please try again."` |

### gws CLI Usage

- Always use `execFile` (not `exec`) — no shell, no command injection.
- Pass args as an array — never concatenate user input into a command string.
- Pass token via `GOOGLE_WORKSPACE_CLI_TOKEN` env var (highest priority in gws auth).
- Set 30-second timeout on all gws calls.
- Handle empty stdout (e.g., `events.delete` returns nothing on success).
- gws returns errors as JSON on stdout — check for `error` field in parsed output.
- Use helper commands where available: `+send`, `+insert`, `+agenda`, `+triage`.

### Security

- Tokens encrypted at rest with AES-256-GCM before SQLite storage.
- Validate `uid` format with `sanitizeUid()` on every request.
- OAuth uses `prompt: 'consent'` to always get a refresh token.
- Always call `getValidAccessToken()` per request — never cache tokens in memory.
- Create new `OAuth2Client` instances for token refresh to avoid race conditions.

## Environment Variables

Required in `.env`:

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `BASE_URL` | Public URL of the server |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `ENCRYPTION_KEY` | 32-byte hex string for AES-256-GCM |
| `LOG_LEVEL` | pino log level (default: info) |

## Gotchas

1. **Gmail `messages.list` only returns IDs** — must call `messages.get` for each to get headers/body. Limit to 5 parallel fetches.
2. **Calendar `events.delete` returns empty stdout** — check for empty string before JSON.parse.
3. **gws first call is slow (~2-3s)** — it fetches Discovery docs, then caches for 24h.
4. **ESM has no `__dirname`** — use `path.dirname(fileURLToPath(import.meta.url))` for view paths.
5. **Omi resolves endpoints relative to App Home URL** — mount tools router at both `/tools` and `/auth/tools`.
6. **`better-sqlite3` needs native compilation** — ensure build-essential is installed on the server.
