#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
START_ARGS=("$@")

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
SSHD_AUTH_MODE="${SSHD_AUTH_MODE:-password_and_key}"
SSHD_AUTHORIZED_KEY_PATH="${SSHD_AUTHORIZED_KEY_PATH:-$USER_HOME/.ssh/id_ed25519.pub}"
BOOT_OPTIONAL_SSH="${BOOT_OPTIONAL_SSH:-true}"
SSHD_RETRY_INITIAL_DELAY_SECONDS="${SSHD_RETRY_INITIAL_DELAY_SECONDS:-60}"
SSHD_RETRY_MAX_DELAY_SECONDS="${SSHD_RETRY_MAX_DELAY_SECONDS:-300}"
SSHD_RETRY_MAX_ATTEMPTS="${SSHD_RETRY_MAX_ATTEMPTS:-20}"
TERMUX_PREFIX="${TERMUX_PREFIX:-${PREFIX:-/data/data/com.termux/files/usr}}"
SVDIR_PATH="${SVDIR_PATH:-${SVDIR:-$TERMUX_PREFIX/var/service}}"
LOGDIR_PATH="${LOGDIR_PATH:-${LOGDIR:-$TERMUX_PREFIX/var/log}}"
SERVICE_DAEMON_BIN="${SERVICE_DAEMON_BIN:-$TERMUX_PREFIX/bin/service-daemon}"
SV_BIN="${SV_BIN:-$TERMUX_PREFIX/bin/sv}"
SSHD_MANAGED_CONFIG_PATH="${SSHD_MANAGED_CONFIG_PATH:-$TERMUX_PREFIX/etc/ssh/sshd_config.d/50-home-server-managed.conf}"
SSHD_SERVICE_LOG_PATH="${SSHD_SERVICE_LOG_PATH:-$LOGDIR_PATH/sv/sshd/current}"
START_LOCK_WAIT_SECONDS="${START_LOCK_WAIT_SECONDS:-30}"
START_MEDIA_STAGE_DELAY_SECONDS="${START_MEDIA_STAGE_DELAY_SECONDS:-15}"
START_WAIT_TIMEOUT_SECONDS="${START_WAIT_TIMEOUT_SECONDS:-180}"
START_WAIT_ARR_TIMEOUT_SECONDS="${START_WAIT_ARR_TIMEOUT_SECONDS:-240}"
START_WAIT_POSTGRES_TIMEOUT_SECONDS="${START_WAIT_POSTGRES_TIMEOUT_SECONDS:-120}"
START_WAIT_PID_EXIT_GRACE_SECONDS="${START_WAIT_PID_EXIT_GRACE_SECONDS:-45}"
SERVICE_FAIL_MODE="${SERVICE_FAIL_MODE:-fail_quiet}"
SERVICE_RETRY_MAX_PER_HOUR="${SERVICE_RETRY_MAX_PER_HOUR:-4}"
SERVICE_BACKOFF_STEPS="${SERVICE_BACKOFF_STEPS:-60,300,900,3600}"
SERVICE_DEGRADED_COOLDOWN_SECONDS="${SERVICE_DEGRADED_COOLDOWN_SECONDS:-3600}"
TAILSCALE_MODE="${TAILSCALE_MODE:-disabled}"
TERMUX_CLOUD_MOUNT_CMD="${TERMUX_CLOUD_MOUNT_CMD:-/data/data/com.termux/files/usr/bin/termux-cloud-mount}"
LOOPBACK_LOCKDOWN_CMD="${LOOPBACK_LOCKDOWN_CMD:-$PROJECT/scripts/loopback-lockdown.sh}"
TAILSCALE_SERVICE_CMD="${TAILSCALE_SERVICE_CMD:-$PROJECT/scripts/tailscale-service.sh}"
LLM_SERVICE_CMD="${LLM_SERVICE_CMD:-$PROJECT/scripts/llm-service.sh}"
MEDIA_IMPORTER_CMD="${MEDIA_IMPORTER_CMD:-$PROJECT/scripts/media-importer.sh}"
MEDIA_WORKFLOW_SERVICE_CMD="${MEDIA_WORKFLOW_SERVICE_CMD:-$PROJECT/scripts/media-workflow-service.sh}"
STORAGE_WATCHDOG_SERVICE_CMD="${STORAGE_WATCHDOG_SERVICE_CMD:-$PROJECT/scripts/storage-watchdog-service.sh}"
USB_MOUNT_SERVICE_CMD="${USB_MOUNT_SERVICE_CMD:-$PROJECT/scripts/usb-mount-service.sh}"
REDIS_SERVICE_CMD="${REDIS_SERVICE_CMD:-$PROJECT/scripts/redis-service.sh}"
POSTGRES_SERVICE_CMD="${POSTGRES_SERVICE_CMD:-$PROJECT/scripts/postgres-service.sh}"
JELLYFIN_SERVICE_CMD="${JELLYFIN_SERVICE_CMD:-$PROJECT/scripts/jellyfin-service.sh}"
QBITTORRENT_SERVICE_CMD="${QBITTORRENT_SERVICE_CMD:-$PROJECT/scripts/qbittorrent-service.sh}"
SONARR_SERVICE_CMD="${SONARR_SERVICE_CMD:-$PROJECT/scripts/sonarr-service.sh}"
RADARR_SERVICE_CMD="${RADARR_SERVICE_CMD:-$PROJECT/scripts/radarr-service.sh}"
PROWLARR_SERVICE_CMD="${PROWLARR_SERVICE_CMD:-$PROJECT/scripts/prowlarr-service.sh}"
BAZARR_SERVICE_CMD="${BAZARR_SERVICE_CMD:-$PROJECT/scripts/bazarr-service.sh}"
FLAREARR_SERVICE_CMD="${FLAREARR_SERVICE_CMD:-$PROJECT/scripts/flarearr-service.sh}"
JELLYSEERR_SERVICE_CMD="${JELLYSEERR_SERVICE_CMD:-$PROJECT/scripts/jellyseerr-service.sh}"
CONFIGURE_ARR_STACK_CMD="${CONFIGURE_ARR_STACK_CMD:-$PROJECT/scripts/configure-arr-stack.sh}"
LLM_BIND_HOST="${LLM_BIND_HOST:-127.0.0.1}"
LLM_PORT="${LLM_PORT:-11435}"
LLM_AUTO_START="${LLM_AUTO_START:-true}"

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
FLAREARR_PID_PATH="${FLAREARR_PID_PATH:-$RUNTIME_DIR/flarearr.pid}"
JELLYSEERR_PID_PATH="${JELLYSEERR_PID_PATH:-$RUNTIME_DIR/jellyseerr.pid}"
LLM_PID_PATH="${LLM_PID_PATH:-$RUNTIME_DIR/llm.pid}"
MEDIA_WORKFLOW_PID_PATH="${MEDIA_WORKFLOW_PID_PATH:-$RUNTIME_DIR/media-workflow.pid}"
STORAGE_WATCHDOG_PID_PATH="${STORAGE_WATCHDOG_PID_PATH:-$RUNTIME_DIR/storage-watchdog.pid}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_BIND_HOST="${FRONTEND_BIND_HOST:-}"
if [ -z "$FRONTEND_BIND_HOST" ]; then
    if [ -n "${SSH_CONNECTION:-}" ]; then
        FRONTEND_BIND_HOST="0.0.0.0"
    else
        FRONTEND_BIND_HOST="127.0.0.1"
    fi
fi
MEDIA_SHARE_NAME="${MEDIA_SHARE_NAME:-Media}"
MEDIA_ROOT="${MEDIA_ROOT:-$FILESYSTEM_ROOT/$MEDIA_SHARE_NAME}"
HMSTX_DRIVE_ROLE_FILE_NAME="${HMSTX_DRIVE_ROLE_FILE_NAME:-.hmstx-role.conf}"
MEDIA_VAULT_DRIVES="${MEDIA_VAULT_DRIVES:-D}"
MEDIA_SCRATCH_DRIVES="${MEDIA_SCRATCH_DRIVES:-E}"
MEDIA_VAULT_DIR_NAME="${MEDIA_VAULT_DIR_NAME:-VAULT}"
MEDIA_SCRATCH_DIR_NAME="${MEDIA_SCRATCH_DIR_NAME:-SCRATCH}"
MEDIA_VAULT_MEDIA_SUBDIR="${MEDIA_VAULT_MEDIA_SUBDIR:-Media}"
MEDIA_SCRATCH_MEDIA_SUBDIR="${MEDIA_SCRATCH_MEDIA_SUBDIR:-HmSTxScratch}"
MEDIA_LAYOUT_STRICT="${MEDIA_LAYOUT_STRICT:-false}"
MEDIA_LAYOUT_AUTO_ADOPT_EMPTY="${MEDIA_LAYOUT_AUTO_ADOPT_EMPTY:-true}"
MEDIA_VAULT_ROOTS="${MEDIA_VAULT_ROOTS:-}"
MEDIA_SCRATCH_ROOTS="${MEDIA_SCRATCH_ROOTS:-}"
MEDIA_VAULT_ROOT="${MEDIA_VAULT_ROOT:-}"
MEDIA_SCRATCH_ROOT="${MEDIA_SCRATCH_ROOT:-}"
MEDIA_MOVIES_DIR="${MEDIA_MOVIES_DIR:-}"
MEDIA_SERIES_DIR="${MEDIA_SERIES_DIR:-}"
MEDIA_MUSIC_DIR="${MEDIA_MUSIC_DIR:-}"
MEDIA_AUDIOBOOKS_DIR="${MEDIA_AUDIOBOOKS_DIR:-}"
MEDIA_SCRATCH_LIBRARY_ROOT="${MEDIA_SCRATCH_LIBRARY_ROOT:-}"
MEDIA_SCRATCH_MOVIES_DIR="${MEDIA_SCRATCH_MOVIES_DIR:-}"
MEDIA_SCRATCH_SERIES_DIR="${MEDIA_SCRATCH_SERIES_DIR:-}"
MEDIA_SCRATCH_MUSIC_DIR="${MEDIA_SCRATCH_MUSIC_DIR:-}"
MEDIA_SCRATCH_AUDIOBOOKS_DIR="${MEDIA_SCRATCH_AUDIOBOOKS_DIR:-}"
MEDIA_DOWNLOADS_DIR="${MEDIA_DOWNLOADS_DIR:-}"
MEDIA_DOWNLOADS_MOVIES_DIR="${MEDIA_DOWNLOADS_MOVIES_DIR:-}"
MEDIA_DOWNLOADS_SERIES_DIR="${MEDIA_DOWNLOADS_SERIES_DIR:-}"
MEDIA_DOWNLOADS_MANUAL_DIR="${MEDIA_DOWNLOADS_MANUAL_DIR:-}"
MEDIA_SMALL_DOWNLOADS_DIR="${MEDIA_SMALL_DOWNLOADS_DIR:-}"
MEDIA_SMALL_DOWNLOADS_MAX_MB="${MEDIA_SMALL_DOWNLOADS_MAX_MB:-256}"
MEDIA_IMPORT_REVIEW_DIR="${MEDIA_IMPORT_REVIEW_DIR:-}"
MEDIA_IMPORT_LOG_DIR="${MEDIA_IMPORT_LOG_DIR:-}"
MEDIA_TRANSCODE_DIR="${MEDIA_TRANSCODE_DIR:-}"
MEDIA_MISC_CACHE_DIR="${MEDIA_MISC_CACHE_DIR:-}"
MEDIA_IPTV_CACHE_DIR="${MEDIA_IPTV_CACHE_DIR:-}"
MEDIA_IPTV_EPG_DIR="${MEDIA_IPTV_EPG_DIR:-}"
MEDIA_QBIT_TMP_DIR="${MEDIA_QBIT_TMP_DIR:-}"
MEDIA_IMPORT_ABORT_FREE_GB="${MEDIA_IMPORT_ABORT_FREE_GB:-200}"
MEDIA_VAULT_WARN_FREE_GB="${MEDIA_VAULT_WARN_FREE_GB:-250}"
MEDIA_SCRATCH_WARN_FREE_GB="${MEDIA_SCRATCH_WARN_FREE_GB:-150}"
MEDIA_SCRATCH_WARN_USED_PERCENT="${MEDIA_SCRATCH_WARN_USED_PERCENT:-85}"
MEDIA_SCRATCH_RETENTION_DAYS="${MEDIA_SCRATCH_RETENTION_DAYS:-30}"
MEDIA_SCRATCH_MIN_FREE_GB="${MEDIA_SCRATCH_MIN_FREE_GB:-200}"
MEDIA_SCRATCH_CLEANUP_ENABLED="${MEDIA_SCRATCH_CLEANUP_ENABLED:-true}"
MEDIA_VAULT_EXPECT_MIN_GB="${MEDIA_VAULT_EXPECT_MIN_GB:-3000}"
MEDIA_SCRATCH_EXPECT_MIN_GB="${MEDIA_SCRATCH_EXPECT_MIN_GB:-1400}"
MEDIA_PREFLIGHT_FAIL_CLOSED="${MEDIA_PREFLIGHT_FAIL_CLOSED:-false}"
MEDIA_VAULT_FALLBACK_TO_SCRATCH="${MEDIA_VAULT_FALLBACK_TO_SCRATCH:-true}"
MEDIA_SCRATCH_FALLBACK_ROOT="${MEDIA_SCRATCH_FALLBACK_ROOT:-$PROJECT/runtime/HmSTxScratch}"
MEDIA_LAYOUT_REPAIR_COMPAT_LINKS="${MEDIA_LAYOUT_REPAIR_COMPAT_LINKS:-true}"
START_LOCK_DIR="${START_LOCK_DIR:-$RUNTIME_DIR/start.lock.d}"

