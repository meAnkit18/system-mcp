#!/usr/bin/env bash
set -e

echo "============================================"
echo "  system-mcp - Local AI Agent Bridge"
echo "============================================"
echo

# Auto-update from GitHub (best effort)
if [ -d ".git" ] && command -v git >/dev/null 2>&1; then
    echo "[INFO] Pulling latest changes..."
    git pull --ff-only 2>/dev/null || echo "[WARN] git pull failed (offline or conflicts); continuing."
fi

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

# Port (allow override)
PORT="${SYSTEM_MCP_PORT:-8787}"
export SYSTEM_MCP_PORT="$PORT"

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

# Always rebuild to pick up latest changes
echo "[INFO] Building TypeScript..."
npm run build

# Resolve host (0.0.0.0 means all interfaces; browser uses 127.0.0.1)
HOST="${SYSTEM_MCP_HOST:-127.0.0.1}"
export SYSTEM_MCP_HOST="$HOST"

# Print the URL clearly
echo "============================================"
echo "  Listening on: $HOST:$PORT"
echo "  Dashboard: http://127.0.0.1:$PORT/dashboard"
echo "  MCP endpoint: http://127.0.0.1:$PORT/mcp"
echo "  (0.0.0.0 is not a browsable address; use 127.0.0.1 or your machine IP)"
echo "  Open the Dashboard URL above in your browser."
echo "============================================"
echo

# Optional: start a public tunnel automatically (no cloudflared/ngrok required)
TUNNEL_LOG=""
TUNNEL_PID=""
if command -v cloudflared >/dev/null 2>&1; then
    echo "[INFO] cloudflared found - starting public tunnel..."
    TUNNEL_LOG="$(mktemp)"
    cloudflared tunnel --url http://127.0.0.1:$PORT >"$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    for i in $(seq 1 30); do
        TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)
        if [ -n "$TUNNEL_URL" ]; then
            echo "============================================"
            echo "  PUBLIC (HTTPS) MCP URL: $TUNNEL_URL/mcp"
            echo "  Use this URL in browser-based agents."
            echo "============================================"
            break
        fi
        sleep 1
    done
elif command -v npx >/dev/null 2>&1; then
    echo "[INFO] Using localtunnel (no cloudflared/ngrok needed)..."
    TUNNEL_LOG="$(mktemp)"
    npx --yes localtunnel --port $PORT >"$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    for i in $(seq 1 40); do
        TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.loca\.lt' "$TUNNEL_LOG" | head -1)
        if [ -n "$TUNNEL_URL" ]; then
            echo "============================================"
            echo "  PUBLIC (HTTPS) MCP URL: $TUNNEL_URL/mcp"
            echo "  Use this URL in browser-based agents."
            echo "============================================"
            break
        fi
        sleep 1
    done
else
    echo "[INFO] No tunnel tool found. For browser agents, install one of:"
    echo "       npm i -g localtunnel   (then: lt --port 8787)"
    echo "       or: ssh -R 80:localhost:8787 nokey@localhost.run"
fi

cleanup() {
    if [ -n "$TUNNEL_PID" ]; then kill "$TUNNEL_PID" 2>/dev/null || true; fi
    [ -n "$TUNNEL_LOG" ] && rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT

# Open dashboard in background (best effort)
(sleep 3 && (xdg-open http://127.0.0.1:$PORT/dashboard 2>/dev/null || sensible-browser http://127.0.0.1:$PORT/dashboard 2>/dev/null || true)) &

# Start server
npm start

echo
echo "[INFO] Server stopped."