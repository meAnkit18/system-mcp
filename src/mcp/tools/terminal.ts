import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerContext } from '../context.js';
import { resolveWithinWorkspaces } from '../../security/paths.js';
import { AppError } from '../../utils/errors.js';
import { classifyCommand, type RiskLevel } from '../../security/permissions.js';
import { runCommand, terminateCommand as termCmd } from '../../execution/commandRunner.js';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

export function registerTerminalTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'execute_command',
    {
      title: 'Execute Command',
      description: 'Execute a terminal command in a workspace directory. Long-running commands return a command id.',
      inputSchema: {
        command: z.string().describe('Command to execute'),
        args: z.array(z.string()).optional().describe('Arguments'),
        cwd: z.string().optional().describe('Working directory'),
        timeoutMs: z.number().int().positive().optional().describe('Timeout in ms'),
        idempotencyKey: z.string().optional().describe('Idempotency key to prevent duplicates'),
        approvalId: z.string().optional().describe('Approval id for dangerous commands'),
      },
    },
    async (args: any) => {
      try {
        const risk: RiskLevel = classifyCommand(args.command + ' ' + (args.args ?? []).join(' '));
        const mode = ctx.config.approvals.dangerousCommands;

        if (risk === 'dangerous') {
          if (mode === 'block') {
            throw new AppError('COMMAND_BLOCKED', 'Dangerous command blocked by configuration', undefined, 403);
          }
          if (mode === 'require-approval') {
            if (args.approvalId) {
              const req = ctx.approvals.get(args.approvalId);
              if (!req || req.status !== 'approved') {
                throw new AppError('APPROVAL_NOT_GRANTED', 'Approval not granted', { approvalId: args.approvalId }, 403);
              }
            } else {
              const req = ctx.approvals.create({
                type: 'command',
                description: `Execute dangerous command: ${args.command}`,
                payload: { command: args.command, args: args.args, cwd: args.cwd },
                risk: 'dangerous',
              });
              ctx.audit.record({ action: 'execute_command', actor: 'mcp', target: args.command, result: 'denied', details: { reason: 'approval_required', approvalId: req.id } });
              return ok({ status: 'pending_approval', approvalId: req.id, risk, message: 'Approval required before execution' });
            }
          }
        }

        const timeoutMs = args.timeoutMs ?? ctx.config.limits.commandTimeoutMs;
        const { record, reused } = await runCommand({
          command: args.command,
          args: args.args,
          cwd: args.cwd,
          timeoutMs,
          maxOutputBytes: ctx.config.limits.maxCommandOutputBytes,
          workspaces: ctx.config.workspaces,
          idempotencyKey: args.idempotencyKey,
          store: ctx.store,
          registry: ctx.registry,
          maxConcurrent: ctx.config.limits.maxConcurrentCommands,
        });

        ctx.audit.record({ action: 'execute_command', actor: 'mcp', target: args.command, result: 'success', details: { commandId: record.id, risk, reused } });
        return ok({
          commandId: record.id,
          status: record.status,
          risk,
          reused,
          pid: record.pid,
          cwd: record.cwd,
        });
      } catch (e) {
        ctx.audit.record({ action: 'execute_command', actor: 'mcp', target: args.command, result: 'failure', error: (e as Error).message });
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_command_status',
    {
      title: 'Get Command Status',
      description: 'Retrieve status and output of a command by id.',
      inputSchema: {
        commandId: z.string().describe('Command id'),
      },
    },
    async (args: any) => {
      try {
        const rec = ctx.store.get(args.commandId);
        if (!rec) throw new AppError('NOT_FOUND', 'Command not found or expired');
        const output = rec.output.map((c) => `[${c.stream}] ${c.data}`).join('');
        ctx.audit.record({ action: 'get_command_status', actor: 'mcp', target: args.commandId, result: 'success' });
        return ok({
          commandId: rec.id,
          status: rec.status,
          exitCode: rec.exitCode,
          signal: rec.signal,
          startedAt: new Date(rec.startedAt).toISOString(),
          finishedAt: rec.finishedAt ? new Date(rec.finishedAt).toISOString() : null,
          truncated: rec.truncated,
          output,
          chunks: rec.output.length,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'terminate_command',
    {
      title: 'Terminate Command',
      description: 'Stop a running command.',
      inputSchema: {
        commandId: z.string().describe('Command id'),
      },
    },
    async (args: any) => {
      try {
        const ok2 = termCmd(args.commandId, ctx.store, ctx.registry);
        ctx.audit.record({ action: 'terminate_command', actor: 'mcp', target: args.commandId, result: ok2 ? 'success' : 'failure' });
        return ok({ commandId: args.commandId, terminated: ok2 });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_processes',
    {
      title: 'List Processes',
      description: 'List processes started or managed by this server.',
      inputSchema: {},
    },
    async () => {
      try {
        const procs = ctx.registry.list().map((p) => ({
          id: p.id,
          pid: p.pid,
          command: p.command,
          cwd: p.cwd,
          status: p.status,
          startedAt: new Date(p.startedAt).toISOString(),
          exitCode: p.exitCode,
          signal: p.signal,
        }));
        return ok({ processes: procs });
      } catch (e) {
        return fail(e);
      }
    },
  );
}