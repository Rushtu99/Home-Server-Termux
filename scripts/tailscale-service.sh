#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
TAILSCALE_MODE="${TAILSCALE_MODE:-disabled}"
TAILSCALE_BIN="${TAILSCALE_BIN:-$(command -v tailscale || true)}"
TAILSCALED_BIN="${TAILSCALED_BIN:-$(command -v tailscaled || true)}"
TAILSCALE_ROOT_CMD="${TAILSCALE_ROOT_CMD:-su -c tailscale}"
TAILSCALE_STATE_DIR="${TAILSCALE_STATE_DIR:-$RUNTIME_DIR/tailscale}"
TAILSCALE_SOCKET="${TAILSCALE_SOCKET:-$TAILSCALE_STATE_DIR/tailscaled.sock}"
TAILSCALE_STATE_PATH="${TAILSCALE_STATE_PATH:-$TAILSCALE_STATE_DIR/tailscaled.state}"
TAILSCALE_PID_PATH="${TAILSCALE_PID_PATH:-$RUNTIME_DIR/tailscaled.pid}"
TAILSCALE_LOG_PATH="${TAILSCALE_LOG_PATH:-$LOG_DIR/tailscaled.log}"
TAILSCALE_AUTH_KEY="${TAILSCALE_AUTH_KEY:-}"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-}"
TAILSCALE_ACCEPT_DNS="${TAILSCALE_ACCEPT_DNS:-false}"
SERVICE_NAME="tailscale"

load_shell_env_file() {
    local env_file="$1"
    local line="" key="" value=""

    [ -f "$env_file" ] || return 0

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ''|\#*) continue ;;
        esac

        key="${line%%=*}"
        value="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"

        if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            continue
        fi

        case "$value" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
        esac

        export "$key=$value"
    done < "$env_file"
}

load_shell_env_file "$SERVER_ENV_FILE"

RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
TAILSCALE_MODE="${TAILSCALE_MODE:-disabled}"
TAILSCALE_BIN="${TAILSCALE_BIN:-$(command -v tailscale || true)}"
TAILSCALED_BIN="${TAILSCALED_BIN:-$(command -v tailscaled || true)}"
TAILSCALE_ROOT_CMD="${TAILSCALE_ROOT_CMD:-su -c tailscale}"
TAILSCALE_STATE_DIR="${TAILSCALE_STATE_DIR:-$RUNTIME_DIR/tailscale}"
TAILSCALE_SOCKET="${TAILSCALE_SOCKET:-$TAILSCALE_STATE_DIR/tailscaled.sock}"
TAILSCALE_STATE_PATH="${TAILSCALE_STATE_PATH:-$TAILSCALE_STATE_DIR/tailscaled.state}"
TAILSCALE_PID_PATH="${TAILSCALE_PID_PATH:-$RUNTIME_DIR/tailscaled.pid}"
TAILSCALE_LOG_PATH="${TAILSCALE_LOG_PATH:-$LOG_DIR/tailscaled.log}"
TAILSCALE_AUTH_KEY="${TAILSCALE_AUTH_KEY:-}"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-}"
TAILSCALE_ACCEPT_DNS="${TAILSCALE_ACCEPT_DNS:-false}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$TAILSCALE_STATE_DIR"

is_shell_command_available() {
    local command_string="$1"
    bash -lc "$command_string" >/dev/null 2>&1
}

run_shell_command() {
    local command_string="$1"
    bash -lc "$command_string"
}

root_tailscale_cli() {
    local command_string="$TAILSCALE_ROOT_CMD"
    local arg=""

    for arg in "$@"; do
        command_string+=" $(printf '%q' "$arg")"
    done

    run_shell_command "$command_string"
}

