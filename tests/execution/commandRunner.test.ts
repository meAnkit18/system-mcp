import { describe, it, expect, beforeEach } from 'vitest';
import { CommandStore } from '../../src/storage/commandStore.js';
import { ProcessRegistry } from '../../src/execution/processRegistry.js';
import { runCommand, terminateCommand } from '../../src/execution/commandRunner.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('commandRunner', () => {
  let store: CommandStore;
  let registry: ProcessRegistry;
  let ws: string;
  beforeEach(() => {
    store = new CommandStore();
    registry = new ProcessRegistry();
    ws = mkdtempSync(path.join(tmpdir(), 'ws-'));
  });

  it('runs echo and captures output', async () => {
    const { record } = await runCommand({
      command: 'echo', args: ['hello'], cwd: ws, timeoutMs: 5000,
      maxOutputBytes: 10000, workspaces: [ws], store, registry, maxConcurrent: 4,
    });
    // wait for completion
    await new Promise((r) => setTimeout(r, 300));
    const rec = store.get(record.id)!;
    expect(rec.status).toBe('completed');
    expect(rec.output.map(c=>c.data).join('')).toContain('hello');
  });

  it('idempotency reuses', async () => {
    const a = await runCommand({ command: 'echo', args: ['x'], cwd: ws, timeoutMs: 5000, maxOutputBytes: 10000, workspaces: [ws], store, registry, maxConcurrent: 4, idempotencyKey: 'k1' });
    const b = await runCommand({ command: 'echo', args: ['x'], cwd: ws, timeoutMs: 5000, maxOutputBytes: 10000, workspaces: [ws], store, registry, maxConcurrent: 4, idempotencyKey: 'k1' });
    expect(b.reused).toBe(true);
    expect(b.record.id).toBe(a.record.id);
  });

  it('timeout kills long command', async () => {
    const { record } = await runCommand({
      command: 'sleep', args: ['10'], cwd: ws, timeoutMs: 200, maxOutputBytes: 10000, workspaces: [ws], store, registry, maxConcurrent: 4,
    });
    await new Promise((r) => setTimeout(r, 600));
    const rec = store.get(record.id)!;
    expect(['timeout','killed','failed']).toContain(rec.status);
  }, 10000);

  it('terminate command', async () => {
    const { record } = await runCommand({
      command: 'sleep', args: ['10'], cwd: ws, timeoutMs: 10000, maxOutputBytes: 10000, workspaces: [ws], store, registry, maxConcurrent: 4,
    });
    await new Promise((r) => setTimeout(r, 100));
    const ok = terminateCommand(record.id, store, registry);
    expect(ok).toBe(true);
    const rec = store.get(record.id)!;
    expect(rec.status).toBe('killed');
  });
});