if [ "$MEDIA_PREFLIGHT_FAIL_CLOSED" = "true" ] && [ "$MEDIA_LAYOUT_STRICT" != "true" ]; then
    MEDIA_LAYOUT_STRICT="true"
fi

mkdir -p "$LOG_DIR" "$RUNTIME_DIR" "$MOUNT_RUNTIME_DIR"
START_LOG="$LOG_DIR/start.log"
if [ "${START_LOG_PIPE_ATTACHED:-0}" != "1" ]; then
    export START_LOG_PIPE_ATTACHED=1
    exec > >(tee -a "$START_LOG") 2>&1
fi
START_DEBUG_ECHO="${START_DEBUG_ECHO:-true}"
START_DEBUG_MAX_LINES_PER_STEP="${START_DEBUG_MAX_LINES_PER_STEP:-80}"
START_COMPACT_LOG="${START_COMPACT_LOG:-true}"
SFQ_HELPER="${SFQ_HELPER:-$PROJECT/scripts/service-fail-quiet.sh}"
[ -f "$SFQ_HELPER" ] && . "$SFQ_HELPER"

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

log_debug() {
    printf '[%s] DEBUG %s\n' "$(timestamp)" "$1"
}

log_info_detail() {
    [ "$START_COMPACT_LOG" = "true" ] && return 0
    log_info "$1"
}

slugify_log_name() {
    printf '%s\n' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//'
}

service_log_path() {
    local service_name="$1"
    local slug=""

    slug="$(slugify_log_name "$service_name")"
    if [ -z "$slug" ]; then
        slug="service"
    fi
    printf '%s/%s.log\n' "$LOG_DIR" "$slug"
}

log_file_line_count() {
    local log_path="$1"

    if [ -f "$log_path" ]; then
        wc -l < "$log_path" | tr -d '[:space:]'
        return 0
    fi

    printf '0\n'
}

log_recent_issues() {
    local name="$1"
    local log_path="$2"
    local from_line="${3:-0}"
    local issue_lines=""
    local line=""

    issue_lines="$(
        awk -v start="$from_line" '
            NR > start {
                lowered = tolower($0)
                if (
                    lowered ~ /(^|[^a-z])(warn|warning)([^a-z]|$)/ ||
                    lowered ~ /(^|[^a-z])(error|fatal|exception|traceback)([^a-z]|$)/ ||
                    lowered ~ /(^|[^a-z])(fail|failed|failure)([^a-z]|$)/
                ) {
                    print
                }
            }
        ' "$log_path" 2>/dev/null | tail -n 10
    )"

    [ -n "$issue_lines" ] || return 0

    log_warn "$name emitted warning/error lines (debug log: $log_path)"
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        printf '[%s] WARN  %s log: %s\n' "$(timestamp)" "$name" "$line"
    done <<EOF
$issue_lines
EOF
}

log_recent_tail() {
    local name="$1"
    local log_path="$2"
    local line=""

    if [ ! -f "$log_path" ]; then
        log_warn "$name debug log is missing: $log_path"
        return 0
    fi

    log_warn "$name recent debug log tail ($log_path):"
    while IFS= read -r line; do
        printf '[%s] WARN  %s log: %s\n' "$(timestamp)" "$name" "$line"
    done <<EOF
$(tail -n 20 "$log_path" 2>/dev/null || true)
EOF
}

emit_new_debug_lines() {
    local name="$1"
    local log_path="$2"
    local from_line="${3:-0}"
    local max_lines="$START_DEBUG_MAX_LINES_PER_STEP"
    local line=""

    [ "$START_DEBUG_ECHO" = "true" ] || return 0
    [ -f "$log_path" ] || return 0
    [[ "$max_lines" =~ ^[0-9]+$ ]] || max_lines=80
    if [ "$max_lines" -le 0 ]; then
        return 0
    fi

    while IFS= read -r line; do
        [ -n "$line" ] || continue
        printf '[%s] DEBUG %s log: %s\n' "$(timestamp)" "$name" "$line"
    done <<EOF
$(awk -v start="$from_line" 'NR > start { print }' "$log_path" 2>/dev/null | tail -n "$max_lines")
EOF
}

run_logged_command() {
    local name="$1"
    local log_path="$2"
    shift 2
    local start_line=0
    local status=0

    mkdir -p "$LOG_DIR"
    start_line="$(log_file_line_count "$log_path")"
    if "$@" >>"$log_path" 2>&1; then
        status=0
    else
        status=$?
    fi
    emit_new_debug_lines "$name" "$log_path" "$start_line"
    log_recent_issues "$name" "$log_path" "$start_line"
    return "$status"
}

HOTKEY_PID=""
RELOAD_REQUESTED=0
EXTERNAL_ROLE_MOUNTS_READY="unknown"

acquire_start_lock() {
    local lock_pid_file="$START_LOCK_DIR/pid"
    local existing_pid=""
    local waited=0

    while true; do
        if mkdir "$START_LOCK_DIR" 2>/dev/null; then
            printf '%s\n' "$$" > "$lock_pid_file"
            return 0
        fi

        if [ -f "$lock_pid_file" ]; then
            existing_pid="$(tr -d '[:space:]' < "$lock_pid_file" 2>/dev/null || true)"
            if [ -n "$existing_pid" ] && [ "$existing_pid" = "$$" ]; then
                return 0
            fi
            if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
                if [ "$waited" -ge "$START_LOCK_WAIT_SECONDS" ]; then
                    log_error "Another start.sh instance is still running after ${START_LOCK_WAIT_SECONDS}s (pid $existing_pid)"
                    exit 1
                fi
                if [ "$waited" -eq 0 ]; then
                    log_info "Waiting for existing start.sh instance (pid $existing_pid)"
                fi
                sleep 1
                waited=$((waited + 1))
                continue
            fi
        fi

        log_warn "Recovering stale startup lock at $START_LOCK_DIR"
        rm -rf "$START_LOCK_DIR" 2>/dev/null || true
    done
}

release_start_lock() {
    local lock_pid_file="$START_LOCK_DIR/pid"
    local lock_pid=""

    if [ ! -f "$lock_pid_file" ]; then
        return 0
    fi

    lock_pid="$(tr -d '[:space:]' < "$lock_pid_file" 2>/dev/null || true)"
    if [ "$lock_pid" = "$$" ]; then
        rm -rf "$START_LOCK_DIR" 2>/dev/null || true
    fi
}

stop_hotkey_listener() {
    if [ -n "${HOTKEY_PID:-}" ] && kill -0 "$HOTKEY_PID" 2>/dev/null; then
        kill "$HOTKEY_PID" 2>/dev/null || true
        wait "$HOTKEY_PID" 2>/dev/null || true
    fi
    HOTKEY_PID=""
}

ensure_node_dependencies() {
    local app_dir="$1"
    local label="$2"

    [ -f "$app_dir/package.json" ] || return 0

    if [ ! -d "$app_dir/node_modules" ]; then
        log_error "$label dependencies missing in $app_dir; run 'npm install' before starting."
        return 1
    fi

    if [ -f "$app_dir/package-lock.json" ]; then
        if ! (cd "$app_dir" && npm ci --dry-run --ignore-scripts --no-audit --no-fund >/dev/null 2>&1); then
            log_error "$label dependencies look out of date; run 'npm install' in $app_dir before starting."
            return 1
        fi
        return 0
    fi

    if ! (cd "$app_dir" && npm ls --depth=0 >/dev/null 2>&1); then
        log_error "$label dependencies look out of date; run 'npm install' in $app_dir before starting."
        return 1
    fi

    return 0
}

ensure_production_dashboard_build() {
    local routes_manifest="$PROJECT/dashboard/.next/routes-manifest.json"

    if [ ! -f "$PROJECT/dashboard/.next/BUILD_ID" ]; then
        log_info "Building production dashboard for localhost"
        (cd "$PROJECT/dashboard" && npm run build)
        return 0
    fi

    if [ -f "$routes_manifest" ] && grep -q '"basePath": "/Home-Server-Termux"' "$routes_manifest"; then
        log_info "Replacing demo export with production dashboard for localhost"
        (cd "$PROJECT/dashboard" && npm run build)
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

ssh_probe_host() {
    case "${1:-127.0.0.1}" in
        0.0.0.0|'::'|'[::]'|'')
            printf '127.0.0.1\n'
            ;;
        *)
            printf '%s\n' "$1"
            ;;
    esac
}

ssh_listener_is_ready() {
    local host="$1"
    local port="$2"
    local probe_host=""

    probe_host="$(ssh_probe_host "$host")"
    if command -v nc >/dev/null 2>&1; then
        nc -z "$probe_host" "$port" >/dev/null 2>&1
        return $?
    fi

    [ "$probe_host" = "127.0.0.1" ] && port_is_open "$port"
}

run_sv() {
    env PREFIX="$TERMUX_PREFIX" SVDIR="$SVDIR_PATH" LOGDIR="$LOGDIR_PATH" "$SV_BIN" "$@"
}

run_service_daemon() {
    env PREFIX="$TERMUX_PREFIX" SVDIR="$SVDIR_PATH" LOGDIR="$LOGDIR_PATH" "$SERVICE_DAEMON_BIN" "$@"
}

supervisor_pid() {
    pgrep -f "$TERMUX_PREFIX/bin/runsvdir $SVDIR_PATH" | head -1 || true
}

supervisor_is_ready() {
    local supervise_ok="$SVDIR_PATH/sshd/supervise/ok"

    if [ -p "$supervise_ok" ]; then
        return 0
    fi

    run_sv status sshd >/dev/null 2>&1
}

