# Troubleshooting

## Chromium not found
Install Chromium: `sudo apt install chromium-browser` (Debian/Ubuntu) or
`sudo dnf install chromium` (Fedora).

## Daemon does not start
Check `~/.system-mcp/daemon.log`. Ensure Node.js >= 20 and dependencies installed.

## Extension cannot connect
Open the extension popup and set the daemon URL and token (from
`~/.system-mcp/extension-token` or `/api/token`).

## Tool calls rejected
Ensure paths are inside the configured workspace. Check approval requirements in
the dashboard.

## Port in use
Set `SYSTEM_MCP_PORT` to another port.
```

<|end|><|start|><|start|>assistant<|channel|>analysis<|message|>Now desktop entry. Create scripts/perchance-code.desktop maybe.<|end|><|start|><|start|>assistant to=write<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
/workspaces/system-mcp/scripts/perchance-code.desktop