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
import { runAgentTask, PerchanceClient } from '../../../src/integrations/perchance/agentLoop.js';

describe('perchance agent loop', () => {
  let dir: string;
  let ws: string;
  let ctx: ServerContext;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ag-'));
    ws = path.join(dir, 'ws');
    mkdirSync(ws);
    writeFileSync(path.join(ws, 'a.txt'), 'hello');

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

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('completes a task with mocked AI', async () => {
    let step = 0;
    const client: PerchanceClient = {
      async send(prompt, history) {
        step++;
        if (step === 1) {
          return '```json\n{"type":"tool_call","id":"c1","tool":"list_files","arguments":{"path":"' + ws + '"}}\n```';
        }
        return 'Task complete. Found a.txt.';
      },
    };
    const res = await runAgentTask(ctx, client, 'Inspect project', { gatherContext: false, maxIterations: 5 });
    expect(res.status).toBe('completed');
    expect(res.toolCallCount).toBe(1);
    expect(res.finalResponse).toContain('complete');
  });

  it('respects max iterations', async () => {
    const client: PerchanceClient = {
      async send(prompt, history) {
        return '```json\n{"type":"tool_call","id":"loop","tool":"get_system_info","arguments":{}}\n```';
      },
    };
    const res = await runAgentTask(ctx, client, 'Loop forever', { gatherContext: false, maxIterations: 2, maxToolCalls: 100 });
    expect(res.status).not.toBe('completed');
  });
});