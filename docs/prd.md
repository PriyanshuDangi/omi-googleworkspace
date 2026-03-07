# PRD: Omi Chat Tools App for Google Workspace

## Overview

A chat tools app for [Omi](https://omi.me) that lets users interact with their Google Workspace (Gmail & Calendar) through natural language in the Omi chat interface. The app provides a simple web UI for Google OAuth login and exposes Omi-compatible chat tool endpoints powered by the [Google Workspace CLI (`gws`)](https://github.com/googleworkspace/cli).

## Problem

Users want to manage their Gmail and Google Calendar without leaving the Omi chat interface. Currently there's no Omi app that bridges Google Workspace actions into Omi's conversational AI.

## Solution

A self-hosted Node.js (Express) server that:

1. Hosts a login UI where users authenticate with their Google account via OAuth
2. Stores per-user OAuth credentials securely
3. Exposes Omi chat tool endpoints that execute `gws` CLI commands on behalf of authenticated users
4. Serves the Omi tool manifest at `/.well-known/omi-tools.json`

## Architecture

```
+-------------------+          +-------------------------+         +------------------+
|   Omi Chat AI     |  POST    |   Express Server        |  exec   |   gws CLI        |
|   (sends tool     | -------> |                         | ------> |   (Google APIs)  |
|    invocations)   |          |   - Auth middleware      |         +------------------+
+-------------------+          |   - Tool endpoints       |
                               |   - OAuth flow           |
+-------------------+          |   - Credential store     |
|   User Browser    |  OAuth   |                         |
|   (login UI)      | -------> |   /auth/google          |
+-------------------+          +-------------------------+
                                        |
                                        v
                               +------------------+
                               |   SQLite / JSON  |
                               |   (user creds)   |
                               +------------------+
```

## User Flow

### 1. Authentication

1. User installs the app from the Omi App Store
2. User is directed to the app's login page (`/auth/login`)
3. User clicks "Sign in with Google" -- initiates OAuth 2.0 consent flow
4. App requests Gmail + Calendar scopes
5. On callback, the server stores the OAuth tokens (access + refresh) mapped to the user's Omi `uid`
6. User sees a success screen and returns to Omi chat

### 2. Chat Interaction

1. User types a natural language request in Omi chat (e.g., "What's on my calendar today?")
2. Omi AI matches the request to one of the registered chat tools
3. Omi sends a POST request to the tool's endpoint with extracted parameters and the user's `uid`
4. Server looks up the user's stored OAuth token, sets it via `GOOGLE_WORKSPACE_CLI_TOKEN` env var
5. Server executes the appropriate `gws` command and parses the JSON output
6. Server returns a formatted result to Omi, which displays it in chat

## MVP Scope -- Gmail Tools

| Tool Name | Description | gws Command | Parameters |
|---|---|---|---|
| `search_emails` | Search emails by query | `gws gmail users.messages list` | `query` (string) |
| `read_email` | Read a specific email | `gws gmail users.messages get` | `message_id` (string) |
| `send_email` | Send an email | `gws gmail users.messages send` | `to`, `subject`, `body` |
| `list_labels` | List all Gmail labels | `gws gmail users.labels list` | -- |
| `trash_email` | Move an email to trash | `gws gmail users.messages trash` | `message_id` (string) |

## MVP Scope -- Calendar Tools

| Tool Name | Description | gws Command | Parameters |
|---|---|---|---|
| `list_events` | List upcoming events | `gws calendar events list` | `date` (optional), `max_results` (optional) |
| `create_event` | Create a calendar event | `gws calendar events insert` | `summary`, `start_time`, `end_time`, `description` (optional), `attendees` (optional) |
| `get_event` | Get details of an event | `gws calendar events get` | `event_id` |
| `update_event` | Update an existing event | `gws calendar events update` | `event_id`, `summary`, `start_time`, `end_time` |
| `delete_event` | Delete a calendar event | `gws calendar events delete` | `event_id` |

## Omi Tool Manifest

Served at `GET /.well-known/omi-tools.json`:

```json
{
  "tools": [
    {
      "name": "search_emails",
      "description": "Use this when the user wants to search their Gmail inbox. Supports Gmail search syntax (from:, to:, subject:, has:attachment, etc).",
      "endpoint": "/api/tools/search_emails",
      "method": "POST",
      "parameters": {
        "properties": {
          "query": {
            "type": "string",
            "description": "Gmail search query (e.g., 'from:boss@company.com is:unread')"
          }
        },
        "required": ["query"]
      },
      "auth_required": true,
      "status_message": "Searching your emails..."
    },
    {
      "name": "read_email",
      "description": "Use this when the user wants to read or view the contents of a specific email message.",
      "endpoint": "/api/tools/read_email",
      "method": "POST",
      "parameters": {
        "properties": {
          "message_id": {
            "type": "string",
            "description": "The Gmail message ID to read"
          }
        },
        "required": ["message_id"]
      },
      "auth_required": true,
      "status_message": "Reading email..."
    },
    {
      "name": "send_email",
      "description": "Use this when the user wants to send an email. Requires recipient, subject, and body.",
      "endpoint": "/api/tools/send_email",
      "method": "POST",
      "parameters": {
        "properties": {
          "to": {
            "type": "string",
            "description": "Recipient email address"
          },
          "subject": {
            "type": "string",
            "description": "Email subject line"
          },
          "body": {
            "type": "string",
            "description": "Email body content"
          }
        },
        "required": ["to", "subject", "body"]
      },
      "auth_required": true,
      "status_message": "Sending email..."
    },
    {
      "name": "list_labels",
      "description": "Use this when the user wants to see their Gmail labels or folders.",
      "endpoint": "/api/tools/list_labels",
      "method": "POST",
      "parameters": {
        "properties": {},
        "required": []
      },
      "auth_required": true,
      "status_message": "Fetching labels..."
    },
    {
      "name": "trash_email",
      "description": "Use this when the user wants to delete or trash an email message.",
      "endpoint": "/api/tools/trash_email",
      "method": "POST",
      "parameters": {
        "properties": {
          "message_id": {
            "type": "string",
            "description": "The Gmail message ID to trash"
          }
        },
        "required": ["message_id"]
      },
      "auth_required": true,
      "status_message": "Moving email to trash..."
    },
    {
      "name": "list_events",
      "description": "Use this when the user wants to see their upcoming calendar events, check their schedule, or see what's on their calendar for a specific day.",
      "endpoint": "/api/tools/list_events",
      "method": "POST",
      "parameters": {
        "properties": {
          "date": {
            "type": "string",
            "description": "Date to list events for in YYYY-MM-DD format. Defaults to today."
          },
          "max_results": {
            "type": "number",
            "description": "Maximum number of events to return. Defaults to 10."
          }
        },
        "required": []
      },
      "auth_required": true,
      "status_message": "Checking your calendar..."
    },
    {
      "name": "create_event",
      "description": "Use this when the user wants to create a new calendar event, schedule a meeting, or add something to their calendar.",
      "endpoint": "/api/tools/create_event",
      "method": "POST",
      "parameters": {
        "properties": {
          "summary": {
            "type": "string",
            "description": "Title of the event"
          },
          "start_time": {
            "type": "string",
            "description": "Start time in ISO 8601 format (e.g., 2024-03-15T09:00:00-05:00)"
          },
          "end_time": {
            "type": "string",
            "description": "End time in ISO 8601 format"
          },
          "description": {
            "type": "string",
            "description": "Optional event description"
          },
          "attendees": {
            "type": "string",
            "description": "Comma-separated list of attendee email addresses"
          }
        },
        "required": ["summary", "start_time", "end_time"]
      },
      "auth_required": true,
      "status_message": "Creating calendar event..."
    },
    {
      "name": "get_event",
      "description": "Use this when the user wants to see details of a specific calendar event.",
      "endpoint": "/api/tools/get_event",
      "method": "POST",
      "parameters": {
        "properties": {
          "event_id": {
            "type": "string",
            "description": "The calendar event ID"
          }
        },
        "required": ["event_id"]
      },
      "auth_required": true,
      "status_message": "Fetching event details..."
    },
    {
      "name": "update_event",
      "description": "Use this when the user wants to update, reschedule, or modify an existing calendar event.",
      "endpoint": "/api/tools/update_event",
      "method": "POST",
      "parameters": {
        "properties": {
          "event_id": {
            "type": "string",
            "description": "The calendar event ID to update"
          },
          "summary": {
            "type": "string",
            "description": "New title for the event"
          },
          "start_time": {
            "type": "string",
            "description": "New start time in ISO 8601 format"
          },
          "end_time": {
            "type": "string",
            "description": "New end time in ISO 8601 format"
          }
        },
        "required": ["event_id"]
      },
      "auth_required": true,
      "status_message": "Updating event..."
    },
    {
      "name": "delete_event",
      "description": "Use this when the user wants to delete or cancel a calendar event.",
      "endpoint": "/api/tools/delete_event",
      "method": "POST",
      "parameters": {
        "properties": {
          "event_id": {
            "type": "string",
            "description": "The calendar event ID to delete"
          }
        },
        "required": ["event_id"]
      },
      "auth_required": true,
      "status_message": "Deleting event..."
    }
  ]
}
```

## Technical Details

### Tech Stack

- **Runtime:** Node.js
- **Framework:** Express
- **CLI Dependency:** `@googleworkspace/cli` (`gws`) installed globally on the server
- **Database:** SQLite (via `better-sqlite3`) for storing user OAuth tokens
- **Auth:** Google OAuth 2.0 (Desktop/Web app credentials)
- **Deployment:** Self-hosted VPS (Docker recommended)

### Project Structure

```
googleworkspace/
  src/
    index.ts                 # Express app entry point
    config.ts                # Environment config
    routes/
      auth.ts                # OAuth login/callback routes
      tools.ts               # Omi chat tool endpoints
      manifest.ts            # /.well-known/omi-tools.json
    services/
      gws.ts                 # gws CLI wrapper (exec + parse JSON)
      gmail.ts               # Gmail-specific tool logic
      calendar.ts            # Calendar-specific tool logic
      token-store.ts         # SQLite token storage
    middleware/
      auth.ts                # Validate user has stored tokens
    views/
      login.html             # Google Sign-in page
      success.html           # Post-auth success page
      error.html             # Error page
  .env.example               # Required env vars
  package.json
  tsconfig.json
  Dockerfile
  docker-compose.yml
  docs/
    prd.md                   # This file
```

### Key Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `SESSION_SECRET` | Express session secret |
| `BASE_URL` | Public URL of the server (for Omi manifest) |
| `ENCRYPTION_KEY` | AES key for encrypting stored tokens |

### gws CLI Integration

Each tool endpoint follows this pattern:

```typescript
async function executeGws(command: string, token: string): Promise<object> {
  const result = await execPromise(command, {
    env: {
      ...process.env,
      GOOGLE_WORKSPACE_CLI_TOKEN: token,
    },
  });
  return JSON.parse(result.stdout);
}
```

The server passes the user's stored OAuth access token via `GOOGLE_WORKSPACE_CLI_TOKEN` env var, so `gws` authenticates as that user without needing its own credential store.

### Token Management

- Access tokens are refreshed automatically using the stored refresh token
- Tokens are encrypted at rest using AES-256-GCM before storing in SQLite
- If a token refresh fails, the tool returns an error guiding the user to re-authenticate

### Security

- All stored tokens encrypted at rest (AES-256-GCM)
- HTTPS required in production
- Rate limiting: 60 requests per minute per user
- Input validation on all tool parameters
- No raw error messages exposed to users -- all errors return user-friendly guidance
- CORS restricted to Omi domains

## API Endpoints

### Auth

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/login?uid={omi_uid}` | Renders Google Sign-in page |
| `GET` | `/auth/callback` | OAuth callback, stores tokens |
| `GET` | `/auth/status?uid={omi_uid}` | Check if user is authenticated |

### Tools (called by Omi)

All tool endpoints accept POST with JSON body containing `uid`, `app_id`, `tool_name`, and tool-specific parameters.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/tools/search_emails` | Search Gmail |
| `POST` | `/api/tools/read_email` | Read an email |
| `POST` | `/api/tools/send_email` | Send an email |
| `POST` | `/api/tools/list_labels` | List Gmail labels |
| `POST` | `/api/tools/trash_email` | Trash an email |
| `POST` | `/api/tools/list_events` | List calendar events |
| `POST` | `/api/tools/create_event` | Create a calendar event |
| `POST` | `/api/tools/get_event` | Get event details |
| `POST` | `/api/tools/update_event` | Update an event |
| `POST` | `/api/tools/delete_event` | Delete an event |

### Manifest

| Method | Path | Description |
|---|---|---|
| `GET` | `/.well-known/omi-tools.json` | Omi tool manifest |

## Example Conversations

**User:** "What meetings do I have tomorrow?"
**Omi AI** calls `list_events` with `{"date": "2026-03-08"}`
**Response:** "You have 3 events tomorrow: 1) Team Standup at 9:00 AM, 2) Design Review at 11:00 AM, 3) 1:1 with Manager at 2:00 PM"

**User:** "Send an email to john@example.com about the project update"
**Omi AI** calls `send_email` with `{"to": "john@example.com", "subject": "Project Update", "body": "..."}`
**Response:** "Email sent to john@example.com with subject 'Project Update'"

**User:** "Search my emails from HR about benefits"
**Omi AI** calls `search_emails` with `{"query": "from:hr subject:benefits"}`
**Response:** "Found 5 emails matching your search: 1) Benefits Enrollment Deadline -- Mar 1, 2) ..."

## Post-MVP Roadmap

1. **Google Drive** -- list, search, upload, download, share files
2. **Google Sheets** -- create, read, update spreadsheets
3. **Google Docs** -- create and edit documents
4. **Reply to email** -- reply/forward within email threads
5. **Proactive notifications** -- use Omi's notification API to alert users of new emails or upcoming events
6. **Multi-account support** -- link multiple Google accounts

## Success Metrics

- Users can authenticate in under 30 seconds
- Tool response time < 3 seconds for all operations
- Zero token leaks or security incidents
- 95%+ uptime for the hosted service
