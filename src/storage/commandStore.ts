export interface CommandOutputChunk {
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp: number;
}

export interface CommandRecord {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'timeout' | 'pending_approval';
  startedAt: number;
  finishedAt?: number;
  exitCode: number | null;
  signal: string | null;
  output: CommandOutputChunk[];
  outputBytes: number;
  truncated: boolean;
  idempotencyKey?: string;
  approvalId?: string;
  pid?: number;
}

export class CommandStore {
  private records = new Map<string, CommandRecord>();
  private idempotency = new Map<string, string>(); // key -> command id
  private expiryMs: number;

  constructor(expiryMs = 30 * 60 * 1000) {
    this.expiryMs = expiryMs;
  }

  create(rec: Omit<CommandRecord, 'output' | 'outputBytes' | 'truncated'>): CommandRecord {
    const full: CommandRecord = {
      ...rec,
      output: [],
      outputBytes: 0,
      truncated: false,
    };
    this.records.set(full.id, full);
    if (full.idempotencyKey) {
      this.idempotency.set(full.idempotencyKey, full.id);
    }
    return full;
  }

  get(id: string): CommandRecord | undefined {
    const r = this.records.get(id);
    if (!r) return undefined;
    if (r.status !== 'running' && r.finishedAt && Date.now() - r.finishedAt > this.expiryMs) {
      this.records.delete(id);
      return undefined;
    }
    return r;
  }

  findByIdempotency(key: string): CommandRecord | undefined {
    const id = this.idempotency.get(key);
    if (!id) return undefined;
    return this.get(id);
  }

  appendOutput(id: string, chunk: CommandOutputChunk, maxBytes: number): void {
    const r = this.records.get(id);
    if (!r) return;
    const bytes = Buffer.byteLength(chunk.data, 'utf8');
    if (r.outputBytes + bytes > maxBytes) {
      r.truncated = true;
      // still append a marker once
      if (!r.output.some((c) => c.data === '[output truncated]')) {
        r.output.push({ stream: 'stderr', data: '[output truncated]\n', timestamp: Date.now() });
      }
      return;
    }
    r.output.push(chunk);
    r.outputBytes += bytes;
  }

  finish(id: string, status: CommandRecord['status'], exitCode: number | null, signal: string | null): void {
    const r = this.records.get(id);
    if (!r) return;
    r.status = status;
    r.exitCode = exitCode;
    r.signal = signal;
    r.finishedAt = Date.now();
  }

  list(): CommandRecord[] {
    return [...this.records.values()];
  }

  running(): CommandRecord[] {
    return this.list().filter((r) => r.status === 'running');
  }

  prune(): void {
    const now = Date.now();
    for (const [id, r] of this.records) {
      if (r.status !== 'running' && r.finishedAt && now - r.finishedAt > this.expiryMs) {
        this.records.delete(id);
      }
    }
  }
}