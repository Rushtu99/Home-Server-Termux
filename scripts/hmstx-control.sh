#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"
TERMUX_PREFIX="${TERMUX_PREFIX:-/data/data/com.termux/files/usr}"
START_SCRIPT="${START_SCRIPT:-$PROJECT/start.sh}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
NGINX_PID_PATH="${NGINX_PID_PATH:-$RUNTIME_DIR/nginx.pid}"
BACKEND_PID_PATH="${BACKEND_PID_PATH:-$RUNTIME_DIR/backend.pid}"
FRONTEND_PID_PATH="${FRONTEND_PID_PATH:-$RUNTIME_DIR/frontend.pid}"
TTYD_PID_PATH="${TTYD_PID_PATH:-$RUNTIME_DIR/ttyd.pid}"
SSHD_PID_PATH="${SSHD_PID_PATH:-$RUNTIME_DIR/sshd.pid}"

SERVICE_ORDER=(
    redis
    postgres
    jellyfin
    qbittorrent
    sonarr
    radarr
    prowlarr
    bazarr
    jellyseerr
    copyparty
    syncthing
    samba
    llm
)

declare -A SERVICE_LABEL=(
    [redis]="Redis"
    [postgres]="PostgreSQL"
    [jellyfin]="Jellyfin"
    [qbittorrent]="qBittorrent"
    [sonarr]="Sonarr"
    [radarr]="Radarr"
    [prowlarr]="Prowlarr"
    [bazarr]="Bazarr"
    [jellyseerr]="Jellyseerr"
    [copyparty]="copyparty"
    [syncthing]="Syncthing"
    [samba]="Samba"
    [llm]="Local LLM"
)

declare -A SERVICE_CMD=(
    [redis]="${REDIS_SERVICE_CMD:-$PROJECT/scripts/redis-service.sh}"
    [postgres]="${POSTGRES_SERVICE_CMD:-$PROJECT/scripts/postgres-service.sh}"
    [jellyfin]="${JELLYFIN_SERVICE_CMD:-$PROJECT/scripts/jellyfin-service.sh}"
    [qbittorrent]="${QBITTORRENT_SERVICE_CMD:-$PROJECT/scripts/qbittorrent-service.sh}"
    [sonarr]="${SONARR_SERVICE_CMD:-$PROJECT/scripts/sonarr-service.sh}"
    [radarr]="${RADARR_SERVICE_CMD:-$PROJECT/scripts/radarr-service.sh}"
    [prowlarr]="${PROWLARR_SERVICE_CMD:-$PROJECT/scripts/prowlarr-service.sh}"
    [bazarr]="${BAZARR_SERVICE_CMD:-$PROJECT/scripts/bazarr-service.sh}"
    [jellyseerr]="${JELLYSEERR_SERVICE_CMD:-$PROJECT/scripts/jellyseerr-service.sh}"
    [copyparty]="${COPYPARTY_SERVICE_CMD:-$PROJECT/scripts/copyparty-service.sh}"
    [syncthing]="${SYNCTHING_SERVICE_CMD:-$PROJECT/scripts/syncthing-service.sh}"
    [samba]="${SAMBA_SERVICE_CMD:-$PROJECT/scripts/samba-service.sh}"
    [llm]="${LLM_SERVICE_CMD:-$PROJECT/scripts/llm-service.sh}"
)

declare -A PROBE_AVAILABLE=()
declare -A PROBE_RUNNING=()
declare -A PROBE_TCP=()
declare -A PROBE_STATUS=()
declare -A PROBE_EXIT=()
declare -A PROBE_MESSAGE=()
declare -A PROBE_SCRIPT=()
declare -A PROBE_NOTES=()
declare -A CORE_RUNNING=()
declare -A CORE_PIDFILE=()
declare -A CORE_LABEL=()
declare -A CORE_PID_HEALTHY=()
declare -A CORE_TCP_REACHABLE=()
declare -A CORE_HOST=()
declare -A CORE_PORT=()
declare -A CORE_PROTOCOL=()
declare -A CORE_ROUTE=()
declare -A CORE_AUTH=()
declare -A CORE_EXPECT=()
declare -A CORE_REMOTE=()
declare -A CORE_NOTES=()

declare -A SERVICE_HOST=()
declare -A SERVICE_PORT=()
declare -A SERVICE_PROTOCOL=()
declare -A SERVICE_ROUTE=()
declare -A SERVICE_AUTH=()
declare -A SERVICE_EXPECT=()
declare -A SERVICE_REMOTE=()
declare -A SERVICE_STARTUP=()

STATUS_AVAILABLE_COUNT=0
STATUS_WORKING_COUNT=0
STATUS_STOPPED_COUNT=0
STATUS_UNAVAILABLE_COUNT=0
STATUS_UNKNOWN_COUNT=0
STATUS_CORE_RUNNING_COUNT=0
STATUS_CORE_TOTAL_COUNT=0

PREFLIGHT_PASS_COUNT=0
PREFLIGHT_WARN_COUNT=0
PREFLIGHT_FAIL_COUNT=0
declare -a PREFLIGHT_CHECK_NAMES=()
declare -a PREFLIGHT_CHECK_LEVELS=()
declare -a PREFLIGHT_CHECK_OK=()
declare -a PREFLIGHT_CHECK_MESSAGES=()

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

