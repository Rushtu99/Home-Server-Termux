#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
if [ -f "$PROJECT/scripts/drive-common.sh" ]; then
    . "$PROJECT/scripts/drive-common.sh"
fi
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
MEDIA_ROOT="${MEDIA_ROOT:-$USER_HOME/Drives/Media}"
MEDIA_SCRATCH_DRIVES="${MEDIA_SCRATCH_DRIVES:-E}"
DEFAULT_SCRATCH_DRIVE_DIR=""
if type resolve_drive_dir >/dev/null 2>&1; then
    DEFAULT_SCRATCH_DRIVE_DIR="$(resolve_drive_dir "${MEDIA_SCRATCH_DRIVES%%,*}" || true)"
fi
MEDIA_SCRATCH_ROOT="${MEDIA_SCRATCH_ROOT:-${DEFAULT_SCRATCH_DRIVE_DIR:+$DEFAULT_SCRATCH_DRIVE_DIR/SCRATCH/HmSTxScratch}}"
if [ -z "$MEDIA_SCRATCH_ROOT" ]; then
    MEDIA_SCRATCH_ROOT="$USER_HOME/Drives/E/SCRATCH/HmSTxScratch"
fi
MEDIA_DOWNLOADS_DIR="${MEDIA_DOWNLOADS_DIR:-$MEDIA_SCRATCH_ROOT/downloads}"
MEDIA_DOWNLOADS_MOVIES_DIR="${MEDIA_DOWNLOADS_MOVIES_DIR:-$MEDIA_DOWNLOADS_DIR/movies}"
MEDIA_DOWNLOADS_SERIES_DIR="${MEDIA_DOWNLOADS_SERIES_DIR:-$MEDIA_DOWNLOADS_DIR/series}"
MEDIA_DOWNLOADS_MANUAL_DIR="${MEDIA_DOWNLOADS_MANUAL_DIR:-$MEDIA_DOWNLOADS_DIR/manual}"
MEDIA_DOWNLOADS_TORRENT_DIR="${MEDIA_DOWNLOADS_TORRENT_DIR:-$MEDIA_DOWNLOADS_DIR/torrent}"
MEDIA_DOWNLOADS_TORRENT_QBIT_DIR="${MEDIA_DOWNLOADS_TORRENT_QBIT_DIR:-$MEDIA_DOWNLOADS_TORRENT_DIR/qbit}"
MEDIA_QBIT_TMP_DIR="${MEDIA_QBIT_TMP_DIR:-$MEDIA_SCRATCH_ROOT/tmp/qbittorrent}"
MEDIA_IMPORTER_CMD="${MEDIA_IMPORTER_CMD:-$PROJECT/scripts/media-importer.sh}"
QBITTORRENT_HOME="${QBITTORRENT_HOME:-$MEDIA_SERVICES_HOME/qbittorrent}"
QBITTORRENT_BIND_HOST="${QBITTORRENT_BIND_HOST:-127.0.0.1}"
QBITTORRENT_PORT="${QBITTORRENT_PORT:-8081}"
QBITTORRENT_PID_PATH="${QBITTORRENT_PID_PATH:-$RUNTIME_DIR/qbittorrent.pid}"
QBITTORRENT_LOG_PATH="${QBITTORRENT_LOG_PATH:-$LOG_DIR/qbittorrent.log}"
QBITTORRENT_BIN="${QBITTORRENT_BIN:-$(command -v qbittorrent-nox || true)}"
QBITTORRENT_CONFIG_PATH="${QBITTORRENT_CONFIG_PATH:-$QBITTORRENT_HOME/qBittorrent/config/qBittorrent.conf}"
QBITTORRENT_CONFIG_BACKUP_PATH="${QBITTORRENT_CONFIG_BACKUP_PATH:-$QBITTORRENT_HOME/qBittorrent/config/qBittorrent.conf.bak}"
QBITTORRENT_FINISHED_CMD="${QBITTORRENT_FINISHED_CMD:-$MEDIA_IMPORTER_CMD import --trigger qb-finish --source \"%F\"}"
SERVICE_NAME="qbittorrent"

mkdir -p \
    "$RUNTIME_DIR" \
    "$LOG_DIR" \
    "$MEDIA_DOWNLOADS_DIR" \
    "$MEDIA_DOWNLOADS_MOVIES_DIR" \
    "$MEDIA_DOWNLOADS_SERIES_DIR" \
    "$MEDIA_DOWNLOADS_MANUAL_DIR" \
    "$MEDIA_DOWNLOADS_TORRENT_DIR" \
    "$MEDIA_DOWNLOADS_TORRENT_QBIT_DIR" \
    "$MEDIA_QBIT_TMP_DIR" \
    "$(dirname "$QBITTORRENT_CONFIG_PATH")"

