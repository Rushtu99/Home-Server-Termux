#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
REDIS_HOME="${REDIS_HOME:-$MEDIA_SERVICES_HOME/redis}"
REDIS_BIND_HOST="${REDIS_BIND_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_PID_PATH="${REDIS_PID_PATH:-$RUNTIME_DIR/redis.pid}"
REDIS_LOG_PATH="${REDIS_LOG_PATH:-$LOG_DIR/redis.log}"
REDIS_CONFIG_PATH="${REDIS_CONFIG_PATH:-$REDIS_HOME/redis.conf}"
REDIS_BIN="${REDIS_BIN:-$(command -v redis-server || command -v valkey-server || true)}"
SERVICE_NAME="redis"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$REDIS_HOME"

ensure_config() {
    cat > "$REDIS_CONFIG_PATH" <<EOF
bind $REDIS_BIND_HOST
port $REDIS_PORT
dir $REDIS_HOME
protected-mode yes
appendonly yes
save 900 1
save 300 10
save 60 10000
daemonize no
pidfile $REDIS_PID_PATH
logfile ""
EOF
}

is_running() {
    local pid=""
    [ -f "$REDIS_PID_PATH" ] || return 1
    pid="$(cat "$REDIS_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_service() {
    [ -n "$REDIS_BIN" ] || {
        echo "redis-server is not installed" >&2
        return 1
    }

    if is_running; then
        return 0
    fi

    ensure_config
    nohup "$REDIS_BIN" "$REDIS_CONFIG_PATH" > "$REDIS_LOG_PATH" 2>&1 &
    printf '%s\n' "$!" > "$REDIS_PID_PATH"
}

stop_service() {
    local pid=""

    if [ ! -f "$REDIS_PID_PATH" ]; then
        return 0
    fi

    pid="$(cat "$REDIS_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi

    rm -f "$REDIS_PID_PATH"
}

status_json() {
    local running=false
    local status="stopped"
    local checked_at=""

    if is_running; then
        running=true
        status="running"
    fi

    checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '{"service":"%s","running":%s,"status":"%s","checkedAt":"%s"}\n' \
        "$SERVICE_NAME" \
        "$running" \
        "$status" \
        "$checked_at"
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
