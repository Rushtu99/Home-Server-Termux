#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
MEDIA_ROOT="${MEDIA_ROOT:-$USER_HOME/Drives/Media}"
MEDIA_DOWNLOADS_DIR="${MEDIA_DOWNLOADS_DIR:-$MEDIA_ROOT/downloads}"
MEDIA_DOWNLOADS_MANUAL_DIR="${MEDIA_DOWNLOADS_MANUAL_DIR:-$MEDIA_DOWNLOADS_DIR/manual}"
QBITTORRENT_HOME="${QBITTORRENT_HOME:-$MEDIA_SERVICES_HOME/qbittorrent}"
QBITTORRENT_BIND_HOST="${QBITTORRENT_BIND_HOST:-127.0.0.1}"
QBITTORRENT_PORT="${QBITTORRENT_PORT:-8081}"
QBITTORRENT_PID_PATH="${QBITTORRENT_PID_PATH:-$RUNTIME_DIR/qbittorrent.pid}"
QBITTORRENT_LOG_PATH="${QBITTORRENT_LOG_PATH:-$LOG_DIR/qbittorrent.log}"
QBITTORRENT_BIN="${QBITTORRENT_BIN:-$(command -v qbittorrent-nox || true)}"
QBITTORRENT_CONFIG_PATH="${QBITTORRENT_CONFIG_PATH:-$QBITTORRENT_HOME/qBittorrent/config/qBittorrent.conf}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$MEDIA_DOWNLOADS_MANUAL_DIR" "$(dirname "$QBITTORRENT_CONFIG_PATH")"

ensure_config() {
    if [ -f "$QBITTORRENT_CONFIG_PATH" ]; then
        return 0
    fi

    cat > "$QBITTORRENT_CONFIG_PATH" <<EOF
[BitTorrent]
Session\DefaultSavePath=$MEDIA_DOWNLOADS_MANUAL_DIR
Session\DisableAutoTMMByDefault=false

[LegalNotice]
Accepted=true

[Network]
Cookies=@Invalid()

[Preferences]
WebUI\Address=$QBITTORRENT_BIND_HOST
WebUI\Port=$QBITTORRENT_PORT
WebUI\CSRFProtection=true
WebUI\HostHeaderValidation=true
WebUI\LocalHostAuth=false
WebUI\SecureCookie=false
EOF
}

is_running() {
    local pid=""
    [ -f "$QBITTORRENT_PID_PATH" ] || return 1
    pid="$(cat "$QBITTORRENT_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_service() {
    [ -n "$QBITTORRENT_BIN" ] || {
        echo "qbittorrent-nox is not installed" >&2
        return 1
    }

    if is_running; then
        return 0
    fi

    ensure_config
    if command -v setsid >/dev/null 2>&1; then
        setsid env HOME="$QBITTORRENT_HOME" QT_QPA_PLATFORM=offscreen \
            "$QBITTORRENT_BIN" \
            --profile="$QBITTORRENT_HOME" \
            --webui-port="$QBITTORRENT_PORT" \
            --confirm-legal-notice \
            > "$QBITTORRENT_LOG_PATH" 2>&1 < /dev/null &
    else
        nohup env HOME="$QBITTORRENT_HOME" QT_QPA_PLATFORM=offscreen \
            "$QBITTORRENT_BIN" \
            --profile="$QBITTORRENT_HOME" \
            --webui-port="$QBITTORRENT_PORT" \
            --confirm-legal-notice \
            > "$QBITTORRENT_LOG_PATH" 2>&1 &
    fi
    printf '%s\n' "$!" > "$QBITTORRENT_PID_PATH"
}

stop_service() {
    local pid=""

    if [ ! -f "$QBITTORRENT_PID_PATH" ]; then
        return 0
    fi

    pid="$(cat "$QBITTORRENT_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi

    rm -f "$QBITTORRENT_PID_PATH"
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
