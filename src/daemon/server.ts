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

  // Security headers
  app.addHook('onSend', async (_req, reply) => {
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