import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from './mcpServer.js';
import { ServerContext } from './context.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActive: number;
}

export function registerMcpRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const sessions = new Map<string, Session>();
  const MAX_SESSIONS = 50;

  (ctx as any).__sessions = sessions;

  app.post('/mcp', async (request, reply) => {
    try {
      const sessionId = request.headers['mcp-session-id'] as string | undefined;
      let session = sessionId ? sessions.get(sessionId) : undefined;

      if (session) {
        session.lastActive = Date.now();
        await session.transport.handleRequest(request.raw, reply.raw, request.body);
        return reply;
      }

      if (!sessionId && isInitializeRequest(request.body)) {
        if (sessions.size >= MAX_SESSIONS) {
          reply.code(503).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many open sessions' }, id: null });
          return reply;
        }
        const eventStore = undefined;
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore,
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server, lastActive: Date.now() });
          },
        });
        let server = createMcpServer(ctx);
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions.has(sid)) {
            sessions.delete(sid);
            server.close().catch(() => {});
          }
        };
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
        return reply;
      }

      if (sessionId) {
        reply.code(404).send({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
        return reply;
      }

      reply.code(400).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
      return reply;
    } catch (error) {
      if (!reply.sent) {
        reply.code(500).send({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
      return reply;
    }
  });

  app.get('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      reply.code(400).send('Missing session ID');
      return reply;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      reply.code(404).send({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
      return reply;
    }
    session.lastActive = Date.now();
    await session.transport.handleRequest(request.raw, reply.raw);
    return reply;
  });

  app.delete('/mcp', async (request, reply) => {
    const sessionId = request.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      reply.code(400).send('Missing session ID');
      return reply;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      reply.code(404).send({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
      return reply;
    }
    await session.transport.handleRequest(request.raw, reply.raw);
    sessions.delete(sessionId);
    await session.server.close().catch(() => {});
    return reply;
  });
}