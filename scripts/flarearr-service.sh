#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
FLAREARR_HOME="${FLAREARR_HOME:-$MEDIA_SERVICES_HOME/flarearr}"
FLAREARR_APP_DIR="${FLAREARR_APP_DIR:-$FLAREARR_HOME/app}"
FLAREARR_VENV_DIR="${FLAREARR_VENV_DIR:-$FLAREARR_HOME/venv}"
FLAREARR_BIND_HOST="${FLAREARR_BIND_HOST:-127.0.0.1}"
FLAREARR_PORT="${FLAREARR_PORT:-8191}"
FLAREARR_PID_PATH="${FLAREARR_PID_PATH:-$RUNTIME_DIR/flarearr.pid}"
FLAREARR_LOG_PATH="${FLAREARR_LOG_PATH:-$LOG_DIR/flarearr.log}"
FLAREARR_LOG_LEVEL="${FLAREARR_LOG_LEVEL:-info}"
FLAREARR_BROWSER_TIMEOUT="${FLAREARR_BROWSER_TIMEOUT:-40000}"
FLAREARR_CHROME_EXE_PATH="${FLAREARR_CHROME_EXE_PATH:-}"
SERVICE_NAME="flarearr"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$FLAREARR_HOME"

resolve_chrome_exe_path() {
    local candidate=""

    if [ -n "$FLAREARR_CHROME_EXE_PATH" ]; then
        [ -x "$FLAREARR_CHROME_EXE_PATH" ] || return 1
        printf '%s\n' "$FLAREARR_CHROME_EXE_PATH"
        return 0
    fi

    for candidate in \
        "$(command -v chromium-browser 2>/dev/null || true)" \
        "$(command -v chromium 2>/dev/null || true)" \
        "$(command -v google-chrome 2>/dev/null || true)" \
        "$(command -v google-chrome-stable 2>/dev/null || true)"; do
        [ -n "$candidate" ] || continue
        [ -x "$candidate" ] || continue
        FLAREARR_CHROME_EXE_PATH="$candidate"
        printf '%s\n' "$candidate"
        return 0
    done

    return 1
}

is_listening() {
    python3 - "$FLAREARR_BIND_HOST" "$FLAREARR_PORT" <<'PY' >/dev/null 2>&1
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

with socket.create_connection((host, port), timeout=2):
    pass
PY
}

is_running() {
    local pid=""
    [ -f "$FLAREARR_PID_PATH" ] || return 1
    pid="$(cat "$FLAREARR_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && is_listening
}

ensure_install() {
    [ -x "$FLAREARR_VENV_DIR/bin/python" ] || {
        echo "FlareArr venv is missing; install dependencies under $FLAREARR_VENV_DIR first." >&2
        return 1
    }

    "$FLAREARR_VENV_DIR/bin/python" -c "import requests, flaresolverr" >/dev/null 2>&1 || {
        echo "FlareArr dependencies are incomplete; activate $FLAREARR_VENV_DIR and install requirements." >&2
        return 1
    }

    resolve_chrome_exe_path >/dev/null || {
        echo "FlareArr requires a Chrome/Chromium executable; set FLAREARR_CHROME_EXE_PATH if auto-detection fails." >&2
        return 1
    }
}

start_service() {
    if is_running; then
        return 0
    fi

    ensure_install

    if command -v setsid >/dev/null 2>&1; then
        setsid env \
            HOST="$FLAREARR_BIND_HOST" \
            PORT="$FLAREARR_PORT" \
            LOG_LEVEL="$FLAREARR_LOG_LEVEL" \
            BROWSER_TIMEOUT="$FLAREARR_BROWSER_TIMEOUT" \
            CHROME_EXE_PATH="$FLAREARR_CHROME_EXE_PATH" \
            "$FLAREARR_VENV_DIR/bin/python" -m flaresolverr > "$FLAREARR_LOG_PATH" 2>&1 < /dev/null &
    else
        nohup env \
            HOST="$FLAREARR_BIND_HOST" \
            PORT="$FLAREARR_PORT" \
            LOG_LEVEL="$FLAREARR_LOG_LEVEL" \
            BROWSER_TIMEOUT="$FLAREARR_BROWSER_TIMEOUT" \
            CHROME_EXE_PATH="$FLAREARR_CHROME_EXE_PATH" \
            "$FLAREARR_VENV_DIR/bin/python" -m flaresolverr > "$FLAREARR_LOG_PATH" 2>&1 &
    fi

    printf '%s\n' "$!" > "$FLAREARR_PID_PATH"

    for _ in $(seq 1 30); do
        sleep 1
        if is_running; then
            return 0
        fi
    done

    rm -f "$FLAREARR_PID_PATH"
    return 1
}

stop_service() {
    local pid=""

    [ -f "$FLAREARR_PID_PATH" ] || return 0
    pid="$(cat "$FLAREARR_PID_PATH" 2>/dev/null || true)"

    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi

    rm -f "$FLAREARR_PID_PATH"
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

doctor_install() {
    ensure_install
    echo "FlareArr install is ready."
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
    doctor)
        doctor_install
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status|doctor}" >&2
        exit 1
        ;;
esac
