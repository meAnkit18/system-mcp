import { FastifyInstance } from 'fastify';
import { ServerContext } from '../mcp/context.js';
import { createMcpServer } from '../mcp/mcpServer.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

function publicUrl(ctx: ServerContext): string {
  const env = process.env.SYSTEM_MCP_PUBLIC_URL;
  if (env) return env.replace(/\/$/, '') + '/mcp';
  return `http://${ctx.config.host === '0.0.0.0' ? '127.0.0.1' : ctx.config.host}:${ctx.config.port}/mcp`;
}

async function callToolInProcess(ctx: ServerContext, tool: string, args: any): Promise<any> {
  const server = createMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'rest-adapter', version: '1.0' });
  await client.connect(clientTransport);
  try {
    const res: any = await client.callTool({ name: tool, arguments: args ?? {} });
    const text = res?.content?.[0]?.text;
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { isError: !!res?.isError, result: parsed ?? res };
  } finally {
    await client.close();
    await server.close();
  }
}

export function registerDashboardRoutes(app: FastifyInstance, ctx: ServerContext): void {
  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(renderDashboard(ctx));
  });

  app.get('/dashboard', async (_req, reply) => {
    reply.type('text/html').send(renderDashboard(ctx));
  });

  // API endpoints
  // Perchance-friendly adapter: call any MCP tool via simple REST (GET or POST)
  app.get('/api/px', async (req, reply) => {
    const q = req.query as any;
    const tool = q.tool;
    if (!tool) return reply.code(400).send({ error: 'missing tool' });
    let args: any = {};
    if (q.args) {
      const raw = String(q.args);
      const candidates = [raw];
      // base64 (standard)
      try { candidates.push(Buffer.from(raw, 'base64').toString('utf8')); } catch {}
      // base64url
      try {
        const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
        candidates.push(Buffer.from(b64, 'base64').toString('utf8'));
      } catch {}
      for (const c of candidates) {
        try { const o = JSON.parse(c); if (o && typeof o === 'object') { args = o; break; } } catch {}
      }
    }
    try {
      const out = await callToolInProcess(ctx, tool, args);
      return out;
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message ?? String(e) });
    }
  });

  app.post('/api/px', async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const tool = body.tool;
    if (!tool) return reply.code(400).send({ error: 'missing tool' });
    try {
      const out = await callToolInProcess(ctx, tool, body.args ?? {});
      return out;
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message ?? String(e) });
    }
  });

  app.get('/api/status', async () => {
    const sessions = (ctx as any).__sessions as Map<string, any> | undefined;
    return {
      uptime: Math.round((Date.now() - ctx.startedAt) / 1000),
      workspaces: ctx.config.workspaces,
      remoteEnabled: ctx.config.remote.enabled,
      sessions: sessions ? sessions.size : 0,
      pendingApprovals: ctx.approvals.listPending().length,
      runningCommands: ctx.store.running().length,
    };
  });

  app.get('/api/connection', async () => {
    const url = publicUrl(ctx);
    const tools = [
      'list_files','read_file','write_file','edit_file','create_directory','move_file',
      'delete_file','search_files','execute_command','get_command_status','terminate_command',
      'get_system_info','git_status','git_diff','list_processes'
    ];
    return {
      name: 'system-mcp',
      transport: 'streamable-http',
      endpoint: url,
      tools,
      mcpServersConfig: {
        'system-mcp': { type: 'streamable-http', url },
      },
    };
  });

  app.get('/api/prompt', async () => {
    const url = publicUrl(ctx);
    const prompt = buildPrompt(ctx, url);
    return { prompt };
  });

  app.get('/api/approvals', async () => ctx.approvals.listPending());

  app.post('/api/approvals/:id/approve', async (req, reply) => {
    const id = (req.params as any).id;
    const r = ctx.approvals.approve(id);
    if (!r) return reply.code(404).send({ error: 'not found' });
    ctx.audit.record({ action: 'approval_approved', actor: 'dashboard', target: id, result: 'success' });
    return { approval: r };
  });

  app.post('/api/approvals/:id/deny', async (req, reply) => {
    const id = (req.params as any).id;
    const r = ctx.approvals.deny(id);
    if (!r) return reply.code(404).send({ error: 'not found' });
    ctx.audit.record({ action: 'approval_denied', actor: 'dashboard', target: id, result: 'success' });
    return { approval: r };
  });

  app.get('/api/commands', async () => ctx.store.list().map((c) => ({
    id: c.id,
    command: c.command,
    status: c.status,
    startedAt: new Date(c.startedAt).toISOString(),
    finishedAt: c.finishedAt ? new Date(c.finishedAt).toISOString() : null,
    exitCode: c.exitCode,
  })));

  app.post('/api/commands/:id/stop', async (req, reply) => {
    const id = (req.params as any).id;
    const { terminateCommand } = await import('../execution/commandRunner.js');
    const ok2 = terminateCommand(id, ctx.store, ctx.registry);
    ctx.audit.record({ action: 'terminate_command', actor: 'dashboard', target: id, result: ok2 ? 'success' : 'failure' });
    return { terminated: ok2 };
  });

  app.post('/api/disconnect', async () => {
    // terminate all MCP sessions and remote (none yet) - emergency disconnect
    const sessions = (ctx as any).__sessions as Map<string, any> | undefined;
    if (sessions) {
      for (const [sid, s] of sessions) {
        try { await s.transport.close(); } catch {}
        try { await s.server.close(); } catch {}
        sessions.delete(sid);
      }
    }
    ctx.registry.killAll();
    ctx.audit.record({ action: 'emergency_disconnect', actor: 'dashboard', result: 'success' });
    return { disconnected: true };
  });

  app.post('/api/revoke', async () => {
    // Phase 1: disable remote (already disabled) + disconnect
    ctx.config.remote.enabled = false;
    ctx.audit.record({ action: 'revoke_access', actor: 'dashboard', result: 'success' });
    return { revoked: true };
  });
}

