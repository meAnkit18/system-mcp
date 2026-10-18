# Perchance Integration

## Overview

Perchance Code uses the existing `system-mcp` daemon as the local execution layer and
Perchance as the AI frontend. The daemon exposes tools via:

- MCP Streamable HTTP: `/mcp`
- REST adapter: `/api/px`
- Versioned tool-call protocol: `/api/tool-call`, `/api/tool-calls`

## Protocol

The AI emits fenced JSON:

```json
{"type":"tool_call","id":"call_001","tool":"list_files","arguments":{"path":"."}}
```

The adapter validates the request, executes the tool through `system-mcp`, and returns:

```json
{"type":"tool_result","id":"call_001","tool":"list_files","ok":true,"result":{...}}
```

## Browser extension

Located in `integrations/perchance/extension/`. Load it in Chromium via
`--load-extension` (the launcher does this automatically). Configure the daemon URL
and token in the popup.

## Agent loop

`src/integrations/perchance/agentLoop.ts` implements a bounded loop:
send task -> detect tool calls -> execute -> feed results -> repeat until completion,
failure, or limits.

## Project context

`gatherProjectContext` collects a concise snapshot (top-level files, common project
files, git status) instead of sending the whole repository.
```

<|end|><|start|><|start|>assistant to=write<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
/workspaces/system-mcp/docs/SECURITY.md