ensure_service_supervisor() {
    local attempts=0
    local pid=""

    if [ ! -x "$SERVICE_DAEMON_BIN" ] || [ ! -x "$SV_BIN" ]; then
        log_error "SSH failure class=SUPERVISOR_UNAVAILABLE missing service-daemon or sv binary"
        return 1
    fi

    pid="$(supervisor_pid)"
    if [ -z "$pid" ]; then
        log_info "Ensuring Termux service supervisor"
        run_service_daemon start >/dev/null 2>&1 || true
    else
        log_info "Termux service supervisor already running (pid $pid)"
    fi

    while [ "$attempts" -lt 10 ]; do
        if supervisor_is_ready; then
            log_info "Termux service supervisor ready"
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 1
    done

    log_error "SSH failure class=SUPERVISOR_UNAVAILABLE service supervisor did not become ready"
    return 1
}

wait_for_port() {
    local port="$1"
    local name="$2"
    local pid_file="${3:-}"
    local host="${4:-127.0.0.1}"
    local timeout_seconds="${5:-$START_WAIT_TIMEOUT_SECONDS}"
    local status_script="${6:-}"
    local pid_exit_grace_seconds="${7:-$START_WAIT_PID_EXIT_GRACE_SECONDS}"
    local attempts=0
    local start_epoch=0
    local now_epoch=0
    local elapsed=0
    local pid_exit_epoch=0
    local pid=""

    if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]]; then
        timeout_seconds="$START_WAIT_TIMEOUT_SECONDS"
    fi
    if ! [[ "$pid_exit_grace_seconds" =~ ^[0-9]+$ ]]; then
        pid_exit_grace_seconds="$START_WAIT_PID_EXIT_GRACE_SECONDS"
    fi
    start_epoch="$(date +%s)"
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

        if [ -n "$status_script" ] && [ -x "$status_script" ] && "$status_script" status >/dev/null 2>&1; then
            :
        fi

        if [ -n "$pid_file" ] && [ -f "$pid_file" ]; then
            pid="$(cat "$pid_file" 2>/dev/null || true)"
            if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
                now_epoch="$(date +%s)"
                if [ "$pid_exit_epoch" -eq 0 ]; then
                    pid_exit_epoch="$now_epoch"
                    log_warn "$name pid $pid exited before listener probe succeeded; allowing ${pid_exit_grace_seconds}s grace"
                fi

                if [ -n "$status_script" ] && [ -x "$status_script" ] && "$status_script" status >/dev/null 2>&1; then
                    :
                elif [ $((now_epoch - pid_exit_epoch)) -ge "$pid_exit_grace_seconds" ]; then
                    log_error "$name exited before opening $host:$port"
                    return 1
                fi
            else
                pid_exit_epoch=0
            fi
        fi

        now_epoch="$(date +%s)"
        elapsed=$((now_epoch - start_epoch))
        if [ "$timeout_seconds" -gt 0 ] && [ "$elapsed" -ge "$timeout_seconds" ]; then
            log_error "Timed out waiting for $name on $host:$port after ${timeout_seconds}s"
            return 1
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

stop_drive_watcher() {
    local watcher="$PROJECT/scripts/drive-watcher.sh"

    if pgrep -f "$watcher" >/dev/null 2>&1; then
        log_info "Stopping legacy drive watcher"
        pkill -f "$watcher" >/dev/null 2>&1 || true
    fi
}

sync_cloud_mount_links() {
    local attempt=0
    local max_attempts=2

    if [ ! -x "$TERMUX_CLOUD_MOUNT_CMD" ]; then
        log_info "termux-cloud-mount not installed; FTP mounts stay in browse-only mode until the helper is added"
        return 0
    fi

    while [ "$attempt" -lt "$max_attempts" ]; do
        if "$TERMUX_CLOUD_MOUNT_CMD" sync-links >/dev/null 2>&1; then
            log_info "termux-cloud-mount synced FTP drive links"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    log_warn "termux-cloud-mount sync-links failed after $max_attempts attempts; check root mount helper state"
    return 0
}

role_main_mount_dir_name() {
    local role="$1"
    case "$(printf '%s' "$role" | tr '[:upper:]' '[:lower:]')" in
        vault)
            printf 'D (%s)\n' "$VAULT_MAIN_LABEL"
            ;;
        scratch)
            printf 'E (%s)\n' "$SCRATCH_MAIN_LABEL"
            ;;
        *)
            printf '\n'
            ;;
    esac
}

role_main_mount_present() {
    local role="$1"
    local dir_name=""
    local primary_path=""
    local mirror_path=""

    dir_name="$(role_main_mount_dir_name "$role")"
    [ -n "$dir_name" ] || return 1

    primary_path="$DRIVES_DIR/$dir_name"
    mirror_path="$TERMUX_DRIVES_MIRROR_ROOT/$dir_name"

    if path_is_external_candidate_mount "$primary_path"; then
        return 0
    fi
    if path_is_external_candidate_mount "$mirror_path"; then
        return 0
    fi
    return 1
}

external_role_mounts_ready() {
    role_main_mount_present "vault" && role_main_mount_present "scratch"
}

bootstrap_drive_mounts() {
    if external_role_mounts_ready; then
        EXTERNAL_ROLE_MOUNTS_READY="true"
        log_info "External vault/scratch mounts already active under $DRIVES_DIR and/or $TERMUX_DRIVES_MIRROR_ROOT; skipping drive scan"
        return 0
    fi

    if [ ! -x "$USB_MOUNT_SERVICE_CMD" ]; then
        EXTERNAL_ROLE_MOUNTS_READY="false"
        log_warn "USB mount helper missing ($USB_MOUNT_SERVICE_CMD); using fallback drive paths"
        return 0
    fi

    log_info "Running USB mount scan for vault/scratch external drives"
    if ! "$USB_MOUNT_SERVICE_CMD" --scan-now >/dev/null 2>&1; then
        log_warn "USB mount scan failed; using fallback drive paths"
    fi

    if external_role_mounts_ready; then
        EXTERNAL_ROLE_MOUNTS_READY="true"
        log_info "External vault/scratch mounts detected"
    else
        EXTERNAL_ROLE_MOUNTS_READY="false"
        log_warn "No external vault/scratch drives detected; fallback roots will be used and vault-only services stay limited"
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
    :
}

normalize_csv_list() {
    local input="$1"
    printf '%s\n' "$input" | tr ';' ',' | tr '\n' ',' | tr -s ',' | sed 's/^,*//; s/,*$//'
}

csv_to_array() {
    local csv="$1"
    local out_name="$2"
    local token=""
    local -n out_ref="$out_name"

    out_ref=()
    csv="$(normalize_csv_list "$csv")"
    [ -n "$csv" ] || return 0

    while IFS= read -r token; do
        token="$(printf '%s' "$token" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$token" ] || continue
        out_ref+=("$token")
    done < <(printf '%s\n' "$csv" | tr ',' '\n')
}

array_contains() {
    local needle="$1"
    shift
    local item=""

    for item in "$@"; do
        if [ "$item" = "$needle" ]; then
            return 0
        fi
    done

    return 1
}

array_push_unique() {
    local out_name="$1"
    local value="$2"
    local -n out_ref="$out_name"

    if ! array_contains "$value" "${out_ref[@]}"; then
        out_ref+=("$value")
    fi
}

join_csv() {
    local out_name="$1"
    local -n out_ref="$out_name"
    local IFS=','
    printf '%s\n' "${out_ref[*]}"
}

read_drive_roles_from_marker() {
    local drive_dir="$1"
    local role_file
    local roles=""

    role_file="$(drive_role_file_path "$drive_dir")"
    [ -f "$role_file" ] || return 1

    roles="$(awk -F= '/^HMSTX_ROLES=/{print $2; found=1; exit} /^HMSTX_ROLE=/{if(!found){print $2; exit}}' "$role_file" 2>/dev/null || true)"
    roles="$(normalize_csv_list "$roles")"
    [ -n "$roles" ] || return 1
    printf '%s\n' "$roles"
}

drive_marker_has_role() {
    local drive_dir="$1"
    local role="$2"
    local roles=""
    local role_item=""

    roles="$(read_drive_roles_from_marker "$drive_dir" || true)"
    [ -n "$roles" ] || return 1

    while IFS= read -r role_item; do
        role_item="$(printf '%s' "$role_item" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        if [ "$role_item" = "$role" ]; then
            return 0
        fi
    done < <(printf '%s\n' "$roles" | tr ',' '\n')

    return 1
}

collect_marker_drive_dirs() {
    local role="$1"
    local out_name="$2"
    local drive_dir=""
    local -n out_ref="$out_name"

    out_ref=()
    while IFS= read -r drive_dir; do
        [ -n "$drive_dir" ] || continue
        if drive_marker_has_role "$drive_dir" "$role"; then
            array_push_unique "$out_name" "$drive_dir"
        fi
    done < <(list_external_drive_dirs)
}

resolve_candidate_drive_dirs() {
    local candidates_csv="$1"
    local out_name="$2"
    local candidate_tokens=()
    local token=""
    local resolved=""
    local -n out_ref="$out_name"

    out_ref=()
    csv_to_array "$candidates_csv" candidate_tokens
    for token in "${candidate_tokens[@]}"; do
        resolved="$(resolve_drive_dir "$token" || true)"
        if [ -z "$resolved" ]; then
            log_warn "Configured drive '$token' is missing under $DRIVES_DIR"
            continue
        fi
        array_push_unique "$out_name" "$resolved"
    done
}

ensure_drive_role_marker() {
    local drive_dir="$1"
    local role="$2"
    local role_file existing_roles=""
    local roles_csv normalized_role
    local roles_array=()
    local item=""

    normalized_role="$(printf '%s' "$role" | tr '[:upper:]' '[:lower:]')"
    role_file="$(drive_role_file_path "$drive_dir")"
    existing_roles="$(read_drive_roles_from_marker "$drive_dir" || true)"
    if [ -n "$existing_roles" ]; then
        csv_to_array "$existing_roles" roles_array
    fi

    if ! array_contains "$normalized_role" "${roles_array[@]}"; then
        roles_array+=("$normalized_role")
    fi

    # Keep the marker stable and append roles without clobbering unrelated content on the drive.
    roles_csv=""
    for item in "${roles_array[@]}"; do
        item="$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$item" ] || continue
        if [ -n "$roles_csv" ]; then
            roles_csv="$roles_csv,$item"
        else
            roles_csv="$item"
        fi
    done

    cat > "$role_file" <<EOF
HMSTX_SCHEMA=1
HMSTX_DRIVE_ID=$(basename "$drive_dir")
HMSTX_ROLES=$roles_csv
HMSTX_UPDATED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
EOF
}

assert_drive_ready() {
    local drive_dir="$1"
    local role="$2"
    local marker=""

    if [ ! -d "$drive_dir" ]; then
        log_error "Drive path for $role is missing: $drive_dir"
        return 1
    fi

    if ! is_writable_dir "$drive_dir"; then
        log_error "Drive path for $role is not writable: $drive_dir"
        return 1
    fi

    marker="$(drive_role_file_path "$drive_dir")"
    if [ ! -f "$marker" ]; then
        ensure_drive_role_marker "$drive_dir" "$role"
    fi

    if ! path_is_direct_mount_in_proc "$drive_dir"; then
        log_warn "Drive path $drive_dir is not a direct mountpoint in /proc/mounts"
    fi

    return 0
}

