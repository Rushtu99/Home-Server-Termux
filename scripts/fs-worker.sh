#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPORTER="$SCRIPT_DIR/media-importer.sh"
USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
FS_WORKER_STATUS_CACHE_FILE="${FS_WORKER_STATUS_CACHE_FILE:-$RUNTIME_DIR/fs-worker-status.json}"
FS_WORKER_STATUS_CACHE_SECONDS="${FS_WORKER_STATUS_CACHE_SECONDS:-2}"

status_json() {
  local output=""
  local now_epoch=0
  local cache_mtime=0

  if [ -f "$FS_WORKER_STATUS_CACHE_FILE" ]; then
    now_epoch="$(date +%s)"
    cache_mtime="$(stat -c '%Y' "$FS_WORKER_STATUS_CACHE_FILE" 2>/dev/null || echo 0)"
    if [ "$cache_mtime" -gt 0 ] && [ $((now_epoch - cache_mtime)) -lt "$FS_WORKER_STATUS_CACHE_SECONDS" ]; then
      cat "$FS_WORKER_STATUS_CACHE_FILE"
      return 0
    fi
  fi

  if output="$("$IMPORTER" status --json 2>/dev/null)"; then
    mkdir -p "$(dirname "$FS_WORKER_STATUS_CACHE_FILE")"
    printf '%s\n' "$output" > "$FS_WORKER_STATUS_CACHE_FILE"
    printf '%s\n' "$output"
    return 0
  fi

  printf '{"service":"fs-worker","running":false,"status":"stopped","checkedAt":"%s"}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  return 1
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
