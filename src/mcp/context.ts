import { Config } from '../daemon/config.js';
import { CommandStore } from '../storage/commandStore.js';
import { ProcessRegistry } from '../execution/processRegistry.js';
import { AuditLog } from '../security/audit.js';
import { ApprovalManager } from '../security/permissions.js';

export interface ServerContext {
  config: Config;
  store: CommandStore;
  registry: ProcessRegistry;
  audit: AuditLog;
  approvals: ApprovalManager;
  startedAt: number;
  toolHandlers: Map<string, (args: any) => Promise<any>>;
  localToken?: string;
  toolCallResults?: Map<string, { result: any; at: number }>;
}