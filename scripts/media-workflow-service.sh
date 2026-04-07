#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_IMPORTER_CMD="${MEDIA_IMPORTER_CMD:-$PROJECT/scripts/media-importer.sh}"
MEDIA_WORKFLOW_INTERVAL_SEC="${MEDIA_WORKFLOW_INTERVAL_SEC:-300}"
MEDIA_WORKFLOW_TRIGGER="${MEDIA_WORKFLOW_TRIGGER:-sweeper}"
MEDIA_WORKFLOW_PID_PATH="${MEDIA_WORKFLOW_PID_PATH:-$RUNTIME_DIR/media-workflow.pid}"
MEDIA_WORKFLOW_LOG_PATH="${MEDIA_WORKFLOW_LOG_PATH:-$LOG_DIR/media-workflow.log}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

is_running() {
    local pid=""
    [ -f "$MEDIA_WORKFLOW_PID_PATH" ] || return 1
    pid="$(cat "$MEDIA_WORKFLOW_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

run_loop() {
    while true; do
        if [ -x "$MEDIA_IMPORTER_CMD" ]; then
            "$MEDIA_IMPORTER_CMD" run --trigger "$MEDIA_WORKFLOW_TRIGGER" >> "$MEDIA_WORKFLOW_LOG_PATH" 2>&1 || true
        else
            printf '[%s] WARN  media importer missing: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$MEDIA_IMPORTER_CMD" >> "$MEDIA_WORKFLOW_LOG_PATH"
        fi
        sleep "$MEDIA_WORKFLOW_INTERVAL_SEC"
    done
}

start_service() {
    if is_running; then
        return 0
    fi

    if [ ! -x "$MEDIA_IMPORTER_CMD" ]; then
        echo "media importer helper is not executable: $MEDIA_IMPORTER_CMD" >&2
        return 1
    fi

    if command -v setsid >/dev/null 2>&1; then
        setsid bash -lc "exec '$0' run-loop" >/dev/null 2>&1 < /dev/null &
    else
        nohup bash -lc "exec '$0' run-loop" >/dev/null 2>&1 &
    fi
    printf '%s\n' "$!" > "$MEDIA_WORKFLOW_PID_PATH"
}

stop_service() {
    local pid=""

    if [ ! -f "$MEDIA_WORKFLOW_PID_PATH" ]; then
        return 0
    fi

    pid="$(cat "$MEDIA_WORKFLOW_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi

    rm -f "$MEDIA_WORKFLOW_PID_PATH"
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
        is_running
        ;;
    run-loop)
        run_loop
        ;;
    run-once)
        "$MEDIA_IMPORTER_CMD" run --trigger "$MEDIA_WORKFLOW_TRIGGER"
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status|run-once}" >&2
        exit 1
        ;;
esac
