#!/usr/bin/env bash
set -euo pipefail

echo "Starting Home Server (WSL/Linux dev mode)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_SERVER_DIR="${HOME_SERVER_DIR:-$SCRIPT_DIR}"
FILEBROWSER_ROOT="${FILEBROWSER_ROOT:-$HOME}"
LOG_DIR="$HOME_SERVER_DIR/logs"
RUNTIME_DIR="${RUNTIME_DIR:-$HOME_SERVER_DIR/runtime}"
FILEBROWSER_DB_PATH="${FILEBROWSER_DB_PATH:-$RUNTIME_DIR/filebrowser.db}"
BUILD_NODE_OPTIONS="${BUILD_NODE_OPTIONS:---max-old-space-size=512}"
RUNTIME_NODE_OPTIONS="${RUNTIME_NODE_OPTIONS:---max-old-space-size=256}"

wait_for_port() {
  local port="$1"
  local name="$2"

  echo "Waiting for $name on port $port..."

  for _ in $(seq 1 30); do
    if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
      echo "$name is running"
      return 0
    fi

    if command -v ss >/dev/null 2>&1 && ss -tuln | grep -q ":$port\\b"; then
      echo "$name is running"
      return 0
    fi

    sleep 1
  done

  echo "$name failed to start"
  return 1
}

if [ "$(id -u)" -eq 0 ]; then
  echo "Please run start-wsl.sh as your normal user, not root."
  exit 1
fi

mkdir -p "$LOG_DIR" "$RUNTIME_DIR"

echo "Fixing local permissions for cache files..."
chmod -R u+rwX "$HOME_SERVER_DIR/dashboard" "$HOME_SERVER_DIR/server" 2>/dev/null || true

echo "Cleaning old processes..."
pkill -f "node index.js" 2>/dev/null || true
pkill -f "next dev --webpack --hostname 0.0.0.0" 2>/dev/null || true
pkill -f "next start -H 0.0.0.0" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill nginx 2>/dev/null || true
pkill filebrowser 2>/dev/null || true
pkill ttyd 2>/dev/null || true

echo "Starting Backend..."
cd "$HOME_SERVER_DIR/server"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund >/dev/null 2>&1
fi
NODE_OPTIONS="$RUNTIME_NODE_OPTIONS" node index.js > "$LOG_DIR/backend.log" 2>&1 &
wait_for_port 4000 "Backend" || exit 1

echo "Building Frontend..."
cd "$HOME_SERVER_DIR/dashboard"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund >/dev/null 2>&1
fi
rm -rf .next
FRONTEND_MODE="prod"
if ! NODE_OPTIONS="$BUILD_NODE_OPTIONS" npm run build > "$LOG_DIR/frontend-build.log" 2>&1; then
  echo "Frontend build failed, falling back to dev mode. Check $LOG_DIR/frontend-build.log"
  FRONTEND_MODE="dev"
fi

if [ "$FRONTEND_MODE" = "prod" ]; then
  echo "Starting Frontend (production mode)..."
  NODE_OPTIONS="$RUNTIME_NODE_OPTIONS" npm start > "$LOG_DIR/frontend.log" 2>&1 &
else
  echo "Starting Frontend (dev fallback mode)..."
  NODE_OPTIONS="$RUNTIME_NODE_OPTIONS" npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
fi
wait_for_port 3000 "Frontend" || exit 1

if command -v nginx >/dev/null 2>&1; then
  echo "Starting Nginx..."
  nginx -p "$HOME_SERVER_DIR" -c "$HOME_SERVER_DIR/nginx.conf" > /dev/null 2>&1 || true
  wait_for_port 8088 "Nginx" || echo "Nginx failed to start"
else
  echo "Skipping Nginx (command not found)"
fi

if command -v filebrowser >/dev/null 2>&1; then
  echo "Starting Filebrowser..."
  filebrowser config set -d "$FILEBROWSER_DB_PATH" --auth.method=noauth >/dev/null 2>&1 || true
  filebrowser -d "$FILEBROWSER_DB_PATH" -r "$FILEBROWSER_ROOT" -p 8080 -a 127.0.0.1 -b /files --noauth > "$LOG_DIR/filebrowser.log" 2>&1 &
  wait_for_port 8080 "Filebrowser" || echo "Filebrowser failed to start"
else
  echo "Skipping Filebrowser (command not found)"
fi

if command -v ttyd >/dev/null 2>&1; then
  echo "Starting ttyd..."
  ttyd -W -i 127.0.0.1 -p 7681 -w "$HOME_SERVER_DIR" bash -l > "$LOG_DIR/ttyd.log" 2>&1 &
  wait_for_port 7681 "ttyd" || echo "ttyd failed to start"
else
  echo "Skipping ttyd (command not found)"
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$HOST_IP" ]; then
  HOST_IP="127.0.0.1"
fi

echo ""
echo "Home Server Started (WSL/Linux dev)"
echo "Dashboard direct: http://$HOST_IP:3000"
echo "Dashboard via Nginx: http://$HOST_IP:8088"
echo "Backend API: http://$HOST_IP:4000 (dashboard routes require auth)"
echo ""

wait
