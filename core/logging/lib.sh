#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

hs_log_rotate() {
  local file="$1" max_bytes="${2:-1048576}"
  [ -f "$file" ] || return 0
  local size="0"
  size="$(wc -c < "$file" 2>/dev/null || printf '0')"
  [ "$size" -lt "$max_bytes" ] 2>/dev/null && return 0
  mv -f "$file" "$file.$(date -u '+%Y%m%dT%H%M%SZ')"
}

hs_log_line() {
  local scope="$1" name="$2" level="$3" message="$4"
  local root="${PROJECT:-$(pwd)}" dir="" file=""
  dir="$root/logs/$scope"
  mkdir -p "$dir"
  file="$dir/$name.log"
  hs_log_rotate "$file"
  printf '[%s] %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(printf '%s' "$level" | tr '[:lower:]' '[:upper:]')" "$message" >> "$file"
}
