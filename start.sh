#!/usr/bin/env bash
set -e

echo "============================================"
echo "  system-mcp - Local AI Agent Bridge"
echo "============================================"
echo

# Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed or not in PATH."
    echo "Please install Node.js from https://nodejs.org/ and re-run."
    exit 1
fi

# Check npm
if ! command -v npm >/dev/null 2>&1; then
    echo "[ERROR] npm is not installed or not in PATH."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing dependencies..."
    npm install
fi

# Ask for workspace if not provided via env
if [ -z "$SYSTEM_MCP_WORKSPACES" ]; then
    read -rp "Enter your projects folder path: " WORKSPACE
    if [ -z "$WORKSPACE" ]; then
        echo "[ERROR] No workspace provided."
        exit 1
    fi
    export SYSTEM_MCP_WORKSPACES="$WORKSPACE"
fi

echo
echo "[INFO] Workspace: $SYSTEM_MCP_WORKSPACES"
echo "[INFO] Starting system-mcp..."
echo

# Build if dist missing
if [ ! -f "dist/index.js" ]; then
    echo "[INFO] Building TypeScript..."
    npm run build
fi

# Open dashboard in background (best effort)
(sleep 3 && (xdg-open http://127.0.0.1:8787/dashboard 2>/dev/null || open http://127.0.0.1:8787/dashboard 2>/dev/null || true)) &

# Start server
npm start

echo
echo "[INFO] Server stopped."