build_pool_roots() {
    local role="$1"
    local candidates_csv="$2"
    local role_dir_name="$3"
    local subdir_name="$4"
    local out_roots_name="$5"
    local out_drives_name="$6"
    local marker_drives=()
    local configured_drives=()
    local all_drives=()
    local direct_mount_drives=()
    local fallback_first_drives=()
    local nonfallback_drives=()
    local drive_dir=""
    local drive_base_lc=""
    local role_root=""
    local -n out_roots_ref="$out_roots_name"
    local -n out_drives_ref="$out_drives_name"

    out_roots_ref=()
    out_drives_ref=()
    collect_marker_drive_dirs "$role" marker_drives
    resolve_candidate_drive_dirs "$candidates_csv" configured_drives

    for drive_dir in "${marker_drives[@]}"; do
        array_push_unique all_drives "$drive_dir"
    done
    for drive_dir in "${configured_drives[@]}"; do
        array_push_unique all_drives "$drive_dir"
    done

    if [ "${#all_drives[@]}" -eq 0 ]; then
        log_error "No drives resolved for role '$role' (candidates: $candidates_csv)"
        return 1
    fi

    for drive_dir in "${all_drives[@]}"; do
        if path_is_direct_mount_in_proc "$drive_dir"; then
            direct_mount_drives+=("$drive_dir")
        fi
    done

    if [ "${#direct_mount_drives[@]}" -gt 0 ]; then
        all_drives=("${direct_mount_drives[@]}")
    else
        for drive_dir in "${all_drives[@]}"; do
            drive_base_lc="$(basename "$drive_dir" | tr '[:upper:]' '[:lower:]')"
            case "$drive_base_lc" in
                *"fallback"*)
                    fallback_first_drives+=("$drive_dir")
                    ;;
                *)
                    nonfallback_drives+=("$drive_dir")
                    ;;
            esac
        done
        if [ "${#fallback_first_drives[@]}" -gt 0 ]; then
            all_drives=("${fallback_first_drives[@]}" "${nonfallback_drives[@]}")
        fi
    fi

    for drive_dir in "${all_drives[@]}"; do
        if ! assert_drive_ready "$drive_dir" "$role"; then
            if [ "$MEDIA_LAYOUT_STRICT" = "true" ]; then
                return 1
            fi
            continue
        fi

        ensure_drive_role_marker "$drive_dir" "$role"
        role_root="$drive_dir/$role_dir_name/$subdir_name"
        if ! mkdir -p "$role_root" 2>/dev/null; then
            log_error "Unable to create $role root at $role_root"
            if [ "$MEDIA_LAYOUT_STRICT" = "true" ]; then
                return 1
            fi
            continue
        fi

        if ! is_writable_dir "$role_root"; then
            log_error "$role root is not writable: $role_root"
            if [ "$MEDIA_LAYOUT_STRICT" = "true" ]; then
                return 1
            fi
            continue
        fi

        out_roots_ref+=("$role_root")
        out_drives_ref+=("$drive_dir")
    done

    if [ "${#out_roots_ref[@]}" -eq 0 ]; then
        log_error "No writable roots available for role '$role'"
        return 1
    fi

    return 0
}

MEDIA_COMPAT_ROOT_REBUILT=0

resolve_link_target_absolute() {
    local link_parent="$1"
    local raw_target="$2"
    local resolved=""

    if [ -z "$raw_target" ]; then
        printf '\n'
        return 0
    fi

    if [ "${raw_target#/}" != "$raw_target" ]; then
        resolved="$(realpath -m "$raw_target" 2>/dev/null || true)"
        if [ -n "$resolved" ]; then
            printf '%s\n' "$resolved"
            return 0
        fi
        printf '%s\n' "$raw_target"
        return 0
    fi

    resolved="$(realpath -m "$link_parent/$raw_target" 2>/dev/null || true)"
    if [ -n "$resolved" ]; then
        printf '%s\n' "$resolved"
        return 0
    fi

    printf '%s\n' "$link_parent/$raw_target"
}

compat_target_for_name() {
    local name="$1"

    case "$name" in
        movies)
            printf '%s\n' "$MEDIA_MOVIES_DIR"
            ;;
        series)
            printf '%s\n' "$MEDIA_SERIES_DIR"
            ;;
        music)
            printf '%s\n' "$MEDIA_MUSIC_DIR"
            ;;
        audiobooks)
            printf '%s\n' "$MEDIA_AUDIOBOOKS_DIR"
            ;;
        downloads)
            printf '%s\n' "$MEDIA_DOWNLOADS_DIR"
            ;;
        iptv-cache)
            printf '%s\n' "$MEDIA_IPTV_CACHE_DIR"
            ;;
        iptv-epg)
            printf '%s\n' "$MEDIA_IPTV_EPG_DIR"
            ;;
        *)
            return 1
            ;;
    esac
}

rebuild_media_compat_root() {
    local tmp_root="$MEDIA_ROOT.__compat-rebuild.$$"
    local stale_root="$MEDIA_ROOT.__compat-stale.$(date '+%Y%m%d%H%M%S').$$"
    local entry=""
    local entry_target=""
    local entries=(movies series music audiobooks downloads iptv-cache iptv-epg)

    if [ "$MEDIA_COMPAT_ROOT_REBUILT" = "1" ]; then
        return 1
    fi

    rm -rf "$tmp_root" 2>/dev/null || true
    if ! mkdir -p "$tmp_root" 2>/dev/null; then
        log_warn "Unable to create temporary compatibility root at $tmp_root"
        return 1
    fi

    for entry in "${entries[@]}"; do
        entry_target="$(compat_target_for_name "$entry" || true)"
        if [ -z "$entry_target" ]; then
            log_warn "Cannot rebuild compatibility root: target is missing for $entry"
            rm -rf "$tmp_root" 2>/dev/null || true
            return 1
        fi
        mkdir -p "$entry_target"
        if ! ln -s "$entry_target" "$tmp_root/$entry" 2>/dev/null; then
            log_warn "Unable to prepare compatibility link $tmp_root/$entry -> $entry_target"
            rm -rf "$tmp_root" 2>/dev/null || true
            return 1
        fi
    done

    if [ -e "$MEDIA_ROOT" ] && ! mv "$MEDIA_ROOT" "$stale_root" 2>/dev/null; then
        log_warn "Unable to rotate existing compatibility root at $MEDIA_ROOT"
        rm -rf "$tmp_root" 2>/dev/null || true
        return 1
    fi

    if ! mv "$tmp_root" "$MEDIA_ROOT" 2>/dev/null; then
        log_warn "Unable to activate rebuilt compatibility root at $MEDIA_ROOT"
        rm -rf "$tmp_root" 2>/dev/null || true
        if [ -d "$stale_root" ] && [ ! -e "$MEDIA_ROOT" ]; then
            mv "$stale_root" "$MEDIA_ROOT" 2>/dev/null || true
        fi
        return 1
    fi

    MEDIA_COMPAT_ROOT_REBUILT=1
    log_warn "Rebuilt compatibility root at $MEDIA_ROOT to recover locked stale links"
    if [ -d "$stale_root" ] && ! rm -rf "$stale_root" 2>/dev/null; then
        log_warn "Retained previous compatibility root for manual cleanup: $stale_root"
    fi
    return 0
}

ensure_compat_link() {
    local name="$1"
    local target="$2"
    local compat_path="$MEDIA_ROOT/$name"
    local link_parent="$MEDIA_ROOT"
    local expected_target=""
    local current_raw_target=""
    local current_target=""
    local has_conflict=0

    mkdir -p "$target"
    expected_target="$(realpath -m "$target" 2>/dev/null || printf '%s\n' "$target")"

    if [ -L "$compat_path" ]; then
        current_raw_target="$(readlink "$compat_path" 2>/dev/null || true)"
        current_target="$(resolve_link_target_absolute "$link_parent" "$current_raw_target")"
        if [ "$current_target" = "$expected_target" ]; then
            return 0
        fi
        if [ "$MEDIA_LAYOUT_REPAIR_COMPAT_LINKS" = "true" ]; then
            if ln -sfn "$target" "$compat_path" 2>/dev/null; then
                log_info_detail "Repaired compatibility link $compat_path -> $target"
                return 0
            fi
            rm -rf "$compat_path" 2>/dev/null || true
            if ln -s "$target" "$compat_path" 2>/dev/null; then
                log_info_detail "Repaired compatibility link $compat_path -> $target (forced relink)"
                return 0
            fi
            if rebuild_media_compat_root; then
                current_raw_target="$(readlink "$compat_path" 2>/dev/null || true)"
                current_target="$(resolve_link_target_absolute "$link_parent" "$current_raw_target")"
                if [ "$current_target" = "$expected_target" ]; then
                    log_info_detail "Repaired compatibility link $compat_path -> $target (compat root rebuild)"
                    return 0
                fi
            fi
            log_warn "Failed to repair compatibility link $compat_path -> $target"
        fi
        log_warn "Compatibility link $compat_path points to ${current_target:-<unreadable>} (expected $expected_target)"
        has_conflict=1
    elif [ -e "$compat_path" ]; then
        if [ -d "$compat_path" ] && [ "$MEDIA_LAYOUT_AUTO_ADOPT_EMPTY" = "true" ] && [ -z "$(find "$compat_path" -mindepth 1 -maxdepth 1 2>/dev/null)" ]; then
            rmdir "$compat_path" 2>/dev/null || true
            ln -s "$target" "$compat_path"
            return 0
        fi
        log_warn "Compatibility path exists and is not a managed symlink: $compat_path"
        has_conflict=1
    else
        ln -s "$target" "$compat_path"
        return 0
    fi

    if [ "$has_conflict" -eq 1 ] && [ "$MEDIA_LAYOUT_STRICT" = "true" ]; then
        return 1
    fi
    return 0
}

directory_has_payload() {
    local target="$1"

    [ -d "$target" ] || return 1

    if find "$target" -mindepth 1 \( -type f -o -type l -o -type s -o -type b -o -type c -o -type p \) -print -quit 2>/dev/null | grep -q .; then
        return 0
    fi

    if find "$target" -mindepth 1 -type d ! -empty -print -quit 2>/dev/null | grep -q .; then
        return 0
    fi

    return 1
}

path_free_gb() {
    local target="$1"
    local kb_free=""
    local stat_free=""
    local stat_block=""

    kb_free="$(df -Pk "$target" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
    if [ -n "$kb_free" ] && [[ "$kb_free" =~ ^[0-9]+$ ]]; then
        printf '%s\n' "$((kb_free / 1024 / 1024))"
        return 0
    fi

    read -r stat_free stat_block <<EOF
$(stat -f -c '%a %S' "$target" 2>/dev/null || true)
EOF
    if [[ "${stat_free:-}" =~ ^[0-9]+$ ]] && [[ "${stat_block:-}" =~ ^[0-9]+$ ]]; then
        printf '%s\n' "$((stat_free * stat_block / 1024 / 1024 / 1024))"
        return 0
    fi

    printf '0\n'
}

path_total_gb() {
    local target="$1"
    local kb_total=""
    local stat_total=""
    local stat_block=""

    kb_total="$(df -Pk "$target" 2>/dev/null | awk 'NR==2 {print $2}' || true)"
    if [ -n "$kb_total" ] && [[ "$kb_total" =~ ^[0-9]+$ ]]; then
        printf '%s\n' "$((kb_total / 1024 / 1024))"
        return 0
    fi

    read -r stat_total stat_block <<EOF
$(stat -f -c '%b %S' "$target" 2>/dev/null || true)
EOF
    if [[ "${stat_total:-}" =~ ^[0-9]+$ ]] && [[ "${stat_block:-}" =~ ^[0-9]+$ ]]; then
        printf '%s\n' "$((stat_total * stat_block / 1024 / 1024 / 1024))"
        return 0
    fi

    printf '0\n'
}

path_mount_device() {
    local target="$1"
    df -Pk "$target" 2>/dev/null | awk 'NR==2 {print $1}'
}

path_mount_options() {
    local target="$1"
    local device=""

    device="$(path_mount_device "$target")"
    [ -n "$device" ] || return 0
    awk -v dev="$device" '$1 == dev {print $4; exit}' /proc/mounts 2>/dev/null || true
}

