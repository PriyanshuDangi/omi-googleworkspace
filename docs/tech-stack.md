# Tech Stack

Mirrors the patterns from [omi_whatsapp](https://github.com/PriyanshuDangi/omi_whatsapp). Same conventions, same tooling, just different service underneath.

## Core

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Node.js 22 LTS** | Native `fetch`, stable `child_process` for `gws` CLI |
| Language | **TypeScript 5 (strict)** | Same `tsconfig.json` setup as omi_whatsapp |
| Framework | **Express 4** | Same version as omi_whatsapp. Proven, stable |
| CLI | **@googleworkspace/cli** | Installed globally on server. Invoked via `child_process.execFile` per request |

## Data & Auth

| Layer | Choice | Notes |
|---|---|---|
| Token storage | **better-sqlite3** | Single-file DB, synchronous API. Stores encrypted OAuth tokens keyed by Omi `uid` |
| OAuth | **google-auth-library** | Official Google library. Handles OAuth2 flow + token refresh. Lighter than full `googleapis` SDK |
| Encryption | **Node.js built-in `crypto`** | AES-256-GCM for tokens at rest. Zero dependencies |

## Developer Experience

| Layer | Choice | Notes |
|---|---|---|
| Dev runner | **tsx** | `tsx watch src/index.ts` -- same as omi_whatsapp |
| Build | **tsc** | `tsc && cp views` -- same as omi_whatsapp. No bundler needed |
| Logging | **pino** | Structured JSON logs, same as omi_whatsapp |
| Testing | **vitest** | Same as omi_whatsapp |
| Env | **dotenv** | `.env` file loading |

## Deployment

| Layer | Choice | Notes |
|---|---|---|
| Process manager | **pm2** | `ecosystem.config.cjs` -- same pattern as omi_whatsapp |
| Reverse proxy | **nginx** (or Caddy) | SSL termination, same as omi_whatsapp server setup |
| Deploy | **deploy.sh** | `git pull → npm ci → npm run build → pm2 reload` -- same flow |

## Production Dependencies (6 packages)

```json
{
  "dependencies": {
    "express": "^4.21.0",
    "better-sqlite3": "^11.0.0",
    "google-auth-library": "^9.0.0",
    "pino": "^9.6.0",
    "dotenv": "^16.4.0",
    "@googleworkspace/cli": "^0.5.0"
  }
}
```

## Dev Dependencies (5 packages)

```json
{
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.19.0",
    "@types/express": "^5.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "vitest": "^4.0.0"
  }
}
```

**Total: 11 packages.**

## What we dropped (and why)

| Removed | Why |
|---|---|
| **zod** | Manual `if (!param)` checks work fine for 10 endpoints -- same pattern as omi_whatsapp |
| **helmet** | All tool requests come from Omi backend servers, not browsers. Security headers don't apply |
| **cors** | Same reason -- no browser clients. Omi calls our endpoints server-to-server |
| **express-rate-limit** | All requests come from Omi's servers (same IP). Can't rate-limit by IP. If needed later, rate-limit per `uid` in middleware |
| **tsup** | `tsc` is enough. No need for a bundler -- same as omi_whatsapp |
| **Docker** | pm2 handles restarts and monitoring. deploy.sh handles deploys. Same as omi_whatsapp |

## Scripts

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

## Project Structure

```
googleworkspace/
  src/
    index.ts                  # Express app entry
    config.ts                 # Env vars
    routes/
      auth.ts                 # OAuth login/callback
      chat-tools.ts           # Manifest + tool endpoints
    services/
      gws.ts                  # gws CLI wrapper
      token-store.ts          # SQLite encrypted token CRUD
    utils/
      logger.ts               # pino logger (same as omi_whatsapp)
      sanitize.ts             # uid sanitization (same as omi_whatsapp)
    types/
      omi.ts                  # Omi request types
    views/
      login.html              # Google Sign-in page
      success.html            # Post-auth confirmation
  ecosystem.config.cjs        # pm2 config
  deploy.sh                   # deploy script
  .env.example
  package.json
  tsconfig.json
  docs/
    prd.md
    tech-stack.md
```
