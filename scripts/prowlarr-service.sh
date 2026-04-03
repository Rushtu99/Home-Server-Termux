#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

SERVICE_NAME="prowlarr"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVARR_HELPER="$SCRIPT_DIR/servarr-proot-service.sh"

export APP_SLUG="prowlarr"
export APP_NAME="Prowlarr"
export APP_BINARY_NAME="Prowlarr"
export APP_PORT="${PROWLARR_PORT:-9696}"
export APP_BIND_HOST="${PROWLARR_BIND_HOST:-127.0.0.1}"
export APP_URL_BASE="${PROWLARR_BASE_PATH:-/prowlarr}"

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
