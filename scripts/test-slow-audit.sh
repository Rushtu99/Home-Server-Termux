#!/usr/bin/env bash
set -eu

delay_sec="${1:-12}"
shift || true
root_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
target="${HMSTX_CONTROL_REAL_CMD:-$root_dir/scripts/hmstx-control.sh}"

if [ ! -x "$target" ]; then
  echo "missing executable HMSTX control command: $target" >&2
  exit 1
fi

sleep "$delay_sec"
if [ "$#" -eq 0 ]; then
  exec "$target" audit --json
fi
exec "$target" "$@"
