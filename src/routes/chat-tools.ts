import { Router, type Request, type Response } from 'express';
import { BASE_URL } from '../config.js';
import { AuthError, getValidAccessToken } from '../services/auth.js';
import { GwsError, executeGws } from '../services/gws.js';
import { logger } from '../utils/logger.js';

type ManifestTool = {
  name: string;
  description: string;
  endpoint: string;
  method: 'POST';
  parameters: {
    properties: Record<string, unknown>;
    required: string[];
  };
  auth_required: true;
  status_message: string;
};

type GmailMessagePayload = {
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
};

type GmailMessageResponse = {
  id?: string;
  payload?: GmailMessagePayload;
  snippet?: string;
};

function getUid(req: Request): string | undefined {
  return (req.body?.uid as string | undefined) || (req.query.uid as string | undefined);
}

function missingParam(res: Response, name: string): true {
  res.status(400).json({ error: `Missing required parameter: ${name}` });
  return true;
}

function requireUid(req: Request, res: Response): string | null {
  const uid = getUid(req);
  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return null;
  }
  return uid;
}

async function requireAccessToken(uid: string, res: Response): Promise<string | null> {
  try {
    return await getValidAccessToken(uid);
  } catch (error) {
    if (error instanceof AuthError && error.kind === 'session_expired') {
      res
        .status(401)
        .json({ error: 'Google session expired. Please reconnect your Google account in app settings.' });
      return null;
    }

    res
      .status(401)
      .json({ error: 'Google account not connected. Please connect your account in app settings.' });
    return null;
  }
}

function handleToolError(res: Response, uid: string, actionMessage: string, error: unknown): void {
  logger.error({ uid, err: error }, `Tool failed: ${actionMessage}`);
  if (error instanceof GwsError && error.kind === 'timeout') {
    res.status(500).json({ error: 'Request timed out. Please try again.' });
    return;
  }

  res.status(500).json({ error: `Failed to ${actionMessage}. Please try again.` });
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function getHeaderValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  headerName: string,
): string {
  const match = headers?.find((item) => item.name?.toLowerCase() === headerName.toLowerCase());
  return match?.value ?? '';
}

function extractMessageBody(payload?: GmailMessagePayload): string {
  if (!payload) {
    return '';
  }

  const textPart = payload.parts?.find((part) => part.mimeType === 'text/plain' && part.body?.data);
  if (textPart?.body?.data) {
    return base64UrlDecode(textPart.body.data);
  }

  if (payload.body?.data) {
    return base64UrlDecode(payload.body.data);
  }

  return '';
}