upsert_config_key() {
    local key="$1"
    local value="$2"
    local tmp_file
    local line=""
    local replaced=0
    tmp_file="$(mktemp)"

    if [ -f "$QBITTORRENT_CONFIG_PATH" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            if [ "${line#"$key="}" != "$line" ]; then
                if [ "$replaced" -eq 0 ]; then
                    printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
                    replaced=1
                fi
                continue
            fi
            printf '%s\n' "$line" >> "$tmp_file"
        done < "$QBITTORRENT_CONFIG_PATH"
    fi

    if [ "$replaced" -eq 0 ]; then
        printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
    fi

    mv "$tmp_file" "$QBITTORRENT_CONFIG_PATH"
}

remove_config_key() {
    local key="$1"
    local tmp_file
    local line=""
    tmp_file="$(mktemp)"

    if [ ! -f "$QBITTORRENT_CONFIG_PATH" ]; then
        return 0
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        if [ "${line#"$key="}" != "$line" ]; then
            continue
        fi
        printf '%s\n' "$line" >> "$tmp_file"
    done < "$QBITTORRENT_CONFIG_PATH"

    mv "$tmp_file" "$QBITTORRENT_CONFIG_PATH"
}

list_matching_pids() {
    pgrep -af "qbittorrent-nox" | awk '!/pgrep -af/ { print $1 }' || true
}

read_pid() {
    local pid=""

    if [ -f "$QBITTORRENT_PID_PATH" ]; then
        pid="$(tr -d '[:space:]' < "$QBITTORRENT_PID_PATH" 2>/dev/null || true)"
    fi
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        printf '%s\n' "$pid"
        return 0
    fi

    pid="$(list_matching_pids | head -n 1)"
    if [ -n "$pid" ]; then
        printf '%s\n' "$pid" > "$QBITTORRENT_PID_PATH"
        printf '%s\n' "$pid"
        return 0
    fi

    return 1
}

ensure_config() {
    if [ ! -f "$QBITTORRENT_CONFIG_PATH" ]; then
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
    else
        cp -f "$QBITTORRENT_CONFIG_PATH" "$QBITTORRENT_CONFIG_BACKUP_PATH" 2>/dev/null || true
    fi

    remove_config_key 'SessionDefaultSavePath'
    remove_config_key 'SessionTempPathEnabled'
    remove_config_key 'SessionTempPath'
    remove_config_key 'CategoriesmoviesSavePath'
    remove_config_key 'CategoriesseriesSavePath'
    remove_config_key 'CategoriesmanualSavePath'
    remove_config_key 'CategoriesstandaloneSavePath'
    remove_config_key 'SessionTorrentFinishedCmdEnabled'
    remove_config_key 'SessionTorrentFinishedCmd'

    # Keep user config intact while enforcing managed storage paths.
    upsert_config_key 'Session\DefaultSavePath' "$MEDIA_DOWNLOADS_MANUAL_DIR"
    upsert_config_key 'Session\TempPathEnabled' "true"
    upsert_config_key 'Session\TempPath' "$MEDIA_QBIT_TMP_DIR"
    upsert_config_key 'Session\DisableAutoTMMByDefault' "false"
    upsert_config_key 'Categories\movies\SavePath' "$MEDIA_DOWNLOADS_MOVIES_DIR"
    upsert_config_key 'Categories\series\SavePath' "$MEDIA_DOWNLOADS_SERIES_DIR"
    upsert_config_key 'Categories\manual\SavePath' "$MEDIA_DOWNLOADS_MANUAL_DIR"
    upsert_config_key 'Categories\standalone\SavePath' "$MEDIA_DOWNLOADS_TORRENT_QBIT_DIR"
    if [ -x "$MEDIA_IMPORTER_CMD" ]; then
        upsert_config_key 'Session\TorrentFinishedCmdEnabled' "true"
        upsert_config_key 'Session\TorrentFinishedCmd' "$QBITTORRENT_FINISHED_CMD"
    else
        upsert_config_key 'Session\TorrentFinishedCmdEnabled' "false"
    fi
}

is_running() {
    local pid=""
    pid="$(read_pid || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_service() {
    local command_str=""
    local pid=""

    [ -n "$QBITTORRENT_BIN" ] || {
        echo "qbittorrent-nox is not installed" >&2
        return 1
    }

    if is_running; then
        return 0
    fi

    ensure_config
    rm -f "$QBITTORRENT_PID_PATH"

    printf -v command_str '%q ' \
        env \
        HOME="$QBITTORRENT_HOME" \
        QT_QPA_PLATFORM=offscreen \
        "$QBITTORRENT_BIN" \
        "--profile=$QBITTORRENT_HOME" \
        "--webui-port=$QBITTORRENT_PORT" \
        --confirm-legal-notice

    /data/data/com.termux/files/usr/bin/bash -lc "${command_str} --daemon" >> "$QBITTORRENT_LOG_PATH" 2>&1
    sleep 3
    pid="$(read_pid || true)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$QBITTORRENT_PID_PATH"
        return 1
    fi
    printf '%s\n' "$pid" > "$QBITTORRENT_PID_PATH"
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

    rm -f "$QBITTORRENT_PID_PATH"
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
