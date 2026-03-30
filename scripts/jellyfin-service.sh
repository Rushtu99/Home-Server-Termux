#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
JELLYFIN_HOME="${JELLYFIN_HOME:-$MEDIA_SERVICES_HOME/jellyfin}"
JELLYFIN_BIND_HOST="${JELLYFIN_BIND_HOST:-127.0.0.1}"
JELLYFIN_PORT="${JELLYFIN_PORT:-8096}"
JELLYFIN_PID_PATH="${JELLYFIN_PID_PATH:-$RUNTIME_DIR/jellyfin.pid}"
JELLYFIN_LOG_PATH="${JELLYFIN_LOG_PATH:-$LOG_DIR/jellyfin.log}"
JELLYFIN_BIN="${JELLYFIN_BIN:-$(command -v jellyfin-server || command -v jellyfin || true)}"
JELLYFIN_DOTNET_ROOT="${JELLYFIN_DOTNET_ROOT:-/data/data/com.termux/files/usr/lib/dotnet}"
JELLYFIN_WEB_DIR="${JELLYFIN_WEB_DIR:-/data/data/com.termux/files/usr/lib/jellyfin/jellyfin-web}"
JELLYFIN_FFMPEG_BIN="${JELLYFIN_FFMPEG_BIN:-/data/data/com.termux/files/usr/opt/jellyfin/bin/ffmpeg}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$JELLYFIN_HOME/cache" "$JELLYFIN_HOME/config" "$JELLYFIN_HOME/data"

is_running() {
    local pid=""
    [ -f "$JELLYFIN_PID_PATH" ] || return 1
    pid="$(cat "$JELLYFIN_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_service() {
    [ -n "$JELLYFIN_BIN" ] || {
        echo "jellyfin-server is not installed" >&2
        return 1
    }

    if is_running; then
        return 0
    fi

    if command -v setsid >/dev/null 2>&1; then
        setsid env \
            HOME="$JELLYFIN_HOME" \
            XDG_CACHE_HOME="$JELLYFIN_HOME/cache" \
            XDG_CONFIG_HOME="$JELLYFIN_HOME/config" \
            JELLYFIN_DATA_DIR="$JELLYFIN_HOME/data" \
            JELLYFIN_CACHE_DIR="$JELLYFIN_HOME/cache" \
            DOTNET_ROOT="$JELLYFIN_DOTNET_ROOT" \
            ASPNETCORE_URLS="http://$JELLYFIN_BIND_HOST:$JELLYFIN_PORT" \
            "$JELLYFIN_BIN" \
            --service \
            --datadir "$JELLYFIN_HOME/data" \
            --cachedir "$JELLYFIN_HOME/cache" \
            --configdir "$JELLYFIN_HOME/config" \
            --logdir "$LOG_DIR" \
            --webdir "$JELLYFIN_WEB_DIR" \
            --ffmpeg "$JELLYFIN_FFMPEG_BIN" \
            > "$JELLYFIN_LOG_PATH" 2>&1 < /dev/null &
    else
        nohup env \
            HOME="$JELLYFIN_HOME" \
            XDG_CACHE_HOME="$JELLYFIN_HOME/cache" \
            XDG_CONFIG_HOME="$JELLYFIN_HOME/config" \
            JELLYFIN_DATA_DIR="$JELLYFIN_HOME/data" \
            JELLYFIN_CACHE_DIR="$JELLYFIN_HOME/cache" \
            DOTNET_ROOT="$JELLYFIN_DOTNET_ROOT" \
            ASPNETCORE_URLS="http://$JELLYFIN_BIND_HOST:$JELLYFIN_PORT" \
            "$JELLYFIN_BIN" \
            --service \
            --datadir "$JELLYFIN_HOME/data" \
            --cachedir "$JELLYFIN_HOME/cache" \
            --configdir "$JELLYFIN_HOME/config" \
            --logdir "$LOG_DIR" \
            --webdir "$JELLYFIN_WEB_DIR" \
            --ffmpeg "$JELLYFIN_FFMPEG_BIN" \
            > "$JELLYFIN_LOG_PATH" 2>&1 &
    fi
    printf '%s\n' "$!" > "$JELLYFIN_PID_PATH"
}

stop_service() {
    local pid=""

    if [ ! -f "$JELLYFIN_PID_PATH" ]; then
        return 0
    fi

    pid="$(cat "$JELLYFIN_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi

    rm -f "$JELLYFIN_PID_PATH"
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
    *)
        echo "usage: $0 {start|stop|restart|status}" >&2
        exit 1
        ;;
esac