path_fs_type() {
    local target="$1"
    stat -f -c %T "$target" 2>/dev/null || printf 'unknown\n'
}

fs_type_is_non_external() {
    local fs_type="$1"
    case "$fs_type" in
        ''|unknown|f2fs|tmpfs|overlay)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

run_pool_preflight() {
    local role="$1"
    local roots_name="$2"
    local expected_min_gb="$3"
    local -n roots_ref="$roots_name"
    local root=""
    local total_gb=0
    local free_gb=0
    local fs_type=""
    local mount_opts=""
    local failures=0

    for root in "${roots_ref[@]}"; do
        total_gb="$(path_total_gb "$root")"
        free_gb="$(path_free_gb "$root")"
        fs_type="$(path_fs_type "$root")"
        mount_opts="$(path_mount_options "$root")"

        log_info_detail "Preflight $role root: $root (fs=$fs_type total=${total_gb}GiB free=${free_gb}GiB opts=${mount_opts:-unknown})"

        if ! is_writable_dir "$root"; then
            log_error "$role root is not writable: $root"
            failures=$((failures + 1))
            continue
        fi

        if [ "$expected_min_gb" -gt 0 ]; then
            if fs_type_is_non_external "$fs_type"; then
                log_info_detail "Skipping $role capacity floor check on non-external fs ($fs_type): $root"
            elif [ "$total_gb" -lt "$expected_min_gb" ]; then
                log_warn "$role root capacity ${total_gb}GiB is below expected floor ${expected_min_gb}GiB: $root"
                failures=$((failures + 1))
            fi
        fi
    done

    if [ "$failures" -gt 0 ] && [ "$MEDIA_PREFLIGHT_FAIL_CLOSED" = "true" ]; then
        return 1
    fi

    return 0
}

run_storage_preflight() {
    local vault_roots_name="$1"
    local scratch_roots_name="$2"

    if ! run_pool_preflight "vault" "$vault_roots_name" "$MEDIA_VAULT_EXPECT_MIN_GB"; then
        return 1
    fi
    if ! run_pool_preflight "scratch" "$scratch_roots_name" "$MEDIA_SCRATCH_EXPECT_MIN_GB"; then
        return 1
    fi
    return 0
}

apply_storage_layout_exports() {
    local vault_roots=()
    local scratch_roots=()
    local vault_drives=()
    local scratch_drives=()
    local vault_roots_csv=""
    local scratch_roots_csv=""
    local vault_free_gb=0
    local vault_ready=true
    local scratch_ready=true
    local fallback_root=""
    local scratch_root=""

    if ! build_pool_roots "vault" "$MEDIA_VAULT_DRIVES" "$MEDIA_VAULT_DIR_NAME" "$MEDIA_VAULT_MEDIA_SUBDIR" vault_roots vault_drives; then
        vault_ready=false
        vault_roots=()
        vault_drives=()
    fi

    if ! build_pool_roots "scratch" "$MEDIA_SCRATCH_DRIVES" "$MEDIA_SCRATCH_DIR_NAME" "$MEDIA_SCRATCH_MEDIA_SUBDIR" scratch_roots scratch_drives; then
        scratch_ready=false
        scratch_roots=()
        scratch_drives=()
    fi

    if [ "$scratch_ready" != "true" ] || [ "${#scratch_roots[@]}" -eq 0 ]; then
        if [ "$MEDIA_LAYOUT_STRICT" = "true" ] || [ "$MEDIA_PREFLIGHT_FAIL_CLOSED" = "true" ]; then
            log_error "Scratch roots unavailable and strict mode is enabled"
            return 1
        fi

        scratch_root="$MEDIA_SCRATCH_FALLBACK_ROOT"
        log_warn "Scratch roots unavailable; falling back to local scratch root: $scratch_root"
        if ! mkdir -p "$scratch_root" 2>/dev/null; then
            log_error "Unable to create local scratch fallback root: $scratch_root"
            return 1
        fi
        if ! is_writable_dir "$scratch_root"; then
            log_error "Local scratch fallback root is not writable: $scratch_root"
            return 1
        fi

        scratch_roots=("$scratch_root")
        scratch_drives=("$scratch_root")
    fi

    if [ "$vault_ready" != "true" ] || [ "${#vault_roots[@]}" -eq 0 ]; then
        if [ "$MEDIA_LAYOUT_STRICT" = "true" ] || [ "$MEDIA_PREFLIGHT_FAIL_CLOSED" = "true" ] || [ "$MEDIA_VAULT_FALLBACK_TO_SCRATCH" != "true" ]; then
            log_error "Vault roots unavailable and fallback is disabled"
            return 1
        fi

        log_warn "Vault roots unavailable; falling back to scratch media roots"
        vault_roots=()
        for scratch_root in "${scratch_roots[@]}"; do
            fallback_root="$scratch_root/media"
            if ! mkdir -p "$fallback_root" 2>/dev/null; then
                log_warn "Unable to create fallback vault root at $fallback_root"
                continue
            fi
            if ! is_writable_dir "$fallback_root"; then
                log_warn "Fallback vault root is not writable: $fallback_root"
                continue
            fi
            vault_roots+=("$fallback_root")
        done

        if [ "${#vault_roots[@]}" -eq 0 ]; then
            log_error "Scratch fallback did not provide any writable vault roots"
            return 1
        fi
        vault_drives=("${scratch_drives[@]}")
    fi

    if ! run_storage_preflight vault_roots scratch_roots; then
        log_error "Storage preflight checks failed"
        return 1
    fi

    vault_roots_csv="$(join_csv vault_roots)"
    scratch_roots_csv="$(join_csv scratch_roots)"
    MEDIA_VAULT_ROOTS="$vault_roots_csv"
    MEDIA_SCRATCH_ROOTS="$scratch_roots_csv"
    MEDIA_VAULT_ROOT="${vault_roots[0]}"
    MEDIA_SCRATCH_ROOT="${scratch_roots[0]}"

    MEDIA_MOVIES_DIR="$MEDIA_VAULT_ROOT/movies"
    MEDIA_SERIES_DIR="$MEDIA_VAULT_ROOT/series"
    MEDIA_MUSIC_DIR="$MEDIA_VAULT_ROOT/music"
    MEDIA_AUDIOBOOKS_DIR="$MEDIA_VAULT_ROOT/audiobooks"

    MEDIA_SCRATCH_LIBRARY_ROOT="${MEDIA_SCRATCH_LIBRARY_ROOT:-$MEDIA_SCRATCH_ROOT/media}"
    MEDIA_SCRATCH_MOVIES_DIR="$MEDIA_SCRATCH_LIBRARY_ROOT/movies"
    MEDIA_SCRATCH_SERIES_DIR="$MEDIA_SCRATCH_LIBRARY_ROOT/series"
    MEDIA_SCRATCH_MUSIC_DIR="$MEDIA_SCRATCH_LIBRARY_ROOT/music"
    MEDIA_SCRATCH_AUDIOBOOKS_DIR="$MEDIA_SCRATCH_LIBRARY_ROOT/audiobooks"

    MEDIA_DOWNLOADS_DIR="$MEDIA_SCRATCH_ROOT/downloads"
    MEDIA_DOWNLOADS_MOVIES_DIR="$MEDIA_DOWNLOADS_DIR/movies"
    MEDIA_DOWNLOADS_SERIES_DIR="$MEDIA_DOWNLOADS_DIR/series"
    MEDIA_DOWNLOADS_MANUAL_DIR="$MEDIA_DOWNLOADS_DIR/manual"
    MEDIA_SMALL_DOWNLOADS_DIR="${MEDIA_SMALL_DOWNLOADS_DIR:-$DRIVES_C_DIR/Download/Home-Server/small}"
    MEDIA_IMPORT_REVIEW_DIR="$MEDIA_SCRATCH_ROOT/review"
    MEDIA_IMPORT_LOG_DIR="$MEDIA_SCRATCH_ROOT/logs"
    MEDIA_TRANSCODE_DIR="$MEDIA_SCRATCH_ROOT/cache/jellyfin"
    MEDIA_MISC_CACHE_DIR="$MEDIA_SCRATCH_ROOT/cache/misc"
    MEDIA_IPTV_CACHE_DIR="$MEDIA_SCRATCH_ROOT/iptv-cache"
    MEDIA_IPTV_EPG_DIR="$MEDIA_SCRATCH_ROOT/iptv-epg"
    MEDIA_QBIT_TMP_DIR="$MEDIA_SCRATCH_ROOT/tmp/qbittorrent"

    export MEDIA_VAULT_ROOTS MEDIA_SCRATCH_ROOTS MEDIA_VAULT_ROOT MEDIA_SCRATCH_ROOT
    export MEDIA_MOVIES_DIR MEDIA_SERIES_DIR MEDIA_MUSIC_DIR MEDIA_AUDIOBOOKS_DIR
    export MEDIA_SCRATCH_LIBRARY_ROOT MEDIA_SCRATCH_MOVIES_DIR MEDIA_SCRATCH_SERIES_DIR
    export MEDIA_SCRATCH_MUSIC_DIR MEDIA_SCRATCH_AUDIOBOOKS_DIR
    export MEDIA_DOWNLOADS_DIR MEDIA_DOWNLOADS_MOVIES_DIR MEDIA_DOWNLOADS_SERIES_DIR MEDIA_DOWNLOADS_MANUAL_DIR
    export MEDIA_SMALL_DOWNLOADS_DIR MEDIA_SMALL_DOWNLOADS_MAX_MB
    export MEDIA_IMPORT_REVIEW_DIR MEDIA_IMPORT_LOG_DIR MEDIA_TRANSCODE_DIR MEDIA_MISC_CACHE_DIR
    export MEDIA_IPTV_CACHE_DIR MEDIA_IPTV_EPG_DIR MEDIA_QBIT_TMP_DIR
    export MEDIA_IMPORT_ABORT_FREE_GB MEDIA_VAULT_WARN_FREE_GB MEDIA_SCRATCH_WARN_FREE_GB
    export MEDIA_SCRATCH_WARN_USED_PERCENT MEDIA_SCRATCH_RETENTION_DAYS MEDIA_SCRATCH_MIN_FREE_GB
    export MEDIA_SCRATCH_CLEANUP_ENABLED MEDIA_IMPORTER_CMD MEDIA_WORKFLOW_SERVICE_CMD

    mkdir -p \
        "$MEDIA_ROOT" \
        "$MEDIA_MOVIES_DIR" \
        "$MEDIA_SERIES_DIR" \
        "$MEDIA_MUSIC_DIR" \
        "$MEDIA_AUDIOBOOKS_DIR" \
        "$MEDIA_SCRATCH_LIBRARY_ROOT" \
        "$MEDIA_SCRATCH_MOVIES_DIR" \
        "$MEDIA_SCRATCH_SERIES_DIR" \
        "$MEDIA_SCRATCH_MUSIC_DIR" \
        "$MEDIA_SCRATCH_AUDIOBOOKS_DIR" \
        "$MEDIA_DOWNLOADS_DIR" \
        "$MEDIA_DOWNLOADS_MOVIES_DIR" \
        "$MEDIA_DOWNLOADS_SERIES_DIR" \
        "$MEDIA_DOWNLOADS_MANUAL_DIR" \
        "$MEDIA_SMALL_DOWNLOADS_DIR" \
        "$MEDIA_IMPORT_REVIEW_DIR" \
        "$MEDIA_IMPORT_LOG_DIR" \
        "$MEDIA_TRANSCODE_DIR" \
        "$MEDIA_MISC_CACHE_DIR" \
        "$MEDIA_IPTV_CACHE_DIR" \
        "$MEDIA_IPTV_EPG_DIR" \
        "$MEDIA_QBIT_TMP_DIR"

    ensure_compat_link "movies" "$MEDIA_MOVIES_DIR" || return 1
    ensure_compat_link "series" "$MEDIA_SERIES_DIR" || return 1
    ensure_compat_link "music" "$MEDIA_MUSIC_DIR" || return 1
    ensure_compat_link "audiobooks" "$MEDIA_AUDIOBOOKS_DIR" || return 1
    ensure_compat_link "downloads" "$MEDIA_DOWNLOADS_DIR" || return 1
    ensure_compat_link "iptv-cache" "$MEDIA_IPTV_CACHE_DIR" || return 1
    ensure_compat_link "iptv-epg" "$MEDIA_IPTV_EPG_DIR" || return 1

    if [ -d "$MEDIA_ROOT/downloads" ] && [ ! -L "$MEDIA_ROOT/downloads" ] && [ "$MEDIA_LAYOUT_AUTO_ADOPT_EMPTY" = "true" ] && ! directory_has_payload "$MEDIA_ROOT/downloads"; then
        rm -rf "$MEDIA_ROOT/downloads"
        ensure_compat_link "downloads" "$MEDIA_DOWNLOADS_DIR" || return 1
    fi

    vault_free_gb="$(path_free_gb "$MEDIA_VAULT_ROOT")"
    local vault_fs_type=""
    vault_fs_type="$(path_fs_type "$MEDIA_VAULT_ROOT")"
    if fs_type_is_non_external "$vault_fs_type"; then
        log_info_detail "Skipping vault import-floor check on non-external fs ($vault_fs_type): $MEDIA_VAULT_ROOT"
    elif [ "$vault_free_gb" -lt "$MEDIA_IMPORT_ABORT_FREE_GB" ]; then
        log_warn "Vault free space ${vault_free_gb}GiB is below import abort floor ${MEDIA_IMPORT_ABORT_FREE_GB}GiB"
        if [ "$MEDIA_LAYOUT_STRICT" = "true" ]; then
            return 1
        fi
    fi

    if [ "$START_COMPACT_LOG" = "true" ]; then
        log_info "Tiered media layout ready (compat=$MEDIA_ROOT vault=$MEDIA_VAULT_ROOT scratch=$MEDIA_SCRATCH_ROOT)"
    else
        log_info "Tiered media layout ready"
        log_info "  Compatibility root: $MEDIA_ROOT"
        log_info "  Vault roots: $MEDIA_VAULT_ROOTS"
        log_info "  Scratch roots: $MEDIA_SCRATCH_ROOTS"
        log_info "  Primary vault root: $MEDIA_VAULT_ROOT"
        log_info "  Primary scratch root: $MEDIA_SCRATCH_ROOT"
        log_info "  Scratch library root: $MEDIA_SCRATCH_LIBRARY_ROOT"
        log_info "  Small downloads dir: $MEDIA_SMALL_DOWNLOADS_DIR"
    fi

    return 0
}

