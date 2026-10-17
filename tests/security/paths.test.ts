import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveWithinWorkspaces, isWithin } from '../../src/security/paths.js';

describe('paths', () => {
  let dir: string;
  let ws: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sm-'));
    ws = path.join(dir, 'ws');
    mkdirSync(ws);
    writeFileSync(path.join(ws, 'a.txt'), 'hi');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('allows path inside workspace', () => {
    const r = resolveWithinWorkspaces('a.txt', [ws]);
    expect(r.absolute).toBe(path.join(ws, 'a.txt'));
  });

  it('blocks traversal', () => {
    expect(() => resolveWithinWorkspaces('../etc/passwd', [ws])).toThrow();
  });

  it('blocks absolute outside', () => {
    expect(() => resolveWithinWorkspaces('/etc/passwd', [ws])).toThrow();
  });

  it('blocks symlink escape', () => {
    const link = path.join(ws, 'link');
    try { symlinkSync('/etc', link); } catch {}
    expect(() => resolveWithinWorkspaces('link/passwd', [ws])).toThrow();
  });

  it('isWithin works', () => {
    expect(isWithin(path.join(ws, 'a'), ws)).toBe(true);
    expect(isWithin('/etc', ws)).toBe(false);
  });
});