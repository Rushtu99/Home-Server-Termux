#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
DASHBOARD_DIR="${DASHBOARD_DIR:-$PROJECT/dashboard}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_BIND_HOST="${FRONTEND_BIND_HOST:-127.0.0.1}"
FRONTEND_PID_PATH="${FRONTEND_PID_PATH:-$RUNTIME_DIR/frontend.pid}"
FRONTEND_LOG_PATH="${FRONTEND_LOG_PATH:-$LOG_DIR/frontend.log}"
DASHBOARD_NODE_OPTIONS="${DASHBOARD_NODE_OPTIONS:---max-old-space-size=384}"
ALLOWED_DEV_ORIGINS="${ALLOWED_DEV_ORIGINS:-127.0.0.1,localhost,http://127.0.0.1:3000,http://127.0.0.1:8088,http://localhost:3000,http://localhost:8088}"
FRONTEND_START_TIMEOUT_SECONDS="${FRONTEND_START_TIMEOUT_SECONDS:-120}"
FRONTEND_AUTO_BUILD="${FRONTEND_AUTO_BUILD:-1}"
SERVICE_NAME="frontend"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

is_listening() {
  if command -v nc >/dev/null 2>&1; then
    nc -z "$FRONTEND_BIND_HOST" "$FRONTEND_PORT" >/dev/null 2>&1
    return $?
  fi

  python3 - "$FRONTEND_BIND_HOST" "$FRONTEND_PORT" <<'PY' >/dev/null 2>&1
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
with socket.create_connection((host, port), timeout=2):
    pass
PY
}

list_matching_pids() {
  pgrep -af "next start -H|next dev --webpack --hostname|next-server" | awk '!/pgrep -af/ && !/frontend-service.sh/ { print $1 }' || true
}

read_pid() {
  local pid=""

  if [ -f "$FRONTEND_PID_PATH" ]; then
    pid="$(tr -d '[:space:]' < "$FRONTEND_PID_PATH" 2>/dev/null || true)"
  fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf '%s\n' "$pid"
    return 0
  fi

  pid="$(list_matching_pids | head -n 1)"
  if [ -n "$pid" ]; then
    printf '%s\n' "$pid" > "$FRONTEND_PID_PATH"
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

needs_dashboard_build() {
  local build_id="$DASHBOARD_DIR/.next/BUILD_ID"
  local watch_paths=(
    "$DASHBOARD_DIR/app"
    "$DASHBOARD_DIR/public"
    "$DASHBOARD_DIR/package.json"
    "$DASHBOARD_DIR/package-lock.json"
    "$DASHBOARD_DIR/next.config.ts"
    "$DASHBOARD_DIR/tsconfig.json"
  )

  if [ ! -f "$build_id" ]; then
    return 0
  fi

  for path in "${watch_paths[@]}"; do
    if [ ! -e "$path" ]; then
      continue
    fi

    if [ -d "$path" ]; then
      if find "$path" -type f -newer "$build_id" -print -quit 2>/dev/null | grep -q .; then
        return 0
      fi
      continue
    fi

    if [ "$path" -nt "$build_id" ]; then
      return 0
    fi
  done

  return 1
}

start_service() {
  local pid=""
  local launch_cmd=""

  if [ ! -d "$DASHBOARD_DIR" ] || [ ! -f "$DASHBOARD_DIR/package.json" ]; then
    echo "dashboard project not found: $DASHBOARD_DIR" >&2
    return 1
  fi

  if is_running && is_listening; then
    echo "frontend already running"
    return 0
  fi

  if [ "$FRONTEND_AUTO_BUILD" = "1" ] && needs_dashboard_build; then
    echo "dashboard build is missing or stale, running npm run build" >> "$FRONTEND_LOG_PATH"
    if ! (
      cd "$DASHBOARD_DIR" &&
      export NODE_OPTIONS="$DASHBOARD_NODE_OPTIONS" FRONTEND_BIND_HOST="$FRONTEND_BIND_HOST" ALLOWED_DEV_ORIGINS="$ALLOWED_DEV_ORIGINS" &&
      npm run build
    ) >> "$FRONTEND_LOG_PATH" 2>&1; then
      echo "dashboard build failed; see $FRONTEND_LOG_PATH" >&2
      return 1
    fi
  fi

  if [ -f "$DASHBOARD_DIR/.next/BUILD_ID" ]; then
    launch_cmd="cd '$DASHBOARD_DIR' && export NODE_OPTIONS='$DASHBOARD_NODE_OPTIONS' PORT='$FRONTEND_PORT' FRONTEND_BIND_HOST='$FRONTEND_BIND_HOST' ALLOWED_DEV_ORIGINS='$ALLOWED_DEV_ORIGINS'; exec npm start"
  else
    launch_cmd="cd '$DASHBOARD_DIR' && export NODE_OPTIONS='$DASHBOARD_NODE_OPTIONS' PORT='$FRONTEND_PORT' FRONTEND_BIND_HOST='$FRONTEND_BIND_HOST' ALLOWED_DEV_ORIGINS='$ALLOWED_DEV_ORIGINS'; exec npm run dev"
  fi

  nohup bash -lc "$launch_cmd" >> "$FRONTEND_LOG_PATH" 2>&1 &
  pid="$!"
  printf '%s\n' "$pid" > "$FRONTEND_PID_PATH"

  for _ in $(seq 1 "$FRONTEND_START_TIMEOUT_SECONDS"); do
    if is_listening; then
      return 0
    fi
    sleep 1
  done

  echo "frontend failed to listen on $FRONTEND_BIND_HOST:$FRONTEND_PORT" >&2
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

  pkill -f "next start -H" >/dev/null 2>&1 || true
  pkill -f "next dev --webpack --hostname" >/dev/null 2>&1 || true
  pkill -f "next-server" >/dev/null 2>&1 || true
  rm -f "$FRONTEND_PID_PATH"
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
