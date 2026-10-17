# Architecture

## Components

1. **Daemon** (`src/daemon`): loads validated config, starts Fastify HTTP server bound to
   localhost, manages lifecycle and graceful shutdown.

2. **MCP Server** (`src/mcp`): official `@modelcontextprotocol/sdk` `McpServer` exposing
   tools. Transport is Streamable HTTP (`/mcp`) with per-session state.

3. **Security** (`src/security`): path resolution with workspace restriction, symlink
   escape prevention, sensitive path blocking, command risk classification, approval
   manager, rate limiter, audit log.

4. **Execution** (`src/execution`, `src/storage`): command runner using `child_process.spawn`,
   process registry, command store with output capture/expiry, idempotency, timeouts.

5. **Dashboard** (`src/dashboard`): local-only HTML dashboard + JSON API for status,
   approvals, commands, controls.

## Data flow

MCP client -> POST /mcp -> transport session -> McpServer tool handler -> security checks
-> executor -> store -> response. Output is polled via get_command_status.

## Concurrency

Each MCP session gets its own McpServer + transport. Command concurrency limited by
config. Process registry tracks all spawned processes.

## Future (Phase 2+)

Outbound authenticated WebSocket to a gateway, device registration, remote session
routing, cloud agent adapter. Not implemented yet.