#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

export APP_SLUG="sonarr"
export APP_NAME="Sonarr"
export APP_BINARY_NAME="Sonarr"
export APP_PORT="${SONARR_PORT:-8989}"
export APP_BIND_HOST="${SONARR_BIND_HOST:-127.0.0.1}"
export APP_URL_BASE="${SONARR_BASE_PATH:-/sonarr}"

"$(dirname "$0")/servarr-proot-service.sh" "$@"
