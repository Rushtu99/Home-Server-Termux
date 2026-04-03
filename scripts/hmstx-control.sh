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
declare -A PROBE_STATUS=()
declare -A PROBE_EXIT=()
declare -A PROBE_MESSAGE=()
declare -A PROBE_SCRIPT=()
declare -A CORE_RUNNING=()
declare -A CORE_PIDFILE=()
declare -A CORE_LABEL=()

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

usage() {
    cat <<'USAGE'
usage: hmstx-control.sh {start|stop|restart|status|preflight} [--json]

actions:
  start      Start full stack via start.sh
  stop       Stop managed services and core stack processes
  restart    Stop then start full stack
  status     Show stack + managed-service status (supports --json)
  preflight  Run host/config checks (supports --json)
USAGE
}

timestamp_iso() {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

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

probe_core_processes() {
    CORE_LABEL=(
        [nginx]="nginx gateway"
        [backend]="Backend API"
        [frontend]="Dashboard frontend"
        [ttyd]="Terminal (ttyd)"
    )
    CORE_PIDFILE=(
        [nginx]="$NGINX_PID_PATH"
        [backend]="$BACKEND_PID_PATH"
        [frontend]="$FRONTEND_PID_PATH"
        [ttyd]="$TTYD_PID_PATH"
    )
    CORE_RUNNING=()
    STATUS_CORE_RUNNING_COUNT=0
    STATUS_CORE_TOTAL_COUNT=0

    local key=""
    for key in nginx backend frontend ttyd; do
        STATUS_CORE_TOTAL_COUNT=$((STATUS_CORE_TOTAL_COUNT + 1))
        if pidfile_running "${CORE_PIDFILE[$key]}"; then
            CORE_RUNNING["$key"]="true"
            STATUS_CORE_RUNNING_COUNT=$((STATUS_CORE_RUNNING_COUNT + 1))
        else
            CORE_RUNNING["$key"]="false"
        fi
    done
}

probe_service() {
    local key="$1"
    local script_path="${SERVICE_CMD[$key]:-}"
    local status_output=""
    local status_code=0
    local running="false"
    local status="unknown"
    local message=""

    PROBE_SCRIPT["$key"]="$script_path"

    if [ ! -x "$script_path" ]; then
        PROBE_AVAILABLE["$key"]="false"
        PROBE_RUNNING["$key"]="false"
        PROBE_STATUS["$key"]="unavailable"
        PROBE_EXIT["$key"]="127"
        PROBE_MESSAGE["$key"]="helper_not_executable"
        return 0
    fi

    PROBE_AVAILABLE["$key"]="true"

    if status_output="$("$script_path" status --json 2>/dev/null)"; then
        status_code=0
    else
        status_code=$?
    fi

    if [ -z "$status_output" ]; then
        if "$script_path" status >/dev/null 2>&1; then
            status_code=0
            running="true"
            status="working"
        else
            status_code=$?
            running="false"
            if [ "$status_code" -eq 1 ]; then
                status="stopped"
            else
                status="unknown"
                message="status_exit_${status_code}"
            fi
        fi
    else
        case "$status_output" in
            *'"running":true'*)
                running="true"
                ;;
            *)
                running="false"
                ;;
        esac

        case "$status_output" in
            *'"status":"running"'*)
                status="working"
                ;;
            *'"status":"stopped"'*)
                status="stopped"
                ;;
            *)
                if [ "$running" = "true" ]; then
                    status="working"
                else
                    status="stopped"
                fi
                ;;
        esac

        if [ "$status_code" -ne 0 ] && [ "$status_code" -ne 1 ]; then
            status="unknown"
            message="status_json_exit_${status_code}"
        fi
    fi

    PROBE_RUNNING["$key"]="$running"
    PROBE_STATUS["$key"]="$status"
    PROBE_EXIT["$key"]="$status_code"
    PROBE_MESSAGE["$key"]="$message"
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
            working)
                STATUS_AVAILABLE_COUNT=$((STATUS_AVAILABLE_COUNT + 1))
                STATUS_WORKING_COUNT=$((STATUS_WORKING_COUNT + 1))
                ;;
            stopped)
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

    if [ "$STATUS_UNAVAILABLE_COUNT" -gt 0 ] && [ "$STATUS_WORKING_COUNT" -eq 0 ]; then
        printf 'unavailable\n'
        return 0
    fi

    if [ "$STATUS_AVAILABLE_COUNT" -eq 0 ]; then
        printf 'unavailable\n'
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

        services_json+="${sep}{\"key\":\"$(json_escape "$key")\",\"label\":\"$(json_escape "$label")\",\"script\":\"$(json_escape "$script_path")\",\"available\":${PROBE_AVAILABLE[$key]:-false},\"running\":${PROBE_RUNNING[$key]:-false},\"status\":\"$(json_escape "${PROBE_STATUS[$key]:-unknown}")\",\"exitCode\":${PROBE_EXIT[$key]:-1},\"message\":\"$(json_escape "$message")\"}"
        sep=","
    done

    printf '%s' "$services_json"
}