function renderDashboard(ctx: ServerContext): string {
  const sessions = (ctx as any).__sessions as Map<string, any> | undefined;
  const pending = ctx.approvals.listPending();
  const running = ctx.store.running();
  const cmds = ctx.store.list().slice(-20).reverse();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>system-mcp dashboard</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#0f172a;color:#e2e8f0}
h1{margin:0 0 16px} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.card{background:#1e293b;border-radius:12px;padding:16px;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.card h2{margin:0 0 8px;font-size:16px;color:#94a3b8}
.stat{font-size:28px;font-weight:700}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #334155}
.btn{background:#3b82f6;color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;margin:4px}
.btn.danger{background:#ef4444}
.btn.warn{background:#f59e0b}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:6px;text-align:left;border-bottom:1px solid #334155}
code{background:#0f172a;padding:2px 6px;border-radius:4px}
</style>
</head>
<body>
<h1>system-mcp — Local Dashboard</h1>
<div class="grid">
  <div class="card"><h2>Connection Status</h2><div class="stat" id="status">online</div><div>Remote: ${ctx.config.remote.enabled ? 'ENABLED' : 'disabled'}</div><div>Uptime: ${Math.round((Date.now()-ctx.startedAt)/1000)}s</div><div>MCP sessions: ${sessions ? sessions.size : 0}</div></div>
  <div class="card"><h2>Workspaces</h2>${ctx.config.workspaces.map(w=>`<div><code>${w}</code></div>`).join('')}</div>
  <div class="card"><h2>Pending Approvals</h2>${pending.length===0?'<div>None</div>':pending.map(a=>`<div class="row"><span>${a.description}</span><span><button class="btn" onclick="approve('${a.id}')">Approve</button><button class="btn danger" onclick="deny('${a.id}')">Deny</button></span></div>`).join('')}</div>
  <div class="card"><h2>Running Commands</h2>${running.length===0?'<div>None</div>':running.map(c=>`<div class="row"><span>${c.command}</span><button class="btn danger" onclick="stop('${c.id}')">Stop</button></div>`).join('')}</div>
</div>
<div class="card" style="margin-top:16px"><h2>Recent Commands</h2>
<table><thead><tr><th>ID</th><th>Command</th><th>Status</th><th>Exit</th></tr></thead><tbody>
${cmds.map(c=>`<tr><td><code>${c.id}</code></td><td>${escapeHtml(c.command)}</td><td>${c.status}</td><td>${c.exitCode ?? ''}</td></tr>`).join('')}
</tbody></table></div>
<div class="card" style="margin-top:16px"><h2>MCP Connection (copy/paste into any agent)</h2>
<p>Transport: Streamable HTTP. Endpoint:</p>
<pre id="endpoint" style="white-space:pre-wrap;word-break:break-all">${publicUrl(ctx)}</pre>
<button class="btn" onclick="copyEndpoint()">Copy Endpoint</button>
<p>Agent config snippet:</p>
<pre id="snippet" style="white-space:pre-wrap">${JSON.stringify({ mcpServers: { 'system-mcp': { type: 'streamable-http', url: publicUrl(ctx) } } }, null, 2)}</pre>
<button class="btn" onclick="copySnippet()">Copy Snippet</button>
<p>Available tools: list_files, read_file, write_file, edit_file, create_directory, move_file, delete_file, search_files, execute_command, get_command_status, terminate_command, get_system_info, git_status, git_diff, list_processes</p>
</div>
<div class="card" style="margin-top:16px"><h2>Copy-Paste Ready Prompt (for any AI agent)</h2>
<p>Paste this into any agent so it can connect and use all tools:</p>
<pre id="prompt" style="white-space:pre-wrap;max-height:300px;overflow:auto">${escapeHtml(buildPrompt(ctx, publicUrl(ctx)))}</pre>
<button class="btn" onclick="copyPrompt()">Copy Prompt</button>
</div>
<div class="card" style="margin-top:16px"><h2>Controls</h2>
<button class="btn danger" onclick="disconnect()">Emergency Disconnect</button>
<button class="btn warn" onclick="revoke()">Revoke Remote Access</button>
</div>
<script>
async function post(u){const r=await fetch(u,{method:'POST'});return r.json();}
function approve(id){post('/api/approvals/'+id+'/approve').then(()=>location.reload());}
function deny(id){post('/api/approvals/'+id+'/deny').then(()=>location.reload());}
function stop(id){post('/api/commands/'+id+'/stop').then(()=>location.reload());}
function disconnect(){if(confirm('Disconnect all sessions?'))post('/api/disconnect').then(()=>location.reload());}
function revoke(){post('/api/revoke').then(()=>location.reload());}
function copyEndpoint(){navigator.clipboard.writeText(document.getElementById('endpoint').innerText);alert('Endpoint copied');}
function copySnippet(){navigator.clipboard.writeText(document.getElementById('snippet').innerText);alert('Snippet copied');}
function copyPrompt(){navigator.clipboard.writeText(document.getElementById('prompt').innerText);alert('Prompt copied');}
setTimeout(()=>location.reload(),5000);
</script>
</body></html>`;
}

function buildPrompt(ctx: ServerContext, url: string): string {
  return `You have access to a local computer through the "system-mcp" MCP server.

CONNECTION
- Transport: Streamable HTTP (MCP)
- Endpoint: ${url}
- Add this to your MCP client config:
  {
    "mcpServers": {
      "system-mcp": { "type": "streamable-http", "url": "${url}" }
    }
  }

AVAILABLE TOOLS
- list_files(path?, recursive?, maxDepth?, includeHidden?, limit?): list files/directories in a workspace.
- read_file(path, offset?, limit?, maxBytes?): read file contents (text or base64 for binary).
- write_file(path, content, encoding?, createParents?, overwrite?, approvalId?): create/overwrite a file.
- edit_file(path, edits[{oldString,newString,replaceAll?}], approvalId?): apply targeted replacements.
- create_directory(path): create a directory (and parents).
- move_file(source, destination, overwrite?, approvalId?): move/rename.
- delete_file(path, recursive?, approvalId?): delete a file or directory (approval required by default).
- search_files(root?, query, filePattern?, maxResults?, includeHidden?): search filenames and contents.
- execute_command(command, args?, cwd?, timeoutMs?, idempotencyKey?, approvalId?): run a terminal command; returns commandId.
- get_command_status(commandId): get status + output of a command.
- terminate_command(commandId): stop a running command.
- get_system_info(): OS, arch, disk, runtimes.
- git_status(cwd?): repository status.
- git_diff(cwd?, path?, staged?, stat?): repository diff.
- list_processes(): processes managed by the server.

USAGE RULES
1. All file paths must be inside configured workspaces; paths outside are rejected.
2. Destructive file ops and dangerous commands may require user approval. If a tool returns status "pending_approval" with an approvalId, tell the user to approve it in the dashboard, then re-run with approvalId.
3. Long-running commands return a commandId immediately with status "running". Poll get_command_status until completed/failed. Do not block.
4. Use idempotencyKey when retrying execute_command to avoid duplicates.
5. Never claim success until the tool confirms it.
6. Report changed files and command output summaries when done.

WORKFLOW EXAMPLE
To create a React app: inspect the project directory, create files, run npm commands, read output, fix errors, summarize changes.

PERCHANCE / FETCH-ONLY AGENTS
If your agent can only fetch URLs (no MCP tool binding), use the REST adapter:
  GET  ${url.replace('/mcp','/api/px')}?tool=TOOL_NAME&args=URL_ENCODED_JSON
  POST ${url.replace('/mcp','/api/px')}  body: {"tool":"TOOL_NAME","args":{...}}
Examples:
  ${url.replace('/mcp','/api/px')}?tool=list_files&args=%7B%22path%22%3A%22%2Fhome%2Fdevdevil%2Fdevelopment%2Fsystem-mcp-test%22%7D
  ${url.replace('/mcp','/api/px')}?tool=get_system_info
The response is JSON: {"isError":false,"result":{...}}.`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}