#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    printf '[%s] ERROR start.sh must be run from the Termux app user, not a root shell. Use su only for mount steps.\n' "$(date '+%Y-%m-%d %H:%M:%S')" >&2
    exit 1
fi

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"
BACKEND_PORT=""

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

if [ -f "$SERVER_ENV_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            PORT=*)
                BACKEND_PORT="${line#PORT=}"
                BACKEND_PORT="${BACKEND_PORT#\"}"
                BACKEND_PORT="${BACKEND_PORT%\"}"
                BACKEND_PORT="${BACKEND_PORT#\'}"
                BACKEND_PORT="${BACKEND_PORT%\'}"
                break
                ;;
        esac
    done < "$SERVER_ENV_FILE"
fi

. "$PROJECT/scripts/drive-common.sh"

FILESYSTEM_ROOT="${FILESYSTEM_ROOT:-${FILEBROWSER_ROOT:-$DRIVES_DIR}}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
NGINX_PID_PATH="${NGINX_PID_PATH:-$RUNTIME_DIR/nginx.pid}"
SERVER_NODE_OPTIONS="${SERVER_NODE_OPTIONS:---max-old-space-size=192}"
DASHBOARD_NODE_OPTIONS="${DASHBOARD_NODE_OPTIONS:---max-old-space-size=384}"
BACKEND_BIND_HOST="${BACKEND_BIND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
TTYD_BIND_HOST="${TTYD_BIND_HOST:-127.0.0.1}"
SSHD_BIND_HOST="${SSHD_BIND_HOST:-127.0.0.1}"
SSHD_PORT="${SSHD_PORT:-8022}"
ENABLE_SSHD="${ENABLE_SSHD:-false}"
DRIVE_AGENT_CMD="${DRIVE_AGENT_CMD:-/data/data/com.termux/files/usr/bin/termux-drive-agent}"
TERMUX_CLOUD_MOUNT_CMD="${TERMUX_CLOUD_MOUNT_CMD:-/data/data/com.termux/files/usr/bin/termux-cloud-mount}"
LOOPBACK_LOCKDOWN_CMD="${LOOPBACK_LOCKDOWN_CMD:-$PROJECT/scripts/loopback-lockdown.sh}"

BACKEND_PID_PATH="${BACKEND_PID_PATH:-$RUNTIME_DIR/backend.pid}"
FRONTEND_PID_PATH="${FRONTEND_PID_PATH:-$RUNTIME_DIR/frontend.pid}"
TTYD_PID_PATH="${TTYD_PID_PATH:-$RUNTIME_DIR/ttyd.pid}"
SSHD_PID_PATH="${SSHD_PID_PATH:-$RUNTIME_DIR/sshd.pid}"
COPYPARTY_PID_PATH="${COPYPARTY_PID_PATH:-$RUNTIME_DIR/copyparty.pid}"
SYNCTHING_PID_PATH="${SYNCTHING_PID_PATH:-$RUNTIME_DIR/syncthing.pid}"
SAMBA_PID_PATH="${SAMBA_PID_PATH:-$RUNTIME_DIR/samba.pid}"
JELLYFIN_PID_PATH="${JELLYFIN_PID_PATH:-$RUNTIME_DIR/jellyfin.pid}"
QBITTORRENT_PID_PATH="${QBITTORRENT_PID_PATH:-$RUNTIME_DIR/qbittorrent.pid}"
REDIS_PID_PATH="${REDIS_PID_PATH:-$RUNTIME_DIR/redis.pid}"
POSTGRES_PID_PATH="${POSTGRES_PID_PATH:-$RUNTIME_DIR/postgres.pid}"
SONARR_PID_PATH="${SONARR_PID_PATH:-$RUNTIME_DIR/sonarr.pid}"
RADARR_PID_PATH="${RADARR_PID_PATH:-$RUNTIME_DIR/radarr.pid}"
PROWLARR_PID_PATH="${PROWLARR_PID_PATH:-$RUNTIME_DIR/prowlarr.pid}"
BAZARR_PID_PATH="${BAZARR_PID_PATH:-$RUNTIME_DIR/bazarr.pid}"
JELLYSEERR_PID_PATH="${JELLYSEERR_PID_PATH:-$RUNTIME_DIR/jellyseerr.pid}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
MEDIA_SHARE_NAME="${MEDIA_SHARE_NAME:-Media}"
MEDIA_ROOT="${MEDIA_ROOT:-$FILESYSTEM_ROOT/$MEDIA_SHARE_NAME}"
MEDIA_MOVIES_DIR="${MEDIA_MOVIES_DIR:-$MEDIA_ROOT/movies}"
MEDIA_SERIES_DIR="${MEDIA_SERIES_DIR:-$MEDIA_ROOT/series}"
MEDIA_DOWNLOADS_DIR="${MEDIA_DOWNLOADS_DIR:-$MEDIA_ROOT/downloads}"
MEDIA_DOWNLOADS_MOVIES_DIR="${MEDIA_DOWNLOADS_MOVIES_DIR:-$MEDIA_DOWNLOADS_DIR/movies}"
MEDIA_DOWNLOADS_SERIES_DIR="${MEDIA_DOWNLOADS_SERIES_DIR:-$MEDIA_DOWNLOADS_DIR/series}"
MEDIA_DOWNLOADS_MANUAL_DIR="${MEDIA_DOWNLOADS_MANUAL_DIR:-$MEDIA_DOWNLOADS_DIR/manual}"
MEDIA_IPTV_CACHE_DIR="${MEDIA_IPTV_CACHE_DIR:-$MEDIA_ROOT/iptv-cache}"
MEDIA_IPTV_EPG_DIR="${MEDIA_IPTV_EPG_DIR:-$MEDIA_ROOT/iptv-epg}"

mkdir -p "$LOG_DIR" "$RUNTIME_DIR" "$MOUNT_RUNTIME_DIR"
START_LOG="$LOG_DIR/start.log"
exec > >(tee -a "$START_LOG") 2>&1

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

log_info() {
    printf '[%s] INFO  %s\n' "$(timestamp)" "$1"
}

log_warn() {
    printf '[%s] WARN  %s\n' "$(timestamp)" "$1"
}

log_error() {
    printf '[%s] ERROR %s\n' "$(timestamp)" "$1"
}

ensure_node_dependencies() {
    local app_dir="$1"
    local label="$2"

    [ -f "$app_dir/package.json" ] || return 0

    if [ ! -d "$app_dir/node_modules" ]; then
        log_info "Installing $label dependencies"
        (cd "$app_dir" && npm install --no-fund --no-audit)
        return 0
    fi

    if [ -f "$app_dir/package-lock.json" ] && [ "$app_dir/package-lock.json" -nt "$app_dir/node_modules" ]; then
        log_info "Refreshing $label dependencies"
        (cd "$app_dir" && npm install --no-fund --no-audit)
        return 0
    fi

    if [ "$app_dir/package.json" -nt "$app_dir/node_modules" ]; then
        log_info "Refreshing $label dependencies"
        (cd "$app_dir" && npm install --no-fund --no-audit)
    fi
}

warn_conflicting_boot_scripts() {
    local boot_dir="$USER_HOME/.termux/boot"

    if [ -e "$boot_dir/start-services.sh" ] || [ -e "$boot_dir/start-sshd.sh" ]; then
        log_warn "Legacy Termux:Boot scripts detected in $boot_dir; run scripts/install-termux-boot.sh to disable conflicting boot entries"
    fi
}

port_is_open() {
    local port="$1"

    if command -v nc >/dev/null 2>&1; then
        nc -z 127.0.0.1 "$port" >/dev/null 2>&1
        return $?
    fi

    ss -tuln 2>/dev/null | grep -q ":$port\\b"
}

wait_for_port() {
    local port="$1"
    local name="$2"
    local pid_file="${3:-}"
    local host="${4:-127.0.0.1}"
    local attempts=0
    local pid=""

    log_info "Waiting for $name on $host:$port"
    while true; do
        if command -v nc >/dev/null 2>&1; then
            nc -z "$host" "$port" >/dev/null 2>&1 && {
                log_info "$name is up on $host:$port"
                return 0
            }
        elif [ "$host" = "127.0.0.1" ] && port_is_open "$port"; then
            log_info "$name is up on $host:$port"
            return 0
        fi

        if [ -n "$pid_file" ] && [ -f "$pid_file" ]; then
            pid="$(cat "$pid_file" 2>/dev/null || true)"
            if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
                log_error "$name exited before opening $host:$port"
                return 1
            fi
        fi

        attempts=$((attempts + 1))
        if [ $((attempts % 5)) -eq 0 ]; then
            log_info "Still waiting for $name on $host:$port"
        fi
        sleep 1
    done
}

stop_pidfile_process() {
    local name="$1"
    local pid_file="$2"
    local pid=""
    local waited=0

    if [ ! -f "$pid_file" ]; then
        return 0
    fi

    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        log_info "Stopping $name (pid $pid)"
        kill "$pid" 2>/dev/null || true

        while kill -0 "$pid" 2>/dev/null; do
            sleep 1
            waited=$((waited + 1))
            if [ "$waited" -eq 5 ]; then
                log_warn "$name did not exit after SIGTERM; forcing stop"
                kill -9 "$pid" 2>/dev/null || true
            fi
            if [ "$waited" -ge 6 ]; then
                break
            fi
        done
    fi

    rm -f "$pid_file"
}

stop_matching_process() {
    local name="$1"
    local pattern="$2"

    if pgrep -f "$pattern" >/dev/null 2>&1; then
        log_info "Stopping legacy $name process"
        pkill -f "$pattern" >/dev/null 2>&1 || true
    fi
}

stop_repo_nginx() {
    local quit_cmd="nginx -p \"$PROJECT\" -c \"$PROJECT/nginx.conf\" -s quit"

    if [ -f "$NGINX_PID_PATH" ] || [ -f "$PROJECT/nginx.pid" ]; then
        $quit_cmd >/dev/null 2>&1 || true
        if command -v su >/dev/null 2>&1; then
            su -c "$quit_cmd" >/dev/null 2>&1 || true
        fi
    fi

    pkill -f "nginx -p $PROJECT -c $PROJECT/nginx.conf" >/dev/null 2>&1 || true
    rm -f "$NGINX_PID_PATH" "$PROJECT/nginx.pid"
}

report_mount_status() {
    local letter="$1"
    local mount_point="$2"
    local fs_type="$3"
    local status="$4"

    case "$status" in
        mounted)
            log_info "Drive $letter ready at $mount_point"
            ;;
        waiting)
            log_info "No $fs_type drive detected yet for $letter"
            ;;
        missing-ntfs-3g)
            log_warn "ntfs-3g not found; cannot mount $letter"
            ;;
        missing-bindfs)
            log_warn "bindfs not found; cannot expose exFAT drive $letter cleanly"
            ;;
        failed:*)
            log_warn "Failed to mount $fs_type drive for $letter (${status#failed:})"
            ;;
    esac
}