build_core_json() {
    local core_json=""
    local sep=""
    local key=""
    local label=""
    local pid_path=""

    for key in nginx backend frontend ttyd; do
        label="${CORE_LABEL[$key]:-$key}"
        pid_path="${CORE_PIDFILE[$key]:-}"
        core_json+="${sep}{\"key\":\"$(json_escape "$key")\",\"label\":\"$(json_escape "$label")\",\"pidFile\":\"$(json_escape "$pid_path")\",\"running\":${CORE_RUNNING[$key]:-false}}"
        sep=","
    done

    printf '%s' "$core_json"
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
    local overall=""

    overall="$(compute_overall_status)"
    printf '{"action":"status","checkedAt":"%s","overall":"%s","summary":{"coreRunning":%s,"coreTotal":%s,"working":%s,"stopped":%s,"unknown":%s,"unavailable":%s},"core":[%s],"services":[%s]}\n' \
        "$(timestamp_iso)" \
        "$overall" \
        "$STATUS_CORE_RUNNING_COUNT" \
        "$STATUS_CORE_TOTAL_COUNT" \
        "$STATUS_WORKING_COUNT" \
        "$STATUS_STOPPED_COUNT" \
        "$STATUS_UNKNOWN_COUNT" \
        "$STATUS_UNAVAILABLE_COUNT" \
        "$(build_core_json)" \
        "$(build_services_json)"
}

