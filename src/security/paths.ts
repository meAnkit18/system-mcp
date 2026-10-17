import { resolve, sep, isAbsolute, relative, normalize } from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { AppError } from '../utils/errors.js';

export interface PathCheckResult {
  absolute: string;
  real: string;
  workspace: string;
}

/**
 * Resolve a user-supplied path against the configured workspaces and ensure it
 * stays inside one of them. Prevents path traversal and symlink escape.
 */
export function resolveWithinWorkspaces(
  inputPath: string,
  workspaces: string[],
): PathCheckResult {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new AppError('INVALID_PATH', 'Path must be a non-empty string');
  }
  const ws = workspaces.map((w) => resolve(w));

  // Determine candidate absolute path. If relative, try against each workspace;
  // if absolute, use as-is.
  let candidate: string;
  if (isAbsolute(inputPath)) {
    candidate = resolve(inputPath);
  } else {
    // For relative paths, anchor to first workspace by default; but callers may pass
    // workspace-qualified. We'll resolve against first workspace.
    candidate = resolve(ws[0] ?? process.cwd(), inputPath);
  }

  // Resolve symlinks for existing paths to defeat symlink traversal.
  let realCandidate = candidate;
  if (existsSync(candidate)) {
    try {
      realCandidate = realpathSync(candidate);
    } catch {
      realCandidate = candidate;
    }
  } else {
    // For non-existent targets (new files), resolve the nearest existing parent.
    let parent = resolve(candidate, '..');
    while (!existsSync(parent) && parent !== resolve(parent, '..')) {
      parent = resolve(parent, '..');
    }
    if (existsSync(parent)) {
      try {
        const realParent = realpathSync(parent);
        const rest = relative(parent, candidate);
        realCandidate = resolve(realParent, rest);
      } catch {
        realCandidate = candidate;
      }
    }
  }

  // Find containing workspace (using real paths where possible).
  const realWorkspaces = ws.map((w) => (existsSync(w) ? safeRealpath(w) : w));
  let containing: string | undefined;
  for (let i = 0; i < ws.length; i++) {
    const w = realWorkspaces[i]!;
    if (isWithin(realCandidate, w)) {
      containing = ws[i]!;
      break;
    }
  }

  if (!containing) {
    throw new AppError(
      'PATH_OUTSIDE_WORKSPACE',
      `Path is outside configured workspaces: ${inputPath}`,
      { candidate, workspaces: ws },
      403,
    );
  }

  // Additional traversal guard: normalized relative must not escape.
  const rel = relative(containing, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError('PATH_TRAVERSAL', 'Path traversal detected', { inputPath }, 403);
  }

  return { absolute: candidate, real: realCandidate, workspace: containing };
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export function isWithin(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  if (c === p) return true;
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Detect sensitive system paths that should never be touched even within workspace.
 */
const SENSITIVE_BASENAMES = new Set(['.env', '.env.local', '.ssh', 'id_rsa', 'id_ed25519']);

export function isSensitivePath(p: string): boolean {
  const base = p.split(sep).pop() ?? '';
  if (SENSITIVE_BASENAMES.has(base)) return true;
  // block common secret files
  if (base.startsWith('.env')) return true;
  return false;
}

/**
 * Validate workspace directory exists and is a directory.
 */
export function validateWorkspaces(workspaces: string[]): string[] {
  const out: string[] = [];
  for (const w of workspaces) {
    const r = resolve(w);
    if (!existsSync(r)) {
      // allow creation later? For security, require existence.
      throw new AppError('WORKSPACE_NOT_FOUND', `Workspace does not exist: ${r}`, undefined, 400);
    }
    const st = statSync(r);
    if (!st.isDirectory()) {
      throw new AppError('WORKSPACE_NOT_DIR', `Workspace is not a directory: ${r}`, undefined, 400);
    }
    out.push(r);
  }
  return out;
}