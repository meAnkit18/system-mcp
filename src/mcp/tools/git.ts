import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execFileSync } from 'node:child_process';
import { ServerContext } from '../context.js';
import { resolveWithinWorkspaces } from '../../security/paths.js';
import { AppError } from '../../utils/errors.js';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function registerGitTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'git_status',
    {
      title: 'Git Status',
      description: 'Inspect git repository status.',
      inputSchema: {
        cwd: z.string().optional().describe('Repository working directory'),
      },
    },
    async (args: any) => {
      try {
        const dir = args.cwd ?? ctx.config.workspaces[0];
        const checked = resolveWithinWorkspaces(dir, ctx.config.workspaces);
        const status = git(checked.absolute, ['status', '--porcelain=v2', '--branch']);
        let branch = '';
        try {
          branch = git(checked.absolute, ['branch', '--show-current']).trim();
        } catch {
          branch = git(checked.absolute, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
        }
        ctx.audit.record({ action: 'git_status', actor: 'mcp', target: checked.absolute, result: 'success' });
        return ok({ cwd: checked.absolute, branch, status });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'git_diff',
    {
      title: 'Git Diff',
      description: 'Read repository changes.',
      inputSchema: {
        cwd: z.string().optional().describe('Repository working directory'),
        path: z.string().optional().describe('Limit diff to path'),
        staged: z.boolean().optional().default(false).describe('Show staged changes'),
        stat: z.boolean().optional().default(false).describe('Show stat only'),
      },
    },
    async (args: any) => {
      try {
        const dir = args.cwd ?? ctx.config.workspaces[0];
        const checked = resolveWithinWorkspaces(dir, ctx.config.workspaces);
        const gitArgs = ['diff'];
        if (args.staged) gitArgs.push('--cached');
        if (args.stat) gitArgs.push('--stat');
        if (args.path) {
          const pChecked = resolveWithinWorkspaces(args.path, ctx.config.workspaces);
          gitArgs.push('--', pChecked.absolute);
        }
        const diff = git(checked.absolute, gitArgs);
        ctx.audit.record({ action: 'git_diff', actor: 'mcp', target: checked.absolute, result: 'success' });
        return ok({ cwd: checked.absolute, diff });
      } catch (e) {
        return fail(e);
      }
    },
  );
}