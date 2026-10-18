#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  Perchance Code - Local Coding Workspace"
echo "============================================"

# --- dependency checks ---
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed. Install from https://nodejs.org/"; exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm is not installed."; exit 1
fi

# --- project directory ---
PROJECT_DIR="${1:-}"
if [ -z "$PROJECT_DIR" ]; then
  if command -v zenity >/dev/null 2>&1; then
    PROJECT_DIR="$(zenity --file-selection --directory --title='Select project directory' 2>/dev/null || true)"
  elif command -v kdialog >/dev/null 2>&1; then
    PROJECT_DIR="$(kdialog --getexistingdirectory "$HOME" 2>/dev/null || true)"
  else
    read -rp "Enter project directory path: " PROJECT_DIR
  fi
fi

if [ -z "$PROJECT_DIR" ]; then
  echo "[ERROR] No project directory selected."; exit 1
fi
# expand ~
PROJECT_DIR="${PROJECT_DIR/#\~/$HOME}"
if [ ! -d "$PROJECT_DIR" ]; then
  echo "[ERROR] Project directory does not exist: $PROJECT_DIR"; exit 1
fi
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
echo "[INFO] Project: $PROJECT_DIR"

# --- chromium detection ---
CHROMIUM=""
for c in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$c" >/dev/null 2>&1; then CHROMIUM="$c"; break; fi
done
if [ -z "$CHROMIUM" ]; then
  echo "[ERROR] Chromium/Chrome is not installed."
  echo "Install one of: chromium, chromium-browser, google-chrome"
  echo "On Debian/Ubuntu: sudo apt install chromium-browser"
  exit 1
fi

# --- data dir / config ---
DATA_DIR="${HOME}/.system-mcp"
mkdir -p "$DATA_DIR"
PROFILE_DIR="${DATA_DIR}/perchance-profile"
mkdir -p "$PROFILE_DIR"
CONFIG_FILE="${DATA_DIR}/perchance-code.json"
PORT="${SYSTEM_MCP_PORT:-8787}"
HOST="127.0.0.1"

# write config (do not overwrite user's original config; this is a dedicated file)
cat > "$CONFIG_FILE" <<EOF
{
  "host": "$HOST",
  "port": $PORT,
  "workspaces": ["$PROJECT_DIR"],
  "dataDir": "$DATA_DIR",
  "remote": { "enabled": false },
  "approvals": { "dangerousCommands": "require-approval", "destructiveFileOps": "require-approval" },
  "limits": {
    "maxFileSizeBytes": 10485760,
    "maxCommandOutputBytes": 10485760,
    "commandTimeoutMs": 120000,
    "maxConcurrentCommands": 8,
    "rateLimitPerMinute": 300
  }
}
EOF

# --- install deps / build ---
if [ ! -d "node_modules" ]; then
  echo "[INFO] Installing dependencies..."
  npm install
fi
echo "[INFO] Building..."
npm run build >/dev/null 2>&1 || { echo "[ERROR] Build failed"; exit 1; }

# --- daemon management ---
PID_FILE="${DATA_DIR}/daemon.pid"
DAEMON_STARTED_BY_US=0

health_ok() {
  curl -fsS "http://${HOST}:${PORT}/health" >/dev/null 2>&1
}

# check if running
if health_ok; then
  # check workspace match
  CURRENT="$(curl -fsS "http://${HOST}:${PORT}/api/status" 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);console.log((j.workspaces||[]).join(","))}catch{console.log("")})' || true)"
  if echo "$CURRENT" | grep -qF "$PROJECT_DIR"; then
    echo "[INFO] Reusing existing daemon (workspace matches)."
  else
    echo "[INFO] Existing daemon has different workspace; restarting..."
    if [ -f "$PID_FILE" ]; then
      OLDPID="$(cat "$PID_FILE" 2>/dev/null || true)"
      if [ -n "$OLDPID" ]; then kill "$OLDPID" 2>/dev/null || true; fi
    fi
    # fallback: kill by port? best effort
    sleep 1
    health_ok && { echo "[ERROR] Could not stop existing daemon"; exit 1; }
    DAEMON_STARTED_BY_US=1
  fi
else
  DAEMON_STARTED_BY_US=1
fi

if [ "$DAEMON_STARTED_BY_US" = "1" ]; then
  echo "[INFO] Starting daemon..."
  SYSTEM_MCP_CONFIG="$CONFIG_FILE" SYSTEM_MCP_HOST="$HOST" SYSTEM_MCP_PORT="$PORT" \
    nohup node dist/index.js > "${DATA_DIR}/daemon.log" 2>&1 &
  echo $! > "$PID_FILE"
  # wait for health
  for i in $(seq 1 30); do
    if health_ok; then break; fi
    sleep 1
  done
  if ! health_ok; then
    echo "[ERROR] Daemon failed to start. See ${DATA_DIR}/daemon.log"
    exit 1
  fi
  echo "[INFO] Daemon started (PID $(cat "$PID_FILE"))."
fi

# --- token ---
TOKEN="$(curl -fsS "http://${HOST}:${PORT}/api/token" 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).token||"")}catch{console.log("")})' || true)"
echo "[INFO] Local token retrieved."

# --- prepare extension config ---
EXT_DIR="${SCRIPT_DIR}/integrations/perchance/extension"
GEN_CONFIG="${PROFILE_DIR}/extension-config.js"
# write a small config file the user can load via popup (best effort)
echo "{\"daemonUrl\":\"http://${HOST}:${PORT}\",\"token\":\"${TOKEN}\"}" > "${DATA_DIR}/extension-config.json"

# --- launch chromium ---
PERCHANCE_URL="https://perchance.org/ai-chat"
DASHBOARD_URL="http://${HOST}:${PORT}/dashboard"

# Build load-extension arg if exists
LOAD_EXT=""
if [ -d "$EXT_DIR" ]; then
  LOAD_EXT="--load-extension=${EXT_DIR}"
fi

echo "[INFO] Launching Chromium..."
"$CHROMIUM" \
  --user-data-dir="$PROFILE_DIR" \
  ${LOAD_EXT} \
  "$PERCHANCE_URL" \
  "$DASHBOARD_URL" \
  >/dev/null 2>&1 &
CHROME_PID=$!

echo "============================================"
echo "  Perchance: $PERCHANCE_URL"
echo "  Dashboard: $DASHBOARD_URL"
echo "  Project:   $PROJECT_DIR"
echo "============================================"
echo "Press Ctrl+C to stop (daemon will keep running unless started by this launcher)."

cleanup() {
  echo
  echo "[INFO] Shutting down..."
  if [ "$DAEMON_STARTED_BY_US" = "1" ] && [ -f "$PID_FILE" ]; then
    OLDPID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$OLDPID" ]; then kill "$OLDPID" 2>/dev/null || true; fi
    rm -f "$PID_FILE"
  fi
}
trap cleanup INT TERM EXIT

# Wait for chromium to exit
wait "$CHROME_PID" 2>/dev/null || true