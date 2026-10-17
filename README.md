# system-mcp

Universal local AI agent bridge. A local daemon that exposes your computer's capabilities
(files, terminal, git, system info) to AI agents through an MCP-compatible interface.
The agent runs in the cloud (or locally); execution always happens on your machine.

Phase 1 (Local MVP) is complete: local daemon, MCP server over Streamable HTTP,
workspace-restricted filesystem tools, terminal execution with status/cancellation,
permission configuration, audit log, and a local dashboard.

Remote connectivity (Phase 2) is **not yet implemented**; remote access stays disabled
by default and there is no outbound gateway connection yet.

## Quick start

### Easiest (one command)

Linux/macOS:
```bash
chmod +x start.sh
./start.sh
```

Windows:
```bat
start.bat
```

The script installs dependencies, asks for your projects folder, builds, starts the server, and opens the dashboard.

### Manual

```bash
npm install
cp config.example.json config.json
# edit config.json: set workspaces to your project folders
npm run build
SYSTEM_MCP_CONFIG=./config.json npm start
```

Or for development:

```bash
SYSTEM_MCP_WORKSPACES=/path/to/projects npm run dev
```

Then open http://127.0.0.1:8787/dashboard

## MCP endpoint

`http://127.0.0.1:8787/mcp` (Streamable HTTP). Connect any MCP client.

## Tools

list_files, read_file, write_file, edit_file, create_directory, move_file, delete_file,
search_files, execute_command, get_command_status, terminate_command, get_system_info,
git_status, git_diff, list_processes.

## Configuration

Environment variables plus JSON config file (see config.example.json). Workspaces restrict
all file operations. Remote access disabled until explicitly enabled.

## Security

- File operations restricted to configured workspaces; path traversal and symlink escape blocked.
- Destructive file ops and dangerous commands require approval (configurable).
- Command timeouts, output limits, process cleanup, rate limits.
- Audit log at ~/.system-mcp/audit.log.
- Dashboard local-only by default.

## Tests

```bash
npm test
```

## Docs

- docs/ARCHITECTURE.md
- docs/THREAT_MODEL.md
- docs/CONNECT_CLOUD_AGENT.md