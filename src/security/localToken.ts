import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Get or create a local credential used to authenticate browser-extension and
 * fetch-only agent requests to the daemon. Stored with restrictive permissions.
 */
export function getOrCreateLocalToken(dataDir: string): string {
  const tokenPath = join(dataDir, 'extension-token');
  try {
    if (existsSync(tokenPath)) {
      const t = readFileSync(tokenPath, 'utf8').trim();
      if (t.length >= 16) return t;
    }
  } catch {
    // fall through to (re)create
  }
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {
    // ignore
  }
  const token = randomBytes(32).toString('hex');
  try {
    writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
  } catch {
    // best effort
  }
  return token;
}