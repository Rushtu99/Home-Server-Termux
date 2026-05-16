#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
TTYD_BIN="${TTYD_BIN:-$(command -v ttyd || true)}"
TTYD_BIND_HOST="${TTYD_BIND_HOST:-127.0.0.1}"
TTYD_PORT="${TTYD_PORT:-7681}"
TTYD_PID_PATH="${TTYD_PID_PATH:-$RUNTIME_DIR/ttyd.pid}"
TTYD_LOG_PATH="${TTYD_LOG_PATH:-$LOG_DIR/ttyd.log}"
TTYD_START_TIMEOUT_SECONDS="${TTYD_START_TIMEOUT_SECONDS:-45}"
SERVICE_NAME="ttyd"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

is_listening() {
  if command -v nc >/dev/null 2>&1; then
    nc -z "$TTYD_BIND_HOST" "$TTYD_PORT" >/dev/null 2>&1
    return $?
  fi

  python3 - "$TTYD_BIND_HOST" "$TTYD_PORT" <<'PY' >/dev/null 2>&1
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
with socket.create_connection((host, port), timeout=2):
    pass
PY
}

read_pid() {
  local pid=""
  if [ -f "$TTYD_PID_PATH" ]; then
    pid="$(tr -d '[:space:]' < "$TTYD_PID_PATH" 2>/dev/null || true)"
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
  local pid=""

  if [ -z "$TTYD_BIN" ]; then
    echo "ttyd binary not found" >&2
    return 1
  fi

  if is_running; then
    echo "ttyd already running"
    return 0
  fi

  nohup "$TTYD_BIN" -W -i "$TTYD_BIND_HOST" -p "$TTYD_PORT" -w "$PROJECT" bash -l > "$TTYD_LOG_PATH" 2>&1 &
  pid="$!"
  printf '%s\n' "$pid" > "$TTYD_PID_PATH"

  for _ in $(seq 1 "$TTYD_START_TIMEOUT_SECONDS"); do
    if is_running; then
      return 0
    fi
    sleep 1
  done

  echo "ttyd failed to listen on $TTYD_BIND_HOST:$TTYD_PORT" >&2
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

  pkill -f "ttyd -W -i $TTYD_BIND_HOST -p $TTYD_PORT -w $PROJECT" >/dev/null 2>&1 || true
  rm -f "$TTYD_PID_PATH"
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
