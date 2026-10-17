import pino from 'pino';

export interface LoggerOptions {
  level?: string;
  redact?: string[];
}

const DEFAULT_REDACT = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
];

export function createLogger(opts: LoggerOptions = {}): pino.Logger {
  return pino({
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: opts.redact ?? DEFAULT_REDACT, censor: '[REDACTED]' },
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createLogger();