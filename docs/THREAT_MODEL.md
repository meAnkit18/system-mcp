# Threat Model

## Assets
- User files within configured workspaces.
- System credentials/secrets outside workspaces.
- Process execution capability.

## Threats & Mitigations

| Threat | Mitigation |
|---|---|
| Path traversal outside workspace | resolveWithinWorkspaces + realpath + containment check |
| Symlink escape | realpath resolution of nearest existing ancestor |
| Sensitive file access (.env, ssh keys) | isSensitivePath block |
| Destructive file ops | approval gating (configurable block/require/allow) |
| Dangerous commands (rm -rf, sudo, etc.) | classifyCommand + approval gating |
| Resource exhaustion | timeouts, output limits, concurrency limits, rate limits |
| Orphaned processes | process registry + killAll on shutdown |
| Secret leakage in logs | pino redaction + audit redaction |
| Remote exposure | remote disabled by default; localhost bind |
| Untrusted MCP client | local-only by default; future: auth tokens |

## Residual risks
- A malicious local process can connect to localhost MCP endpoint (no auth in Phase 1).
  Mitigation planned: local auth token.
- Command allowlist not enforced by default (configurable).
- No sandboxing of executed commands; runs as user.