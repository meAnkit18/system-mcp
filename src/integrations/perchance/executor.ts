import { ServerContext } from '../../mcp/context.js';
import { callTool } from '../../utils/callTool.js';
import { ToolCall, ToolResult, makeToolResult, validateToolCall } from './protocol.js';

// placeholder import holder; define locally below
const ALLOWED_TOOLS = [
  'list_files','read_file','write_file','edit_file','create_directory','move_file',
  'delete_file','search_files','execute_command','get_command_status','terminate_command',
  'get_system_info','git_status','git_diff','list_processes'
];

export interface ExecuteOptions {
  allowedTools?: string[];
  duplicateWindowMs?: number;
}

export async function executeToolCall(
  ctx: ServerContext,
  input: unknown,
  opts: ExecuteOptions = {},
): Promise<ToolResult> {
  const allowed = opts.allowedTools ?? ALLOWED_TOOLS;
  const validation = validateToolCall(input, allowed);
  if (!validation.ok) {
    const call = (typeof input === 'object' && input !== null ? input : {}) as any;
    return makeToolResult(
      { type: 'tool_call', id: String(call?.id ?? 'unknown'), tool: String(call?.tool ?? 'unknown'), arguments: {} },
      false,
      undefined,
      { code: validation.error.code, message: validation.error.message, details: validation.error.details },
    );
  }
  const call: ToolCall = validation.value;

  // duplicate prevention
  const dupWindow = opts.duplicateWindowMs ?? 5 * 60 * 1000;
  if (!ctx.toolCallResults) ctx.toolCallResults = new Map();
  const cached = ctx.toolCallResults.get(call.id);
  if (cached && Date.now() - cached.at < dupWindow) {
    const prev: ToolResult = cached.result;
    return { ...prev, duplicate: true, timestamp: new Date().toISOString() };
  }

  try {
    const { isError, result } = await callTool(ctx, call.tool, call.arguments ?? {});
    const toolResult = makeToolResult(call, !isError, result, isError ? (result?.error ?? { code: 'TOOL_ERROR', message: typeof result === 'string' ? result : JSON.stringify(result) }) : undefined);
    ctx.toolCallResults.set(call.id, { result: toolResult, at: Date.now() });
    ctx.audit.record({ action: 'perchance_tool_call', actor: 'perchance', target: call.tool, result: isError ? 'failure' : 'success', details: { id: call.id } });
    return toolResult;
  } catch (e: any) {
    const err = { code: 'EXECUTION_ERROR', message: e?.message ?? String(e) };
    const toolResult = makeToolResult(call, false, undefined, err);
    ctx.toolCallResults.set(call.id, { result: toolResult, at: Date.now() });
    ctx.audit.record({ action: 'perchance_tool_call', actor: 'perchance', target: call.tool, result: 'failure', error: err.message, details: { id: call.id } });
    return toolResult;
  }
}