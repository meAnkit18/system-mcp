@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   system-mcp - Local AI Agent Bridge
echo ============================================
echo.

REM Auto-update from GitHub (best effort)
if exist ".git" (
    where git >nul 2>&1
    if not errorlevel 1 (
        echo [INFO] Pulling latest changes...
        git pull --ff-only 2>nul
        if errorlevel 1 echo [WARN] git pull failed; continuing.
    )
)

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/ and re-run.
    pause
    exit /b 1
)

REM Check npm
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed or not in PATH.
    pause
    exit /b 1
)

REM Install dependencies if needed
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
)

REM Ask for workspace if not provided via env
if "%SYSTEM_MCP_WORKSPACES%"=="" (
    set /p WORKSPACE="Enter your projects folder path: "
    if "!WORKSPACE!"=="" (
        echo [ERROR] No workspace provided.
        pause
        exit /b 1
    )
    set "SYSTEM_MCP_WORKSPACES=!WORKSPACE!"
)

echo.
echo [INFO] Workspace: %SYSTEM_MCP_WORKSPACES%
echo [INFO] Starting system-mcp...
echo.

REM Always rebuild to pick up latest changes
echo [INFO] Building TypeScript...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

REM Optional public tunnel (cloudflared, else localtunnel via npx)
where cloudflared >nul 2>&1
if not errorlevel 1 (
    echo [INFO] cloudflared found - starting public tunnel in new window...
    start "system-mcp-tunnel" cmd /k "cloudflared tunnel --url http://127.0.0.1:8787"
) else (
    where npx >nul 2>&1
    if not errorlevel 1 (
        echo [INFO] Using localtunnel via npx (no cloudflared needed)...
        start "system-mcp-tunnel" cmd /k "npx --yes localtunnel --port 8787"
    ) else (
        echo [INFO] No tunnel tool found. For browser agents, install localtunnel:
        echo        npm i -g localtunnel   (then: lt --port 8787)
    )
)

REM Start server
start "" cmd /c "timeout /t 3 >nul && start http://127.0.0.1:8787/dashboard"
call npm start

echo.
echo [INFO] Server stopped.
pause