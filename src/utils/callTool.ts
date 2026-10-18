import { ServerContext } from '../mcp/context.js';
import { createMcpServer } from '../mcp/mcpServer.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

export interface ToolCallResult {
  isError: boolean;
  result: any;
}

/**
 * Invoke a registered tool directly (preferred) or via an in-memory MCP
 * transport as a fallback. Used by REST and Perchance adapters.
 */
export async function callTool(ctx: ServerContext, tool: string, args: any = {}): Promise<ToolCallResult> {
  const handler = ctx.toolHandlers.get(tool);
  if (handler) {
    const res: any = await handler(args ?? {});
    const text = res?.content?.[0]?.text;
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { isError: !!res?.isError, result: parsed ?? res };
  }

  // Fallback for contexts without populated handlers.
  const server = createMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'callTool', version: '1.0' });
  await client.connect(clientTransport);
  try {
    const res: any = await client.callTool({ name: tool, arguments: args ?? {} });
    const text = res?.content?.[0]?.text;
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { isError: !!res?.isError, result: parsed ?? res };
  } finally {
    await client.close();
    await server.close();
  }
}