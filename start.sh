#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    printf '[%s] ERROR start.sh must be run from the Termux app user, not a root shell. Use su only for mount steps.\n' "$(date '+%Y-%m-%d %H:%M:%S')" >&2
    exit 1
fi

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
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

. "$PROJECT/scripts/drive-common.sh"

FILESYSTEM_ROOT="${FILESYSTEM_ROOT:-${FILEBROWSER_ROOT:-$DRIVES_DIR}}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
NGINX_PID_PATH="${NGINX_PID_PATH:-$RUNTIME_DIR/nginx.pid}"
FILEBROWSER_DB_PATH="${FILEBROWSER_DB_PATH:-$RUNTIME_DIR/filebrowser.db}"
SERVER_NODE_OPTIONS="${SERVER_NODE_OPTIONS:---max-old-space-size=192}"
DASHBOARD_NODE_OPTIONS="${DASHBOARD_NODE_OPTIONS:---max-old-space-size=384}"

BACKEND_PID_PATH="${BACKEND_PID_PATH:-$RUNTIME_DIR/backend.pid}"
FILEBROWSER_PID_PATH="${FILEBROWSER_PID_PATH:-$RUNTIME_DIR/filebrowser.pid}"
FRONTEND_PID_PATH="${FRONTEND_PID_PATH:-$RUNTIME_DIR/frontend.pid}"
TTYD_PID_PATH="${TTYD_PID_PATH:-$RUNTIME_DIR/ttyd.pid}"

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
    local attempts=0
    local pid=""

    log_info "Waiting for $name on port $port"
    while true; do
        if port_is_open "$port"; then
            log_info "$name is up on port $port"
            return 0
        fi

        if [ -n "$pid_file" ] && [ -f "$pid_file" ]; then
            pid="$(cat "$pid_file" 2>/dev/null || true)"
            if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
                log_error "$name exited before opening port $port"
                return 1
            fi
        fi

        attempts=$((attempts + 1))
        if [ $((attempts % 5)) -eq 0 ]; then
            log_info "Still waiting for $name on port $port"
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

start_background_command() {
    local name="$1"
    local port="$2"
    local pid_file="$3"
    local command_string="$4"
    local pid=""

    log_info "Starting $name"
    bash -lc "$command_string" &
    pid=$!
    printf '%s\n' "$pid" > "$pid_file"
    wait_for_port "$port" "$name" "$pid_file"
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

log_info "Starting Home Server"
warn_conflicting_boot_scripts

stop_drive_watcher
prepare_drives_root
report_mount_status "D" "$DRIVES_D_DIR" "ntfs" "$(mount_external_drive "D" "$DRIVES_D_DIR" "ntfs" "$D_SOURCE" "$D_UUID" "$D_LABEL")"
report_mount_status "E" "$DRIVES_E_DIR" "exfat" "$(mount_external_drive "E" "$DRIVES_E_DIR" "exfat" "$E_SOURCE" "$E_UUID" "$E_LABEL")"

if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
fi

log_info "Cleaning old processes"
stop_pidfile_process "backend" "$BACKEND_PID_PATH"
stop_pidfile_process "frontend" "$FRONTEND_PID_PATH"
stop_pidfile_process "filebrowser" "$FILEBROWSER_PID_PATH"
stop_pidfile_process "ttyd" "$TTYD_PID_PATH"
stop_repo_nginx

stop_matching_process "backend" "$PROJECT/server/index.js"
stop_matching_process "frontend" "next start -H 0.0.0.0"
stop_matching_process "frontend" "next dev --webpack --hostname 0.0.0.0"
stop_matching_process "frontend" "next-server"
stop_matching_process "filebrowser" "filebrowser -d $FILEBROWSER_DB_PATH"
stop_matching_process "ttyd" "ttyd -W -i 127.0.0.1 -p 7681 -w $PROJECT"

log_info "Checking SSH"
if command -v sshd >/dev/null 2>&1; then
    pgrep sshd >/dev/null 2>&1 || sshd
fi

start_background_command \
    "Backend" \
    4000 \
    "$BACKEND_PID_PATH" \
    "mkdir -p '$LOG_DIR'; cd '$PROJECT/server' && export NODE_OPTIONS='$SERVER_NODE_OPTIONS'; exec node '$PROJECT/server/index.js' > '$LOG_DIR/backend.log' 2>&1"

if command -v filebrowser >/dev/null 2>&1; then
    start_background_command \
        "FileBrowser" \
        8080 \
        "$FILEBROWSER_PID_PATH" \
        "mkdir -p '$RUNTIME_DIR' '$LOG_DIR' '$FILESYSTEM_ROOT'; filebrowser config set -d '$FILEBROWSER_DB_PATH' --auth.method=noauth >/dev/null 2>&1 || true; exec filebrowser -d '$FILEBROWSER_DB_PATH' -r '$FILESYSTEM_ROOT' -p 8080 -a 127.0.0.1 -b /files --noauth > '$LOG_DIR/filebrowser.log' 2>&1"
else
    log_warn "Skipping FileBrowser (command not found)"
fi

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
        "mkdir -p '$LOG_DIR'; exec ttyd -W -i 127.0.0.1 -p 7681 -w '$PROJECT' bash -l > '$LOG_DIR/ttyd.log' 2>&1"
else
    log_warn "Skipping ttyd (command not found)"
fi

if [ -f "$PROJECT/dashboard/.next/BUILD_ID" ]; then
    start_background_command \
        "Frontend" \
        3000 \
        "$FRONTEND_PID_PATH" \
        "mkdir -p '$LOG_DIR'; cd '$PROJECT/dashboard' && export NODE_OPTIONS='$DASHBOARD_NODE_OPTIONS'; exec npm start > '$LOG_DIR/frontend.log' 2>&1"
else
    start_background_command \
        "Frontend" \
        3000 \
        "$FRONTEND_PID_PATH" \
        "mkdir -p '$LOG_DIR'; cd '$PROJECT/dashboard' && export NODE_OPTIONS='$DASHBOARD_NODE_OPTIONS'; exec npm run dev > '$LOG_DIR/frontend.log' 2>&1"
fi

HOST_IP="$(detect_host_ip)"
log_info "Home Server started"
printf '[%s] INFO  Dashboard: http://%s:8088\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Files:     http://%s:8088/files\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Terminal:  http://%s:8088/term\n' "$(timestamp)" "$HOST_IP"

wait