ensure_media_layout() {
    if ! apply_storage_layout_exports; then
        log_error "Tiered media layout preflight failed"
        if [ "$MEDIA_LAYOUT_STRICT" = "true" ] || [ "$MEDIA_PREFLIGHT_FAIL_CLOSED" = "true" ]; then
            return 1
        fi
        log_warn "Continuing startup with existing media paths because strict/fail-closed mode is disabled"
        return 0
    fi
}

ensure_bootstrap_ssh_key() {
    local pubkey_path="$SSHD_AUTHORIZED_KEY_PATH"
    local ssh_dir="$USER_HOME/.ssh"
    local auth_keys="$ssh_dir/authorized_keys"
    local pubkey_line=""

    mkdir -p "$ssh_dir"
    chmod 700 "$ssh_dir"
    touch "$auth_keys"
    chmod 600 "$auth_keys"

    [ -f "$pubkey_path" ] || return 0

    pubkey_line="$(grep -Ev '^[[:space:]]*(#|$)' "$pubkey_path" | head -1 || true)"
    [ -n "$pubkey_line" ] || return 0

    if ! grep -Fqx "$pubkey_line" "$auth_keys" 2>/dev/null; then
        printf '%s\n' "$pubkey_line" >> "$auth_keys"
        log_info "Added bootstrap SSH key from $pubkey_path"
    fi
}

normalize_sshd_auth_mode() {
    case "$SSHD_AUTH_MODE" in
        key_only|password_only|password_and_key)
            printf '%s\n' "$SSHD_AUTH_MODE"
            ;;
        *)
            log_warn "Unknown SSHD_AUTH_MODE=$SSHD_AUTH_MODE; falling back to password_and_key"
            printf 'password_and_key\n'
            ;;
    esac
}

ssh_expected_auth_flags() {
    local normalized_mode=""

    normalized_mode="$(normalize_sshd_auth_mode)"
    case "$normalized_mode" in
        key_only)
            printf 'yes\nno\nno\n'
            ;;
        password_only)
            printf 'no\nyes\nyes\n'
            ;;
        password_and_key)
            printf 'yes\nyes\nyes\n'
            ;;
    esac
}

ssh_policy_payload() {
    local auth_flags=""
    local pubkey_auth=""
    local password_auth=""
    local kbd_auth=""

    auth_flags="$(ssh_expected_auth_flags)"
    pubkey_auth="$(printf '%s\n' "$auth_flags" | sed -n '1p')"
    password_auth="$(printf '%s\n' "$auth_flags" | sed -n '2p')"
    kbd_auth="$(printf '%s\n' "$auth_flags" | sed -n '3p')"

    cat <<EOF
Port $SSHD_PORT
ListenAddress $SSHD_BIND_HOST
PubkeyAuthentication $pubkey_auth
PasswordAuthentication $password_auth
KbdInteractiveAuthentication $kbd_auth
EOF
}

ssh_policy_hash() {
    ssh_policy_payload | sha256sum | awk '{print $1}'
}

render_managed_sshd_config() {
    local config_hash=""

    config_hash="$(ssh_policy_hash)"
    cat <<EOF
# managed-by home-server/start.sh
# source-hash: $config_hash
$(ssh_policy_payload)
EOF
}

sync_managed_sshd_config() {
    local config_dir=""
    local tmp_file=""
    local config_hash=""

    config_dir="$(dirname "$SSHD_MANAGED_CONFIG_PATH")"
    mkdir -p "$config_dir"
    tmp_file="$(mktemp "$config_dir/50-home-server-managed.conf.XXXXXX")"
    render_managed_sshd_config > "$tmp_file"
    config_hash="$(ssh_policy_hash)"

    if [ -f "$SSHD_MANAGED_CONFIG_PATH" ] && cmp -s "$tmp_file" "$SSHD_MANAGED_CONFIG_PATH"; then
        rm -f "$tmp_file"
        log_info "SSH managed config unchanged (hash=$config_hash)"
        return 1
    fi

    mv "$tmp_file" "$SSHD_MANAGED_CONFIG_PATH"
    chmod 600 "$SSHD_MANAGED_CONFIG_PATH"
    log_info "SSH managed config regenerated (hash=$config_hash)"
    return 0
}

ssh_expected_listenaddress() {
    case "$SSHD_BIND_HOST" in
        '::'|'[::]')
            printf '[::]:%s\n' "$SSHD_PORT"
            ;;
        *)
            printf '%s:%s\n' "$SSHD_BIND_HOST" "$SSHD_PORT"
            ;;
    esac
}

ssh_current_policy_matches() {
    local effective_config=""
    local auth_flags=""
    local expected_listen=""
    local pubkey_expected=""
    local password_expected=""
    local kbd_expected=""

    effective_config="$(sshd -T 2>/dev/null || true)"
    [ -n "$effective_config" ] || return 1

    auth_flags="$(ssh_expected_auth_flags)"
    pubkey_expected="$(printf '%s\n' "$auth_flags" | sed -n '1p')"
    password_expected="$(printf '%s\n' "$auth_flags" | sed -n '2p')"
    kbd_expected="$(printf '%s\n' "$auth_flags" | sed -n '3p')"
    expected_listen="$(ssh_expected_listenaddress)"

    printf '%s\n' "$effective_config" | grep -qx "port $SSHD_PORT" || return 1
    printf '%s\n' "$effective_config" | grep -qx "pubkeyauthentication $pubkey_expected" || return 1
    printf '%s\n' "$effective_config" | grep -qx "passwordauthentication $password_expected" || return 1
    printf '%s\n' "$effective_config" | grep -qx "kbdinteractiveauthentication $kbd_expected" || return 1
    printf '%s\n' "$effective_config" | grep -qx "listenaddress $expected_listen" || return 1
}

sshd_service_running() {
    run_sv status sshd 2>/dev/null | grep -q '^run: sshd:'
}

sshd_process_count() {
    pgrep -x sshd | wc -l | tr -d '[:space:]'
}

sshd_session_count() {
    pgrep -f '/data/data/com.termux/files/usr/libexec/sshd-session' | wc -l | tr -d '[:space:]'
}

