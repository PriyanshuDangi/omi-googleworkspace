import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const GWS_BIN = process.env.GWS_BIN ?? 'gws';
const TIMEOUT_MS = 30_000;

export type GwsErrorKind = 'timeout' | 'upstream';

export class GwsError extends Error {
  readonly kind: GwsErrorKind;

  constructor(kind: GwsErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

function parseJsonOutput(stdout: string): unknown {
  if (!stdout.trim()) {
    return {};
  }

  return JSON.parse(stdout);
}

function containsErrorPayload(payload: unknown): payload is { error: unknown } {
  return Boolean(payload && typeof payload === 'object' && 'error' in payload);
}

export async function executeGws(args: string[], token: string): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(GWS_BIN, args, {
      env: {
        ...process.env,
        GOOGLE_WORKSPACE_CLI_TOKEN: token,
      },
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });

    const parsed = parseJsonOutput(stdout);
    if (containsErrorPayload(parsed)) {
      throw new GwsError('upstream', 'Google Workspace request failed');
    }

    return parsed;
  } catch (error) {
    const err = error as { stderr?: string; code?: string | number; signal?: string };
    const isTimeout = err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT';

    logger.error(
      {
        args,
        code: err.code,
        signal: err.signal,
        stderr: err.stderr,
      },
      'gws command failed',
    );

    if (isTimeout) {
      throw new GwsError('timeout', 'Request timed out. Please try again.');
    }

    throw new GwsError('upstream', 'Google Workspace request failed');
  }
}
