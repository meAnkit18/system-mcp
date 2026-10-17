import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { ServerContext } from '../context.js';

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
}

function tryVersion(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function registerSystemTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    'get_system_info',
    {
      title: 'Get System Info',
      description: 'Retrieve OS, architecture, disk space, and installed runtimes.',
      inputSchema: {},
    },
    async () => {
      try {
        let disk: any = null;
        try {
          const s = statfsSync(ctx.config.workspaces[0] ?? os.homedir());
          disk = { totalBytes: s.blocks * s.bsize, freeBytes: s.bfree * s.bsize, availableBytes: s.bavail * s.bsize };
        } catch {
          disk = null;
        }
        const info = {
          platform: process.platform,
          osType: os.type(),
          osRelease: os.release(),
          arch: process.arch,
          hostname: os.hostname(),
          cpus: os.cpus().length,
          totalMemoryBytes: os.totalmem(),
          freeMemoryBytes: os.freemem(),
          uptimeSeconds: os.uptime(),
          nodeVersion: process.version,
          workspaces: ctx.config.workspaces,
          disk,
          runtimes: {
            node: process.version,
            npm: tryVersion('npm --version'),
            python: tryVersion('python3 --version') ?? tryVersion('python --version'),
            git: tryVersion('git --version'),
            docker: tryVersion('docker --version'),
          },
          startedAt: new Date(ctx.startedAt).toISOString(),
        };
        ctx.audit.record({ action: 'get_system_info', actor: 'mcp', result: 'success' });
        return ok(info);
      } catch (e) {
        return fail(e);
      }
    },
  );
}