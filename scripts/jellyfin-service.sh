#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"

load_shell_env_file() {
    local env_file="$1"
    local line="" key="" value=""

    [ -f "$env_file" ] || return 0

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ''|\#*) continue ;;
        esac

        key="${line%%=*}"
        value="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            continue
        fi

        case "$value" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
        esac

        export "$key=$value"
    done < "$env_file"
}

load_shell_env_file "$SERVER_ENV_FILE"

if [ -f "$PROJECT/scripts/drive-common.sh" ]; then
    . "$PROJECT/scripts/drive-common.sh"
fi
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
JELLYFIN_HOME="${JELLYFIN_HOME:-$MEDIA_SERVICES_HOME/jellyfin}"
MEDIA_SCRATCH_DRIVES="${MEDIA_SCRATCH_DRIVES:-E}"
DEFAULT_SCRATCH_DRIVE_DIR=""
if type resolve_drive_dir >/dev/null 2>&1; then
    DEFAULT_SCRATCH_DRIVE_DIR="$(resolve_drive_dir "${MEDIA_SCRATCH_DRIVES%%,*}" || true)"
fi
MEDIA_SCRATCH_ROOT="${MEDIA_SCRATCH_ROOT:-${DEFAULT_SCRATCH_DRIVE_DIR:+$DEFAULT_SCRATCH_DRIVE_DIR/SCRATCH/HmSTxScratch}}"
if [ -z "$MEDIA_SCRATCH_ROOT" ]; then
    MEDIA_SCRATCH_ROOT="$USER_HOME/Drives/E/SCRATCH/HmSTxScratch"
fi
MEDIA_TRANSCODE_DIR="${MEDIA_TRANSCODE_DIR:-$MEDIA_SCRATCH_ROOT/cache/jellyfin}"
MEDIA_MISC_CACHE_DIR="${MEDIA_MISC_CACHE_DIR:-$MEDIA_SCRATCH_ROOT/cache/misc}"
JELLYFIN_BIND_HOST="${JELLYFIN_BIND_HOST:-127.0.0.1}"
JELLYFIN_PORT="${JELLYFIN_PORT:-8096}"
JELLYFIN_PID_PATH="${JELLYFIN_PID_PATH:-$RUNTIME_DIR/jellyfin.pid}"
JELLYFIN_LOG_PATH="${JELLYFIN_LOG_PATH:-$LOG_DIR/jellyfin.log}"
JELLYFIN_BIN="${JELLYFIN_BIN:-$(command -v jellyfin-server || command -v jellyfin || true)}"
JELLYFIN_DOTNET_ROOT="${JELLYFIN_DOTNET_ROOT:-/data/data/com.termux/files/usr/lib/dotnet}"
JELLYFIN_WEB_DIR="${JELLYFIN_WEB_DIR:-/data/data/com.termux/files/usr/lib/jellyfin/jellyfin-web}"
JELLYFIN_FFMPEG_BIN="${JELLYFIN_FFMPEG_BIN:-/data/data/com.termux/files/usr/opt/jellyfin/bin/ffmpeg}"
JELLYFIN_CACHE_DIR="${JELLYFIN_CACHE_DIR:-${MEDIA_TRANSCODE_DIR:-$JELLYFIN_HOME/cache}}"
JELLYFIN_MISC_CACHE_DIR="${JELLYFIN_MISC_CACHE_DIR:-${MEDIA_MISC_CACHE_DIR:-$JELLYFIN_HOME/cache}}"
JELLYFIN_LIBRARY_SYNC_CMD="${JELLYFIN_LIBRARY_SYNC_CMD:-$PROJECT/scripts/jellyfin-library-sync.sh}"
JELLYFIN_TMUX_SESSION="${JELLYFIN_TMUX_SESSION:-hmstx-jellyfin}"
SERVICE_NAME="jellyfin"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$JELLYFIN_CACHE_DIR" "$JELLYFIN_MISC_CACHE_DIR" "$JELLYFIN_HOME/config" "$JELLYFIN_HOME/data"

list_matching_pids() {
    pgrep -af "jellyfin.dll|jellyfin --service" | awk '!/pgrep -af/ && !/jellyfin-service.sh/ { print $1 }' || true
}

tmux_session_exists() {
    command -v tmux >/dev/null 2>&1 && tmux has-session -t "$JELLYFIN_TMUX_SESSION" 2>/dev/null
}

read_pid() {
    local pid=""

    if [ -f "$JELLYFIN_PID_PATH" ]; then
        pid="$(tr -d '[:space:]' < "$JELLYFIN_PID_PATH" 2>/dev/null || true)"
    fi
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        printf '%s\n' "$pid"
        return 0
    fi

    pid="$(list_matching_pids | head -n 1)"
    if [ -n "$pid" ]; then
        printf '%s\n' "$pid" > "$JELLYFIN_PID_PATH"
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

start_service() {
    local command_str=""
    local pid=""
    local launch_script=""

    [ -n "$JELLYFIN_BIN" ] || {
        echo "jellyfin-server is not installed" >&2
        return 1
    }

    if is_running; then
        return 0
    fi

    if [ -x "$JELLYFIN_LIBRARY_SYNC_CMD" ]; then
        "$JELLYFIN_LIBRARY_SYNC_CMD" sync >> "$JELLYFIN_LOG_PATH" 2>&1 || true
    fi

    rm -f "$JELLYFIN_PID_PATH"
    launch_script="$RUNTIME_DIR/jellyfin-launch.sh"

    printf -v command_str '%q ' \
        env \
        HOME="$JELLYFIN_HOME" \
        XDG_CACHE_HOME="$JELLYFIN_MISC_CACHE_DIR" \
        XDG_CONFIG_HOME="$JELLYFIN_HOME/config" \
        JELLYFIN_DATA_DIR="$JELLYFIN_HOME/data" \
        JELLYFIN_CACHE_DIR="$JELLYFIN_CACHE_DIR" \
        DOTNET_ROOT="$JELLYFIN_DOTNET_ROOT" \
        ASPNETCORE_URLS="http://$JELLYFIN_BIND_HOST:$JELLYFIN_PORT" \
        "$JELLYFIN_BIN" \
        --service \
        --datadir "$JELLYFIN_HOME/data" \
        --cachedir "$JELLYFIN_CACHE_DIR" \
        --configdir "$JELLYFIN_HOME/config" \
        --logdir "$LOG_DIR" \
        --webdir "$JELLYFIN_WEB_DIR" \
        --ffmpeg "$JELLYFIN_FFMPEG_BIN"

    cat > "$launch_script" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
exec ${command_str} >> "$JELLYFIN_LOG_PATH" 2>&1
EOF
    chmod +x "$launch_script"

    if command -v tmux >/dev/null 2>&1; then
        tmux kill-session -t "$JELLYFIN_TMUX_SESSION" 2>/dev/null || true
        tmux new-session -d -s "$JELLYFIN_TMUX_SESSION" "$launch_script"
    else
        nohup "$launch_script" < /dev/null &
        printf '%s\n' "$!" > "$JELLYFIN_PID_PATH"
    fi
    sleep 2
    pid="$(read_pid || true)"
    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$JELLYFIN_PID_PATH"
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
        tmux kill-session -t "$JELLYFIN_TMUX_SESSION" 2>/dev/null || true
    fi

    rm -f "$JELLYFIN_PID_PATH"
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
