# Omi Google Workspace Integration

Node.js + TypeScript server that connects Gmail and Google Calendar tools to Omi chat using the `gws` CLI.

## Features

- Google OAuth setup flow for each Omi user (`uid`)
- Encrypted token storage in SQLite (`AES-256-GCM`)
- Omi tool manifest at `/.well-known/omi-tools.json`
- 10 tool endpoints for Gmail and Calendar
- Request-scoped structured logging with pino + `tid`

## Requirements

- Node.js 22 LTS
- npm
- `gws` CLI installed (`npm install -g @googleworkspace/cli`)
- Native build toolchain for `better-sqlite3` (Xcode CLI tools on macOS, build-essential on Linux)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy env file:

```bash
cp .env.example .env
```

3. Generate `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. Fill OAuth values in `.env`.

5. Run:

```bash
npm run dev
```

## Environment Variables

- `PORT` (default: `3000`)
- `BASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ENCRYPTION_KEY` (64 hex chars)
- `LOG_LEVEL` (default: `info`)

## Routes

- `GET /health`
- `GET /auth?uid=<uid>` login page
- `GET /auth/login?uid=<uid>` redirect to Google OAuth
- `GET /auth/callback` OAuth callback
- `GET /auth/status?uid=<uid>` setup status for Omi polling
- `GET /.well-known/omi-tools.json` Omi tool manifest
- `POST /tools/*` tool endpoints
- `POST /auth/tools/*` mirrored tool endpoints for Omi relative path behavior

## Development Commands

```bash
npm run dev
npm run build
npm run start
npm test
```

## Deployment

Uses `pm2` with:

```bash
bash deploy.sh
```
