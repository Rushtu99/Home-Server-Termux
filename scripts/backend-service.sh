#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
BACKEND_BIND_HOST="${BACKEND_BIND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
BACKEND_PID_PATH="${BACKEND_PID_PATH:-$RUNTIME_DIR/backend.pid}"
BACKEND_LOG_PATH="${BACKEND_LOG_PATH:-$LOG_DIR/backend.log}"
SERVER_NODE_OPTIONS="${SERVER_NODE_OPTIONS:---max-old-space-size=192}"
BACKEND_START_TIMEOUT_SECONDS="${BACKEND_START_TIMEOUT_SECONDS:-90}"
SERVICE_NAME="backend"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

is_listening() {
  if command -v nc >/dev/null 2>&1; then
    nc -z "$BACKEND_BIND_HOST" "$BACKEND_PORT" >/dev/null 2>&1
    return $?
  fi

  python3 - "$BACKEND_BIND_HOST" "$BACKEND_PORT" <<'PY' >/dev/null 2>&1
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
with socket.create_connection((host, port), timeout=2):
    pass
PY
}

list_matching_pids() {
  pgrep -af "node .*server/index.js|node .*server/src/main/start-server.js|npm --prefix .*/server run start" | awk '!/pgrep -af/ && !/backend-service.sh/ { print $1 }' || true
}

read_pid() {
  local pid=""

  if [ -f "$BACKEND_PID_PATH" ]; then
    pid="$(tr -d '[:space:]' < "$BACKEND_PID_PATH" 2>/dev/null || true)"
  fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf '%s\n' "$pid"
    return 0
  fi

  pid="$(list_matching_pids | head -n 1)"
  if [ -n "$pid" ]; then
    printf '%s\n' "$pid" > "$BACKEND_PID_PATH"
    printf '%s\n' "$pid"
    return 0
  fi

  return 1
}

is_running() {
  local pid=""
  pid="$(read_pid || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_service() {
  local pid=""

  if is_running && is_listening; then
    echo "backend already running"
    return 0
  fi

  nohup bash -lc "mkdir -p '$LOG_DIR'; exec env NODE_OPTIONS='$SERVER_NODE_OPTIONS' BACKEND_BIND_HOST='$BACKEND_BIND_HOST' PORT='$BACKEND_PORT' npm --prefix '$PROJECT/server' run start --silent >> '$BACKEND_LOG_PATH' 2>&1" >/dev/null 2>&1 &
  pid="$!"
  printf '%s\n' "$pid" > "$BACKEND_PID_PATH"

  for _ in $(seq 1 "$BACKEND_START_TIMEOUT_SECONDS"); do
    if is_listening; then
      return 0
    fi
    sleep 1
  done

  echo "backend failed to listen on $BACKEND_BIND_HOST:$BACKEND_PORT" >&2
  return 1
}

stop_service() {
  local pid=""

  pid="$(read_pid || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi

  list_matching_pids | while read -r extra_pid; do
    [ -n "$extra_pid" ] || continue
    kill "$extra_pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$extra_pid" 2>/dev/null; then
      kill -9 "$extra_pid" >/dev/null 2>&1 || true
    fi
  done

  rm -f "$BACKEND_PID_PATH"
}

status_json() {
  local running=false
  local status="stopped"
  local status_code=1

  if is_running && is_listening; then
    running=true
    status="running"
    status_code=0
  fi

  printf '{"service":"%s","running":%s,"status":"%s","checkedAt":"%s"}\n' \
    "$SERVICE_NAME" \
    "$running" \
    "$status" \
    "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  return "$status_code"
}

case "${1:-status}" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  status)
    if [ "${2:-}" = "--json" ]; then
      status_json
    else
      if is_running && is_listening; then
        echo "running"
      else
        echo "stopped"
        exit 1
      fi
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status [--json]}" >&2
    exit 1
    ;;
esac