stop_drive_watcher() {
    local watcher="$PROJECT/scripts/drive-watcher.sh"

    if pgrep -f "$watcher" >/dev/null 2>&1; then
        log_info "Stopping legacy drive watcher"
        pkill -f "$watcher" >/dev/null 2>&1 || true
    fi
}

run_drive_agent_scan() {
    if [ ! -x "$DRIVE_AGENT_CMD" ]; then
        log_info "termux-drive-agent not installed; only C will be present until the agent is added"
        return 0
    fi

    if "$DRIVE_AGENT_CMD" scan >/dev/null 2>&1; then
        log_info "termux-drive-agent synced removable drive state"
    else
        log_warn "termux-drive-agent scan failed; check ~/.termux/logs/termux-drive-agent.log"
    fi
}

sync_cloud_mount_links() {
    if [ ! -x "$TERMUX_CLOUD_MOUNT_CMD" ]; then
        log_info "termux-cloud-mount not installed; FTP mounts stay in browse-only mode until the helper is added"
        return 0
    fi

    if "$TERMUX_CLOUD_MOUNT_CMD" sync-links >/dev/null 2>&1; then
        log_info "termux-cloud-mount synced FTP drive links"
    else
        log_warn "termux-cloud-mount sync-links failed; check root mount helper state"
    fi
}

