#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
PROJECT="${PROJECT:-$(cd "$(dirname "$0")/../.." && pwd)}"
exec "$PROJECT/core/service-adapter.sh" "qbittorrent" "discover" "$@"
