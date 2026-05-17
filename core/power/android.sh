#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

hs_power_status_json() {
  if command -v termux-battery-status >/dev/null 2>&1; then
    termux-battery-status || printf '{}\n'
    return 0
  fi
  printf '{"available":false,"reason":"termux-battery-status not installed"}\n'
}

hs_wakelock_acquire() {
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
}

hs_wakelock_release() {
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock || true
}

hs_thermal_status_json() {
  local zone="" temp="" first=true
  printf '{"available":true,"zones":['
  for zone in /sys/class/thermal/thermal_zone*/temp; do
    [ -r "$zone" ] || continue
    temp="$(cat "$zone" 2>/dev/null || true)"
    case "$temp" in ''|*[!0-9-]*) continue ;; esac
    $first || printf ','
    first=false
    printf '{"path":"%s","milliC":%s}' "$zone" "$temp"
  done
  printf ']}'
}

hs_power_guard_heavy_ok() {
  local min_battery="${1:-15}" status="" pct="" charging=""
  status="$(hs_power_status_json)"
  if command -v node >/dev/null 2>&1; then
    pct="$(printf '%s' "$status" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s); console.log(j.percentage ?? j.level ?? "");}catch{console.log("")}})')"
    charging="$(printf '%s' "$status" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s); console.log(String(j.status||"").toLowerCase());}catch{console.log("")}})')"
    if [ -n "$pct" ] && [ "$pct" -lt "$min_battery" ] 2>/dev/null && [ "$charging" != "charging" ] && [ "$charging" != "full" ]; then
      return 1
    fi
  fi
  return 0
}
