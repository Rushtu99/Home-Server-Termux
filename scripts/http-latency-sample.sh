#!/usr/bin/env bash
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <url> [count]" >&2
  exit 1
fi

url="$1"
count="${2:-5}"
i=1

while [ "$i" -le "$count" ]; do
  started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  curl -sS -o /dev/null -w "sample=%s started_at=%s status=%{http_code} total=%{time_total}s connect=%{time_connect}s ttfb=%{time_starttransfer}s\n" "$i" "$started_at" "$url"
  i=$((i + 1))
done
