#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPORTER="$SCRIPT_DIR/media-importer.sh"

status_json() {
  if "$IMPORTER" status --json >/dev/null 2>&1; then
    "$IMPORTER" status --json
  else
    printf '{"service":"fs-worker","running":false,"status":"stopped","checkedAt":"%s"}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    return 1
  fi
}

action="${1:-status}"
shift || true

case "$action" in
  start)
    exec "$IMPORTER" run --trigger fs-worker "$@"
    ;;
  stop)
    echo "fs-worker is run-to-completion"
    ;;
  restart)
    exec "$IMPORTER" run --trigger fs-worker "$@"
    ;;
  status)
    if [ "${1:-}" = "--json" ]; then
      status_json
    else
      exec "$IMPORTER" status "$@"
    fi
    ;;
  *)
    echo "usage: fs-worker.sh {start|stop|restart|status [--json]}" >&2
    exit 1
    ;;
esac
