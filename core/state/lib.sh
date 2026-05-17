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

hs_state_write_service() {
  local service="$1" status="$2" pid="${3:-}" health="${4:-unknown}" reason="${5:-}"
  local root="${PROJECT:-$(pwd)}" dir="" now="" started_at="" uptime="0" restart_count="0" current_json=""
  dir="$root/state/services"
  mkdir -p "$dir"
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  current_json="$dir/$service.json"

  if [ -f "$current_json" ] && command -v node >/dev/null 2>&1; then
    started_at="$(node -e 'const fs=require("fs"); const p=process.argv[1]; try { console.log(JSON.parse(fs.readFileSync(p,"utf8")).startedAt || ""); } catch { console.log(""); }' "$current_json")"
    restart_count="$(node -e 'const fs=require("fs"); const p=process.argv[1]; try { console.log(Number(JSON.parse(fs.readFileSync(p,"utf8")).restartCount || 0)); } catch { console.log(0); }' "$current_json")"
  fi

  if [ "$status" = "running" ]; then
    [ -n "$started_at" ] || started_at="$now"
    if command -v node >/dev/null 2>&1; then
      uptime="$(node -e 'const t=Date.parse(process.argv[1]); console.log(Number.isFinite(t) ? Math.max(0, Math.floor((Date.now()-t)/1000)) : 0)' "$started_at")"
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
