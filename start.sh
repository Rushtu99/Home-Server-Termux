#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

# -------------------------------
# Home Server Start Script
# -------------------------------
# Absolute paths
USER_HOME="/data/data/com.termux/files/home"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
NAS="${NAS:-$USER_HOME/nas}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
FILEBROWSER_DB_PATH="${FILEBROWSER_DB_PATH:-$RUNTIME_DIR/filebrowser.db}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=128}"

echo "🚀 Starting Home Server (no tmux mode)..."

mkdir -p "$LOG_DIR" "$RUNTIME_DIR"

if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
fi

detect_host_ip() {
    local HOST_IP=""

    if command -v ifconfig >/dev/null 2>&1; then
        HOST_IP=$(ifconfig wlan0 2>/dev/null | awk '/inet / { print $2; exit }')
        if [ -z "$HOST_IP" ]; then
            HOST_IP=$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" { print $2; exit }')
        fi
    fi

    if [ -n "$HOST_IP" ]; then
        printf '%s\n' "$HOST_IP"
    else
        printf '127.0.0.1\n'
    fi
}

# --- Helper: wait for port ---
wait_for_port() {
    local PORT=$1
    local NAME=$2
    local RETRIES=30
    local SLEEP=1

    echo "⏳ Waiting for $NAME on port $PORT..."
    for i in $(seq 1 $RETRIES); do
        if command -v nc >/dev/null 2>&1; then
            if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
                echo "✅ $NAME is up on port $PORT"
                return 0
            fi
        elif ss -tuln 2>/dev/null | grep -q ":$PORT\\b"; then
            echo "✅ $NAME is up on port $PORT"
            return 0
        fi
        sleep $SLEEP
    done

    echo "⚠ Timeout waiting for $NAME"
    return 1
}

# --- Cleanup ---
echo "🧹 Cleaning old processes..."
pkill -f "node index.js" 2>/dev/null || true
pkill -f "next dev --webpack --hostname 0.0.0.0" 2>/dev/null || true
pkill -f "next start -H 0.0.0.0" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill filebrowser 2>/dev/null || true
pkill nginx 2>/dev/null || true
pkill ttyd 2>/dev/null || true

# ⚠ Do NOT kill sshd
# pkill sshd

# --- SSH ---
echo "🔐 Checking SSH..."
if command -v sshd >/dev/null 2>&1; then
    pgrep sshd >/dev/null || sshd
fi
sleep 1

# --- Backend ---
echo "🟢 Starting Backend..."
cd "$PROJECT/server" || { echo "❌ Backend directory not found"; exit 1; }
node index.js > "$LOG_DIR/backend.log" 2>&1 &
wait_for_port 4000 "Backend"

# --- Filebrowser ---
echo "📁 Starting Filebrowser..."
if command -v filebrowser >/dev/null 2>&1; then
    filebrowser config set -d "$FILEBROWSER_DB_PATH" --auth.method=noauth >/dev/null 2>&1 || true
    filebrowser -d "$FILEBROWSER_DB_PATH" -r "$NAS" -p 8080 -a 127.0.0.1 -b /files --noauth > "$LOG_DIR/filebrowser.log" 2>&1 &
    wait_for_port 8080 "Filebrowser" || echo "⚠ Filebrowser failed to start"
else
    echo "⚠ Skipping Filebrowser (command not found)"
fi

# --- Nginx ---
echo "🌐 Starting Nginx..."
if command -v nginx >/dev/null 2>&1; then
    mkdir -p "$PROJECT/logs"
    nginx -p "$PROJECT" -c "$PROJECT/nginx.conf"
    wait_for_port 8088 "Nginx" || echo "⚠ Nginx failed to start"
else
    echo "⚠ Skipping Nginx (command not found)"
fi

# --- Terminal ---
echo "💻 Starting Terminal..."
if command -v ttyd >/dev/null 2>&1; then
    ttyd -W -i 127.0.0.1 -p 7681 bash -l > "$LOG_DIR/ttyd.log" 2>&1 &
    wait_for_port 7681 "Terminal" || echo "⚠ Terminal failed to start"
else
    echo "⚠ Skipping ttyd (command not found)"
fi

# --- Extra delay for frontend stability ---
echo "⏳ Waiting 10s before starting Frontend..."
sleep 10

# --- Frontend ---
echo "⚛ Starting Frontend..."
cd "$PROJECT/dashboard" || { echo "❌ Dashboard directory not found"; exit 1; }
if [ -f ".next/BUILD_ID" ]; then
    npm start > "$LOG_DIR/frontend.log" 2>&1 &
else
    npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
fi
wait_for_port 3000 "Frontend" || echo "⚠ Frontend failed (system still usable)"

# --- Done ---
HOST_IP=$(detect_host_ip)
echo ""
echo "✅ Home Server Started"
echo "🌐 Dashboard: http://$HOST_IP:8088"
echo "📁 Files:     http://$HOST_IP:8088/files"
echo "💻 Terminal:  http://$HOST_IP:8088/term"
echo ""

# --- Keep script alive ---
wait
