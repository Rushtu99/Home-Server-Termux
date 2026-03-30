#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

export APP_SLUG="prowlarr"
export APP_NAME="Prowlarr"
export APP_BINARY_NAME="Prowlarr"
export APP_PORT="${PROWLARR_PORT:-9696}"
export APP_BIND_HOST="${PROWLARR_BIND_HOST:-127.0.0.1}"
export APP_URL_BASE="${PROWLARR_BASE_PATH:-/prowlarr}"

"$(dirname "$0")/servarr-proot-service.sh" "$@"
