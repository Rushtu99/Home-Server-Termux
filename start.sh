#!/data/data/com.termux/files/usr/bin/bash

echo "🚀 Starting Home Server (no tmux mode)..."

termux-wake-lock
export NODE_OPTIONS="--max-old-space-size=192"

# --- Helper: wait for port ---
wait_for_port() {
  local port=$1
  local name=$2

  echo "⏳ Waiting for $name on port $port..."

  for i in {1..20}; do
    if ss -tuln | grep -q ":$port"; then
      echo "✅ $name is running"
      return 0
    fi
    sleep 1
  done

  echo "❌ $name failed to start"
  exit 1
}

# --- Cleanup ---
echo "🧹 Cleaning old processes..."
pkill node 2>/dev/null
pkill filebrowser 2>/dev/null
pkill nginx 2>/dev/null
pkill ttyd 2>/dev/null

# ⚠️ Do NOT kill sshd
# pkill sshd

# --- SSH ---
echo "🔐 Checking SSH..."
pgrep sshd > /dev/null || sshd
sleep 1

# --- Backend ---
echo "🟢 Starting Backend..."
cd ~/home-server/server
node index.js > backend.log 2>&1 &
wait_for_port 4000 "Backend"

# --- Filebrowser ---
echo "📁 Starting Filebrowser..."
filebrowser -d ~/filebrowser.db -r ~/nas -p 8080 -a 0.0.0.0 > filebrowser.log 2>&1 &
wait_for_port 8080 "Filebrowser"

# --- Nginx ---
echo "🌐 Starting Nginx..."
nginx -c ~/home-server/nginx.conf
wait_for_port 8088 "Nginx"

# --- Terminal ---
echo "💻 Starting Terminal..."
ttyd -p 7681 bash -l > ttyd.log 2>&1 &
wait_for_port 7681 "Terminal"

# 🧠 Delay before frontend
echo "⏳ Waiting before frontend..."
sleep 10

# --- Frontend (NO BUILD) ---
echo "⚛️ Starting Frontend..."
cd ~/home-server/dashboard
npm start > frontend.log 2>&1 &

wait_for_port 3000 "Frontend" || echo "⚠️ Frontend failed (system still usable)"

# --- Done ---
echo ""
echo "✅ Home Server Started"
echo "🌐 Dashboard: http://192.168.1.69:8088"
echo "📁 Files:     http://192.168.1.69:8088/files"
echo "💻 Terminal:  http://192.168.1.69:8088/term"
echo ""

# --- Keep script alive ---
wait
