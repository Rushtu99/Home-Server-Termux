#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
TAILSCALE_MODE="${TAILSCALE_MODE:-disabled}"
TAILSCALE_BIN="${TAILSCALE_BIN:-$(command -v tailscale || true)}"
TAILSCALED_BIN="${TAILSCALED_BIN:-$(command -v tailscaled || true)}"
TAILSCALE_STATE_DIR="${TAILSCALE_STATE_DIR:-$RUNTIME_DIR/tailscale}"
TAILSCALE_SOCKET="${TAILSCALE_SOCKET:-$TAILSCALE_STATE_DIR/tailscaled.sock}"
TAILSCALE_STATE_PATH="${TAILSCALE_STATE_PATH:-$TAILSCALE_STATE_DIR/tailscaled.state}"
TAILSCALE_PID_PATH="${TAILSCALE_PID_PATH:-$RUNTIME_DIR/tailscaled.pid}"
TAILSCALE_LOG_PATH="${TAILSCALE_LOG_PATH:-$LOG_DIR/tailscaled.log}"
TAILSCALE_AUTH_KEY="${TAILSCALE_AUTH_KEY:-}"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-}"
TAILSCALE_ACCEPT_DNS="${TAILSCALE_ACCEPT_DNS:-false}"
SERVICE_NAME="tailscale"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$TAILSCALE_STATE_DIR"

is_running() {
    local pid=""
    [ -f "$TAILSCALE_PID_PATH" ] || return 1
    pid="$(cat "$TAILSCALE_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

ensure_managed_mode() {
    if [ "$TAILSCALE_MODE" != "managed_daemon" ]; then
        echo "tailscale managed service is disabled unless TAILSCALE_MODE=managed_daemon" >&2
        return 1
    fi
}

ensure_install() {
    ensure_managed_mode
    [ -n "$TAILSCALED_BIN" ] || {
        echo "tailscaled binary not found" >&2
        return 1
    }
    [ -n "$TAILSCALE_BIN" ] || {
        echo "tailscale CLI binary not found" >&2
        return 1
    }
    [ -e /dev/net/tun ] || {
        echo "/dev/net/tun is missing" >&2
        return 1
    }
}

tailscale_cli() {
    "$TAILSCALE_BIN" --socket="$TAILSCALE_SOCKET" "$@"
}

start_service() {
    if is_running; then
        return 0
    fi

    ensure_install
    if command -v setsid >/dev/null 2>&1; then
        setsid "$TAILSCALED_BIN" --state="$TAILSCALE_STATE_PATH" --socket="$TAILSCALE_SOCKET" > "$TAILSCALE_LOG_PATH" 2>&1 < /dev/null &
    else
        nohup "$TAILSCALED_BIN" --state="$TAILSCALE_STATE_PATH" --socket="$TAILSCALE_SOCKET" > "$TAILSCALE_LOG_PATH" 2>&1 &
    fi
    printf '%s\n' "$!" > "$TAILSCALE_PID_PATH"

    local attempt=0
    while [ "$attempt" -lt 10 ]; do
        if tailscale_cli status >/dev/null 2>&1; then
            break
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    if [ -n "$TAILSCALE_AUTH_KEY" ]; then
        local up_args=(up --authkey="$TAILSCALE_AUTH_KEY" --accept-dns="$TAILSCALE_ACCEPT_DNS")
        if [ -n "$TAILSCALE_HOSTNAME" ]; then
            up_args+=(--hostname="$TAILSCALE_HOSTNAME")
        fi
        tailscale_cli "${up_args[@]}" >/dev/null 2>&1 || true
    fi
}

stop_service() {
    local pid=""

    [ -f "$TAILSCALE_PID_PATH" ] || return 0
    pid="$(cat "$TAILSCALE_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi
    rm -f "$TAILSCALE_PID_PATH"
}

status_json() {
    local running=false
    local connected=false
    local status="stopped"
    local checked_at=""
    local ip4=""
    local ip6=""
    local magic_dns=""
    local status_code=1

    if [ "$TAILSCALE_MODE" = "android_app" ]; then
        status="external"
    fi

    if is_running; then
        running=true
        status="running"
        status_code=0
    fi

    if [ -n "$TAILSCALE_BIN" ] && [ -S "$TAILSCALE_SOCKET" ]; then
        ip4="$(tailscale_cli ip -4 2>/dev/null | head -1 || true)"
        ip6="$(tailscale_cli ip -6 2>/dev/null | head -1 || true)"
        magic_dns="$(tailscale_cli status --json 2>/dev/null | python -c 'import json,sys; data=json.load(sys.stdin); self=data.get("Self") or {}; print(self.get("DNSName",""))' 2>/dev/null || true)"
        if [ -n "$ip4" ] || [ -n "$magic_dns" ]; then
            connected=true
        fi
    fi

    checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '{"service":"%s","mode":"%s","running":%s,"connected":%s,"status":"%s","ip4":"%s","ip6":"%s","dnsName":"%s","checkedAt":"%s"}\n' \
        "$SERVICE_NAME" \
        "$TAILSCALE_MODE" \
        "$running" \
        "$connected" \
        "$status" \
        "$ip4" \
        "$ip6" \
        "$magic_dns" \
        "$checked_at"

    return "$status_code"
}

case "${1:-status}" in
    start)
        start_service
        ;;
    stop)
        stop_service
        ;;
    restart)
        stop_service
        start_service
        ;;
    status)
        if [ "${2:-}" = "--json" ]; then
            status_json
        else
            is_running
        fi
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status [--json]}" >&2
        exit 1
        ;;
esac
