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
  const token = process.env.SYSTEM_MCP_TOKEN;

  // Rate limit middleware
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return; // handle in CORS hook
    const key = req.ip ?? 'local';
    const r = limiter.check(key);
    if (!r.allowed) {
      reply.code(429).send({ error: 'Rate limit exceeded' });
      return;
    }
    if (token && req.url.startsWith('/mcp')) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        reply.code(401).send({ error: 'Unauthorized' });
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