apply_loopback_lockdown() {
    local exempt_ports=""
    local current_ssh_port=""

    if [ ! -x "$LOOPBACK_LOCKDOWN_CMD" ]; then
        log_warn "loopback-lockdown helper not installed; internal services may remain reachable outside nginx"
        return 0
    fi

    if [ "$ENABLE_SSHD" = "true" ] && [ -n "$SSHD_PORT" ]; then
        exempt_ports="$SSHD_PORT"
    fi

    if [ -n "${SSH_CONNECTION:-}" ]; then
        current_ssh_port="$(printf '%s\n' "$SSH_CONNECTION" | awk '{ print $4 }')"
        if [ -n "$current_ssh_port" ] && [ "$current_ssh_port" != "$exempt_ports" ]; then
            exempt_ports="${exempt_ports:+$exempt_ports,}$current_ssh_port"
        fi
    fi

    if LOOPBACK_LOCKDOWN_EXEMPT_TCP_PORTS="$exempt_ports" "$LOOPBACK_LOCKDOWN_CMD" apply >/dev/null 2>&1; then
        log_info "Applied loopback-only firewall rules for internal service ports"
    else
        log_warn "Failed to apply loopback-only firewall rules"
    fi
}

ensure_media_layout() {
    mkdir -p \
        "$MEDIA_ROOT" \
        "$MEDIA_MOVIES_DIR" \
        "$MEDIA_SERIES_DIR" \
        "$MEDIA_DOWNLOADS_DIR" \
        "$MEDIA_DOWNLOADS_MOVIES_DIR" \
        "$MEDIA_DOWNLOADS_SERIES_DIR" \
        "$MEDIA_DOWNLOADS_MANUAL_DIR" \
        "$MEDIA_IPTV_CACHE_DIR" \
        "$MEDIA_IPTV_EPG_DIR"
    log_info "Media share ready at $MEDIA_ROOT"
}

