import Fastify from 'fastify';
import { ServerContext } from '../mcp/context.js';
import { registerMcpRoutes } from '../mcp/transport.js';
import { registerDashboardRoutes } from '../dashboard/routes.js';
import { createLogger } from '../utils/logger.js';
import { RateLimiter } from '../security/rateLimit.js';

const log = createLogger();

export async function buildServer(ctx: ServerContext) {
  const app = Fastify({ logger: false });

  const limiter = new RateLimiter(ctx.config.limits.rateLimitPerMinute);
  const token = ctx.localToken ?? process.env.SYSTEM_MCP_TOKEN;

  // Rate limit middleware
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return; // handle in CORS hook
    const key = req.ip ?? 'local';
    const r = limiter.check(key);
    if (!r.allowed) {
      reply.code(429).send({ error: 'Rate limit exceeded' });
      return;
    }

    // Origin validation (defense in depth; not sole authorization).
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      const okOrigin =
        origin === 'null' ||
        origin.startsWith('http://127.0.0.1') ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('https://');
      if (!okOrigin) {
        reply.code(403).send({ error: 'Origin not allowed' });
        return;
      }
    }

    // Token enforcement for sensitive endpoints when a token is configured.
    const sensitive = req.url.startsWith('/mcp') || req.url.startsWith('/api/px') || req.url.startsWith('/api/tool');
    if (token && sensitive) {
      const auth = req.headers.authorization as string | undefined;
      const xtoken = req.headers['x-system-mcp-token'] as string | undefined;
      const qtoken = (req.query as any)?.token;
      const provided = auth === `Bearer ${token}` ? token : (xtoken ?? qtoken);
      if (provided !== token) {
        reply.code(401).send({ error: 'Unauthorized: missing or invalid local token' });
        return;
      }
    }
  });

  // CORS + Private Network Access (for browser-based agents like Perchance)
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') {
      reply.code(204);
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID');
      reply.header('Access-Control-Allow-Private-Network', 'true');
      reply.header('Access-Control-Max-Age', '86400');
      await reply.send();
    }
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID');
    reply.header('Access-Control-Allow-Private-Network', 'true');
    reply.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  // Health
  app.get('/health', async () => ({ status: 'ok', uptime: Math.round((Date.now() - ctx.startedAt) / 1000) }));

  registerMcpRoutes(app, ctx);
  registerDashboardRoutes(app, ctx);

  return app;
}