function formatAgendaTime(value: string | undefined): string {
  if (!value) {
    return 'Unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function buildManifest(baseUrl: string): { tools: ManifestTool[] } {
  const endpoint = (name: string): string => `${baseUrl}/tools/${name}`;

  return {
    tools: [
      {
        name: 'search_emails',
        description:
          'Use this when the user wants to search their Gmail inbox. Supports Gmail search syntax (from:, to:, subject:, has:attachment, etc).',
        endpoint: endpoint('search_emails'),
        method: 'POST',
        parameters: {
          properties: {
            query: {
              type: 'string',
              description: "Gmail search query (e.g., 'from:boss@company.com is:unread')",
            },
          },
          required: ['query'],
        },
        auth_required: true,
        status_message: 'Searching your emails...',
      },
      {
        name: 'read_email',
        description:
          'Use this when the user wants to read or view the contents of a specific email message.',
        endpoint: endpoint('read_email'),
        method: 'POST',
        parameters: {
          properties: {
            message_id: {
              type: 'string',
              description: 'The Gmail message ID to read',
            },
          },
          required: ['message_id'],
        },
        auth_required: true,
        status_message: 'Reading email...',
      },
      {
        name: 'send_email',
        description:
          'Use this when the user wants to send an email. Requires recipient, subject, and body.',
        endpoint: endpoint('send_email'),
        method: 'POST',
        parameters: {
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address',
            },
            subject: {
              type: 'string',
              description: 'Email subject line',
            },
            body: {
              type: 'string',
              description: 'Email body content',
            },
          },
          required: ['to', 'subject', 'body'],
        },
        auth_required: true,
        status_message: 'Sending email...',
      },
      {
        name: 'list_labels',
        description: 'Use this when the user wants to see their Gmail labels or folders.',
        endpoint: endpoint('list_labels'),
        method: 'POST',
        parameters: {
          properties: {},
          required: [],
        },
        auth_required: true,
        status_message: 'Fetching labels...',
      },
      {
        name: 'trash_email',
        description: 'Use this when the user wants to delete or trash an email message.',
        endpoint: endpoint('trash_email'),
        method: 'POST',
        parameters: {
          properties: {
            message_id: {
              type: 'string',
              description: 'The Gmail message ID to trash',
            },
          },
          required: ['message_id'],
        },
        auth_required: true,
        status_message: 'Moving email to trash...',
      },
      {
        name: 'list_events',
        description:
          "Use this when the user wants to see their upcoming calendar events, check their schedule, or see what's on their calendar for a specific day.",
        endpoint: endpoint('list_events'),
        method: 'POST',
        parameters: {
          properties: {
            date: {
              type: 'string',
              description: 'Date to list events for in YYYY-MM-DD format. Defaults to today.',
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of events to return. Defaults to 10.',
            },
          },
          required: [],
        },
        auth_required: true,
        status_message: 'Checking your calendar...',
      },
      {
        name: 'create_event',
        description:
          'Use this when the user wants to create a new calendar event, schedule a meeting, or add something to their calendar.',
        endpoint: endpoint('create_event'),
        method: 'POST',
        parameters: {
          properties: {
            summary: {
              type: 'string',
              description: 'Title of the event',
            },
            start_time: {
              type: 'string',
              description: 'Start time in ISO 8601 format (e.g., 2024-03-15T09:00:00-05:00)',
            },
            end_time: {
              type: 'string',
              description: 'End time in ISO 8601 format',
            },
            description: {
              type: 'string',
              description: 'Optional event description',
            },
            attendees: {
              type: 'string',
              description: 'Comma-separated list of attendee email addresses',
            },
          },
          required: ['summary', 'start_time', 'end_time'],
        },
        auth_required: true,
        status_message: 'Creating calendar event...',
      },
      {
        name: 'get_event',
        description: 'Use this when the user wants to see details of a specific calendar event.',
        endpoint: endpoint('get_event'),
        method: 'POST',
        parameters: {
          properties: {
            event_id: {
              type: 'string',
              description: 'The calendar event ID',
            },
          },
          required: ['event_id'],
        },
        auth_required: true,
        status_message: 'Fetching event details...',
      },
      {
        name: 'update_event',
        description:
          'Use this when the user wants to update, reschedule, or modify an existing calendar event.',
        endpoint: endpoint('update_event'),
        method: 'POST',
        parameters: {
          properties: {
            event_id: {
              type: 'string',
              description: 'The calendar event ID to update',
            },
            summary: {
              type: 'string',
              description: 'New title for the event',
            },
            start_time: {
              type: 'string',
              description: 'New start time in ISO 8601 format',
            },
            end_time: {
              type: 'string',
              description: 'New end time in ISO 8601 format',
            },
          },
          required: ['event_id'],
        },
        auth_required: true,
        status_message: 'Updating event...',
      },
      {
        name: 'delete_event',
        description: 'Use this when the user wants to delete or cancel a calendar event.',
        endpoint: endpoint('delete_event'),
        method: 'POST',
        parameters: {
          properties: {
            event_id: {
              type: 'string',
              description: 'The calendar event ID to delete',
            },
          },
          required: ['event_id'],
        },
        auth_required: true,
        status_message: 'Deleting event...',
      },
    ],
  };
}

export const manifestRouter = Router();
export const toolsRouter = Router();

manifestRouter.get('/omi-tools.json', (req, res) => {
  const baseUrl = BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json(buildManifest(baseUrl));
});