is_running() {
    local pid=""
    [ -f "$TAILSCALE_PID_PATH" ] || return 1
    pid="$(cat "$TAILSCALE_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

ensure_managed_mode() {
    if [ "$TAILSCALE_MODE" != "managed_daemon" ] && [ "$TAILSCALE_MODE" != "root_daemon" ]; then
        echo "tailscale helper is disabled unless TAILSCALE_MODE=managed_daemon or root_daemon" >&2
        return 1
    fi
}

ensure_install() {
    ensure_managed_mode
    if [ "$TAILSCALE_MODE" = "root_daemon" ]; then
        is_shell_command_available "$TAILSCALE_ROOT_CMD version" || {
            echo "root tailscale CLI command failed: $TAILSCALE_ROOT_CMD" >&2
            return 1
        }
        return 0
    fi
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

tailscale_status_json() {
    if [ "$TAILSCALE_MODE" = "root_daemon" ]; then
        root_tailscale_cli status --json
    else
        tailscale_cli status --json
    fi
}

extract_status_field() {
    local raw="$1"
    local field="$2"

    TAILSCALE_STATUS_JSON="$raw" python - "$field" <<'PY'
import json
import os
import sys

field = sys.argv[1]
try:
    data = json.loads(os.environ.get("TAILSCALE_STATUS_JSON", ""))
except Exception:
    sys.exit(1)

self_data = data.get("Self") or {}
ips = self_data.get("TailscaleIPs") or []
mapping = {
    "backend_state": str(data.get("BackendState") or ""),
    "dns_name": str(self_data.get("DNSName") or "").rstrip("."),
    "ip4": str(ips[0] if len(ips) > 0 else ""),
    "ip6": str(ips[1] if len(ips) > 1 else ""),
}
print(mapping.get(field, ""), end="")
PY
}

collect_tailscale_state() {
    local raw=""
    local backend_state=""
    local dns_name=""
    local ip4=""
    local ip6=""
    local running="false"
    local connected="false"
    local status="stopped"

    raw="$(tailscale_status_json 2>/dev/null || true)"
    if [ -n "$raw" ]; then
        backend_state="$(extract_status_field "$raw" backend_state 2>/dev/null || true)"
        dns_name="$(extract_status_field "$raw" dns_name 2>/dev/null || true)"
        ip4="$(extract_status_field "$raw" ip4 2>/dev/null || true)"
        ip6="$(extract_status_field "$raw" ip6 2>/dev/null || true)"
    fi

    if [ "$TAILSCALE_MODE" = "root_daemon" ]; then
        if [ -n "$backend_state" ] && [ "$backend_state" != "NoState" ]; then
            running="true"
            status="running"
        fi
    elif is_running; then
        running="true"
        status="running"
    fi

    if [ -n "$dns_name" ] || [ -n "$ip4" ]; then
        connected="true"
        status="working"
    fi

    if [ "$running" = "false" ] && [ "$connected" = "false" ] && [ "$TAILSCALE_MODE" = "root_daemon" ] && [ -n "$raw" ]; then
        status="degraded"
    fi

    printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$running" "$connected" "$status" "$dns_name" "$ip4" "$ip6"
}

run_tailscale_up() {
    local -a up_args=(up --accept-dns="$TAILSCALE_ACCEPT_DNS")

    if [ -n "$TAILSCALE_AUTH_KEY" ]; then
        up_args+=(--authkey="$TAILSCALE_AUTH_KEY")
    fi
    if [ -n "$TAILSCALE_HOSTNAME" ]; then
        up_args+=(--hostname="$TAILSCALE_HOSTNAME")
    fi

    if [ "$TAILSCALE_MODE" = "root_daemon" ]; then
        root_tailscale_cli "${up_args[@]}"
    else
        tailscale_cli "${up_args[@]}"
    fi
}

start_service() {
    local state=()

    if [ "$TAILSCALE_MODE" = "root_daemon" ]; then
        ensure_install
        mapfile -t state < <(collect_tailscale_state)
        if [ "${state[1]:-false}" = "true" ]; then
            return 0
        fi
        run_tailscale_up >/dev/null 2>&1
        return 0
    fi

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

    run_tailscale_up >/dev/null 2>&1 || true
}

stop_service() {
    local pid=""

    if [ "$TAILSCALE_MODE" = "root_daemon" ]; then
        return 0
    fi

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
    local dns_name=""
    local ip4=""
    local ip6=""
    local status_code=1
    local state=()

    if [ "$TAILSCALE_MODE" = "android_app" ]; then
        status="external"
        running=true
        connected=true
        dns_name="${TAILSCALE_DNS_NAME}"
        ip4="${TAILSCALE_IP}"
        status_code=0
    else
        mapfile -t state < <(collect_tailscale_state)
        running="${state[0]:-false}"
        connected="${state[1]:-false}"
        status="${state[2]:-stopped}"
        dns_name="${state[3]:-}"
        ip4="${state[4]:-}"
        ip6="${state[5]:-}"
        if [ "$running" = "true" ]; then
            status_code=0
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
        "$dns_name" \
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
            if [ "$TAILSCALE_MODE" = "root_daemon" ]; then
                mapfile -t state < <(collect_tailscale_state)
                [ "${state[0]:-false}" = "true" ]
            else
                is_running
            fi
        fi
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status [--json]}" >&2
        exit 1
        ;;
esac