run_service_action() {
    local action="$1"
    local key=""
    local script_path=""
    local label=""
    local fail_count=0
    local ok_count=0
    local skip_count=0

    if [ "$action" = "stop" ]; then
        for ((idx=${#SERVICE_ORDER[@]} - 1; idx >= 0; idx -= 1)); do
            key="${SERVICE_ORDER[$idx]}"
            label="${SERVICE_LABEL[$key]:-$key}"
            script_path="${SERVICE_CMD[$key]:-}"

            if [ ! -x "$script_path" ]; then
                printf '[SKIP] %s (%s not executable)\n' "$label" "$script_path"
                skip_count=$((skip_count + 1))
                continue
            fi

            if "$script_path" "$action"; then
                printf '[ OK ] %s %s\n' "$label" "$action"
                ok_count=$((ok_count + 1))
            else
                printf '[FAIL] %s %s\n' "$label" "$action" >&2
                fail_count=$((fail_count + 1))
            fi
        done
    else
        for key in "${SERVICE_ORDER[@]}"; do
            label="${SERVICE_LABEL[$key]:-$key}"
            script_path="${SERVICE_CMD[$key]:-}"

            if [ ! -x "$script_path" ]; then
                printf '[SKIP] %s (%s not executable)\n' "$label" "$script_path"
                skip_count=$((skip_count + 1))
                continue
            fi

            if "$script_path" "$action"; then
                printf '[ OK ] %s %s\n' "$label" "$action"
                ok_count=$((ok_count + 1))
            else
                printf '[FAIL] %s %s\n' "$label" "$action" >&2
                fail_count=$((fail_count + 1))
            fi
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
    local name="$1"
    local level="$2"
    local ok="$3"
    local message="$4"

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
    local key=""
    local script_path=""

    PREFLIGHT_PASS_COUNT=0
    PREFLIGHT_WARN_COUNT=0
    PREFLIGHT_FAIL_COUNT=0
    PREFLIGHT_CHECK_NAMES=()
    PREFLIGHT_CHECK_LEVELS=()
    PREFLIGHT_CHECK_OK=()
    PREFLIGHT_CHECK_MESSAGES=()

    if [ "$(id -u)" -eq 0 ]; then
        add_preflight_check "termux-user" "fail" "false" "Run as the Termux app user, not root."
    else
        add_preflight_check "termux-user" "fail" "true" "Using non-root Termux user."
    fi

    if [ -d "$PROJECT" ]; then
        add_preflight_check "project-dir" "fail" "true" "$PROJECT"
    else
        add_preflight_check "project-dir" "fail" "false" "Project directory is missing: $PROJECT"
    fi

    if [ -d "$PROJECT/scripts" ]; then
        add_preflight_check "scripts-dir" "fail" "true" "$PROJECT/scripts"
    else
        add_preflight_check "scripts-dir" "fail" "false" "Scripts directory is missing: $PROJECT/scripts"
    fi

    if [ -d "$TERMUX_PREFIX" ]; then
        add_preflight_check "termux-prefix" "warn" "true" "$TERMUX_PREFIX"
    else
        add_preflight_check "termux-prefix" "warn" "false" "Expected Termux prefix missing: $TERMUX_PREFIX"
    fi

    if command -v node >/dev/null 2>&1; then
        add_preflight_check "node" "fail" "true" "$(command -v node)"
    else
        add_preflight_check "node" "fail" "false" "node is required for dashboard/API stack"
    fi

    if command -v npm >/dev/null 2>&1; then
        add_preflight_check "npm" "fail" "true" "$(command -v npm)"
    else
        add_preflight_check "npm" "fail" "false" "npm is required for dashboard/API stack"
    fi

    if command -v su >/dev/null 2>&1; then
        add_preflight_check "su" "warn" "true" "$(command -v su)"
    else
        add_preflight_check "su" "warn" "false" "su is required for Samba and Servarr chroot actions"
    fi

    if command -v nginx >/dev/null 2>&1; then
        add_preflight_check "nginx" "warn" "true" "$(command -v nginx)"
    else
        add_preflight_check "nginx" "warn" "false" "nginx is not installed; gateway start will be skipped"
    fi

    if [ -f "$SERVER_ENV_FILE" ]; then
        add_preflight_check "server-env" "warn" "true" "$SERVER_ENV_FILE"
    else
        add_preflight_check "server-env" "warn" "false" "Missing server env file: $SERVER_ENV_FILE"
    fi

    if [ -x "$START_SCRIPT" ] || [ -f "$START_SCRIPT" ]; then
        add_preflight_check "start-script" "fail" "true" "$START_SCRIPT"
    else
        add_preflight_check "start-script" "fail" "false" "Missing start script: $START_SCRIPT"
    fi

    for key in "${SERVICE_ORDER[@]}"; do
        script_path="${SERVICE_CMD[$key]:-}"

        if [ -x "$script_path" ]; then
            add_preflight_check "helper:$key" "fail" "true" "$script_path"
            if bash -n "$script_path" >/dev/null 2>&1; then
                add_preflight_check "syntax:$key" "fail" "true" "bash -n passed"
            else
                add_preflight_check "syntax:$key" "fail" "false" "bash -n failed for $script_path"
            fi
        else
            add_preflight_check "helper:$key" "fail" "false" "Helper missing or not executable: $script_path"
        fi
    done

    if bash -n "$0" >/dev/null 2>&1; then
        add_preflight_check "syntax:hmstx-control" "fail" "true" "bash -n passed"
    else
        add_preflight_check "syntax:hmstx-control" "fail" "false" "bash -n failed for $0"
    fi

    collect_service_state
    for key in "${SERVICE_ORDER[@]}"; do
        if [ "${PROBE_STATUS[$key]:-unknown}" = "unknown" ]; then
            add_preflight_check "status:$key" "warn" "false" "Status probe failed (${PROBE_MESSAGE[$key]:-unknown error})"
        fi
    done
}

build_preflight_checks_json() {
    local checks_json=""
    local sep=""
    local idx=0

    for ((idx=0; idx<${#PREFLIGHT_CHECK_NAMES[@]}; idx+=1)); do
        checks_json+="${sep}{\"name\":\"$(json_escape "${PREFLIGHT_CHECK_NAMES[$idx]}")\",\"level\":\"$(json_escape "${PREFLIGHT_CHECK_LEVELS[$idx]}")\",\"ok\":${PREFLIGHT_CHECK_OK[$idx]},\"message\":\"$(json_escape "${PREFLIGHT_CHECK_MESSAGES[$idx]}")\"}"
        sep=","
    done

    printf '%s' "$checks_json"
}

emit_preflight_text() {
    local idx=0
    local indicator=""

    printf 'hmstx preflight: pass=%s warn=%s fail=%s\n' "$PREFLIGHT_PASS_COUNT" "$PREFLIGHT_WARN_COUNT" "$PREFLIGHT_FAIL_COUNT"

    for ((idx=0; idx<${#PREFLIGHT_CHECK_NAMES[@]}; idx+=1)); do
        if [ "${PREFLIGHT_CHECK_OK[$idx]}" = "true" ]; then
            indicator="OK"
        elif [ "${PREFLIGHT_CHECK_LEVELS[$idx]}" = "warn" ]; then
            indicator="WARN"
        else
            indicator="FAIL"
        fi

        printf '  [%s] %s: %s\n' "$indicator" "${PREFLIGHT_CHECK_NAMES[$idx]}" "${PREFLIGHT_CHECK_MESSAGES[$idx]}"
    done

    emit_status_text
}

emit_preflight_json() {
    local overall="ok"

    if [ "$PREFLIGHT_FAIL_COUNT" -gt 0 ]; then
        overall="failed"
    elif [ "$PREFLIGHT_WARN_COUNT" -gt 0 ]; then
        overall="warn"
    fi

    printf '{"action":"preflight","checkedAt":"%s","overall":"%s","summary":{"pass":%s,"warn":%s,"fail":%s},"checks":[%s],"services":[%s]}\n' \
        "$(timestamp_iso)" \
        "$overall" \
        "$PREFLIGHT_PASS_COUNT" \
        "$PREFLIGHT_WARN_COUNT" \
        "$PREFLIGHT_FAIL_COUNT" \
        "$(build_preflight_checks_json)" \
        "$(build_services_json)"
}

ACTION="${1:-status}"
if [ "$#" -gt 0 ]; then
    shift
fi
JSON_OUTPUT=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --json)
            JSON_OUTPUT=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

case "$ACTION" in
    start|stop|restart|status|preflight)
        ;;
    -h|--help)
        usage
        exit 0
        ;;
    *)
        echo "unknown action: $ACTION" >&2
        usage >&2
        exit 1
        ;;
esac

if [ "$JSON_OUTPUT" -eq 1 ] && [ "$ACTION" != "status" ] && [ "$ACTION" != "preflight" ]; then
    echo "--json is only supported with status or preflight" >&2
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
        if [ "$JSON_OUTPUT" -eq 1 ]; then
            emit_status_json
        else
            emit_status_text
        fi

        if [ "$(compute_overall_status)" = "working" ]; then
            exit 0
        fi
        exit 1
        ;;
    preflight)
        run_preflight_checks
        if [ "$JSON_OUTPUT" -eq 1 ]; then
            emit_preflight_json
        else
            emit_preflight_text
        fi

        if [ "$PREFLIGHT_FAIL_COUNT" -eq 0 ]; then
            exit 0
        fi
        exit 1
        ;;
esac