toolsRouter.post('/search_emails', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const query = req.body?.query as string | undefined;
  if (!query) {
    missingParam(res, 'query');
    return;
  }

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    const listResult = (await executeGws(
      [
        'gmail',
        'users',
        'messages',
        'list',
        '--params',
        JSON.stringify({ userId: 'me', q: query, maxResults: 10 }),
      ],
      token,
    )) as { messages?: Array<{ id?: string }> };

    const messages = (listResult.messages ?? []).filter((m) => m.id).slice(0, 5);
    if (!messages.length) {
      res.json({ result: 'No emails found matching your query.' });
      return;
    }

    const details = await Promise.all(
      messages.map((message) =>
        executeGws(
          [
            'gmail',
            'users',
            'messages',
            'get',
            '--params',
            JSON.stringify({
              userId: 'me',
              id: message.id,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'Date'],
            }),
          ],
          token,
        ),
      ),
    );

    const formatted = (details as GmailMessageResponse[]).map((item, index) => {
      const subject = getHeaderValue(item.payload?.headers, 'Subject') || '(No subject)';
      const from = getHeaderValue(item.payload?.headers, 'From') || 'Unknown sender';
      const date = getHeaderValue(item.payload?.headers, 'Date') || 'Unknown date';
      const id = item.id ? ` [id: ${item.id}]` : '';
      return `${index + 1}) ${subject} - ${from} (${date})${id}`;
    });

    res.json({ result: `Found ${formatted.length} emails:\n${formatted.join('\n')}` });
  } catch (error) {
    handleToolError(res, uid, 'search emails', error);
  }
});

toolsRouter.post('/read_email', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const messageId = req.body?.message_id as string | undefined;
  if (!messageId) {
    missingParam(res, 'message_id');
    return;
  }

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    const message = (await executeGws(
      [
        'gmail',
        'users',
        'messages',
        'get',
        '--params',
        JSON.stringify({ userId: 'me', id: messageId, format: 'full' }),
      ],
      token,
    )) as GmailMessageResponse;

    const headers = message.payload?.headers;
    const subject = getHeaderValue(headers, 'Subject') || '(No subject)';
    const from = getHeaderValue(headers, 'From') || 'Unknown sender';
    const to = getHeaderValue(headers, 'To') || 'Unknown recipient';
    const date = getHeaderValue(headers, 'Date') || 'Unknown date';
    const body = extractMessageBody(message.payload) || message.snippet || '(No readable body)';

    res.json({
      result: `From: ${from}\nTo: ${to}\nSubject: ${subject}\nDate: ${date}\n\n${body}`,
    });
  } catch (error) {
    handleToolError(res, uid, 'read email', error);
  }
});

toolsRouter.post('/send_email', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const to = req.body?.to as string | undefined;
  const subject = req.body?.subject as string | undefined;
  const body = req.body?.body as string | undefined;

  if (!to) {
    missingParam(res, 'to');
    return;
  }
  if (!subject) {
    missingParam(res, 'subject');
    return;
  }
  if (!body) {
    missingParam(res, 'body');
    return;
  }

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    await executeGws(['gmail', '+send', '--to', to, '--subject', subject, '--body', body], token);
    res.json({ result: `Email sent to ${to} with subject '${subject}'.` });
  } catch (error) {
    handleToolError(res, uid, 'send email', error);
  }
});

toolsRouter.post('/list_labels', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    const result = (await executeGws(
      ['gmail', 'users', 'labels', 'list', '--params', JSON.stringify({ userId: 'me' })],
      token,
    )) as { labels?: Array<{ name?: string; type?: string }> };

    const labels = (result.labels ?? [])
      .filter((label) => label.type === 'user')
      .map((label) => label.name)
      .filter(Boolean) as string[];

    if (!labels.length) {
      res.json({ result: 'No custom labels found.' });
      return;
    }

    res.json({ result: `Your labels: ${labels.join(', ')}` });
  } catch (error) {
    handleToolError(res, uid, 'list labels', error);
  }
});

toolsRouter.post('/trash_email', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const messageId = req.body?.message_id as string | undefined;
  if (!messageId) {
    missingParam(res, 'message_id');
    return;
  }

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    await executeGws(
      ['gmail', 'users', 'messages', 'trash', '--params', JSON.stringify({ userId: 'me', id: messageId })],
      token,
    );
    res.json({ result: 'Email moved to trash.' });
  } catch (error) {
    handleToolError(res, uid, 'trash email', error);
  }
});

