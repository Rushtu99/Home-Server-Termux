#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
PID_FILE="${PID_FILE:-$RUNTIME_DIR/nextjs-dashboard.pid}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/nextjs-dashboard.log}"

DASHBOARD_DIR="${DASHBOARD_DIR:-$PROJECT/dashboard}"
NEXTJS_DASHBOARD_HOST="${NEXTJS_DASHBOARD_HOST:-127.0.0.1}"
NEXTJS_DASHBOARD_PORT="${NEXTJS_DASHBOARD_PORT:-3000}"
NEXTJS_DASHBOARD_CMD="${NEXTJS_DASHBOARD_CMD:-npm --prefix \"$DASHBOARD_DIR\" run dev -- --hostname $NEXTJS_DASHBOARD_HOST --port $NEXTJS_DASHBOARD_PORT}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

is_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_service() {
  if is_running; then
    echo "nextjs-dashboard already running"
    return 0
  fi
  sh -lc "nohup $NEXTJS_DASHBOARD_CMD >> \"$LOG_FILE\" 2>&1 & echo \$! > \"$PID_FILE\""
  sleep 1
  if ! is_running; then
    echo "failed to start nextjs-dashboard" >&2
    return 1
  fi
}

stop_service() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "nextjs-dashboard already stopped"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

status_json() {
  local running=false
  local state="stopped"
  if is_running; then
    running=true
    state="running"
  fi
  printf '{"service":"nextjs-dashboard","running":%s,"status":"%s","checkedAt":"%s"}\n' \
    "$running" "$state" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  [ "$running" = true ]
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
    echo "usage: nextjs-dashboard-service.sh {start|stop|restart|status [--json]}" >&2
    exit 1
    ;;
esac
