# Connecting a Cloud AI Agent

Phase 1 provides a local MCP server only. To connect a cloud agent today you must
expose the local endpoint through a secure tunnel (e.g. Cloudflare Tunnel, Tailscale,
ngrok) **at your own risk**, and configure the agent's MCP client to use the tunnel URL.

Steps:
1. Start system-mcp locally (remote stays disabled).
2. Create a tunnel to http://127.0.0.1:8787.
3. In your cloud agent's MCP settings, add a Streamable HTTP server pointing at
   `<tunnel-url>/mcp`.
4. Use the dashboard to approve destructive operations.

## Planned (Phase 2)

Authenticated outbound WebSocket from the daemon to a gateway, device registration,
short-lived session credentials, revocation, and reconnection. This will avoid exposing
local ports. Not implemented yet.