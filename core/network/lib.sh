#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

hs_network_port_open() {
  local host="${1:-127.0.0.1}" port="${2:?port required}"
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

hs_network_http_ok() {
  local url="${1:?url required}" expected="${2:-}"
  local code=""
  if command -v curl >/dev/null 2>&1; then
    code="$(curl -L -s -o /dev/null -w '%{http_code}' --max-time 4 "$url" || true)"
    if [ -n "$expected" ]; then
      [ "$code" = "$expected" ]
    else
      [ "$code" -ge 200 ] && [ "$code" -lt 500 ]
    fi
    return $?
  fi
  python3 - "$url" "$expected" <<'PY'
import sys, urllib.request
expected = sys.argv[2]
try:
    response = urllib.request.urlopen(sys.argv[1], timeout=4)
    code = response.getcode()
    sys.exit(0 if (code == int(expected) if expected else 200 <= code < 500) else 1)
except Exception:
    sys.exit(1)
PY
}

hs_network_online() {
  local probe="${1:-https://connectivitycheck.gstatic.com/generate_204}"
  hs_network_http_ok "$probe" 204 || hs_network_port_open 1.1.1.1 53
}