NGINX_PORT="${NGINX_PORT:-8088}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
BACKEND_BIND_HOST="${BACKEND_BIND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
FRONTEND_BIND_HOST="${FRONTEND_BIND_HOST:-127.0.0.1}"
TTYD_PORT="${TTYD_PORT:-7681}"
TTYD_BIND_HOST="${TTYD_BIND_HOST:-127.0.0.1}"
SSHD_PORT="${SSHD_PORT:-8022}"
SSHD_BIND_HOST="${SSHD_BIND_HOST:-127.0.0.1}"
ENABLE_SSHD="${ENABLE_SSHD:-false}"
FTP_SERVER_PORT="${FTP_SERVER_PORT:-2121}"
FTP_BIND_HOST="${FTP_BIND_HOST:-127.0.0.1}"
COPYPARTY_PORT="${COPYPARTY_PORT:-3923}"
COPYPARTY_BIND_HOST="${COPYPARTY_BIND_HOST:-127.0.0.1}"
SYNCTHING_GUI_PORT="${SYNCTHING_GUI_PORT:-8384}"
SYNCTHING_GUI_BIND_HOST="${SYNCTHING_GUI_BIND_HOST:-127.0.0.1}"
SAMBA_PORT="${SAMBA_PORT:-445}"
JELLYFIN_PORT="${JELLYFIN_PORT:-8096}"
JELLYFIN_BIND_HOST="${JELLYFIN_BIND_HOST:-127.0.0.1}"
QBITTORRENT_PORT="${QBITTORRENT_PORT:-8081}"
QBITTORRENT_BIND_HOST="${QBITTORRENT_BIND_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_BIND_HOST="${REDIS_BIND_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_BIND_HOST="${POSTGRES_BIND_HOST:-127.0.0.1}"
SONARR_PORT="${SONARR_PORT:-8989}"
SONARR_BIND_HOST="${SONARR_BIND_HOST:-127.0.0.1}"
RADARR_PORT="${RADARR_PORT:-7878}"
RADARR_BIND_HOST="${RADARR_BIND_HOST:-127.0.0.1}"
PROWLARR_PORT="${PROWLARR_PORT:-9696}"
PROWLARR_BIND_HOST="${PROWLARR_BIND_HOST:-127.0.0.1}"
BAZARR_PORT="${BAZARR_PORT:-6767}"
BAZARR_BIND_HOST="${BAZARR_BIND_HOST:-127.0.0.1}"
JELLYSEERR_PORT="${JELLYSEERR_PORT:-5055}"
JELLYSEERR_BIND_HOST="${JELLYSEERR_BIND_HOST:-127.0.0.1}"
LLM_PORT="${LLM_PORT:-11435}"
LLM_BIND_HOST="${LLM_BIND_HOST:-127.0.0.1}"
CODEX_REVAMPED_PORT="${CODEX_REVAMPED_PORT:-2455}"
CODEX_REVAMPED_BIND_HOST="${CODEX_REVAMPED_BIND_HOST:-127.0.0.1}"
TAILSCALE_MODE="${TAILSCALE_MODE:-disabled}"
TAILSCALE_DNS_NAME="${TAILSCALE_DNS_NAME:-}"
TAILSCALE_IP="${TAILSCALE_IP:-}"
TAILSCALE_GATEWAY_PORT="${TAILSCALE_GATEWAY_PORT:-8088}"
TAILSCALE_SSH_PORT="${TAILSCALE_SSH_PORT:-8022}"
TAILSCALE_EXPOSE_GATEWAY="${TAILSCALE_EXPOSE_GATEWAY:-true}"
TAILSCALE_EXPOSE_SSH="${TAILSCALE_EXPOSE_SSH:-true}"
TAILSCALE_SERVICE_CMD="${TAILSCALE_SERVICE_CMD:-$PROJECT/scripts/tailscale-service.sh}"

if [ "$TAILSCALE_MODE" != "disabled" ]; then
    SERVICE_ORDER+=(tailscale)
    SERVICE_LABEL[tailscale]="Tailscale"
    SERVICE_CMD[tailscale]="$TAILSCALE_SERVICE_CMD"
fi

SERVICE_HOST[redis]="$REDIS_BIND_HOST"
SERVICE_PORT[redis]="$REDIS_PORT"
SERVICE_PROTOCOL[redis]="tcp"
SERVICE_REMOTE[redis]="none"
SERVICE_STARTUP[redis]="required"

SERVICE_HOST[postgres]="$POSTGRES_BIND_HOST"
SERVICE_PORT[postgres]="$POSTGRES_PORT"
SERVICE_PROTOCOL[postgres]="tcp"
SERVICE_REMOTE[postgres]="none"
SERVICE_STARTUP[postgres]="required"

SERVICE_HOST[jellyfin]="$JELLYFIN_BIND_HOST"
SERVICE_PORT[jellyfin]="$JELLYFIN_PORT"
SERVICE_PROTOCOL[jellyfin]="http"
SERVICE_ROUTE[jellyfin]="/jellyfin/"
SERVICE_AUTH[jellyfin]="public"
SERVICE_EXPECT[jellyfin]="200"
SERVICE_REMOTE[jellyfin]="gateway"
SERVICE_STARTUP[jellyfin]="required"

SERVICE_HOST[qbittorrent]="$QBITTORRENT_BIND_HOST"
SERVICE_PORT[qbittorrent]="$QBITTORRENT_PORT"
SERVICE_PROTOCOL[qbittorrent]="http"
SERVICE_ROUTE[qbittorrent]="/qb/"
SERVICE_AUTH[qbittorrent]="admin"
SERVICE_EXPECT[qbittorrent]="401"
SERVICE_REMOTE[qbittorrent]="gateway"
SERVICE_STARTUP[qbittorrent]="required"

SERVICE_HOST[sonarr]="$SONARR_BIND_HOST"
SERVICE_PORT[sonarr]="$SONARR_PORT"
SERVICE_PROTOCOL[sonarr]="http"
SERVICE_ROUTE[sonarr]="/sonarr/"
SERVICE_AUTH[sonarr]="admin"
SERVICE_EXPECT[sonarr]="401"
SERVICE_REMOTE[sonarr]="gateway"
SERVICE_STARTUP[sonarr]="required"

SERVICE_HOST[radarr]="$RADARR_BIND_HOST"
SERVICE_PORT[radarr]="$RADARR_PORT"
SERVICE_PROTOCOL[radarr]="http"
SERVICE_ROUTE[radarr]="/radarr/"
SERVICE_AUTH[radarr]="admin"
SERVICE_EXPECT[radarr]="401"
SERVICE_REMOTE[radarr]="gateway"
SERVICE_STARTUP[radarr]="required"

SERVICE_HOST[prowlarr]="$PROWLARR_BIND_HOST"
SERVICE_PORT[prowlarr]="$PROWLARR_PORT"
SERVICE_PROTOCOL[prowlarr]="http"
SERVICE_ROUTE[prowlarr]="/prowlarr/"
SERVICE_AUTH[prowlarr]="admin"
SERVICE_EXPECT[prowlarr]="401"
SERVICE_REMOTE[prowlarr]="gateway"
SERVICE_STARTUP[prowlarr]="required"

SERVICE_HOST[bazarr]="$BAZARR_BIND_HOST"
SERVICE_PORT[bazarr]="$BAZARR_PORT"
SERVICE_PROTOCOL[bazarr]="http"
SERVICE_ROUTE[bazarr]="/bazarr/"
SERVICE_AUTH[bazarr]="admin"
SERVICE_EXPECT[bazarr]="401"
SERVICE_REMOTE[bazarr]="gateway"
SERVICE_STARTUP[bazarr]="required"

SERVICE_HOST[jellyseerr]="$JELLYSEERR_BIND_HOST"
SERVICE_PORT[jellyseerr]="$JELLYSEERR_PORT"
SERVICE_PROTOCOL[jellyseerr]="http"
SERVICE_ROUTE[jellyseerr]="/requests/"
SERVICE_AUTH[jellyseerr]="auth"
SERVICE_EXPECT[jellyseerr]="401"
SERVICE_REMOTE[jellyseerr]="gateway"
SERVICE_STARTUP[jellyseerr]="required"

SERVICE_HOST[copyparty]="$COPYPARTY_BIND_HOST"
SERVICE_PORT[copyparty]="$COPYPARTY_PORT"
SERVICE_PROTOCOL[copyparty]="http"
SERVICE_ROUTE[copyparty]="/copyparty/"
SERVICE_AUTH[copyparty]="auth"
SERVICE_EXPECT[copyparty]="401"
SERVICE_REMOTE[copyparty]="gateway"
SERVICE_STARTUP[copyparty]="optional"

SERVICE_HOST[syncthing]="$SYNCTHING_GUI_BIND_HOST"
SERVICE_PORT[syncthing]="$SYNCTHING_GUI_PORT"
SERVICE_PROTOCOL[syncthing]="http"
SERVICE_ROUTE[syncthing]="/syncthing/"
SERVICE_AUTH[syncthing]="admin"
SERVICE_EXPECT[syncthing]="401"
SERVICE_REMOTE[syncthing]="gateway"
SERVICE_STARTUP[syncthing]="optional"

SERVICE_HOST[samba]="127.0.0.1"
SERVICE_PORT[samba]="$SAMBA_PORT"
SERVICE_PROTOCOL[samba]="tcp"
SERVICE_REMOTE[samba]="none"
SERVICE_STARTUP[samba]="optional"

SERVICE_HOST[llm]="$LLM_BIND_HOST"
SERVICE_PORT[llm]="$LLM_PORT"
SERVICE_PROTOCOL[llm]="http"
SERVICE_ROUTE[llm]="/llm/"
SERVICE_AUTH[llm]="admin"
SERVICE_EXPECT[llm]="401"
SERVICE_REMOTE[llm]="gateway"
SERVICE_STARTUP[llm]="optional"

SERVICE_HOST[tailscale]="127.0.0.1"
SERVICE_PORT[tailscale]="0"
SERVICE_PROTOCOL[tailscale]="tcp"
SERVICE_REMOTE[tailscale]="gateway"
SERVICE_STARTUP[tailscale]="${TAILSCALE_MODE:-disabled}"

usage() {
    cat <<'USAGE'
usage: hmstx-control.sh {start|stop|restart|status|preflight|audit} [--json]

actions:
  start      Start full stack via start.sh
  stop       Stop managed services and core stack processes
  restart    Stop then start full stack
  status     Show stack + managed-service status (supports --json)
  preflight  Run host/config checks (supports --json)
  audit      Run network exposure/ports audit (supports --json)
USAGE
}

timestamp_iso() {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

json_escape() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$'\n'/\\n}"
    value="${value//$'\r'/}"
    printf '%s' "$value"
}

