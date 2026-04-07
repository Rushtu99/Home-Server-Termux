#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

SERVICE_NAME="radarr"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVARR_HELPER="$SCRIPT_DIR/servarr-proot-service.sh"
PROJECT="${PROJECT:-${HOME:-/data/data/com.termux/files/home}/home-server}"
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

export APP_SLUG="radarr"
export APP_NAME="Radarr"
export APP_BINARY_NAME="Radarr"
export APP_PORT="${RADARR_PORT:-7878}"
export APP_BIND_HOST="${RADARR_BIND_HOST:-127.0.0.1}"
export APP_URL_BASE="${RADARR_BASE_PATH:-/radarr}"

is_running() {
    "$SERVARR_HELPER" status >/dev/null 2>&1
}

status_json() {
    local running=false
    local status="stopped"
    local checked_at=""
    local status_code=1

    if is_running; then
        running=true
        status="running"
        status_code=0
    fi

    checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '{"service":"%s","running":%s,"status":"%s","checkedAt":"%s"}\n' \
        "$SERVICE_NAME" \
        "$running" \
        "$status" \
        "$checked_at"

    return "$status_code"
}

if [ "${1:-status}" = "status" ] && [ "${2:-}" = "--json" ]; then
    status_json
    exit $?
fi

"$SERVARR_HELPER" "$@"
