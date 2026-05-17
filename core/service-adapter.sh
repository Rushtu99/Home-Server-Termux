#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/utils/env.sh"
. "$SCRIPT_DIR/logging/lib.sh"
. "$SCRIPT_DIR/state/lib.sh"
. "$SCRIPT_DIR/events/lib.sh"

service="${1:?service required}"
action="${2:?action required}"
shift 2 || true

legacy_script_for() {
  case "$1" in
    filesystem) printf '%s\n' "$PROJECT/scripts/mount-service.sh" ;;
    backend) printf '%s\n' "$PROJECT/scripts/backend-service.sh" ;;
    frontend) printf '%s\n' "$PROJECT/scripts/frontend-service.sh" ;;
    nginx) printf '%s\n' "$PROJECT/scripts/nginx-service.sh" ;;
    qbittorrent) printf '%s\n' "$PROJECT/scripts/qbittorrent-service.sh" ;;
    jellyfin) printf '%s\n' "$PROJECT/scripts/jellyfin-service.sh" ;;
    sonarr) printf '%s\n' "$PROJECT/scripts/sonarr-service.sh" ;;
    radarr) printf '%s\n' "$PROJECT/scripts/radarr-service.sh" ;;
    bazarr) printf '%s\n' "$PROJECT/scripts/bazarr-service.sh" ;;
    prowlarr) printf '%s\n' "$PROJECT/scripts/prowlarr-service.sh" ;;
    flarearr) printf '%s\n' "$PROJECT/scripts/flarearr-service.sh" ;;
    llama_cpp) printf '%s\n' "$PROJECT/scripts/llama-cpp-service.sh" ;;
    *) return 1 ;;
  esac
}

run_legacy() {
  local script=""
  script="$(legacy_script_for "$service")" || { echo "unknown service: $service" >&2; return 1; }
  [ -f "$script" ] || { echo "missing legacy wrapper: $script" >&2; return 1; }
  bash "$script" "$@"
}

case "$action" in
  start|stop|restart)
    hs_log_line services "$service" info "$action requested"
    hs_emit "service.$action.requested" "$service"
    if run_legacy "$action" "$@"; then
      if run_legacy status >/dev/null 2>&1; then
        hs_state_write_service "$service" running "" unknown
      else
        hs_state_write_service "$service" stopped "" unknown
      fi
      hs_emit "service.$action.completed" "$service"
      hs_log_line services "$service" info "$action completed"
    else
      hs_state_write_service "$service" stopped "" unhealthy "$action failed"
      hs_emit "service.$action.failed" "$service" "{\"reason\":\"command failed\"}"
      hs_log_line services "$service" error "$action failed"
      exit 1
    fi
    ;;
  status)
    hs_state_cleanup_stale_pid "$service"
    if run_legacy status "$@"; then
      hs_state_write_service "$service" running "" unknown
      exit 0
    fi
    hs_state_write_service "$service" stopped "" unknown
    exit 1
    ;;
  health)
    if run_legacy status --json >/dev/null 2>&1 || run_legacy status >/dev/null 2>&1; then
      hs_state_write_service "$service" running "" healthy
      printf '{"service":"%s","healthy":true,"checkedAt":"%s"}\n' "$service" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      exit 0
    fi
    hs_state_write_service "$service" stopped "" unhealthy
    printf '{"service":"%s","healthy":false,"checkedAt":"%s"}\n' "$service" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    exit 1
    ;;
  discover)
    case "$service" in
      filesystem) "$PROJECT/core/filesystem/discover.sh" ;;
      qbittorrent)
        printf '{"service":"qbittorrent","downloadDir":"%s","configDir":"%s","sessionDir":"%s"}\n' \
          "${MEDIA_DOWNLOADS_TORRENT_QBIT_DIR:-}" "${QBITTORRENT_HOME:-$USER_HOME/services/qbittorrent}" "${QBITTORRENT_HOME:-$USER_HOME/services/qbittorrent}/qBittorrent/BT_backup" ;;
      jellyfin)
        printf '{"service":"jellyfin","mediaRoot":"%s","configDir":"%s","cacheDir":"%s"}\n' \
          "${MEDIA_ROOT:-$USER_HOME/Drives/Media}" "${JELLYFIN_HOME:-$USER_HOME/services/jellyfin}/config" "${JELLYFIN_CACHE_DIR:-}" ;;
      llama_cpp)
        printf '{"service":"llama_cpp","binary":"%s","modelsDir":"%s"}\n' \
          "${LLAMA_CPP_BIN:-${LLM_BIN:-llama-server}}" "${LLM_MODELS_DIR:-$USER_HOME/models}" ;;
      nginx)
        printf '{"service":"nginx","frontend":"%s","backend":"http://%s:%s","config":"%s"}\n' \
          "$PROJECT/dashboard" "${BACKEND_BIND_HOST:-127.0.0.1}" "${PORT:-${BACKEND_PORT:-4000}}" "$PROJECT/nginx.conf" ;;
      *) printf '{"service":"%s","discoverable":true}\n' "$service" ;;
    esac
    ;;
  config)
    printf '{"service":"%s","project":"%s","env":"%s"}\n' "$service" "$PROJECT" "$SERVER_ENV_FILE"
    ;;
  *)
    echo "usage: service-adapter.sh <service> {start|stop|restart|status|health|discover|config}" >&2
    exit 2
    ;;
esac