stop_repo_sshd() {
    stop_pidfile_process "sshd" "$SSHD_PID_PATH"

    if [ -n "${SSH_CONNECTION:-}" ]; then
        return 0
    fi

    if pgrep sshd >/dev/null 2>&1; then
        log_info "Stopping public sshd instances to keep nginx as the only exposed entrypoint"
        pkill sshd >/dev/null 2>&1 || true
    fi
}

start_background_command() {
    local name="$1"
    local port="$2"
    local pid_file="$3"
    local command_string="$4"
    local host="${5:-127.0.0.1}"
    local pid=""

    log_info "Starting $name"
    bash -lc "$command_string" &
    pid=$!
    printf '%s\n' "$pid" > "$pid_file"
    wait_for_port "$port" "$name" "$pid_file" "$host"
}

detect_host_ip() {
    local host_ip="${HOST_IP:-}"

    if [ -n "$host_ip" ]; then
        printf '%s\n' "$host_ip"
        return 0
    fi

    if command -v ifconfig >/dev/null 2>&1; then
        host_ip="$(ifconfig wlan0 2>/dev/null | awk '/inet / { print $2; exit }')"
        if [ -z "$host_ip" ]; then
            host_ip="$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" { print $2; exit }')"
        fi
    fi

    if [ -n "$host_ip" ]; then
        printf '%s\n' "$host_ip"
    else
        printf '127.0.0.1\n'
    fi
}

build_allowed_dev_origins() {
    local host_ip
    host_ip="$(detect_host_ip)"
    printf '127.0.0.1,localhost,%s,%s:8088\n' "$host_ip" "$host_ip"
}

HOST_IP="$(detect_host_ip)"
ALLOWED_DEV_ORIGINS="${ALLOWED_DEV_ORIGINS:-$(build_allowed_dev_origins)}"

log_info "Starting Home Server"
warn_conflicting_boot_scripts

stop_drive_watcher
prepare_drives_root
ensure_media_layout
run_drive_agent_scan
sync_cloud_mount_links
apply_loopback_lockdown

if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
fi

log_info "Cleaning old processes"
stop_pidfile_process "backend" "$BACKEND_PID_PATH"
stop_pidfile_process "frontend" "$FRONTEND_PID_PATH"
stop_pidfile_process "ttyd" "$TTYD_PID_PATH"
stop_pidfile_process "sshd" "$SSHD_PID_PATH"
stop_pidfile_process "copyparty" "$COPYPARTY_PID_PATH"
stop_pidfile_process "syncthing" "$SYNCTHING_PID_PATH"
stop_pidfile_process "samba" "$SAMBA_PID_PATH"
stop_pidfile_process "redis" "$REDIS_PID_PATH"
stop_pidfile_process "postgres" "$POSTGRES_PID_PATH"
stop_pidfile_process "jellyfin" "$JELLYFIN_PID_PATH"
stop_pidfile_process "qbittorrent" "$QBITTORRENT_PID_PATH"
stop_pidfile_process "sonarr" "$SONARR_PID_PATH"
stop_pidfile_process "radarr" "$RADARR_PID_PATH"
stop_pidfile_process "prowlarr" "$PROWLARR_PID_PATH"
stop_pidfile_process "bazarr" "$BAZARR_PID_PATH"
stop_pidfile_process "jellyseerr" "$JELLYSEERR_PID_PATH"
stop_repo_nginx

stop_matching_process "backend" "$PROJECT/server/index.js"
stop_matching_process "backend" "node $PROJECT/server/index.js"
stop_matching_process "frontend" "next start -H 0.0.0.0"
stop_matching_process "frontend" "next start -H 127.0.0.1"
stop_matching_process "frontend" "next dev --webpack --hostname 0.0.0.0"
stop_matching_process "frontend" "next dev --webpack --hostname 127.0.0.1"
stop_matching_process "frontend" "next-server"
stop_matching_process "ttyd" "ttyd -W -i $TTYD_BIND_HOST -p 7681 -w $PROJECT"
stop_matching_process "copyparty" "copyparty -i"
stop_matching_process "syncthing" "syncthing serve --no-browser"
stop_matching_process "samba" "smbd -i -s"
stop_matching_process "redis" "redis-server "
stop_matching_process "postgres" "postgres -D"
stop_matching_process "jellyfin" "jellyfin-server"
stop_matching_process "qbittorrent" "qbittorrent-nox"
stop_matching_process "sonarr" "Sonarr -nobrowser"
stop_matching_process "radarr" "Radarr -nobrowser"
stop_matching_process "prowlarr" "Prowlarr -nobrowser"
stop_matching_process "bazarr" "bazarr.py"
stop_matching_process "jellyseerr" "server/index.js"

