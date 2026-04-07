#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
JELLYSEERR_HOME="${JELLYSEERR_HOME:-$MEDIA_SERVICES_HOME/jellyseerr}"
JELLYSEERR_APP_DIR="${JELLYSEERR_APP_DIR:-$JELLYSEERR_HOME/app}"
JELLYSEERR_BIND_HOST="${JELLYSEERR_BIND_HOST:-127.0.0.1}"
JELLYSEERR_PORT="${JELLYSEERR_PORT:-5055}"
JELLYSEERR_BASE_PATH="${JELLYSEERR_BASE_PATH:-/requests}"
JELLYSEERR_PID_PATH="${JELLYSEERR_PID_PATH:-$RUNTIME_DIR/jellyseerr.pid}"
JELLYSEERR_LOG_PATH="${JELLYSEERR_LOG_PATH:-$LOG_DIR/jellyseerr.log}"
JELLYSEERR_DATA_DIR="${JELLYSEERR_DATA_DIR:-$JELLYSEERR_HOME/data}"
SERVICE_NAME="jellyseerr"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$JELLYSEERR_HOME" "$JELLYSEERR_DATA_DIR"

is_running() {
    local pid=""
    [ -f "$JELLYSEERR_PID_PATH" ] || return 1
    pid="$(cat "$JELLYSEERR_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

ensure_install() {
    [ -f "$JELLYSEERR_APP_DIR/package.json" ] || {
        echo "Jellyseerr app is missing; run scripts/install-media-automation.sh first" >&2
        return 1
    }
    [ -f "$JELLYSEERR_APP_DIR/dist/index.js" ] || {
        echo "Jellyseerr build output is missing; run scripts/install-media-automation.sh first" >&2
        return 1
    }
}

start_service() {
    if is_running; then
        return 0
    fi

    ensure_install
    if command -v setsid >/dev/null 2>&1; then
        setsid env NODE_ENV=production PORT="$JELLYSEERR_PORT" HOST="$JELLYSEERR_BIND_HOST" CONFIG_DIRECTORY="$JELLYSEERR_DATA_DIR" BASE_URL="$JELLYSEERR_BASE_PATH" \
            node "$JELLYSEERR_APP_DIR/dist/index.js" > "$JELLYSEERR_LOG_PATH" 2>&1 < /dev/null &
    else
        nohup env NODE_ENV=production PORT="$JELLYSEERR_PORT" HOST="$JELLYSEERR_BIND_HOST" CONFIG_DIRECTORY="$JELLYSEERR_DATA_DIR" BASE_URL="$JELLYSEERR_BASE_PATH" \
            node "$JELLYSEERR_APP_DIR/dist/index.js" > "$JELLYSEERR_LOG_PATH" 2>&1 &
    fi
    printf '%s\n' "$!" > "$JELLYSEERR_PID_PATH"
}

stop_service() {
    local pid=""

    [ -f "$JELLYSEERR_PID_PATH" ] || return 0
    pid="$(cat "$JELLYSEERR_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi
    rm -f "$JELLYSEERR_PID_PATH"
}

status_json() {
    local running=false
    local status="stopped"
    local checked_at=""
    local status_code=1

    if is_running; then
        running=true
        status="running"
        status_code=0
    fi

    checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '{"service":"%s","running":%s,"status":"%s","checkedAt":"%s"}\n' \
        "$SERVICE_NAME" \
        "$running" \
        "$status" \
        "$checked_at"

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
            is_running
        fi
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status [--json]}" >&2
        exit 1
        ;;
esac
