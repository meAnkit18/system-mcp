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

## Browser-based agents (Perchance, etc.)

The server now sends CORS and Private Network Access headers and handles OPTIONS
preflight, so a browser page may call `http://127.0.0.1:8787/mcp` directly. If your
browser still blocks mixed content (https page -> http localhost), expose the server
through a tunnel and use the resulting HTTPS URL:

```bash
# cloudflared (recommended: no interstitial page)
cloudflared tunnel --url http://127.0.0.1:8787
# or ngrok (free tier shows an interstitial unless the request sends ngrok-skip-browser-warning: true)
ngrok http 8787
# or localhost.run (no account, no interstitial)
ssh -R 80:localhost:8787 nokey@localhost.run
```

Then point the agent at `https://<tunnel-host>/mcp`.

### Fetch-only agents (Perchance, etc.)

If the agent can only fetch URLs (no MCP tool binding), use the built-in REST adapter:

```
GET  https://<tunnel-host>/api/px?tool=TOOL_NAME&args=URL_ENCODED_JSON
POST https://<tunnel-host>/api/px   body: {"tool":"TOOL_NAME","args":{...}}
```

The dashboard's "Copy-Paste Ready Prompt" already contains these instructions with the
correct public URL.

Important: **localtunnel** shows a "Tunnel website ahead!" reminder page to browser-like
requests, which breaks fetch-only agents. Prefer cloudflared, ngrok, or localhost.run.
If you must use localtunnel, the fetch request must include the header
`Bypass-Tunnel-Reminder: true`. If you use ngrok's free tier, include
`ngrok-skip-browser-warning: true`.

## Planned (Phase 2)

Authenticated outbound WebSocket from the daemon to a gateway, device registration,
short-lived session credentials, revocation, and reconnection. This will avoid exposing
local ports. Not implemented yet.