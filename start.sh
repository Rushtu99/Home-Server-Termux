#!/data/data/com.termux/files/usr/bin/bash
#
# Bot guidance:
# - Termux bootstrap script; keep commands mobile-safe and memory-aware.
# - Keep service command parity with server/index.js.

set -euo pipefail

echo "Starting Home Server (Termux mode)..."

HOME_SERVER_DIR="${HOME_SERVER_DIR:-$HOME/home-server}"
FILEBROWSER_ROOT="${FILEBROWSER_ROOT:-$HOME/nas}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=128}"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock
fi

wait_for_port() {
  local port="$1"
  local name="$2"

  echo "Waiting for $name on port $port..."

  for _ in {1..25}; do
    if ss -tuln | grep -q ":$port\\b"; then
      echo "$name is running"
      return 0
    fi
    sleep 1
  done

  echo "$name failed to start"
  return 1
}

echo "Cleaning old processes..."
pkill -f "node index.js" 2>/dev/null || true
pkill -f "next dev --webpack --hostname 0.0.0.0" 2>/dev/null || true
pkill -f "next start -H 0.0.0.0" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill filebrowser 2>/dev/null || true
pkill nginx 2>/dev/null || true
pkill ttyd 2>/dev/null || true

echo "Checking SSH..."
if command -v sshd >/dev/null 2>&1; then
  pgrep sshd >/dev/null || sshd
fi
sleep 1

echo "Starting Backend..."
cd "$HOME_SERVER_DIR/server" || exit 1
node index.js > backend.log 2>&1 &
wait_for_port 4000 "Backend" || exit 1

echo "Starting Filebrowser..."
if command -v filebrowser >/dev/null 2>&1; then
  filebrowser config set -d "$HOME_SERVER_DIR/filebrowser.db" --auth.method=noauth >/dev/null 2>&1 || true
  filebrowser -d "$HOME_SERVER_DIR/filebrowser.db" -r "$FILEBROWSER_ROOT" -p 8080 -a 127.0.0.1 -b /files --noauth > filebrowser.log 2>&1 &
  wait_for_port 8080 "Filebrowser" || echo "Filebrowser failed to start"
else
  echo "Skipping Filebrowser (command not found)"
fi

echo "Starting Nginx..."
if command -v nginx >/dev/null 2>&1; then
  mkdir -p "$HOME_SERVER_DIR/logs"
  nginx -p "$HOME_SERVER_DIR" -c "$HOME_SERVER_DIR/nginx.conf"
  wait_for_port 8088 "Nginx" || echo "Nginx failed to start"
else
  echo "Skipping Nginx (command not found)"
fi

echo "Starting Terminal..."
if command -v ttyd >/dev/null 2>&1; then
  ttyd -W -i 127.0.0.1 -p 7681 bash -l > ttyd.log 2>&1 &
  wait_for_port 7681 "Terminal" || echo "Terminal failed to start"
else
  echo "Skipping ttyd (command not found)"
fi

echo "Waiting before frontend..."
sleep 10

echo "Starting Frontend..."
cd "$HOME_SERVER_DIR/dashboard" || exit 1
if [ -f ".next/BUILD_ID" ]; then
  npm start > frontend.log 2>&1 &
else
  npm run dev > frontend.log 2>&1 &
fi
wait_for_port 3000 "Frontend" || echo "Frontend failed (system still usable)"

HOST_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')
if [ -z "$HOST_IP" ]; then
  HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$HOST_IP" ]; then
  HOST_IP="127.0.0.1"
fi

echo ""
echo "Home Server Started (Termux)"
echo "Dashboard: http://$HOST_IP:8088"
echo "Files:     http://$HOST_IP:8088/files"
echo "Terminal:  http://$HOST_IP:8088/term"
echo ""

wait