ensure_node_dependencies "$PROJECT/server" "backend"
ensure_node_dependencies "$PROJECT/dashboard" "dashboard"

log_info "Checking SSH"
if [ "$ENABLE_SSHD" = "true" ] && command -v sshd >/dev/null 2>&1; then
    stop_repo_sshd
    start_background_command \
        "sshd" \
        "$SSHD_PORT" \
        "$SSHD_PID_PATH" \
        "mkdir -p '$LOG_DIR'; exec sshd -D -E '$LOG_DIR/sshd.log' -o ListenAddress='$SSHD_BIND_HOST' -o Port='$SSHD_PORT' > '$LOG_DIR/sshd-stdout.log' 2>&1" \
        "$SSHD_BIND_HOST"
else
    stop_repo_sshd
    log_info "sshd disabled in single-port mode"
fi

start_background_command \
    "Backend" \
    "$BACKEND_PORT" \
    "$BACKEND_PID_PATH" \
    "mkdir -p '$LOG_DIR'; cd '$PROJECT/server' && export NODE_OPTIONS='$SERVER_NODE_OPTIONS' BACKEND_BIND_HOST='$BACKEND_BIND_HOST' PORT='$BACKEND_PORT'; exec node '$PROJECT/server/index.js' > '$LOG_DIR/backend.log' 2>&1" \
    "$BACKEND_BIND_HOST"

log_info "Starting nginx"
if command -v nginx >/dev/null 2>&1; then
    mkdir -p "$LOG_DIR" "$RUNTIME_DIR"
    nginx -p "$PROJECT" -c "$PROJECT/nginx.conf"
    wait_for_port 8088 "nginx"
else
    log_warn "Skipping nginx (command not found)"
fi

if command -v ttyd >/dev/null 2>&1; then
    start_background_command \
        "ttyd" \
        7681 \
        "$TTYD_PID_PATH" \
        "mkdir -p '$LOG_DIR'; exec ttyd -W -i '$TTYD_BIND_HOST' -p 7681 -w '$PROJECT' bash -l > '$LOG_DIR/ttyd.log' 2>&1" \
        "$TTYD_BIND_HOST"
else
    log_warn "Skipping ttyd (command not found)"
fi

if [ -f "$PROJECT/dashboard/.next/BUILD_ID" ]; then
    start_background_command \
        "Frontend" \
        "$FRONTEND_PORT" \
        "$FRONTEND_PID_PATH" \
        "mkdir -p '$LOG_DIR'; cd '$PROJECT/dashboard' && export NODE_OPTIONS='$DASHBOARD_NODE_OPTIONS' PORT='$FRONTEND_PORT' ALLOWED_DEV_ORIGINS='$ALLOWED_DEV_ORIGINS'; exec npm start > '$LOG_DIR/frontend.log' 2>&1" \
        "127.0.0.1"
else
    start_background_command \
        "Frontend" \
        "$FRONTEND_PORT" \
        "$FRONTEND_PID_PATH" \
        "mkdir -p '$LOG_DIR'; cd '$PROJECT/dashboard' && export NODE_OPTIONS='$DASHBOARD_NODE_OPTIONS' PORT='$FRONTEND_PORT' ALLOWED_DEV_ORIGINS='$ALLOWED_DEV_ORIGINS'; exec npm run dev > '$LOG_DIR/frontend.log' 2>&1" \
        "127.0.0.1"
fi

log_info "Home Server started"
printf '[%s] INFO  Dashboard: http://%s:8088\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Files:     http://%s:8088/files\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Terminal:  http://%s:8088/term\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Jellyfin:  http://%s:8088/jellyfin/\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  qBittorrent: http://%s:8088/qb/\n' "$(timestamp)" "$HOST_IP"
if [ -f "$HOME/services/jellyseerr/app/dist/index.js" ]; then
    printf '[%s] INFO  Requests:  http://%s:8088/requests/\n' "$(timestamp)" "$HOST_IP"
fi

wait
