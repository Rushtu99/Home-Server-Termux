#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
FILESYSTEM_ROOT="${FILESYSTEM_ROOT:-${FILEBROWSER_ROOT:-$USER_HOME/Drives}}"
COPYPARTY_BIND_HOST="${COPYPARTY_BIND_HOST:-127.0.0.1}"
COPYPARTY_PORT="${COPYPARTY_PORT:-3923}"
COPYPARTY_BASE_PATH="${COPYPARTY_BASE_PATH:-/copyparty}"
COPYPARTY_PID_PATH="${COPYPARTY_PID_PATH:-$RUNTIME_DIR/copyparty.pid}"
COPYPARTY_LOG_PATH="${COPYPARTY_LOG_PATH:-$LOG_DIR/copyparty.log}"
COPYPARTY_BIN="${COPYPARTY_BIN:-$(command -v copyparty || true)}"
SERVICE_NAME="copyparty"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

is_running() {
    local pid=""
    [ -f "$COPYPARTY_PID_PATH" ] || return 1
    pid="$(cat "$COPYPARTY_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null
}

start_service() {
    [ -n "$COPYPARTY_BIN" ] || {
        printf 'copyparty binary not found\n' >&2
        exit 1
    }

    if is_running; then
        printf 'copyparty already running\n'
        exit 0
    fi

    nohup "$COPYPARTY_BIN" -i "$COPYPARTY_BIND_HOST" -p "$COPYPARTY_PORT" --name "Home Server Transfers" --rproxy 1 --rp-loc "$COPYPARTY_BASE_PATH" --chdir "$FILESYSTEM_ROOT" > "$COPYPARTY_LOG_PATH" 2>&1 &
    printf '%s\n' "$!" > "$COPYPARTY_PID_PATH"
}

stop_service() {
    local pid=""
    if [ ! -f "$COPYPARTY_PID_PATH" ]; then
        return 0
    fi

    pid="$(cat "$COPYPARTY_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi
    rm -f "$COPYPARTY_PID_PATH"
}

status_service() {
    if is_running; then
        printf 'running\n'
        exit 0
    fi

    printf 'stopped\n'
    exit 1
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

case "${1:-}" in
    start) start_service ;;
    stop) stop_service ;;
    restart)
        stop_service
        start_service
        ;;
    status)
        if [ "${2:-}" = "--json" ]; then
            status_json
        else
            status_service
        fi
        ;;
    *)
        printf 'Usage: %s {start|stop|restart|status [--json]}\n' "$0" >&2
        exit 1
        ;;
esac
