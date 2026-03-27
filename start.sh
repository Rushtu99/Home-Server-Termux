#!/data/data/com.termux/files/usr/bin/bash

echo "🚀 Starting Home Server..."

# Prevent Android from killing processes
termux-wake-lock

# Limit Node memory (IMPORTANT)
export NODE_OPTIONS="--max-old-space-size=256"

# --- Cleanup old processes ---
pkill sshd 2>/dev/null
pkill node 2>/dev/null
pkill filebrowser 2>/dev/null
pkill nginx 2>/dev/null
pkill ttyd 2>/dev/null

# Kill old tmux session
tmux kill-session -t homeserver 2>/dev/null

# --- Create tmux session ---
tmux new-session -d -s homeserver

# --- SSH ---
tmux send-keys -t homeserver "sshd" C-m
sleep 1

# --- Backend (Express) ---
tmux split-window -h -t homeserver
tmux send-keys -t homeserver "cd ~/home-server/server && node index.js > backend.log 2>&1" C-m
sleep 2

# --- Filebrowser ---
tmux split-window -v -t homeserver
tmux send-keys -t homeserver "filebrowser -d ~/filebrowser.db -r ~/nas -p 8080 -a 0.0.0.0 > filebrowser.log 2>&1" C-m
sleep 2

# --- Nginx ---
tmux split-window -v -t homeserver
tmux send-keys -t homeserver "nginx -c ~/home-server/nginx.conf" C-m
sleep 2

# --- Terminal (ttyd) ---
tmux split-window -v -t homeserver
tmux send-keys -t homeserver "ttyd -p 7681 bash -l" C-m
sleep 2

# --- Next.js (PRODUCTION MODE) ---
tmux split-window -v -t homeserver
tmux send-keys -t homeserver "cd ~/home-server/dashboard && npm run build && npm start > frontend.log 2>&1" C-m

# --- Attach ---
echo "✅ All services started"
echo "🌐 Access: http://192.168.1.69:8088"

tmux attach -t homeserver
