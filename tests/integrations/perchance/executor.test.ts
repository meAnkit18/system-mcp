import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMcpServer } from '../../../src/mcp/mcpServer.js';
import { ServerContext } from '../../../src/mcp/context.js';
import { CommandStore } from '../../../src/storage/commandStore.js';
import { ProcessRegistry } from '../../../src/execution/processRegistry.js';
import { AuditLog } from '../../../src/security/audit.js';
import { ApprovalManager } from '../../../src/security/permissions.js';
import { executeToolCall } from '../../../src/integrations/perchance/executor.js';

describe('perchance executor', () => {
  let dir: string;
  let ws: string;
  let ctx: ServerContext;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'px-'));
    ws = path.join(dir, 'ws');
    mkdirSync(ws);
    writeFileSync(path.join(ws, 'hello.txt'), 'hello world');

    ctx = {
      config: {
        host: '127.0.0.1', port: 0, workspaces: [ws], dataDir: dir,
        auditLogPath: path.join(dir, 'audit.log'),
        remote: { enabled: false },
        approvals: { dangerousCommands: 'allow', destructiveFileOps: 'allow' },
        limits: { maxFileSizeBytes: 1024 * 1024, maxCommandOutputBytes: 1024 * 1024, commandTimeoutMs: 5000, maxConcurrentCommands: 4, rateLimitPerMinute: 1000 },
      } as any,
      store: new CommandStore(),
      registry: new ProcessRegistry(),
      audit: new AuditLog(path.join(dir, 'audit.log')),
      approvals: new ApprovalManager(),
      startedAt: Date.now(),
      toolHandlers: new Map(),
      toolCallResults: new Map(),
    };
    createMcpServer(ctx);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('executes list_files', async () => {
    const r = await executeToolCall(ctx, { type: 'tool_call', id: 'c1', tool: 'list_files', arguments: { path: ws } });
    expect(r.ok).toBe(true);
    expect((r.result as any).entries.some((e: any) => e.name === 'hello.txt')).toBe(true);
  });

  it('rejects invalid tool request', async () => {
    const r = await executeToolCall(ctx, { type: 'tool_call', id: 'c2', tool: 'nope', arguments: {} }, { allowedTools: ['list_files'] });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('UNKNOWN_TOOL');
  });

  it('rejects path traversal', async () => {
    const r = await executeToolCall(ctx, { type: 'tool_call', id: 'c3', tool: 'read_file', arguments: { path: '/etc/passwd' } });
    expect(r.ok).toBe(false);
  });

  it('prevents duplicate execution', async () => {
    const first = await executeToolCall(ctx, { type: 'tool_call', id: 'dup', tool: 'get_system_info', arguments: {} });
    expect(first.ok).toBe(true);
    const second = await executeToolCall(ctx, { type: 'tool_call', id: 'dup', tool: 'get_system_info', arguments: {} });
    expect(second.duplicate).toBe(true);
  });

  it('runs command and returns output', async () => {
    const r = await executeToolCall(ctx, { type: 'tool_call', id: 'cmd1', tool: 'execute_command', arguments: { command: 'echo', args: ['hi'] } });
    expect(r.ok).toBe(true);
    const cmdId = (r.result as any).commandId;
    await new Promise((res) => setTimeout(res, 300));
    const st = await executeToolCall(ctx, { type: 'tool_call', id: 'cmd2', tool: 'get_command_status', arguments: { commandId: cmdId } });
    expect((st.result as any).output).toContain('hi');
  });
});
