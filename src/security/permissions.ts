import { AppError } from '../utils/errors.js';

export type RiskLevel = 'safe' | 'moderate' | 'dangerous';

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\brm\s+-r\s+-f\b/i,
  /\bsudo\b/i,
  /\bchmod\s+777\b/i,
  /\bchown\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bkill\s+-9\b/i,
  /:\(\)\s*\{\s*:\|\:&\s*\};:/, // fork bomb
  /\bcurl\b.*\|\s*(bash|sh)\b/i,
  /\bwget\b.*\|\s*(bash|sh)\b/i,
  /\beval\b/i,
  />>?\s*\/etc\//i,
  /\bnpm\s+publish\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
];

const MODERATE_PATTERNS: RegExp[] = [
  /\brm\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bnpm\s+install\b/i,
  /\bpip\s+install\b/i,
  /\bgit\s+commit\b/i,
  /\bgit\s+checkout\b/i,
  /\bchmod\b/i,
];

export function classifyCommand(command: string): RiskLevel {
  const c = command.trim();
  for (const p of DANGEROUS_PATTERNS) {
    if (p.test(c)) return 'dangerous';
  }
  for (const p of MODERATE_PATTERNS) {
    if (p.test(c)) return 'moderate';
  }
  return 'safe';
}

export function isDestructiveFileOp(op: string): boolean {
  return ['delete', 'move', 'overwrite'].includes(op);
}

export interface ApprovalRequest {
  id: string;
  type: 'command' | 'file';
  description: string;
  payload: Record<string, unknown>;
  risk: RiskLevel;
  createdAt: number;
  status: 'pending' | 'approved' | 'denied';
  resolvedAt?: number;
}

export class ApprovalManager {
  private requests = new Map<string, ApprovalRequest>();

  create(req: Omit<ApprovalRequest, 'id' | 'createdAt' | 'status'>): ApprovalRequest {
    const id = `apr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const full: ApprovalRequest = {
      ...req,
      id,
      createdAt: Date.now(),
      status: 'pending',
    };
    this.requests.set(id, full);
    return full;
  }

  get(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  listPending(): ApprovalRequest[] {
    return [...this.requests.values()].filter((r) => r.status === 'pending');
  }

  approve(id: string): ApprovalRequest | undefined {
    const r = this.requests.get(id);
    if (!r || r.status !== 'pending') return r;
    r.status = 'approved';
    r.resolvedAt = Date.now();
    return r;
  }

  deny(id: string): ApprovalRequest | undefined {
    const r = this.requests.get(id);
    if (!r || r.status !== 'pending') return r;
    r.status = 'denied';
    r.resolvedAt = Date.now();
    return r;
  }

  // cleanup old resolved requests (keep 1 hour)
  prune(maxAgeMs = 3600_000): void {
    const now = Date.now();
    for (const [id, r] of this.requests) {
      if (r.status !== 'pending' && r.resolvedAt && now - r.resolvedAt > maxAgeMs) {
        this.requests.delete(id);
      }
    }
  }
}

export function assertNotBlocked(mode: 'block' | 'require-approval' | 'allow', risk: RiskLevel): void {
  if (risk === 'safe') return;
  if (mode === 'block' && risk === 'dangerous') {
    throw new AppError('COMMAND_BLOCKED', 'Dangerous commands are blocked by configuration', undefined, 403);
  }
}