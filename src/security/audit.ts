import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ level: 'info' });

export interface AuditEvent {
  timestamp: string;
  action: string;
  actor: string;
  target?: string;
  details?: Record<string, unknown>;
  result: 'success' | 'failure' | 'denied';
  error?: string;
}

export class AuditLog {
  constructor(private readonly filePath: string) {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      // ignore
    }
  }

  record(event: Omit<AuditEvent, 'timestamp'>): void {
    const entry: AuditEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    // Redact obvious secrets in details
    const line = JSON.stringify(entry);
    try {
      appendFileSync(this.filePath, line + '\n', { mode: 0o600 });
    } catch (e) {
      log.error({ err: e }, 'Failed to write audit log');
    }
    log.info({ audit: entry.action, result: entry.result }, 'audit');
  }

  path(): string {
    return this.filePath;
  }
}