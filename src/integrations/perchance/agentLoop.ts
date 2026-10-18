import { ServerContext } from '../../mcp/context.js';
import { executeToolCall } from './executor.js';
import { parseToolCalls, buildToolInstructions } from './protocol.js';
import { callTool } from '../../utils/callTool.js';

export interface PerchanceClient {
  send(prompt: string, history: AgentMessage[]): Promise<string>;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface AgentTaskOptions {
  maxIterations?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
  gatherContext?: boolean;
  allowedTools?: string[];
  token?: string;
  baseUrl?: string;
}

export interface AgentTaskResult {
  status: 'completed' | 'failed' | 'cancelled' | 'limit_reached';
  iterations: number;
  toolCallCount: number;
  finalResponse: string;
  transcript: AgentMessage[];
  errors: string[];
}

export async function gatherProjectContext(ctx: ServerContext): Promise<string> {
  const lines: string[] = [];
  try {
    const { result } = await callTool(ctx, 'list_files', { path: ctx.config.workspaces[0], recursive: false, limit: 100 });
    lines.push('Top-level entries:');
    const entries = (result as any)?.entries ?? [];
    for (const e of entries.slice(0, 80)) {
      lines.push(`- ${e.type} ${e.name}`);
    }
  } catch (e: any) {
    lines.push(`list_files failed: ${e?.message ?? e}`);
  }
  // Read common project files
  for (const name of ['AGENTS.md', 'README.md', 'package.json', 'pyproject.toml', 'Cargo.toml']) {
    try {
      const { result, isError } = await callTool(ctx, 'read_file', { path: `${ctx.config.workspaces[0]}/${name}` });
      if (!isError && (result as any)?.content) {
        const content = String((result as any).content).slice(0, 4000);
        lines.push(`\n--- ${name} ---\n${content}`);
      }
    } catch {
      // ignore missing
    }
  }
  try {
    const { result } = await callTool(ctx, 'git_status', { cwd: ctx.config.workspaces[0] });
    lines.push(`\nGit status:\n${JSON.stringify(result)}`);
  } catch {
    // ignore
  }
  return lines.join('\n');
}

export async function runAgentTask(
  ctx: ServerContext,
  client: PerchanceClient,
  task: string,
  opts: AgentTaskOptions = {},
): Promise<AgentTaskResult> {
  const maxIterations = opts.maxIterations ?? 20;
  const maxToolCalls = opts.maxToolCalls ?? 100;
  const errors: string[] = [];
  const transcript: AgentMessage[] = [];
  let toolCallCount = 0;
  let finalResponse = '';
  let cancelled = false;

  const baseUrl = opts.baseUrl ?? `http://${ctx.config.host}:${ctx.config.port}/mcp`;
  const instructions = buildToolInstructions(baseUrl, opts.token ?? ctx.localToken);
  const contextBlock = opts.gatherContext === false ? '' : await gatherProjectContext(ctx);

  const systemPrompt = `${instructions}\n\nPROJECT CONTEXT\n${contextBlock}`;
  transcript.push({ role: 'system', content: systemPrompt });

  let history: AgentMessage[] = [...transcript];
  let userMessage = task;
  transcript.push({ role: 'user', content: task });
  history = [...transcript];

  let iterations = 0;
  let status: AgentTaskResult['status'] = 'limit_reached';

  while (iterations < maxIterations) {
    iterations++;
    let response: string;
    try {
      response = await client.send(userMessage, history);
    } catch (e: any) {
      errors.push(`client error: ${e?.message ?? e}`);
      status = 'failed';
      break;
    }
    finalResponse = response;
    transcript.push({ role: 'assistant', content: response });
    history = [...transcript];

    const calls = parseToolCalls(response);
    if (calls.length === 0) {
      status = 'completed';
      break;
    }

    // Execute calls sequentially
    let hitToolLimit = false;
    const results: string[] = [];
    for (const call of calls) {
      if (toolCallCount >= maxToolCalls) {
        hitToolLimit = true;
        errors.push('Max tool calls reached');
        break;
      }
      toolCallCount++;
      const tr = await executeToolCall(ctx, call, { allowedTools: opts.allowedTools });
      const text = `tool_result ${call.id} (${call.tool}): ${JSON.stringify(tr)}`;
      results.push(text);
      transcript.push({ role: 'tool', content: text });
      history = [...transcript];
      if (!tr.ok) {
        // continue; let AI diagnose
      }
    }
    if (hitToolLimit) {
      status = 'limit_reached';
      break;
    }

    userMessage = `Tool results:\n${results.join('\n')}\nContinue the task.`;
    transcript.push({ role: 'user', content: userMessage });
    history = [...transcript];
  }

  if (iterations >= maxIterations && status === 'limit_reached') {
    errors.push('Max iterations reached');
  }

  return { status, iterations, toolCallCount, finalResponse, transcript, errors };
}