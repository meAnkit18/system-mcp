import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerContext } from './context.js';
import { registerFilesystemTools } from './tools/filesystem.js';
import { registerTerminalTools } from './tools/terminal.js';
import { registerSystemTools } from './tools/system.js';
import { registerGitTools } from './tools/git.js';

export function createMcpServer(ctx: ServerContext): McpServer {
  const server = new McpServer(
    { name: 'system-mcp', version: '0.1.0' },
    { capabilities: { tools: {}, logging: {} } },
  );

  registerFilesystemTools(server, ctx);
  registerTerminalTools(server, ctx);
  registerSystemTools(server, ctx);
  registerGitTools(server, ctx);

  return server;
}