require_termux_user() {
    if [ "$(id -u)" -eq 0 ]; then
        echo "hmstx-control must run as the Termux app user (non-root)." >&2
        return 1
    fi
    return 0
}

pidfile_running() {
    local pid_file="$1"
    local pid=""

    [ -f "$pid_file" ] || return 1
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

stop_pidfile_process() {
    local pid_file="$1"
    local pid=""

    [ -f "$pid_file" ] || return 0
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi
    rm -f "$pid_file"
    return 0
}

probe_tcp() {
    python3 - "$1" "$2" <<'PY'
import socket, sys
host = sys.argv[1]
port = int(sys.argv[2])
s = socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(1.2)
try:
    s.connect((host, port))
except Exception:
    print('false')
else:
    print('true')
finally:
    s.close()
PY
}

probe_http_status() {
    python3 - "$1" <<'PY'
import sys, urllib.request, urllib.error
url = sys.argv[1]
req = urllib.request.Request(url, method='GET')
opener = urllib.request.build_opener(urllib.request.HTTPHandler)
try:
    with opener.open(req, timeout=2) as resp:
        print(resp.status)
except urllib.error.HTTPError as exc:
    print(exc.code)
except Exception:
    print(0)
PY
}

join_notes_json() {
    local raw="$1"
    local result=""
    local sep=""
    local note=""
    IFS='|' read -r -a __notes <<< "$raw"
    for note in "${__notes[@]}"; do
        [ -n "$note" ] || continue
        result+="$sep\"$(json_escape "$note")\""
        sep=","
    done
    printf '%s' "$result"
}

probe_core_processes() {
    CORE_LABEL=([nginx]="nginx gateway" [backend]="Backend API" [frontend]="Dashboard frontend" [ttyd]="Terminal (ttyd)")
    CORE_PIDFILE=([nginx]="$NGINX_PID_PATH" [backend]="$BACKEND_PID_PATH" [frontend]="$FRONTEND_PID_PATH" [ttyd]="$TTYD_PID_PATH")
    CORE_HOST=([nginx]="127.0.0.1" [backend]="$BACKEND_BIND_HOST" [frontend]="$FRONTEND_BIND_HOST" [ttyd]="$TTYD_BIND_HOST")
    CORE_PORT=([nginx]="$NGINX_PORT" [backend]="$BACKEND_PORT" [frontend]="$FRONTEND_PORT" [ttyd]="$TTYD_PORT")
    CORE_PROTOCOL=([nginx]="http" [backend]="http" [frontend]="http" [ttyd]="http")
    CORE_ROUTE=([nginx]="/" [backend]="/api/auth/me" [frontend]="/" [ttyd]="/term/")
    CORE_AUTH=([nginx]="public" [backend]="auth" [frontend]="public" [ttyd]="auth")
    CORE_EXPECT=([nginx]="200" [backend]="401" [frontend]="200" [ttyd]="401")
    CORE_REMOTE=([nginx]="gateway" [backend]="gateway" [frontend]="gateway" [ttyd]="gateway")
    STATUS_CORE_RUNNING_COUNT=0
    STATUS_CORE_TOTAL_COUNT=0

    local key="" pid_ok="false" tcp_ok="false" notes=""
    for key in nginx backend frontend ttyd; do
        STATUS_CORE_TOTAL_COUNT=$((STATUS_CORE_TOTAL_COUNT + 1))
        if pidfile_running "${CORE_PIDFILE[$key]}"; then
            pid_ok="true"
        else
            pid_ok="false"
        fi
        tcp_ok="$(probe_tcp "${CORE_HOST[$key]}" "${CORE_PORT[$key]}")"
        notes=""
        if [ "$tcp_ok" = "true" ] && [ "$pid_ok" != "true" ]; then
            notes="Port is reachable but pidfile is stale or missing."
        fi
        if [ "$pid_ok" = "true" ] || [ "$tcp_ok" = "true" ]; then
            CORE_RUNNING[$key]="true"
            STATUS_CORE_RUNNING_COUNT=$((STATUS_CORE_RUNNING_COUNT + 1))
        else
            CORE_RUNNING[$key]="false"
        fi
        CORE_PID_HEALTHY[$key]="$pid_ok"
        CORE_TCP_REACHABLE[$key]="$tcp_ok"
        CORE_NOTES[$key]="$notes"
    done
}

probe_service() {
    local key="$1"
    local script_path="${SERVICE_CMD[$key]:-}"
    local status_output=""
    local status_code=0
    local running="false"
    local tcp_reachable="false"
    local available="true"
    local status="unknown"
    local message=""
    local notes=""
    local startup_mode="${SERVICE_STARTUP[$key]:-optional}"

    PROBE_SCRIPT[$key]="$script_path"

    if [ "$key" = "tailscale" ] && [ "$TAILSCALE_MODE" = "android_app" ]; then
        local reachable="false"
        if [ -n "$TAILSCALE_DNS_NAME" ] || [ -n "$TAILSCALE_IP" ]; then
            reachable="true"
        fi
        PROBE_AVAILABLE[$key]="true"
        PROBE_RUNNING[$key]="$reachable"
        PROBE_TCP[$key]="$reachable"
        PROBE_EXIT[$key]="0"
        PROBE_MESSAGE[$key]="${TAILSCALE_DNS_NAME:-$TAILSCALE_IP}"
        PROBE_NOTES[$key]="$( [ "$reachable" = "true" ] || printf '%s' 'Configure TAILSCALE_DNS_NAME or TAILSCALE_IP for stable remote links.' )"
        PROBE_STATUS[$key]="$( [ "$reachable" = "true" ] && printf 'external' || printf 'degraded' )"
        return 0
    fi

    if [ -n "${SERVICE_PORT[$key]:-}" ] && [ "${SERVICE_PORT[$key]}" != "0" ]; then
        tcp_reachable="$(probe_tcp "${SERVICE_HOST[$key]:-127.0.0.1}" "${SERVICE_PORT[$key]}")"
    fi

    if [ ! -x "$script_path" ]; then
        available="false"
        status_code=127
        message="helper_not_executable"
        if [ "$tcp_reachable" = "true" ]; then
            status="external"
            notes="Port is reachable without a repo-managed helper."
        else
            status="unavailable"
        fi
        PROBE_AVAILABLE[$key]="$available"
        PROBE_RUNNING[$key]="false"
        PROBE_TCP[$key]="$tcp_reachable"
        PROBE_STATUS[$key]="$status"
        PROBE_EXIT[$key]="$status_code"
        PROBE_MESSAGE[$key]="$message"
        PROBE_NOTES[$key]="$notes"
        return 0
    fi

    if status_output="$($script_path status --json 2>/dev/null)"; then
        status_code=0
    else
        status_code=$?
    fi

    if [ -n "$status_output" ]; then
        case "$status_output" in
            *'"running":true'*) running="true" ;;
        esac
        case "$status_output" in
            *'"connected":true'*) running="true" ;;
        esac
        case "$status_output" in
            *'"status":"running"'*|*'"status":"working"'*) status="working" ;;
            *'"status":"stopped"'*) status="stopped" ;;
            *'"status":"external"'*) status="external" ;;
            *) status="unknown" ;;
        esac
    else
        if "$script_path" status >/dev/null 2>&1; then
            status_code=0
            running="true"
            status="working"
        else
            status_code=$?
            status="$( [ "$startup_mode" = "required" ] && printf 'stalled' || printf 'stopped' )"
        fi
    fi

    if [ "$running" != "true" ] && [ "$tcp_reachable" = "true" ]; then
        running="true"
        notes="${notes:+$notes|}Port is reachable; helper state may be stale."
        if [ "$status" = "stopped" ] || [ "$status" = "stalled" ] || [ "$status" = "unknown" ]; then
            status="working"
        fi
    fi

    if [ "$key" = "sshd" ] && [ "$ENABLE_SSHD" != "true" ] && [ "$tcp_reachable" = "true" ]; then
        status="external"
        available="false"
        notes="${notes:+$notes|}Repo-managed sshd is disabled but port ${SSHD_PORT} is open."
    fi

    if [ "$status" = "unknown" ]; then
        if [ "$running" = "true" ]; then
            status="working"
        elif [ "$startup_mode" = "required" ]; then
            status="stalled"
        else
            status="stopped"
        fi
    fi

    PROBE_AVAILABLE[$key]="$available"
    PROBE_RUNNING[$key]="$running"
    PROBE_TCP[$key]="$tcp_reachable"
    PROBE_STATUS[$key]="$status"
    PROBE_EXIT[$key]="$status_code"
    PROBE_MESSAGE[$key]="$message"
    PROBE_NOTES[$key]="$notes"
}

