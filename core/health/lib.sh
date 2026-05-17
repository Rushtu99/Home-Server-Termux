#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

health_process() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

health_port() {
  local host="$1" port="$2"
  if command -v nc >/dev/null 2>&1; then
    nc -z "$host" "$port" >/dev/null 2>&1
    return $?
  fi
  python3 - "$host" "$port" <<'PY' >/dev/null 2>&1
import socket, sys
with socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=2):
    pass
PY
}

health_http() {
  local url="$1" expected="${2:-}"
  local code=""
  if command -v curl >/dev/null 2>&1; then
    code="$(curl -L -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
    if [ -n "$expected" ]; then [ "$code" = "$expected" ]; else [ "$code" -ge 200 ] && [ "$code" -lt 500 ]; fi
    return $?
  fi
  python3 - "$url" "$expected" <<'PY'
import sys, urllib.request
expected = sys.argv[2]
try:
    response = urllib.request.urlopen(sys.argv[1], timeout=3)
    code = response.getcode()
    ok = code == int(expected) if expected else 200 <= code < 500
    sys.exit(0 if ok else 1)
except Exception:
    sys.exit(1)
PY
}

health_custom() {
  "$@"
}