stop_unmanaged_sshd() {
    local pid=""
    local attempts=0

    pid="$(pgrep -x sshd | head -1 || true)"
    [ -n "$pid" ] || return 0

    log_warn "Stopping unmanaged sshd (pid $pid) so repo-managed sshd can take over"
    kill "$pid" 2>/dev/null || true
    while [ "$attempts" -lt 10 ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 1
    done

    log_error "SSH failure class=START_TIMEOUT unmanaged sshd pid $pid did not exit"
    return 1
}

log_sshd_diagnostics() {
    local failure_class="$1"
    local service_status=""
    local sshd_count=""
    local session_count=""
    local line=""

    service_status="$(run_sv status sshd 2>/dev/null || echo unavailable)"
    sshd_count="$(sshd_process_count)"
    session_count="$(sshd_session_count)"

    log_error "SSH failure class=$failure_class"
    log_error "SSH supervisor status: $service_status"
    log_error "SSH listener probe host=$(ssh_probe_host "$SSHD_BIND_HOST") port=$SSHD_PORT ready=$(ssh_listener_is_ready "$SSHD_BIND_HOST" "$SSHD_PORT" && printf yes || printf no)"
    log_error "SSH process count: ${sshd_count:-0}"
    log_error "SSH session count: ${session_count:-0}"
    log_error "SSH policy hash: $(ssh_policy_hash)"

    if [ -f "$SSHD_SERVICE_LOG_PATH" ]; then
        while IFS= read -r line; do
            log_error "SSH service log: $line"
        done <<EOF
$(tail -n 50 "$SSHD_SERVICE_LOG_PATH" 2>/dev/null || true)
EOF
    fi
}

wait_for_sshd_supervised() {
    local attempts=0

    log_info "Waiting for sshd on $SSHD_BIND_HOST:$SSHD_PORT"
    while [ "$attempts" -lt 15 ]; do
        if sshd_service_running && ssh_listener_is_ready "$SSHD_BIND_HOST" "$SSHD_PORT"; then
            log_info "sshd is up on $SSHD_BIND_HOST:$SSHD_PORT"
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 1
    done

    log_sshd_diagnostics "START_TIMEOUT"
    return 1
}

stop_repo_sshd() {
    if ! supervisor_is_ready; then
        return 0
    fi

    if sshd_service_running; then
        log_info "Stopping repo-managed sshd"
        run_sv down sshd >/dev/null 2>&1 || true
        rm -f "$SSHD_PID_PATH"
    fi
}

start_tailscale_service() {
    local tailscale_log=""

    if [ "$TAILSCALE_MODE" = "disabled" ] || [ "$TAILSCALE_MODE" = "android_app" ]; then
        return 0
    fi

    if [ ! -x "$TAILSCALE_SERVICE_CMD" ]; then
        log_warn "Skipping Tailscale (helper not found: $TAILSCALE_SERVICE_CMD)"
        return 0
    fi

    tailscale_log="$(service_log_path "tailscale")"
    log_info "Ensuring Tailscale (debug log: $tailscale_log)"
    if ! run_logged_command "Tailscale" "$tailscale_log" "$TAILSCALE_SERVICE_CMD" start; then
        log_warn "Tailscale start failed (check root daemon and Tailscale auth state)"
        log_recent_tail "Tailscale" "$tailscale_log"
        return 0
    fi
}

start_repo_sshd() {
    local config_changed=0
    local sshd_count=0
    local attempts=0

    if [ "$ENABLE_SSHD" != "true" ] || ! command -v sshd >/dev/null 2>&1; then
        stop_repo_sshd
        log_info "sshd disabled in single-port mode"
        return 0
    fi

    ensure_bootstrap_ssh_key
    if ! ensure_service_supervisor; then
        return 1
    fi

    if sync_managed_sshd_config; then
        config_changed=1
    fi

    if ssh_listener_is_ready "$SSHD_BIND_HOST" "$SSHD_PORT"; then
        sshd_count="$(sshd_process_count)"
        if [ "${sshd_count:-0}" = "1" ] && ssh_current_policy_matches; then
            rm -f "$SSHD_PID_PATH"
            if sshd_service_running; then
                log_info "Reusing existing repo-managed sshd on $(ssh_probe_host "$SSHD_BIND_HOST"):$SSHD_PORT"
            else
                log_warn "Reusing unmanaged sshd on $(ssh_probe_host "$SSHD_BIND_HOST"):$SSHD_PORT"
            fi
            return 0
        fi

        if [ "${sshd_count:-0}" = "0" ]; then
            log_sshd_diagnostics "PORT_CONFLICT_NON_SSHD"
            return 1
        fi

        if ! sshd_service_running; then
            if [ "$(sshd_session_count)" = "0" ]; then
                if ! stop_unmanaged_sshd; then
                    return 1
                fi
            else
                log_sshd_diagnostics "POLICY_DRIFT_ACTIVE_SESSIONS"
                return 1
            fi
        fi

        if ssh_listener_is_ready "$SSHD_BIND_HOST" "$SSHD_PORT" && ! sshd_service_running; then
            log_sshd_diagnostics "POLICY_DRIFT"
            return 1
        fi
    fi

    if sshd_service_running; then
        log_info "Restarting repo-managed sshd"
        run_sv down sshd >/dev/null 2>&1 || true
        while [ "$attempts" -lt 10 ]; do
            if ! ssh_listener_is_ready "$SSHD_BIND_HOST" "$SSHD_PORT"; then
                break
            fi
            attempts=$((attempts + 1))
            sleep 1
        done
    else
        log_info "Starting sshd"
    fi

    run_sv up sshd >/dev/null 2>&1 || true
    if ! wait_for_sshd_supervised; then
        if [ "$config_changed" -eq 1 ]; then
            log_error "SSH managed config changed immediately before startup"
        fi
        log_sshd_diagnostics "SSHD_BIND_FAILURE"
        return 1
    fi

    rm -f "$SSHD_PID_PATH"
    return 0
}

start_repo_sshd_optional() {
    local attempt=0
    local retry_delay=0
    local max_attempts=0
    local recovered=0

    if start_repo_sshd; then
        return 0
    fi

    if [ "$BOOT_OPTIONAL_SSH" != "true" ]; then
        return 1
    fi

    retry_delay="$SSHD_RETRY_INITIAL_DELAY_SECONDS"
    if ! [[ "$retry_delay" =~ ^[0-9]+$ ]] || [ "$retry_delay" -lt 1 ]; then
        retry_delay=5
    fi

    if ! [[ "$SSHD_RETRY_MAX_DELAY_SECONDS" =~ ^[0-9]+$ ]] || [ "$SSHD_RETRY_MAX_DELAY_SECONDS" -lt "$retry_delay" ]; then
        SSHD_RETRY_MAX_DELAY_SECONDS="$retry_delay"
    fi
    max_attempts="$SSHD_RETRY_MAX_ATTEMPTS"
    if ! [[ "$max_attempts" =~ ^[0-9]+$ ]] || [ "$max_attempts" -lt 1 ]; then
        max_attempts=20
    fi

    log_warn "Optional SSH startup failed; continuing core startup in degraded mode"

    (
        while [ "$attempt" -lt "$max_attempts" ]; do
            attempt=$((attempt + 1))
            log_warn "Optional SSH retry scheduled in ${retry_delay}s (attempt=${attempt})"
            sleep "$retry_delay"

            if start_repo_sshd; then
                recovered=1
                log_info "Optional SSH recovered on retry attempt ${attempt}"
                break
            fi

            if [ "$retry_delay" -lt "$SSHD_RETRY_MAX_DELAY_SECONDS" ]; then
                retry_delay=$((retry_delay * 2))
                if [ "$retry_delay" -gt "$SSHD_RETRY_MAX_DELAY_SECONDS" ]; then
                    retry_delay="$SSHD_RETRY_MAX_DELAY_SECONDS"
                fi
            fi
        done
        if [ "$recovered" -ne 1 ]; then
            log_error "Optional SSH retries exhausted after ${attempt} attempts; leaving SSH in degraded mode"
        fi
    ) &

    return 0
}

stop_managed_services() {
    log_info "Cleaning old processes"
    stop_pidfile_process "backend" "$BACKEND_PID_PATH"
    stop_pidfile_process "frontend" "$FRONTEND_PID_PATH"
    stop_pidfile_process "ttyd" "$TTYD_PID_PATH"
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
    stop_pidfile_process "flarearr" "$FLAREARR_PID_PATH"
    stop_pidfile_process "jellyseerr" "$JELLYSEERR_PID_PATH"
    stop_pidfile_process "llm" "$LLM_PID_PATH"
    stop_pidfile_process "media-workflow" "$MEDIA_WORKFLOW_PID_PATH"
    stop_pidfile_process "storage-watchdog" "$STORAGE_WATCHDOG_PID_PATH"
    stop_repo_nginx
}

stop_legacy_services() {
    stop_matching_process "backend" "$PROJECT/server/index.js"
    stop_matching_process "backend" "node $PROJECT/server/index.js"
    stop_matching_process "backend" "npm --prefix $PROJECT/server run start"
    stop_matching_process "backend" "node $PROJECT/server/src/main/start-server.js"
    stop_matching_process "backend" "node src/main/start-server.js"
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
    stop_matching_process "flarearr" "flaresolverr.py"
    stop_matching_process "jellyseerr" "server/index.js"
    stop_matching_process "llm" "llama-server"
    stop_matching_process "media-workflow" "media-workflow-service.sh run-loop"
}

reload_launcher() {
    if [ "$RELOAD_REQUESTED" -eq 1 ]; then
        return 0
    fi

    RELOAD_REQUESTED=1
    printf '\n'
    log_info "Reload requested from keyboard"
    stop_hotkey_listener
    stop_managed_services
    stop_legacy_services
    exec "$SCRIPT_PATH" "${START_ARGS[@]}"
}

start_hotkey_listener() {
    local parent_pid="$BASHPID"

    if [ ! -t 0 ] || [ ! -t 1 ]; then
        return 0
    fi

    log_info "Press R to reload services"
    (
        while IFS= read -r -s -n 1 key; do
            case "$key" in
                [Rr])
                    kill -USR1 "$parent_pid" 2>/dev/null || true
                    exit 0
                    ;;
            esac
        done
    ) &
    HOTKEY_PID=$!
}

start_background_command() {
    local name="$1"
    local port="$2"
    local pid_file="$3"
    local command_string="$4"
    local host="${5:-127.0.0.1}"
    local pid=""
    local debug_log=""

    debug_log="$(service_log_path "$name")"
    log_info "Starting $name (debug log: $debug_log)"
    bash -lc "$command_string" &
    pid=$!
    printf '%s\n' "$pid" > "$pid_file"
    wait_for_port "$port" "$name" "$pid_file" "$host"
}

start_llm_service() {
    local llm_log=""

    if [ "$LLM_AUTO_START" != "true" ]; then
        log_info "Local LLM autostart disabled"
        return 0
    fi

    if [ ! -x "$LLM_SERVICE_CMD" ]; then
        log_warn "Skipping Local LLM (service helper not found: $LLM_SERVICE_CMD)"
        return 0
    fi

    llm_log="$(service_log_path "llm")"
    log_info "Starting Local LLM (debug log: $llm_log)"
    if ! run_logged_command "Local LLM" "$llm_log" "$LLM_SERVICE_CMD" start; then
        log_warn "Local LLM start failed (install llama-cpp and configure a GGUF model)"
        log_recent_tail "Local LLM" "$llm_log"
        return 0
    fi

    if ! wait_for_port "$LLM_PORT" "Local LLM" "$LLM_PID_PATH" "$LLM_BIND_HOST"; then
        log_warn "Local LLM failed to listen on $LLM_BIND_HOST:$LLM_PORT (see $LOG_DIR/llm.log)"
    fi
}

start_service_helper() {
    local name="$1"
    local script_path="$2"
    local port="$3"
    local pid_file="$4"
    local host="$5"
    local helper_log=""
    local service_key=""
    local wait_timeout="$START_WAIT_TIMEOUT_SECONDS"

    if [ ! -x "$script_path" ]; then
        log_warn "Skipping $name (helper not found: $script_path)"
        return 0
    fi

    helper_log="$(service_log_path "$name")"
    service_key="$(slugify_log_name "$name")"
    [ -n "$service_key" ] || service_key="service"
    case "$service_key" in
        sonarr|radarr|prowlarr)
            wait_timeout="$START_WAIT_ARR_TIMEOUT_SECONDS"
            ;;
        postgresql)
            wait_timeout="$START_WAIT_POSTGRES_TIMEOUT_SECONDS"
            ;;
    esac
    if type sfq_is_cooldown_active >/dev/null 2>&1 && sfq_is_cooldown_active "$RUNTIME_DIR" "$service_key"; then
        local cooldown_left=0
        cooldown_left="$(sfq_remaining_cooldown "$RUNTIME_DIR" "$service_key" 2>/dev/null || echo 0)"
        log_warn "Skipping $name due to fail-quiet cooldown (${cooldown_left}s remaining)"
        return 0
    fi

    log_info "Starting $name (debug log: $helper_log)"
    if ! run_logged_command "$name" "$helper_log" "$script_path" start; then
        log_warn "$name start helper returned non-zero; verifying listener health before marking failure"
        if wait_for_port "$port" "$name" "$pid_file" "$host" "$wait_timeout" "$script_path"; then
            log_warn "$name appears healthy despite helper non-zero exit; continuing"
            if type sfq_mark_success >/dev/null 2>&1; then
                sfq_mark_success "$RUNTIME_DIR" "$service_key"
            fi
            return 0
        fi

        log_warn "$name start failed (see $helper_log)"
        if type sfq_record_failure >/dev/null 2>&1; then
            sfq_record_failure "$RUNTIME_DIR" "$service_key" "$helper_log" "service helper returned non-zero during start"
        fi
        log_recent_tail "$name" "$helper_log"
        return 0
    fi

    if ! wait_for_port "$port" "$name" "$pid_file" "$host" "$wait_timeout" "$script_path"; then
        log_warn "$name failed to listen on $host:$port"
        if type sfq_record_failure >/dev/null 2>&1; then
            sfq_record_failure "$RUNTIME_DIR" "$service_key" "$helper_log" "listener not ready after service start"
        fi
        return 0
    fi

    if type sfq_mark_success >/dev/null 2>&1; then
        sfq_mark_success "$RUNTIME_DIR" "$service_key"
    fi
}

