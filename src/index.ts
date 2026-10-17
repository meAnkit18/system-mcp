#!/usr/bin/env node
import { loadConfig } from './daemon/config.js';
import { buildServer } from './daemon/server.js';
import { ServerContext } from './mcp/context.js';
import { CommandStore } from './storage/commandStore.js';
import { ProcessRegistry } from './execution/processRegistry.js';
import { AuditLog } from './security/audit.js';
import { ApprovalManager } from './security/permissions.js';
import { validateWorkspaces } from './security/paths.js';
import { createLogger } from './utils/logger.js';

const log = createLogger();

async function main() {
  const config = loadConfig();
  config.workspaces = validateWorkspaces(config.workspaces);

  const ctx: ServerContext = {
    config,
    store: new CommandStore(),
    registry: new ProcessRegistry(),
    audit: new AuditLog(config.auditLogPath!),
    approvals: new ApprovalManager(),
    startedAt: Date.now(),
  };

  const app = await buildServer(ctx);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down');
    ctx.registry.killAll();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  log.info({ host: config.host, port: config.port, workspaces: config.workspaces }, 'system-mcp daemon listening');
  // eslint-disable-next-line no-console
  console.log(`\nsystem-mcp running at http://${config.host}:${config.port}`);
  console.log(`Dashboard: http://${config.host}:${config.port}/dashboard`);
  console.log(`MCP endpoint: http://${config.host}:${config.port}/mcp`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});