#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

hs_event_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

hs_emit() {
  local event="$1" subject="${2:-}" payload="${3:-{}}"
  local root="${PROJECT:-$(pwd)}" dir="" file=""
  dir="$root/state/events"
  file="$dir/events.jsonl"
  mkdir -p "$dir"
  case "$payload" in
    \{*\}|\[*\]) ;;
    *) payload="\"$(hs_event_escape "$payload")\"" ;;
  esac
  printf '{"timestamp":"%s","event":"%s","subject":"%s","payload":%s}\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(hs_event_escape "$event")" "$(hs_event_escape "$subject")" "$payload" >> "$file"
  hs_event_dispatch "$event" "$subject" "$payload"
}

hs_events_list() {
  local limit="${1:-100}" root="${PROJECT:-$(pwd)}" file=""
  file="$root/state/events/events.jsonl"
  [ -f "$file" ] || return 0
  tail -n "$limit" "$file"
}

hs_event_subscribe() {
  local event="$1" handler="$2" root="${PROJECT:-$(pwd)}" dir=""
  [ -n "$event" ] && [ -n "$handler" ] || return 2
  dir="$root/state/events/subscribers/$event"
  mkdir -p "$dir"
  printf '%s\n' "$handler" > "$dir/$(basename "$handler").subscriber"
}

hs_event_dispatch() {
  local event="$1" subject="${2:-}" payload="${3:-{}}" root="${PROJECT:-$(pwd)}" dir="" subscriber="" handler=""
  dir="$root/state/events/subscribers/$event"
  [ -d "$dir" ] || return 0
  for subscriber in "$dir"/*.subscriber; do
    [ -f "$subscriber" ] || continue
    handler="$(cat "$subscriber")"
    [ -x "$handler" ] || continue
    "$handler" "$event" "$subject" "$payload" || true
  done
}
