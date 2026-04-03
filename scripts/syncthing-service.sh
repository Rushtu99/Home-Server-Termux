#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
SYNCTHING_HOME="${SYNCTHING_HOME:-$RUNTIME_DIR/syncthing}"
SYNCTHING_GUI_BIND_HOST="${SYNCTHING_GUI_BIND_HOST:-127.0.0.1}"
SYNCTHING_GUI_PORT="${SYNCTHING_GUI_PORT:-8384}"
SYNCTHING_PID_PATH="${SYNCTHING_PID_PATH:-$RUNTIME_DIR/syncthing.pid}"
SYNCTHING_LOG_PATH="${SYNCTHING_LOG_PATH:-$LOG_DIR/syncthing.log}"
SYNCTHING_BIN="${SYNCTHING_BIN:-$(command -v syncthing || true)}"
SERVICE_NAME="syncthing"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$SYNCTHING_HOME"

is_running() {
    local pid=""
    [ -f "$SYNCTHING_PID_PATH" ] || return 1
    pid="$(cat "$SYNCTHING_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null
}

start_service() {
    [ -n "$SYNCTHING_BIN" ] || {
        printf 'syncthing binary not found\n' >&2
        exit 1
    }

    if is_running; then
        printf 'syncthing already running\n'
        exit 0
    fi

    nohup "$SYNCTHING_BIN" serve --no-browser --home "$SYNCTHING_HOME" --gui-address="http://$SYNCTHING_GUI_BIND_HOST:$SYNCTHING_GUI_PORT" --no-port-probing > "$SYNCTHING_LOG_PATH" 2>&1 &
    printf '%s\n' "$!" > "$SYNCTHING_PID_PATH"
}

stop_service() {
    local pid=""
    if [ ! -f "$SYNCTHING_PID_PATH" ]; then
        return 0
    fi

    pid="$(cat "$SYNCTHING_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi
    rm -f "$SYNCTHING_PID_PATH"
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
