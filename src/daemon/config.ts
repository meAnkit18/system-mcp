import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const ConfigSchema = z.object({
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(8787),
  workspaces: z.array(z.string()).default([]),
  dataDir: z.string().default(join(homedir(), '.system-mcp')),
  auditLogPath: z.string().optional(),
  remote: z
    .object({
      enabled: z.boolean().default(false),
      gatewayUrl: z.string().optional(),
      deviceId: z.string().optional(),
    })
    .default({ enabled: false }),
  approvals: z
    .object({
      dangerousCommands: z.enum(['block', 'require-approval', 'allow']).default('require-approval'),
      destructiveFileOps: z.enum(['block', 'require-approval', 'allow']).default('require-approval'),
    })
    .default({ dangerousCommands: 'require-approval', destructiveFileOps: 'require-approval' }),
  limits: z
    .object({
      maxFileSizeBytes: z.number().int().positive().default(10 * 1024 * 1024),
      maxCommandOutputBytes: z.number().int().positive().default(10 * 1024 * 1024),
      commandTimeoutMs: z.number().int().positive().default(120000),
      maxConcurrentCommands: z.number().int().positive().default(8),
      rateLimitPerMinute: z.number().int().positive().default(300),
    })
    .default({
      maxFileSizeBytes: 10 * 1024 * 1024,
      maxCommandOutputBytes: 10 * 1024 * 1024,
      commandTimeoutMs: 120000,
      maxConcurrentCommands: 8,
      rateLimitPerMinute: 300,
    }),
  allowedCommands: z.array(z.string()).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function defaultDataDir(): string {
  return join(homedir(), '.system-mcp');
}

export function loadConfig(configPath?: string): Config {
  const envPath = process.env.SYSTEM_MCP_CONFIG;
  const path = configPath ?? envPath;
  let raw: unknown = {};
  if (path && existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to parse config file ${path}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Env overrides
  const envWorkspaces = process.env.SYSTEM_MCP_WORKSPACES;
  if (envWorkspaces) {
    (raw as Record<string, unknown>).workspaces = envWorkspaces.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (process.env.SYSTEM_MCP_HOST) (raw as Record<string, unknown>).host = process.env.SYSTEM_MCP_HOST;
  if (process.env.SYSTEM_MCP_PORT) (raw as Record<string, unknown>).port = Number(process.env.SYSTEM_MCP_PORT);

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.message}`);
  }
  const cfg = parsed.data;

  // Ensure data dir exists
  if (!existsSync(cfg.dataDir)) mkdirSync(cfg.dataDir, { recursive: true });
  if (!cfg.auditLogPath) cfg.auditLogPath = join(cfg.dataDir, 'audit.log');

  // If no workspaces configured, default to current working directory? For safety, require explicit.
  // But for demo, default to cwd if none.
  if (cfg.workspaces.length === 0) {
    cfg.workspaces = [process.cwd()];
  }
  cfg.workspaces = cfg.workspaces.map((w) => resolve(w));
  return cfg;
}

export function writeDefaultConfig(path: string): void {
  const sample = {
    host: '127.0.0.1',
    port: 8787,
    workspaces: [process.cwd()],
    dataDir: defaultDataDir(),
    remote: { enabled: false },
    approvals: { dangerousCommands: 'require-approval', destructiveFileOps: 'require-approval' },
    limits: {
      maxFileSizeBytes: 10485760,
      maxCommandOutputBytes: 10485760,
      commandTimeoutMs: 120000,
      maxConcurrentCommands: 8,
      rateLimitPerMinute: 300,
    },
  };
  // write handled by caller
  void sample;
  void path;
}