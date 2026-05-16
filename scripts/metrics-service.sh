#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
STATE_FILE="${STATE_FILE:-$RUNTIME_DIR/metrics-service.state}"

mkdir -p "$RUNTIME_DIR"

set_state() {
  printf '%s\n' "$1" > "$STATE_FILE"
}

get_state() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE"
  else
    printf 'stopped\n'
  fi
}

status_json() {
  local state
  state="$(get_state)"
  local running=false
  if [ "$state" = "running" ]; then
    running=true
  fi
  printf '{"service":"metrics-service","running":%s,"status":"%s","checkedAt":"%s"}\n' \
    "$running" "$state" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  [ "$running" = true ]
}

case "${1:-status}" in
  start)
    set_state running
    echo "metrics-service marked running"
    ;;
  stop)
    set_state stopped
    echo "metrics-service marked stopped"
    ;;
  restart)
    set_state running
    echo "metrics-service marked running"
    ;;
  status)
    if [ "${2:-}" = "--json" ]; then
      status_json
    else
      get_state
    fi
    ;;
  *)
    echo "usage: metrics-service.sh {start|stop|restart|status [--json]}" >&2
    exit 1
    ;;
esac
