import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpServer } from '../../src/mcp/mcpServer.js';
import { ServerContext } from '../../src/mcp/context.js';
import { CommandStore } from '../../src/storage/commandStore.js';
import { ProcessRegistry } from '../../src/execution/processRegistry.js';
import { AuditLog } from '../../src/security/audit.js';
import { ApprovalManager } from '../../src/security/permissions.js';

describe('MCP integration', () => {
  let dir: string;
  let ws: string;
  let client: Client;
  let server: ReturnType<typeof createMcpServer>;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'sm-'));
    ws = path.join(dir, 'ws');
    mkdirSync(ws);
    writeFileSync(path.join(ws, 'hello.txt'), 'hello world\nsecond line');

    const ctx: ServerContext = {
      config: {
        host: '127.0.0.1', port: 0, workspaces: [ws], dataDir: dir,
        auditLogPath: path.join(dir, 'audit.log'),
        remote: { enabled: false },
        approvals: { dangerousCommands: 'allow', destructiveFileOps: 'allow' },
        limits: { maxFileSizeBytes: 1024*1024, maxCommandOutputBytes: 1024*1024, commandTimeoutMs: 5000, maxConcurrentCommands: 4, rateLimitPerMinute: 1000 },
      } as any,
      store: new CommandStore(),
      registry: new ProcessRegistry(),
      audit: new AuditLog(path.join(dir, 'audit.log')),
      approvals: new ApprovalManager(),
      startedAt: Date.now(),
    };
    server = createMcpServer(ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: 'test', version: '1.0' });
    await client.connect(ct);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('execute_command');
    expect(names.length).toBeGreaterThanOrEqual(14);
  });

  it('reads file', async () => {
    const res: any = await client.callTool({ name: 'read_file', arguments: { path: path.join(ws, 'hello.txt') } });
    const text = res.content[0].text;
    const data = JSON.parse(text);
    expect(data.content).toContain('hello world');
  });

  it('writes and edits file', async () => {
    const p = path.join(ws, 'new.txt');
    await client.callTool({ name: 'write_file', arguments: { path: p, content: 'foo bar' } });
    await client.callTool({ name: 'edit_file', arguments: { path: p, edits: [{ oldString: 'bar', newString: 'baz' }] } });
    const res: any = await client.callTool({ name: 'read_file', arguments: { path: p } });
    const data = JSON.parse(res.content[0].text);
    expect(data.content).toBe('foo baz');
  });

  it('lists files', async () => {
    const res: any = await client.callTool({ name: 'list_files', arguments: { path: ws } });
    const data = JSON.parse(res.content[0].text);
    expect(data.entries.some((e: any) => e.name === 'hello.txt')).toBe(true);
  });

  it('searches files', async () => {
    const res: any = await client.callTool({ name: 'search_files', arguments: { root: ws, query: 'hello' } });
    const data = JSON.parse(res.content[0].text);
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('executes command', async () => {
    const res: any = await client.callTool({ name: 'execute_command', arguments: { command: 'echo', args: ['hi'] } });
    const data = JSON.parse(res.content[0].text);
    await new Promise((r) => setTimeout(r, 300));
    const st: any = await client.callTool({ name: 'get_command_status', arguments: { commandId: data.commandId } });
    const sd = JSON.parse(st.content[0].text);
    expect(sd.output).toContain('hi');
  });

  it('system info', async () => {
    const res: any = await client.callTool({ name: 'get_system_info', arguments: {} });
    const data = JSON.parse(res.content[0].text);
    expect(data.platform).toBeTruthy();
  });

  it('git status in temp repo', async () => {
    // init git repo
    const { execSync } = await import('node:child_process');
    execSync('git init', { cwd: ws });
    execSync('git config user.email t@t.com', { cwd: ws });
    execSync('git config user.name t', { cwd: ws });
    const res: any = await client.callTool({ name: 'git_status', arguments: { cwd: ws } });
    const data = JSON.parse(res.content[0].text);
    expect(data.branch).toBeTruthy();
  });

  it('blocks path traversal', async () => {
    const res: any = await client.callTool({ name: 'read_file', arguments: { path: '/etc/passwd' } });
    // either isError or throws; check
    expect(res.isError === true || JSON.stringify(res).includes('outside')).toBe(true);
  });
});