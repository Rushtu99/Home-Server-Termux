#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
POSTGRES_HOME="${POSTGRES_HOME:-$MEDIA_SERVICES_HOME/postgresql}"
POSTGRES_DATA_DIR="${POSTGRES_DATA_DIR:-$POSTGRES_HOME/data}"
POSTGRES_SOCKET_DIR="${POSTGRES_SOCKET_DIR:-$POSTGRES_HOME/socket}"
POSTGRES_BIND_HOST="${POSTGRES_BIND_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_PID_PATH="${POSTGRES_PID_PATH:-$RUNTIME_DIR/postgres.pid}"
POSTGRES_LOG_PATH="${POSTGRES_LOG_PATH:-$LOG_DIR/postgres.log}"
POSTGRES_BIN="${POSTGRES_BIN:-$(command -v postgres || true)}"
PG_CTL_BIN="${PG_CTL_BIN:-$(command -v pg_ctl || true)}"
INITDB_BIN="${INITDB_BIN:-$(command -v initdb || true)}"
PSQL_BIN="${PSQL_BIN:-$(command -v psql || true)}"
CREATEDB_BIN="${CREATEDB_BIN:-$(command -v createdb || true)}"
POSTGRES_DB="${POSTGRES_DB:-homeserver_media}"
POSTGRES_USER="${POSTGRES_USER:-homeserver_media}"
SERVICE_NAME="postgres"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$POSTGRES_HOME" "$POSTGRES_SOCKET_DIR"

is_listening() {
    if command -v nc >/dev/null 2>&1; then
        nc -z "$POSTGRES_BIND_HOST" "$POSTGRES_PORT" >/dev/null 2>&1
        return $?
    fi

    python3 - "$POSTGRES_BIND_HOST" "$POSTGRES_PORT" <<'PY' >/dev/null 2>&1
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

with socket.create_connection((host, port), timeout=2):
    pass
PY
}

ensure_cluster() {
    [ -n "$POSTGRES_BIN" ] || {
        echo "postgresql is not installed" >&2
        return 1
    }
    [ -n "$PG_CTL_BIN" ] || {
        echo "pg_ctl is not installed" >&2
        return 1
    }
    [ -n "$INITDB_BIN" ] || {
        echo "initdb is not installed" >&2
        return 1
    }

    if [ -f "$POSTGRES_DATA_DIR/PG_VERSION" ]; then
        return 0
    fi

    mkdir -p "$POSTGRES_DATA_DIR"
    "$INITDB_BIN" -D "$POSTGRES_DATA_DIR" --auth-local=trust --auth-host=trust --username=postgres >/dev/null
    cat >> "$POSTGRES_DATA_DIR/postgresql.conf" <<EOF
listen_addresses = '$POSTGRES_BIND_HOST'
port = $POSTGRES_PORT
unix_socket_directories = '$POSTGRES_SOCKET_DIR'
EOF
    cat > "$POSTGRES_DATA_DIR/pg_hba.conf" <<EOF
local all all trust
host all all 127.0.0.1/32 trust
host all all ::1/128 trust
EOF
}

ensure_database() {
    [ -n "$PSQL_BIN" ] || return 0
    [ -n "$CREATEDB_BIN" ] || return 0

    "$PSQL_BIN" -h "$POSTGRES_BIND_HOST" -p "$POSTGRES_PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$POSTGRES_USER'" | grep -q 1 \
        || "$PSQL_BIN" -h "$POSTGRES_BIND_HOST" -p "$POSTGRES_PORT" -U postgres -d postgres -c "CREATE ROLE \"$POSTGRES_USER\" LOGIN"

    "$PSQL_BIN" -h "$POSTGRES_BIND_HOST" -p "$POSTGRES_PORT" -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'" | grep -q 1 \
        || "$CREATEDB_BIN" -h "$POSTGRES_BIND_HOST" -p "$POSTGRES_PORT" -U postgres -O "$POSTGRES_USER" "$POSTGRES_DB"
}

is_running() {
    "$PG_CTL_BIN" -D "$POSTGRES_DATA_DIR" status >/dev/null 2>&1
}

is_healthy() {
    is_running && is_listening
}

start_service() {
    ensure_cluster
    if is_healthy; then
        return 0
    fi

    if is_running && ! is_listening; then
        "$PG_CTL_BIN" -D "$POSTGRES_DATA_DIR" stop -m fast >/dev/null 2>&1 || true
        sleep 1
    fi

    "$PG_CTL_BIN" -D "$POSTGRES_DATA_DIR" -l "$POSTGRES_LOG_PATH" -o "-h $POSTGRES_BIND_HOST -p $POSTGRES_PORT -k $POSTGRES_SOCKET_DIR" start >/dev/null

    local attempts=0
    local max_attempts=60
    while [ "$attempts" -lt "$max_attempts" ]; do
        if is_healthy; then
            "$PG_CTL_BIN" -D "$POSTGRES_DATA_DIR" status | awk '/PID:/ { print $2 }' | tr -d ',' > "$POSTGRES_PID_PATH" || true
            ensure_database
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 1
    done

    "$PG_CTL_BIN" -D "$POSTGRES_DATA_DIR" status | awk '/PID:/ { print $2 }' | tr -d ',' > "$POSTGRES_PID_PATH" || true
    return 1
}

stop_service() {
    if [ ! -f "$POSTGRES_DATA_DIR/PG_VERSION" ]; then
        rm -f "$POSTGRES_PID_PATH"
        return 0
    fi

    if is_running; then
        "$PG_CTL_BIN" -D "$POSTGRES_DATA_DIR" stop -m fast >/dev/null || true
    fi

    rm -f "$POSTGRES_PID_PATH"
}

status_json() {
    local running=false
    local status="stopped"
    local checked_at=""
    local status_code=1

    if is_healthy; then
        running=true
        status="running"
        status_code=0
    elif is_running; then
        status="degraded"
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
            is_healthy
        fi
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status [--json]}" >&2
        exit 1
        ;;
esac