start_worker_helper() {
    local name="$1"
    local script_path="$2"
    local pid_file="$3"
    local helper_log=""

    if [ ! -x "$script_path" ]; then
        log_warn "Skipping $name (helper not found: $script_path)"
        return 0
    fi

    helper_log="$(service_log_path "$name")"
    log_info "Starting $name (debug log: $helper_log)"
    if ! run_logged_command "$name" "$helper_log" "$script_path" start; then
        log_warn "$name start failed (see $helper_log)"
        log_recent_tail "$name" "$helper_log"
        return 0
    fi

    if [ -f "$pid_file" ]; then
        local pid=""
        pid="$(cat "$pid_file" 2>/dev/null || true)"
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi

    log_warn "$name did not report a running pid"
    return 0
}

start_media_stack_services() {
    start_service_helper "Redis" "$REDIS_SERVICE_CMD" 6379 "$REDIS_PID_PATH" "127.0.0.1"
    start_service_helper "PostgreSQL" "$POSTGRES_SERVICE_CMD" 5432 "$POSTGRES_PID_PATH" "127.0.0.1"

    if [ "$START_MEDIA_STAGE_DELAY_SECONDS" -gt 0 ]; then
        log_info "Staging non-core media stack startup delay (${START_MEDIA_STAGE_DELAY_SECONDS}s)"
        sleep "$START_MEDIA_STAGE_DELAY_SECONDS"
    fi

    if [ "$EXTERNAL_ROLE_MOUNTS_READY" = "true" ]; then
        start_service_helper "Jellyfin" "$JELLYFIN_SERVICE_CMD" 8096 "$JELLYFIN_PID_PATH" "127.0.0.1"
    else
        log_warn "Skipping Jellyfin (external vault drive not mounted)"
    fi
    start_service_helper "qBittorrent" "$QBITTORRENT_SERVICE_CMD" 8081 "$QBITTORRENT_PID_PATH" "127.0.0.1"

    start_service_helper "Sonarr" "$SONARR_SERVICE_CMD" 8989 "$SONARR_PID_PATH" "127.0.0.1"
    start_service_helper "Radarr" "$RADARR_SERVICE_CMD" 7878 "$RADARR_PID_PATH" "127.0.0.1"
    start_service_helper "Prowlarr" "$PROWLARR_SERVICE_CMD" 9696 "$PROWLARR_PID_PATH" "127.0.0.1"

    if [ "$EXTERNAL_ROLE_MOUNTS_READY" = "true" ]; then
        start_service_helper "Bazarr" "$BAZARR_SERVICE_CMD" 6767 "$BAZARR_PID_PATH" "127.0.0.1"
    else
        log_warn "Skipping Bazarr (vault drive not mounted)"
    fi

    start_service_helper "FlareArr" "$FLAREARR_SERVICE_CMD" 8191 "$FLAREARR_PID_PATH" "127.0.0.1"

    if [ -f "$HOME/services/jellyseerr/app/dist/index.js" ]; then
        start_service_helper "Jellyseerr" "$JELLYSEERR_SERVICE_CMD" 5055 "$JELLYSEERR_PID_PATH" "127.0.0.1"
    fi

    if [ -x "$CONFIGURE_ARR_STACK_CMD" ]; then
        local arr_log=""
        arr_log="$(service_log_path "arr-stack-reconcile")"
        log_info "Reconciling ARR, subtitles, and request-stack integrations"
        if ! run_logged_command "ARR stack reconcile" "$arr_log" "$CONFIGURE_ARR_STACK_CMD"; then
            log_warn "ARR stack reconciliation failed (see $arr_log)"
            log_recent_tail "ARR stack reconcile" "$arr_log"
        fi
    fi

    start_worker_helper "Storage watchdog" "$STORAGE_WATCHDOG_SERVICE_CMD" "$STORAGE_WATCHDOG_PID_PATH"
    start_worker_helper "Media workflow sweeper" "$MEDIA_WORKFLOW_SERVICE_CMD" "$MEDIA_WORKFLOW_PID_PATH"
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
    local origins
    local host_ip
    local ip
    local ip_list=""

    append_origin() {
        local candidate="$1"
        [ -n "$candidate" ] || return 0
        case ",$origins," in
            *",$candidate,"*) ;;
            *) origins="${origins},${candidate}" ;;
        esac
    }

    origins="127.0.0.1,localhost"

    if command -v ifconfig >/dev/null 2>&1; then
        ip_list="$(ifconfig 2>/dev/null | awk '/inet / { print $2 }' | grep -v '^127\.' || true)"
    fi

    if [ -z "$ip_list" ] && command -v ip >/dev/null 2>&1; then
        ip_list="$(ip -o -4 addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -v '^127\.' || true)"
    fi

    if [ -z "$ip_list" ]; then
        host_ip="$(detect_host_ip)"
        ip_list="$host_ip"
    fi

    while IFS= read -r ip; do
        [ -n "$ip" ] || continue
        append_origin "$ip"
        append_origin "${ip}:3000"
        append_origin "${ip}:8088"
        append_origin "http://${ip}"
        append_origin "http://${ip}:3000"
        append_origin "http://${ip}:8088"
    done <<EOF
$ip_list
EOF

    append_origin "http://127.0.0.1"
    append_origin "http://127.0.0.1:3000"
    append_origin "http://127.0.0.1:8088"
    append_origin "http://localhost"
    append_origin "http://localhost:3000"
    append_origin "http://localhost:8088"

    printf '%s\n' "$origins"
}

HOST_IP="$(detect_host_ip)"
ALLOWED_DEV_ORIGINS="${ALLOWED_DEV_ORIGINS:-$(build_allowed_dev_origins)}"
acquire_start_lock
trap 'release_start_lock' EXIT

log_info "Starting Home Server"
warn_conflicting_boot_scripts

stop_drive_watcher
prepare_drives_root
bootstrap_drive_mounts
export HMSTX_EXTERNAL_DRIVES_READY="$EXTERNAL_ROLE_MOUNTS_READY"
DRIVE_MIRROR_MODE=""
DRIVE_MIRROR_ENTRIES_JSON="[]"
DRIVE_MIRROR_ALIASES_JSON="[]"
DRIVE_MIRROR_REASON=""
ensure_termux_drive_mirror DRIVE_MIRROR_MODE DRIVE_MIRROR_ENTRIES_JSON DRIVE_MIRROR_ALIASES_JSON DRIVE_MIRROR_REASON
case "$DRIVE_MIRROR_MODE" in
    preferred-mirror)
        log_info "Host drive mirror ready at $TERMUX_DRIVES_MIRROR_ROOT"
        ;;
    *)
        log_warn "Host drive mirror degraded; falling back to $DRIVES_DIR${DRIVE_MIRROR_REASON:+ ($DRIVE_MIRROR_REASON)}"
        ;;
esac
if printf '%s\n' "$DRIVE_MIRROR_ALIASES_JSON" | grep -Fq 'conflict-active-mount'; then
    log_warn "Legacy D/E alias cleanup found active conflicting mountpoints under $DRIVES_DIR"
fi
sync_cloud_mount_links
ensure_termux_drive_mirror DRIVE_MIRROR_MODE DRIVE_MIRROR_ENTRIES_JSON DRIVE_MIRROR_ALIASES_JSON DRIVE_MIRROR_REASON
case "$DRIVE_MIRROR_MODE" in
    preferred-mirror)
        log_info "Host drive mirror refreshed after FTP link sync"
        ;;
    *)
        log_warn "Host drive mirror refresh after FTP link sync fell back to $DRIVES_DIR${DRIVE_MIRROR_REASON:+ ($DRIVE_MIRROR_REASON)}"
        ;;
esac
ensure_media_layout
apply_loopback_lockdown

if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
fi

stop_managed_services
stop_legacy_services
start_tailscale_service
log_info "Checking SSH"
if ! start_repo_sshd_optional; then
    log_error "SSH startup failed and BOOT_OPTIONAL_SSH=false; aborting startup."
    exit 1
fi

if ! ensure_node_dependencies "$PROJECT/server" "backend"; then
    log_error "Backend dependencies check failed; aborting startup."
    exit 1
fi

if ! ensure_node_dependencies "$PROJECT/dashboard" "dashboard"; then
    log_error "Dashboard dependencies check failed; aborting startup."
    exit 1
fi

start_background_command \
    "Backend" \
    "$BACKEND_PORT" \
    "$BACKEND_PID_PATH" \
    "mkdir -p '$LOG_DIR'; exec env NODE_OPTIONS='$SERVER_NODE_OPTIONS' BACKEND_BIND_HOST='$BACKEND_BIND_HOST' PORT='$BACKEND_PORT' npm --prefix '$PROJECT/server' run start --silent > '$LOG_DIR/backend.log' 2>&1" \
    "$BACKEND_BIND_HOST"

start_media_stack_services
start_llm_service

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
    ensure_production_dashboard_build
    start_background_command \
        "Frontend" \
        "$FRONTEND_PORT" \
        "$FRONTEND_PID_PATH" \
        "mkdir -p '$LOG_DIR'; cd '$PROJECT/dashboard' && export NODE_OPTIONS='$DASHBOARD_NODE_OPTIONS' PORT='$FRONTEND_PORT' FRONTEND_BIND_HOST='$FRONTEND_BIND_HOST' ALLOWED_DEV_ORIGINS='$ALLOWED_DEV_ORIGINS'; exec npm start > '$LOG_DIR/frontend.log' 2>&1" \
        "127.0.0.1"
else
    start_background_command \
        "Frontend" \
        "$FRONTEND_PORT" \
        "$FRONTEND_PID_PATH" \
        "mkdir -p '$LOG_DIR'; cd '$PROJECT/dashboard' && export NODE_OPTIONS='$DASHBOARD_NODE_OPTIONS' PORT='$FRONTEND_PORT' FRONTEND_BIND_HOST='$FRONTEND_BIND_HOST' ALLOWED_DEV_ORIGINS='$ALLOWED_DEV_ORIGINS'; exec npm run dev > '$LOG_DIR/frontend.log' 2>&1" \
        "127.0.0.1"
fi

log_info "Home Server started"
if [ "$FRONTEND_BIND_HOST" != "127.0.0.1" ]; then
    printf '[%s] INFO  Frontend:  http://%s:%s\n' "$(timestamp)" "$HOST_IP" "$FRONTEND_PORT"
fi
printf '[%s] INFO  Dashboard: http://%s:8088\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Files:     http://%s:8088/files\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Terminal:  http://%s:8088/term\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Jellyfin:  http://%s:8088/jellyfin/\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  qBittorrent: http://%s:8088/qb/\n' "$(timestamp)" "$HOST_IP"
if [ -f "$HOME/services/jellyseerr/app/dist/index.js" ]; then
    printf '[%s] INFO  Requests:  http://%s:8088/requests/\n' "$(timestamp)" "$HOST_IP"
fi
if [ -f "$HOME/services/flarearr/app/flaresolverr.py" ] || [ -f "$HOME/services/flarearr/app/src/flaresolverr.py" ]; then
    printf '[%s] INFO  FlareArr:  http://%s:8088/flarearr/\n' "$(timestamp)" "$HOST_IP"
fi
printf '[%s] INFO  Network request logs: %s/access.log\n' "$(timestamp)" "$LOG_DIR"
printf '[%s] INFO  Network error logs:   %s/error.log\n' "$(timestamp)" "$LOG_DIR"
printf '[%s] INFO  Follow live requests: tail -f %s/access.log\n' "$(timestamp)" "$LOG_DIR"

trap 'reload_launcher' USR1
trap 'stop_hotkey_listener; release_start_lock' EXIT
start_hotkey_listener

wait
