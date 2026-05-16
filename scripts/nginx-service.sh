#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
NGINX_BIN="${NGINX_BIN:-$(command -v nginx || true)}"
NGINX_PID_PATH="${NGINX_PID_PATH:-$RUNTIME_DIR/nginx.pid}"
NGINX_PORT="${NGINX_PORT:-8088}"
NGINX_START_TIMEOUT_SECONDS="${NGINX_START_TIMEOUT_SECONDS:-30}"
SERVICE_NAME="nginx"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

is_listening() {
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$NGINX_PORT" >/dev/null 2>&1
    return $?
  fi

  python3 - "$NGINX_PORT" <<'PY' >/dev/null 2>&1
import socket
import sys

port = int(sys.argv[1])
with socket.create_connection(("127.0.0.1", port), timeout=2):
    pass
PY
}

read_pid() {
  local pid=""
  if [ -f "$NGINX_PID_PATH" ]; then
    pid="$(tr -d '[:space:]' < "$NGINX_PID_PATH" 2>/dev/null || true)"
  fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf '%s\n' "$pid"
    return 0
  fi
  return 1
}

is_running() {
  read_pid >/dev/null 2>&1 && is_listening
}

start_service() {
  if [ -z "$NGINX_BIN" ]; then
    echo "nginx binary not found" >&2
    return 1
  fi

  if is_running; then
    echo "nginx already running"
    return 0
  fi

  "$NGINX_BIN" -p "$PROJECT" -c "$PROJECT/nginx.conf"

  for _ in $(seq 1 "$NGINX_START_TIMEOUT_SECONDS"); do
    if is_running; then
      return 0
    fi
    sleep 1
  done

  echo "nginx failed to listen on 127.0.0.1:$NGINX_PORT" >&2
  return 1
}

stop_service() {
  if [ -z "$NGINX_BIN" ]; then
    rm -f "$NGINX_PID_PATH"
    return 0
  fi

  "$NGINX_BIN" -p "$PROJECT" -c "$PROJECT/nginx.conf" -s quit >/dev/null 2>&1 || true

  if command -v su >/dev/null 2>&1; then
    su -c "'$NGINX_BIN' -p '$PROJECT' -c '$PROJECT/nginx.conf' -s quit" >/dev/null 2>&1 || true
  fi

  pkill -f "nginx -p $PROJECT -c $PROJECT/nginx.conf" >/dev/null 2>&1 || true
  rm -f "$NGINX_PID_PATH" "$PROJECT/nginx.pid"
}

status_json() {
  local running=false
  local status="stopped"
  local status_code=1

  if is_running; then
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
      if is_running; then
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