collect_service_state() {
    local key=""

    STATUS_AVAILABLE_COUNT=0
    STATUS_WORKING_COUNT=0
    STATUS_STOPPED_COUNT=0
    STATUS_UNAVAILABLE_COUNT=0
    STATUS_UNKNOWN_COUNT=0
    probe_core_processes

    for key in "${SERVICE_ORDER[@]}"; do
        probe_service "$key"
        case "${PROBE_STATUS[$key]:-unknown}" in
            working|external)
                STATUS_AVAILABLE_COUNT=$((STATUS_AVAILABLE_COUNT + 1))
                STATUS_WORKING_COUNT=$((STATUS_WORKING_COUNT + 1))
                ;;
            stopped|degraded)
                STATUS_AVAILABLE_COUNT=$((STATUS_AVAILABLE_COUNT + 1))
                STATUS_STOPPED_COUNT=$((STATUS_STOPPED_COUNT + 1))
                ;;
            unavailable)
                STATUS_UNAVAILABLE_COUNT=$((STATUS_UNAVAILABLE_COUNT + 1))
                ;;
            *)
                STATUS_AVAILABLE_COUNT=$((STATUS_AVAILABLE_COUNT + 1))
                STATUS_UNKNOWN_COUNT=$((STATUS_UNKNOWN_COUNT + 1))
                ;;
        esac
    done
}