toolsRouter.post('/list_events', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const dateInput = req.body?.date as string | undefined;
  const maxResultsInput = req.body?.max_results as number | undefined;
  const maxResults = Number.isFinite(maxResultsInput) ? Math.max(1, Math.floor(maxResultsInput as number)) : 10;

  const date = dateInput ? new Date(`${dateInput}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) {
    res.status(400).json({ error: 'Missing required parameter: date' });
    return;
  }

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    const result = (await executeGws(
      [
        'calendar',
        'events',
        'list',
        '--params',
        JSON.stringify({
          calendarId: 'primary',
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        }),
      ],
      token,
    )) as {
      items?: Array<{
        summary?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
      }>;
    };

    const items = result.items ?? [];
    if (!items.length) {
      res.json({ result: 'No events found for this day.' });
      return;
    }

    const formatted = items.map((event, index) => {
      const title = event.summary || '(Untitled event)';
      const startText = formatAgendaTime(event.start?.dateTime ?? event.start?.date);
      const endText = formatAgendaTime(event.end?.dateTime ?? event.end?.date);
      return `${index + 1}) ${title} - ${startText} to ${endText}`;
    });

    res.json({ result: formatted.join('\n') });
  } catch (error) {
    handleToolError(res, uid, 'list events', error);
  }
});

toolsRouter.post('/create_event', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const summary = req.body?.summary as string | undefined;
  const startTime = req.body?.start_time as string | undefined;
  const endTime = req.body?.end_time as string | undefined;
  const description = req.body?.description as string | undefined;
  const attendees = req.body?.attendees as string | undefined;

  if (!summary) {
    missingParam(res, 'summary');
    return;
  }
  if (!startTime) {
    missingParam(res, 'start_time');
    return;
  }
  if (!endTime) {
    missingParam(res, 'end_time');
    return;
  }

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    const args = ['calendar', '+insert', '--summary', summary, '--start', startTime, '--end', endTime];
    if (description) {
      args.push('--description', description);
    }
    if (attendees) {
      for (const email of attendees.split(',').map((item) => item.trim()).filter(Boolean)) {
        args.push('--attendee', email);
      }
    }

    await executeGws(args, token);
    res.json({ result: `Event '${summary}' created for ${startTime}.` });
  } catch (error) {
    handleToolError(res, uid, 'create event', error);
  }
});

toolsRouter.post('/get_event', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const eventId = req.body?.event_id as string | undefined;
  if (!eventId) {
    missingParam(res, 'event_id');
    return;
  }

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    const event = (await executeGws(
      [
        'calendar',
        'events',
        'get',
        '--params',
        JSON.stringify({ calendarId: 'primary', eventId }),
      ],
      token,
    )) as {
      summary?: string;
      status?: string;
      location?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      attendees?: Array<{ email?: string }>;
    };

    const attendees = (event.attendees ?? [])
      .map((attendee) => attendee.email)
      .filter(Boolean)
      .join(', ');

    res.json({
      result:
        `Title: ${event.summary ?? '(Untitled event)'}\n` +
        `Status: ${event.status ?? 'unknown'}\n` +
        `Start: ${event.start?.dateTime ?? event.start?.date ?? 'unknown'}\n` +
        `End: ${event.end?.dateTime ?? event.end?.date ?? 'unknown'}\n` +
        `Location: ${event.location ?? 'N/A'}\n` +
        `Attendees: ${attendees || 'None'}\n\n` +
        `Description: ${event.description ?? 'N/A'}`,
    });
  } catch (error) {
    handleToolError(res, uid, 'get event details', error);
  }
});

toolsRouter.post('/update_event', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const eventId = req.body?.event_id as string | undefined;
  const summary = req.body?.summary as string | undefined;
  const startTime = req.body?.start_time as string | undefined;
  const endTime = req.body?.end_time as string | undefined;

  if (!eventId) {
    missingParam(res, 'event_id');
    return;
  }

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  const body: Record<string, unknown> = {};
  if (summary) body.summary = summary;
  if (startTime) body.start = { dateTime: startTime };
  if (endTime) body.end = { dateTime: endTime };

  try {
    await executeGws(
      [
        'calendar',
        'events',
        'patch',
        '--params',
        JSON.stringify({ calendarId: 'primary', eventId }),
        '--json',
        JSON.stringify(body),
      ],
      token,
    );
    res.json({ result: 'Event updated.' });
  } catch (error) {
    handleToolError(res, uid, 'update event', error);
  }
});

toolsRouter.post('/delete_event', async (req, res) => {
  const uid = requireUid(req, res);
  if (!uid) return;

  const eventId = req.body?.event_id as string | undefined;
  if (!eventId) {
    missingParam(res, 'event_id');
    return;
  }

  const token = await requireAccessToken(uid, res);
  if (!token) return;

  try {
    await executeGws(
      [
        'calendar',
        'events',
        'delete',
        '--params',
        JSON.stringify({ calendarId: 'primary', eventId }),
      ],
      token,
    );
    res.json({ result: 'Event deleted.' });
  } catch (error) {
    handleToolError(res, uid, 'delete event', error);
  }
});
