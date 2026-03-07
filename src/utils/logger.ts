import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';

type RequestContext = {
  tid: string;
};

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

const LOGS_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const DAILY_LOG_FILE = path.join(
  LOGS_DIR,
  `${new Date().toISOString().slice(0, 10)}.log`,
);

const streams = pino.multistream([
  { stream: process.stdout },
  { stream: pino.destination({ dest: DAILY_LOG_FILE, mkdir: true, sync: false }) },
]);

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const ctx = requestContextStorage.getStore();
      return ctx?.tid ? { tid: ctx.tid } : {};
    },
  },
  streams,
);
