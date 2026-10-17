import { ChildProcess } from 'node:child_process';

export interface ManagedProcess {
  id: string;
  pid: number | undefined;
  command: string;
  cwd: string;
  startedAt: number;
  process: ChildProcess;
  status: 'running' | 'exited' | 'killed' | 'failed';
  exitCode: number | null;
  signal: string | null;
}

export class ProcessRegistry {
  private processes = new Map<string, ManagedProcess>();

  register(p: ManagedProcess): void {
    this.processes.set(p.id, p);
  }

  get(id: string): ManagedProcess | undefined {
    return this.processes.get(id);
  }

  list(): ManagedProcess[] {
    return [...this.processes.values()];
  }

  running(): ManagedProcess[] {
    return this.list().filter((p) => p.status === 'running');
  }

  markExited(id: string, code: number | null, signal: string | null): void {
    const p = this.processes.get(id);
    if (p) {
      p.status = code === null && signal ? 'killed' : 'exited';
      p.exitCode = code;
      p.signal = signal;
    }
  }

  remove(id: string): void {
    this.processes.delete(id);
  }

  killAll(): void {
    for (const p of this.processes.values()) {
      if (p.status === 'running') {
        try {
          p.process.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    }
  }
}