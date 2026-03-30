#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

export APP_SLUG="radarr"
export APP_NAME="Radarr"
export APP_BINARY_NAME="Radarr"
export APP_PORT="${RADARR_PORT:-7878}"
export APP_BIND_HOST="${RADARR_BIND_HOST:-127.0.0.1}"
export APP_URL_BASE="${RADARR_BASE_PATH:-/radarr}"

"$(dirname "$0")/servarr-proot-service.sh" "$@"
