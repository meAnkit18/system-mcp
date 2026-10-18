# Security

- Local daemon binds to 127.0.0.1 by default.
- A local token (`~/.system-mcp/extension-token`) authenticates extension/agent
  requests to `/mcp`, `/api/px`, and `/api/tool*`.
- Origin validation provides defense in depth but is not sole authorization.
- Workspace restrictions and symlink protections are enforced by `resolveWithinWorkspaces`.
- Destructive file operations and dangerous commands require approval by default.
- Timeouts, output limits, concurrency and rate limits are enforced.
- Audit log at `~/.system-mcp/audit.log`.
- Emergency disconnect: `POST /api/disconnect`.
- Remote access remains disabled by default. Future remote access must use
  authenticated outbound connections, short-lived credentials, device registration
  and revocation.
```

<|end|><|start|><|start|>assistant to=write<|channel|>analysis <|constrain|>xml<|message|><rfl:parameter name="path">
/workspaces/system-mcp/docs/TROUBLESHOOTING.md