#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
SAMBA_RUNTIME_DIR="${SAMBA_RUNTIME_DIR:-$RUNTIME_DIR/samba}"
SAMBA_CONFIG_PATH="${SAMBA_CONFIG_PATH:-$SAMBA_RUNTIME_DIR/smb.conf}"
SAMBA_PID_PATH="${SAMBA_PID_PATH:-$RUNTIME_DIR/samba.pid}"
SAMBA_RENDERER="${SAMBA_RENDERER:-$PROJECT/scripts/render-samba-config.js}"
SAMBA_LOG_PATH="${SAMBA_LOG_PATH:-$LOG_DIR/samba.log}"
SMBD_BIN="${SMBD_BIN:-$(command -v smbd || true)}"
SERVICE_NAME="samba"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$SAMBA_RUNTIME_DIR"

is_running() {
    local pid=""
    [ -f "$SAMBA_PID_PATH" ] || return 1
    pid="$(cat "$SAMBA_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null
}

start_samba() {
    node "$SAMBA_RENDERER" > "$SAMBA_RUNTIME_DIR/exports.json"
    testparm -s "$SAMBA_CONFIG_PATH" >/dev/null

    [ -n "$SMBD_BIN" ] || {
        printf 'smbd binary not found\n' >&2
        exit 1
    }

    if is_running; then
        printf 'samba already running\n'
        exit 0
    fi

    if ! command -v su >/dev/null 2>&1; then
        printf 'su command is required to start samba on a LAN port\n' >&2
        exit 1
    fi

    su -c "nohup sh -c 'exec \"$SMBD_BIN\" -i -s \"$SAMBA_CONFIG_PATH\" > \"$SAMBA_LOG_PATH\" 2>&1' >/dev/null 2>&1 & echo \$! > \"$SAMBA_PID_PATH\""
}

stop_samba() {
    if ! command -v su >/dev/null 2>&1; then
        rm -f "$SAMBA_PID_PATH"
        exit 0
    fi

    su -c "if [ -f \"$SAMBA_PID_PATH\" ]; then pid=\$(cat \"$SAMBA_PID_PATH\" 2>/dev/null || true); if [ -n \"\$pid\" ] && kill -0 \"\$pid\" 2>/dev/null; then kill \"\$pid\" >/dev/null 2>&1 || true; sleep 1; if kill -0 \"\$pid\" 2>/dev/null; then kill -9 \"\$pid\" >/dev/null 2>&1 || true; fi; fi; rm -f \"$SAMBA_PID_PATH\"; fi"
}

status_samba() {
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
    start)
        start_samba
        ;;
    stop)
        stop_samba
        ;;
    restart)
        stop_samba
        start_samba
        ;;
    status)
        if [ "${2:-}" = "--json" ]; then
            status_json
        else
            status_samba
        fi
        ;;
    render)
        node "$SAMBA_RENDERER"
        ;;
    *)
        printf 'Usage: %s {start|stop|restart|status [--json]|render}\n' "$0" >&2
        exit 1
        ;;
esac