compute_overall_status() {
    if [ "$STATUS_CORE_TOTAL_COUNT" -gt 0 ] && [ "$STATUS_CORE_RUNNING_COUNT" -lt "$STATUS_CORE_TOTAL_COUNT" ]; then
        printf 'stalled\n'
        return 0
    fi
    if [ "$STATUS_UNKNOWN_COUNT" -gt 0 ]; then
        printf 'unknown\n'
        return 0
    fi
    if [ "$STATUS_WORKING_COUNT" -gt 0 ]; then
        printf 'working\n'
        return 0
    fi
    if [ "$STATUS_STOPPED_COUNT" -gt 0 ]; then
        printf 'stopped\n'
        return 0
    fi
    if [ "$STATUS_UNAVAILABLE_COUNT" -gt 0 ]; then
        printf 'unavailable\n'
        return 0
    fi
    printf 'stalled\n'
}

build_services_json() {
    local services_json=""
    local sep=""
    local key=""
    local label=""
    local script_path=""
    local message=""

    for key in "${SERVICE_ORDER[@]}"; do
        label="${SERVICE_LABEL[$key]:-$key}"
        script_path="${PROBE_SCRIPT[$key]:-${SERVICE_CMD[$key]:-}}"
        message="${PROBE_MESSAGE[$key]:-}"
        services_json+="${sep}{\"key\":\"$(json_escape "$key")\",\"label\":\"$(json_escape "$label")\",\"script\":\"$(json_escape "$script_path")\",\"available\":${PROBE_AVAILABLE[$key]:-false},\"running\":${PROBE_RUNNING[$key]:-false},\"tcpReachable\":${PROBE_TCP[$key]:-false},\"status\":\"$(json_escape "${PROBE_STATUS[$key]:-unknown}")\",\"exitCode\":${PROBE_EXIT[$key]:-1},\"message\":\"$(json_escape "$message")\",\"notes\":[$(join_notes_json "${PROBE_NOTES[$key]:-}")] }"
        sep=","
    done
    printf '%s' "$services_json"
}

build_core_json() {
    local core_json=""
    local sep=""
    local key=""
    local status=""
    local observed="0"

    for key in nginx backend frontend ttyd; do
        observed="$(probe_http_status "http://127.0.0.1:${NGINX_PORT}${CORE_ROUTE[$key]}")"
        status="$( [ "${CORE_RUNNING[$key]:-false}" = "true" ] && printf 'working' || printf 'stalled' )"
        core_json+="${sep}{\"key\":\"$(json_escape "$key")\",\"label\":\"$(json_escape "${CORE_LABEL[$key]:-$key}")\",\"pidFile\":\"$(json_escape "${CORE_PIDFILE[$key]:-}")\",\"pidHealthy\":${CORE_PID_HEALTHY[$key]:-false},\"tcpReachable\":${CORE_TCP_REACHABLE[$key]:-false},\"status\":\"$status\",\"bindHost\":\"$(json_escape "${CORE_HOST[$key]:-127.0.0.1}")\",\"port\":${CORE_PORT[$key]:-0},\"protocol\":\"${CORE_PROTOCOL[$key]:-tcp}\",\"routePath\":\"$(json_escape "${CORE_ROUTE[$key]:-}")\",\"authMode\":\"${CORE_AUTH[$key]:-none}\",\"expectedUnauthenticatedStatus\":${CORE_EXPECT[$key]:-0},\"observedUnauthenticatedStatus\":${observed:-0},\"remoteSurface\":\"${CORE_REMOTE[$key]:-none}\",\"notes\":[$(join_notes_json "${CORE_NOTES[$key]:-}")] }"
        sep=","
    done
    printf '%s' "$core_json"
}

build_service_exposure_json() {
    local items=""
    local sep=""
    local key=""
    local observed="0"
    local startup=""
    local route=""
    local notes=""

    for key in "${SERVICE_ORDER[@]}"; do
        route="${SERVICE_ROUTE[$key]:-}"
        observed="0"
        if [ -n "$route" ]; then
            observed="$(probe_http_status "http://127.0.0.1:${NGINX_PORT}${route}")"
        fi
        startup="${SERVICE_STARTUP[$key]:-optional}"
        notes="${PROBE_NOTES[$key]:-}"
        if [ "$key" = "sshd" ] && [ "$ENABLE_SSHD" != "true" ] && [ "$(probe_tcp "$SSHD_BIND_HOST" "$SSHD_PORT")" = "true" ]; then
            notes="${notes:+$notes|}Unmanaged sshd drift detected on configured SSH port."
        fi
        items+="${sep}{\"key\":\"$(json_escape "$key")\",\"label\":\"$(json_escape "${SERVICE_LABEL[$key]:-$key}")\",\"startupMode\":\"$(json_escape "$startup")\",\"protocol\":\"$(json_escape "${SERVICE_PROTOCOL[$key]:-tcp}")\",\"bindHost\":\"$(json_escape "${SERVICE_HOST[$key]:-127.0.0.1}")\",\"port\":${SERVICE_PORT[$key]:-0},\"pidHealthy\":${PROBE_RUNNING[$key]:-false},\"tcpReachable\":${PROBE_TCP[$key]:-false},\"routePath\":\"$(json_escape "$route")\",\"authMode\":\"$(json_escape "${SERVICE_AUTH[$key]:-none}")\",\"expectedUnauthenticatedStatus\":${SERVICE_EXPECT[$key]:-0},\"observedUnauthenticatedStatus\":${observed:-0},\"remoteSurface\":\"$(json_escape "${SERVICE_REMOTE[$key]:-none}")\",\"status\":\"$(json_escape "${PROBE_STATUS[$key]:-unknown}")\",\"notes\":[$(join_notes_json "$notes")] }"
        sep=","
    done
    printf '%s' "$items"
}

