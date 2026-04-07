#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
BAZARR_HOME="${BAZARR_HOME:-$MEDIA_SERVICES_HOME/bazarr}"
BAZARR_APP_DIR="${BAZARR_APP_DIR:-$BAZARR_HOME/app}"
BAZARR_VENV_DIR="${BAZARR_VENV_DIR:-$BAZARR_HOME/venv}"
BAZARR_BIND_HOST="${BAZARR_BIND_HOST:-127.0.0.1}"
BAZARR_PORT="${BAZARR_PORT:-6767}"
BAZARR_PID_PATH="${BAZARR_PID_PATH:-$RUNTIME_DIR/bazarr.pid}"
BAZARR_LOG_PATH="${BAZARR_LOG_PATH:-$LOG_DIR/bazarr.log}"
BAZARR_CONFIG_DIR="${BAZARR_CONFIG_DIR:-$BAZARR_HOME/data}"
BAZARR_TMUX_SESSION="${BAZARR_TMUX_SESSION:-hmstx-bazarr}"
SERVICE_NAME="bazarr"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$BAZARR_HOME" "$BAZARR_CONFIG_DIR"

list_matching_pids() {
    pgrep -af "bazarr.py" | awk '!/pgrep -af/ { print $1 }' || true
}

tmux_session_exists() {
    command -v tmux >/dev/null 2>&1 && tmux has-session -t "$BAZARR_TMUX_SESSION" 2>/dev/null
}

read_pid() {
    local pid=""

    if [ -f "$BAZARR_PID_PATH" ]; then
        pid="$(tr -d '[:space:]' < "$BAZARR_PID_PATH" 2>/dev/null || true)"
    fi
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        printf '%s\n' "$pid"
        return 0
    fi

    pid="$(list_matching_pids | head -n 1)"
    if [ -n "$pid" ]; then
        printf '%s\n' "$pid" > "$BAZARR_PID_PATH"
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

ensure_install() {
    [ -x "$BAZARR_VENV_DIR/bin/python" ] || {
        echo "Bazarr virtualenv is missing; run scripts/install-media-automation.sh first" >&2
        return 1
    }
    [ -f "$BAZARR_APP_DIR/bazarr.py" ] || {
        echo "Bazarr app is missing; run scripts/install-media-automation.sh first" >&2
        return 1
    }
    "$BAZARR_VENV_DIR/bin/python" -c "import lxml" >/dev/null 2>&1 || {
        echo "Bazarr dependencies are incomplete; lxml is missing from the venv" >&2
        return 1
    }
}

start_service() {
    local command_str=""
    local pid=""

    if is_running; then
        return 0
    fi

    ensure_install
    rm -f "$BAZARR_PID_PATH"

    printf -v command_str '%q ' \
        env \
        BAZARR_HOST="$BAZARR_BIND_HOST" \
        BAZARR_PORT="$BAZARR_PORT" \
        BAZARR_CONFIG_DIR="$BAZARR_CONFIG_DIR" \
        "$BAZARR_VENV_DIR/bin/python" \
        "$BAZARR_APP_DIR/bazarr.py"

    if command -v tmux >/dev/null 2>&1; then
        tmux kill-session -t "$BAZARR_TMUX_SESSION" 2>/dev/null || true
        tmux new-session -d -s "$BAZARR_TMUX_SESSION" "/data/data/com.termux/files/usr/bin/bash -lc \"${command_str} >> \\\"${BAZARR_LOG_PATH}\\\" 2>&1\""
    else
        nohup /data/data/com.termux/files/usr/bin/bash -lc "exec ${command_str}" >> "$BAZARR_LOG_PATH" 2>&1 < /dev/null &
        printf '%s\n' "$!" > "$BAZARR_PID_PATH"
    fi
    sleep 2
    pid="$(read_pid || true)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$BAZARR_PID_PATH"
        return 1
    fi
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
    if tmux_session_exists; then
        tmux kill-session -t "$BAZARR_TMUX_SESSION" 2>/dev/null || true
    fi
    rm -f "$BAZARR_PID_PATH"
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
