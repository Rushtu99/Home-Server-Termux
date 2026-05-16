#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SCRIPTS_DIR="$PROJECT/scripts"
FORMAT="text"
CHECK_TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [ "${1:-}" = "--json" ]; then
  FORMAT="json"
fi

SERVICES=(
  "backend:backend-service.sh"
  "frontend:frontend-service.sh"
  "nginx:nginx-service.sh"
  "ttyd:ttyd-service.sh"
  "tailscale:tailscale-service.sh"
  "redis:redis-service.sh"
  "postgresql:postgres-service.sh"
  "llm:llm-service.sh"
  "mount:mount-service.sh"
  "storage-watchdog:storage-watchdog-service.sh"
  "media-workflow:media-workflow-service.sh"
  "qbittorrent:qbittorrent-service.sh"
  "jellyfin:jellyfin-service.sh"
  "sonarr:sonarr-service.sh"
  "radarr:radarr-service.sh"
  "prowlarr:prowlarr-service.sh"
  "bazarr:bazarr-service.sh"
  "jellyseerr:jellyseerr-service.sh"
  "flarearr:flarearr-service.sh"
  "copyparty:copyparty-service.sh"
  "samba:samba-service.sh"
  "syncthing:syncthing-service.sh"
  "logging:logging-service.sh"
  "metrics:metrics-service.sh"
)

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

check_one() {
  local name="$1"
  local script="$2"
  local path="$SCRIPTS_DIR/$script"
  local output=""
  local code=1
  local status="stopped"

  if [ ! -f "$path" ]; then
    if [ "$FORMAT" = "json" ]; then
      printf '{"service":"%s","running":false,"status":"missing","checkedAt":"%s"}' "$name" "$CHECK_TS"
    else
      printf '%-18s %s\n' "$name" "missing ($script)"
    fi
    return 0
  fi

  if output="$(bash "$path" status --json 2>/dev/null)"; then
    code=0
  else
    code=$?
  fi

  if [ -n "$output" ] && [[ "$output" == \{*\} ]]; then
    if [ "$FORMAT" = "json" ]; then
      printf '%s' "$output"
    else
      if printf '%s' "$output" | rg -q '"running"[[:space:]]*:[[:space:]]*true'; then
        status="running"
      elif printf '%s' "$output" | rg -q '"status"[[:space:]]*:[[:space:]]*"working"'; then
        status="working"
      elif printf '%s' "$output" | rg -q '"status"[[:space:]]*:[[:space:]]*"degraded"'; then
        status="degraded"
      elif printf '%s' "$output" | rg -q '"status"[[:space:]]*:[[:space:]]*"stalled"'; then
        status="stalled"
      elif printf '%s' "$output" | rg -q '"status"[[:space:]]*:[[:space:]]*"unavailable"'; then
        status="unavailable"
      elif printf '%s' "$output" | rg -q '"status"[[:space:]]*:[[:space:]]*"external"'; then
        status="external"
      else
        status="stopped"
      fi
      printf '%-18s %s\n' "$name" "$status"
    fi
    return 0
  fi

  if bash "$path" status >/dev/null 2>&1; then
    code=0
    status="running"
  else
    code=$?
    status="stopped"
  fi

  if [ "$FORMAT" = "json" ]; then
    if [ "$code" -eq 0 ]; then
      printf '{"service":"%s","running":true,"status":"running","checkedAt":"%s"}' "$name" "$CHECK_TS"
    else
      printf '{"service":"%s","running":false,"status":"stopped","checkedAt":"%s"}' "$name" "$CHECK_TS"
    fi
  else
    printf '%-18s %s\n' "$name" "$status"
  fi
}

if [ "$FORMAT" = "json" ]; then
  printf '{"checkedAt":"%s","services":[' "$CHECK_TS"
  first=1
  for item in "${SERVICES[@]}"; do
    name="${item%%:*}"
    script="${item#*:}"
    result="$(check_one "$name" "$script")"
    if [ "$first" -eq 1 ]; then
      first=0
    else
      printf ','
    fi
    printf '%s' "$result"
  done
  printf ']}\n'
else
  printf '%-18s %s\n' "SERVICE" "STATE"
  printf '%-18s %s\n' "-------" "-----"
  for item in "${SERVICES[@]}"; do
    name="${item%%:*}"
    script="${item#*:}"
    check_one "$name" "$script"
  done
fi
