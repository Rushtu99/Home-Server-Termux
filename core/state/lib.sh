#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

hs_state_json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

hs_state_pid_alive() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

hs_state_json_field_string() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$file" | head -n 1
}

hs_state_json_field_number() {
  local file="$1" key="$2" value=""
  [ -f "$file" ] || {
    printf '0\n'
    return 0
  }
  value="$(sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" "$file" | head -n 1)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
  else
    printf '0\n'
  fi
}

hs_state_iso_to_epoch() {
  local iso="$1"
  [ -n "$iso" ] || {
    printf '0\n'
    return 0
  }
  date -u -d "$iso" '+%s' 2>/dev/null || printf '0\n'
}

hs_state_write_service() {
  local service="$1" status="$2" pid="${3:-}" health="${4:-unknown}" reason="${5:-}"
  local root="${PROJECT:-$(pwd)}" dir="" now="" started_at="" uptime="0" restart_count="0" current_json=""
  dir="$root/state/services"
  mkdir -p "$dir"
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  current_json="$dir/$service.json"

  if [ -f "$current_json" ]; then
    started_at="$(hs_state_json_field_string "$current_json" "startedAt")"
    restart_count="$(hs_state_json_field_number "$current_json" "restartCount")"
  fi

  if [ "$status" = "running" ]; then
    local started_epoch="0" now_epoch="0"
    [ -n "$started_at" ] || started_at="$now"
    started_epoch="$(hs_state_iso_to_epoch "$started_at")"
    now_epoch="$(date -u '+%s')"
    if [ "$started_epoch" -gt 0 ] && [ "$now_epoch" -ge "$started_epoch" ]; then
      uptime="$((now_epoch - started_epoch))"
    else
      uptime="0"
    fi
  else
    started_at=""
  fi

  printf '%s\n' "$status" > "$dir/$service.status"
  printf '%s\n' "$health" > "$dir/$service.health"
  if [ -n "$pid" ]; then
    printf '%s\n' "$pid" > "$dir/$service.pid"
  elif [ "$status" != "running" ]; then
    rm -f "$dir/$service.pid"
  fi
  cat > "$current_json.tmp.$$" <<JSON
{
  "name": "$(hs_state_json_escape "$service")",
  "status": "$(hs_state_json_escape "$status")",
  "running": $([ "$status" = "running" ] && printf true || printf false),
  "pid": "$(hs_state_json_escape "$pid")",
  "health": "$(hs_state_json_escape "$health")",
  "reason": "$(hs_state_json_escape "$reason")",
  "startedAt": "$(hs_state_json_escape "$started_at")",
  "updatedAt": "$now",
  "lastHealthCheck": "$now",
  "uptimeSec": $uptime,
  "restartCount": $restart_count
}
JSON
  mv -f "$current_json.tmp.$$" "$current_json"
  return 0
}

hs_state_cleanup_stale_pid() {
  local service="$1" root="${PROJECT:-$(pwd)}" dir="" pid_file="" pid=""
  dir="$root/state/services"
  pid_file="$dir/$service.pid"
  [ -f "$pid_file" ] || return 0
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [ -n "$pid" ] && hs_state_pid_alive "$pid"; then
    return 0
  fi
  rm -f "$pid_file"
  hs_state_write_service "$service" stopped "" stale "removed stale pid ${pid:-unknown}"
}
