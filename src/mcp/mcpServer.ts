import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerContext } from './context.js';
import { registerFilesystemTools } from './tools/filesystem.js';
import { registerTerminalTools } from './tools/terminal.js';
import { registerSystemTools } from './tools/system.js';
import { registerGitTools } from './tools/git.js';

export function createMcpServer(ctx: ServerContext): McpServer {
  if (!ctx.toolHandlers) ctx.toolHandlers = new Map();

  const server = new McpServer(
    { name: 'system-mcp', version: '0.1.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  // Intercept tool registration so the same handlers are available to REST/agent
  // adapters without an MCP transport round-trip.
  const originalRegisterTool = server.registerTool.bind(server);
  (server as any).registerTool = (name: string, config: any, handler: (args: any) => Promise<any>) => {
    const wrapped = async (args: any) => handler(args ?? {});
    ctx.toolHandlers.set(name, wrapped);
    return originalRegisterTool(name, config, wrapped);
  };

  registerFilesystemTools(server, ctx);
  registerTerminalTools(server, ctx);
  registerSystemTools(server, ctx);
  registerGitTools(server, ctx);

  return server;
}