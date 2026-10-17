import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveWithinWorkspaces } from '../security/paths.js';
import { ProcessRegistry, ManagedProcess } from './processRegistry.js';
import { CommandStore, CommandRecord } from '../storage/commandStore.js';
import { AppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger();

export interface RunCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  workspaces: string[];
  env?: Record<string, string>;
  idempotencyKey?: string;
  store: CommandStore;
  registry: ProcessRegistry;
  maxConcurrent: number;
}

export interface RunCommandResult {
  record: CommandRecord;
  reused: boolean;
}

export async function runCommand(opts: RunCommandOptions): Promise<RunCommandResult> {
  const { command, args = [], cwd, workspaces, store, registry, maxConcurrent } = opts;

  // idempotency
  if (opts.idempotencyKey) {
    const existing = store.findByIdempotency(opts.idempotencyKey);
    if (existing) {
      return { record: existing, reused: true };
    }
  }

  if (registry.running().length >= maxConcurrent) {
    throw new AppError('TOO_MANY_COMMANDS', 'Too many concurrent commands running', undefined, 429);
  }

  // validate cwd
  let workingDir = process.cwd();
  if (cwd) {
    const checked = resolveWithinWorkspaces(cwd, workspaces);
    workingDir = checked.absolute;
  } else if (workspaces.length > 0) {
    workingDir = workspaces[0]!;
  }

  const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = store.create({
    id,
    command,
    args,
    cwd: workingDir,
    status: 'running',
    startedAt: Date.now(),
    exitCode: null,
    signal: null,
    idempotencyKey: opts.idempotencyKey,
  });

  // Spawn. Use shell to allow complex commands? Security: better spawn without shell for args,
  // but command may be a full shell line. We'll support both: if args provided, execFile-like;
  // if no args, run via shell with -c. To be safe and flexible, use shell when no args.
  let child;
  if (args && args.length > 0) {
    child = spawn(command, args, {
      cwd: workingDir,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    child = spawn(command, {
      cwd: workingDir,
      env: { ...process.env, ...(opts.env ?? {}) },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  record.pid = child.pid;

  const managed: ManagedProcess = {
    id,
    pid: child.pid,
    command,
    cwd: workingDir,
    startedAt: record.startedAt,
    process: child,
    status: 'running',
    exitCode: null,
    signal: null,
  };
  registry.register(managed);

  const killTimer = setTimeout(() => {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 5000);
      store.finish(id, 'timeout', null, 'SIGTERM');
      registry.markExited(id, null, 'SIGTERM');
    }
  }, opts.timeoutMs);

  child.stdout?.on('data', (d: Buffer) => {
    store.appendOutput(id, { stream: 'stdout', data: d.toString('utf8'), timestamp: Date.now() }, opts.maxOutputBytes);
  });
  child.stderr?.on('data', (d: Buffer) => {
    store.appendOutput(id, { stream: 'stderr', data: d.toString('utf8'), timestamp: Date.now() }, opts.maxOutputBytes);
  });

  child.on('error', (err) => {
    clearTimeout(killTimer);
    store.appendOutput(id, { stream: 'stderr', data: `${err.message}\n`, timestamp: Date.now() }, opts.maxOutputBytes);
    store.finish(id, 'failed', null, null);
    registry.markExited(id, null, null);
    managed.status = 'failed';
    log.error({ id, err: err.message }, 'command error');
  });

  child.on('close', (code, signal) => {
    clearTimeout(killTimer);
    const status = signal === 'SIGTERM' && code === null ? 'timeout' : code === 0 ? 'completed' : 'failed';
    // If already finished (timeout), keep timeout status
    const rec = store.get(id);
    if (rec && rec.status === 'timeout') {
      registry.markExited(id, rec.exitCode, rec.signal);
      return;
    }
    store.finish(id, code === 0 ? 'completed' : signal ? 'killed' : 'failed', code, signal);
    registry.markExited(id, code, signal ?? null);
    managed.status = code === 0 ? 'exited' : 'failed';
    managed.exitCode = code;
    managed.signal = signal ?? null;
    log.info({ id, code, signal }, 'command finished');
  });

  return { record, reused: false };
}

export function terminateCommand(id: string, store: CommandStore, registry: ProcessRegistry): boolean {
  const rec = store.get(id);
  const managed = registry.get(id);
  if (!rec || !managed) return false;
  if (rec.status !== 'running') return false;
  try {
    managed.process.kill('SIGTERM');
  } catch {
    return false;
  }
  setTimeout(() => {
    try {
      if (managed.process.exitCode === null) managed.process.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 5000);
  store.finish(id, 'killed', null, 'SIGTERM');
  registry.markExited(id, null, 'SIGTERM');
  managed.status = 'killed';
  return true;
}