build_tailscale_json() {
    local mode="$TAILSCALE_MODE"
    local identity="${TAILSCALE_DNS_NAME:-$TAILSCALE_IP}"
    local connected="false"
    local status="disabled"
    local notes=""

    if [ "$mode" = "android_app" ]; then
        if [ -n "$identity" ]; then
            connected="true"
            status="external"
        else
            status="degraded"
            notes="Configure TAILSCALE_DNS_NAME or TAILSCALE_IP for stable gateway and SSH links."
        fi
    elif [ "$mode" = "managed_daemon" ]; then
        if [ -x "$TAILSCALE_SERVICE_CMD" ]; then
            local raw=""
            if raw="$($TAILSCALE_SERVICE_CMD status --json 2>/dev/null || true)"; then
                case "$raw" in
                    *'"connected":true'*) connected="true" ;;
                esac
                case "$raw" in
                    *'"status":"running"'*|*'"status":"working"'*) status="working" ;;
                    *'"status":"stopped"'*) status="stopped" ;;
                    *) status="degraded" ;;
                esac
                if [ -z "$identity" ]; then
                    identity="$(printf '%s' "$raw" | sed -n 's/.*"dnsName":"\([^"]*\)".*/\1/p' | head -1)"
                fi
            fi
        else
            status="unavailable"
            notes="Managed tailscale helper is missing or not executable."
        fi
    fi

    local gateway_url=""
    local ssh_target=""
    if [ -n "$identity" ]; then
        gateway_url="http://${identity}:${TAILSCALE_GATEWAY_PORT}"
        ssh_target="ssh -p ${TAILSCALE_SSH_PORT} ${USER:-termux}@${identity}"
    fi

    printf '{"mode":"%s","status":"%s","connected":%s,"dnsName":"%s","ip":"%s","gatewayUrl":"%s","sshTarget":"%s","notes":[%s]}' \
        "$(json_escape "$mode")" \
        "$(json_escape "$status")" \
        "$connected" \
        "$(json_escape "$TAILSCALE_DNS_NAME")" \
        "$(json_escape "$TAILSCALE_IP")" \
        "$(json_escape "$gateway_url")" \
        "$(json_escape "$ssh_target")" \
        "$(join_notes_json "$notes")"
}

build_remote_access_json() {
    local identity="${TAILSCALE_DNS_NAME:-$TAILSCALE_IP}"
    local gateway_url=""
    local ssh_target=""
    local gateway_status="disabled"
    local ssh_status="disabled"
    if [ -n "$identity" ]; then
        gateway_url="http://${identity}:${TAILSCALE_GATEWAY_PORT}"
        ssh_target="ssh -p ${TAILSCALE_SSH_PORT} ${USER:-termux}@${identity}"
        [ "$TAILSCALE_EXPOSE_GATEWAY" = "true" ] && gateway_status="preferred"
        [ "$TAILSCALE_EXPOSE_SSH" = "true" ] && ssh_status="preferred"
    fi
    printf '{"preferred":"tailscale","gateway":{"enabled":%s,"port":%s,"url":"%s","status":"%s"},"ssh":{"enabled":%s,"port":%s,"target":"%s","status":"%s"}}' \
        "$( [ "$TAILSCALE_EXPOSE_GATEWAY" = "true" ] && printf true || printf false )" \
        "$TAILSCALE_GATEWAY_PORT" \
        "$(json_escape "$gateway_url")" \
        "$(json_escape "$gateway_status")" \
        "$( [ "$TAILSCALE_EXPOSE_SSH" = "true" ] && printf true || printf false )" \
        "$TAILSCALE_SSH_PORT" \
        "$(json_escape "$ssh_target")" \
        "$(json_escape "$ssh_status")"
}

emit_status_text() {
    local key=""
    local label=""
    local overall=""

    overall="$(compute_overall_status)"
    printf 'hmstx status: %s\n' "$overall"
    printf '  core=%s/%s running\n' "$STATUS_CORE_RUNNING_COUNT" "$STATUS_CORE_TOTAL_COUNT"
    printf '  working=%s stopped=%s unknown=%s unavailable=%s\n' \
        "$STATUS_WORKING_COUNT" \
        "$STATUS_STOPPED_COUNT" \
        "$STATUS_UNKNOWN_COUNT" \
        "$STATUS_UNAVAILABLE_COUNT"

    for key in "${SERVICE_ORDER[@]}"; do
        label="${SERVICE_LABEL[$key]:-$key}"
        printf '  - %-12s %s\n' "$label" "${PROBE_STATUS[$key]:-unknown}"
    done
}

emit_status_json() {
    local overall="$(compute_overall_status)"
    printf '{"action":"status","checkedAt":"%s","overall":"%s","summary":{"coreRunning":%s,"coreTotal":%s,"working":%s,"stopped":%s,"unknown":%s,"unavailable":%s},"core":[%s],"services":[%s]}\n' \
        "$(timestamp_iso)" "$overall" "$STATUS_CORE_RUNNING_COUNT" "$STATUS_CORE_TOTAL_COUNT" "$STATUS_WORKING_COUNT" "$STATUS_STOPPED_COUNT" "$STATUS_UNKNOWN_COUNT" "$STATUS_UNAVAILABLE_COUNT" "$(build_core_json)" "$(build_services_json)"
}

emit_audit_text() {
    local overall="$(compute_overall_status)"
    printf 'hmstx audit: %s\n' "$overall"
    printf '  core=%s/%s reachable\n' "$STATUS_CORE_RUNNING_COUNT" "$STATUS_CORE_TOTAL_COUNT"
    printf '  tailscale=%s\n' "$TAILSCALE_MODE"
    printf '  gateway=http://127.0.0.1:%s\n' "$NGINX_PORT"
}

emit_audit_json() {
    local overall="$(compute_overall_status)"
    printf '{"action":"audit","checkedAt":"%s","overall":"%s","core":[%s],"services":[%s],"tailscale":%s,"remoteAccess":%s}\n' \
        "$(timestamp_iso)" "$overall" "$(build_core_json)" "$(build_service_exposure_json)" "$(build_tailscale_json)" "$(build_remote_access_json)"
}

run_service_action() {
    local action="$1"
    local key="" script_path="" label="" fail_count=0 ok_count=0 skip_count=0

    if [ "$action" = "stop" ]; then
        for ((idx=${#SERVICE_ORDER[@]} - 1; idx >= 0; idx -= 1)); do
            key="${SERVICE_ORDER[$idx]}"
            [ "$key" = "tailscale" ] && [ "$TAILSCALE_MODE" != "managed_daemon" ] && continue
            label="${SERVICE_LABEL[$key]:-$key}"
            script_path="${SERVICE_CMD[$key]:-}"
            if [ ! -x "$script_path" ]; then
                printf '[SKIP] %s (%s not executable)\n' "$label" "$script_path"
                skip_count=$((skip_count + 1))
                continue
            fi
            if "$script_path" "$action"; then ok_count=$((ok_count + 1)); printf '[ OK ] %s %s\n' "$label" "$action"; else fail_count=$((fail_count + 1)); printf '[FAIL] %s %s\n' "$label" "$action" >&2; fi
        done
    else
        for key in "${SERVICE_ORDER[@]}"; do
            [ "$key" = "tailscale" ] && [ "$TAILSCALE_MODE" != "managed_daemon" ] && continue
            label="${SERVICE_LABEL[$key]:-$key}"
            script_path="${SERVICE_CMD[$key]:-}"
            if [ ! -x "$script_path" ]; then
                printf '[SKIP] %s (%s not executable)\n' "$label" "$script_path"
                skip_count=$((skip_count + 1))
                continue
            fi
            if "$script_path" "$action"; then ok_count=$((ok_count + 1)); printf '[ OK ] %s %s\n' "$label" "$action"; else fail_count=$((fail_count + 1)); printf '[FAIL] %s %s\n' "$label" "$action" >&2; fi
        done
    fi
    printf 'hmstx %s summary: ok=%s failed=%s skipped=%s\n' "$action" "$ok_count" "$fail_count" "$skip_count"
    [ "$fail_count" -eq 0 ]
}

start_stack() {
    if [ ! -x "$START_SCRIPT" ] && [ ! -f "$START_SCRIPT" ]; then
        echo "start script not found: $START_SCRIPT" >&2
        return 1
    fi
    exec bash "$START_SCRIPT"
}

stop_stack() {
    run_service_action stop || true
    stop_pidfile_process "$TTYD_PID_PATH" || true
    stop_pidfile_process "$FRONTEND_PID_PATH" || true
    stop_pidfile_process "$BACKEND_PID_PATH" || true
    if command -v nginx >/dev/null 2>&1 && [ -f "$NGINX_PID_PATH" ]; then
        nginx -s quit >/dev/null 2>&1 || true
    fi
    stop_pidfile_process "$NGINX_PID_PATH" || true
    stop_pidfile_process "$SSHD_PID_PATH" || true
    return 0
}

add_preflight_check() {
    local name="$1" level="$2" ok="$3" message="$4"
    PREFLIGHT_CHECK_NAMES+=("$name")
    PREFLIGHT_CHECK_LEVELS+=("$level")
    PREFLIGHT_CHECK_OK+=("$ok")
    PREFLIGHT_CHECK_MESSAGES+=("$message")
    if [ "$ok" = "true" ]; then
        PREFLIGHT_PASS_COUNT=$((PREFLIGHT_PASS_COUNT + 1))
    elif [ "$level" = "warn" ]; then
        PREFLIGHT_WARN_COUNT=$((PREFLIGHT_WARN_COUNT + 1))
    else
        PREFLIGHT_FAIL_COUNT=$((PREFLIGHT_FAIL_COUNT + 1))
    fi
}

run_preflight_checks() {
    local key="" script_path=""
    PREFLIGHT_PASS_COUNT=0; PREFLIGHT_WARN_COUNT=0; PREFLIGHT_FAIL_COUNT=0
    PREFLIGHT_CHECK_NAMES=(); PREFLIGHT_CHECK_LEVELS=(); PREFLIGHT_CHECK_OK=(); PREFLIGHT_CHECK_MESSAGES=()

    [ "$(id -u)" -eq 0 ] && add_preflight_check "termux-user" "fail" "false" "Run as the Termux app user, not root." || add_preflight_check "termux-user" "fail" "true" "Using non-root Termux user."
    [ -d "$PROJECT" ] && add_preflight_check "project-dir" "fail" "true" "$PROJECT" || add_preflight_check "project-dir" "fail" "false" "Project directory is missing: $PROJECT"
    [ -d "$PROJECT/scripts" ] && add_preflight_check "scripts-dir" "fail" "true" "$PROJECT/scripts" || add_preflight_check "scripts-dir" "fail" "false" "Scripts directory is missing: $PROJECT/scripts"
    [ -d "$TERMUX_PREFIX" ] && add_preflight_check "termux-prefix" "warn" "true" "$TERMUX_PREFIX" || add_preflight_check "termux-prefix" "warn" "false" "Expected Termux prefix missing: $TERMUX_PREFIX"
    command -v node >/dev/null 2>&1 && add_preflight_check "node" "fail" "true" "$(command -v node)" || add_preflight_check "node" "fail" "false" "node is required for dashboard/API stack"
    command -v npm >/dev/null 2>&1 && add_preflight_check "npm" "fail" "true" "$(command -v npm)" || add_preflight_check "npm" "fail" "false" "npm is required for dashboard/API stack"
    command -v su >/dev/null 2>&1 && add_preflight_check "su" "warn" "true" "$(command -v su)" || add_preflight_check "su" "warn" "false" "su is required for Samba and Servarr chroot actions"
    command -v nginx >/dev/null 2>&1 && add_preflight_check "nginx" "warn" "true" "$(command -v nginx)" || add_preflight_check "nginx" "warn" "false" "nginx is not installed; gateway start will be skipped"
    [ -f "$SERVER_ENV_FILE" ] && add_preflight_check "server-env" "warn" "true" "$SERVER_ENV_FILE" || add_preflight_check "server-env" "warn" "false" "Missing server env file: $SERVER_ENV_FILE"
    [ -x "$START_SCRIPT" ] || [ -f "$START_SCRIPT" ] && add_preflight_check "start-script" "fail" "true" "$START_SCRIPT" || add_preflight_check "start-script" "fail" "false" "Missing start script: $START_SCRIPT"

    for key in "${SERVICE_ORDER[@]}"; do
        [ "$key" = "tailscale" ] && [ "$TAILSCALE_MODE" = "android_app" ] && continue
        script_path="${SERVICE_CMD[$key]:-}"
        if [ -x "$script_path" ]; then
            add_preflight_check "helper:$key" "fail" "true" "$script_path"
            if bash -n "$script_path" >/dev/null 2>&1; then add_preflight_check "syntax:$key" "fail" "true" "bash -n passed"; else add_preflight_check "syntax:$key" "fail" "false" "bash -n failed for $script_path"; fi
        else
            add_preflight_check "helper:$key" "fail" "false" "Helper missing or not executable: $script_path"
        fi
    done

    if [ "$TAILSCALE_MODE" = "managed_daemon" ]; then
        command -v tailscale >/dev/null 2>&1 && add_preflight_check "tailscale-cli" "warn" "true" "$(command -v tailscale)" || add_preflight_check "tailscale-cli" "warn" "false" "tailscale CLI is missing"
        command -v tailscaled >/dev/null 2>&1 && add_preflight_check "tailscaled" "warn" "true" "$(command -v tailscaled)" || add_preflight_check "tailscaled" "warn" "false" "tailscaled is missing"
        [ -e /dev/net/tun ] && add_preflight_check "tailscale-tun" "warn" "true" "/dev/net/tun" || add_preflight_check "tailscale-tun" "warn" "false" "/dev/net/tun is missing; managed daemon mode will not work"
    fi

    if bash -n "$0" >/dev/null 2>&1; then add_preflight_check "syntax:hmstx-control" "fail" "true" "bash -n passed"; else add_preflight_check "syntax:hmstx-control" "fail" "false" "bash -n failed for $0"; fi
    collect_service_state
}

build_preflight_checks_json() {
    local checks_json="" sep="" idx=0
    for ((idx=0; idx<${#PREFLIGHT_CHECK_NAMES[@]}; idx+=1)); do
        checks_json+="${sep}{\"name\":\"$(json_escape "${PREFLIGHT_CHECK_NAMES[$idx]}")\",\"level\":\"$(json_escape "${PREFLIGHT_CHECK_LEVELS[$idx]}")\",\"ok\":${PREFLIGHT_CHECK_OK[$idx]},\"message\":\"$(json_escape "${PREFLIGHT_CHECK_MESSAGES[$idx]}")\"}"
        sep=","
    done
    printf '%s' "$checks_json"
}

emit_preflight_text() {
    local idx=0 indicator=""
    printf 'hmstx preflight: pass=%s warn=%s fail=%s\n' "$PREFLIGHT_PASS_COUNT" "$PREFLIGHT_WARN_COUNT" "$PREFLIGHT_FAIL_COUNT"
    for ((idx=0; idx<${#PREFLIGHT_CHECK_NAMES[@]}; idx+=1)); do
        if [ "${PREFLIGHT_CHECK_OK[$idx]}" = "true" ]; then indicator="OK"; elif [ "${PREFLIGHT_CHECK_LEVELS[$idx]}" = "warn" ]; then indicator="WARN"; else indicator="FAIL"; fi
        printf '  [%s] %s: %s\n' "$indicator" "${PREFLIGHT_CHECK_NAMES[$idx]}" "${PREFLIGHT_CHECK_MESSAGES[$idx]}"
    done
    emit_status_text
}

emit_preflight_json() {
    local overall="ok"
    [ "$PREFLIGHT_FAIL_COUNT" -gt 0 ] && overall="failed" || { [ "$PREFLIGHT_WARN_COUNT" -gt 0 ] && overall="warn" || true; }
    printf '{"action":"preflight","checkedAt":"%s","overall":"%s","summary":{"pass":%s,"warn":%s,"fail":%s},"checks":[%s],"services":[%s]}\n' \
        "$(timestamp_iso)" "$overall" "$PREFLIGHT_PASS_COUNT" "$PREFLIGHT_WARN_COUNT" "$PREFLIGHT_FAIL_COUNT" "$(build_preflight_checks_json)" "$(build_services_json)"
}

ACTION="${1:-status}"
if [ "$#" -gt 0 ]; then shift; fi
JSON_OUTPUT=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --json) JSON_OUTPUT=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
    esac
    shift
done

case "$ACTION" in
    start|stop|restart|status|preflight|audit) ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown action: $ACTION" >&2; usage >&2; exit 1 ;;
esac

if [ "$JSON_OUTPUT" -eq 1 ] && [ "$ACTION" != "status" ] && [ "$ACTION" != "preflight" ] && [ "$ACTION" != "audit" ]; then
    echo "--json is only supported with status, preflight, or audit" >&2
    exit 1
fi

case "$ACTION" in
    start)
        require_termux_user
        start_stack
        ;;
    stop)
        require_termux_user
        stop_stack
        ;;
    restart)
        require_termux_user
        stop_stack
        start_stack
        ;;
    status)
        collect_service_state
        if [ "$JSON_OUTPUT" -eq 1 ]; then emit_status_json; else emit_status_text; fi
        [ "$(compute_overall_status)" = "working" ] && exit 0 || exit 1
        ;;
    preflight)
        run_preflight_checks
        if [ "$JSON_OUTPUT" -eq 1 ]; then emit_preflight_json; else emit_preflight_text; fi
        [ "$PREFLIGHT_FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
        ;;
    audit)
        collect_service_state
        if [ "$JSON_OUTPUT" -eq 1 ]; then emit_audit_json; else emit_audit_text; fi
        [ "$(compute_overall_status)" = "working" ] && exit 0 || exit 1
        ;;
esac
