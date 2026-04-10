#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
JELLYSEERR_HOME="${JELLYSEERR_HOME:-$MEDIA_SERVICES_HOME/jellyseerr}"
JELLYSEERR_APP_DIR="${JELLYSEERR_APP_DIR:-$JELLYSEERR_HOME/app}"
JELLYSEERR_PACKAGE_JSON="${JELLYSEERR_PACKAGE_JSON:-$JELLYSEERR_APP_DIR/package.json}"
JELLYSEERR_DIST_PATH="${JELLYSEERR_DIST_PATH:-$JELLYSEERR_APP_DIR/dist/index.js}"
JELLYSEERR_BIND_HOST="${JELLYSEERR_BIND_HOST:-127.0.0.1}"
JELLYSEERR_PORT="${JELLYSEERR_PORT:-5055}"
JELLYSEERR_BASE_PATH="${JELLYSEERR_BASE_PATH:-/requests}"
JELLYSEERR_PID_PATH="${JELLYSEERR_PID_PATH:-$RUNTIME_DIR/jellyseerr.pid}"
JELLYSEERR_LOG_PATH="${JELLYSEERR_LOG_PATH:-$LOG_DIR/jellyseerr.log}"
JELLYSEERR_DATA_DIR="${JELLYSEERR_DATA_DIR:-$JELLYSEERR_HOME/data}"
JELLYSEERR_NODE_ROOT="${JELLYSEERR_NODE_ROOT:-/data/data/com.termux/files/usr/opt/nodejs-22}"
JELLYSEERR_NODE_BIN="${JELLYSEERR_NODE_BIN:-}"
JELLYSEERR_COREPACK_CLI="${JELLYSEERR_COREPACK_CLI:-}"
JELLYSEERR_NPM_CLI="${JELLYSEERR_NPM_CLI:-}"
JELLYSEERR_NODE_SHIMS_DIR="${JELLYSEERR_NODE_SHIMS_DIR:-}"
SERVICE_NAME="jellyseerr"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$JELLYSEERR_HOME" "$JELLYSEERR_DATA_DIR"

if [ -z "$JELLYSEERR_NODE_BIN" ]; then
    if [ -x "$JELLYSEERR_NODE_ROOT/bin/node" ]; then
        JELLYSEERR_NODE_BIN="$JELLYSEERR_NODE_ROOT/bin/node"
    else
        JELLYSEERR_NODE_BIN="$(command -v node || true)"
    fi
fi
if [ -z "$JELLYSEERR_COREPACK_CLI" ] && [ -f "$JELLYSEERR_NODE_ROOT/lib/node_modules/corepack/dist/corepack.js" ]; then
    JELLYSEERR_COREPACK_CLI="$JELLYSEERR_NODE_ROOT/lib/node_modules/corepack/dist/corepack.js"
fi
if [ -z "$JELLYSEERR_NPM_CLI" ] && [ -f "$JELLYSEERR_NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js" ]; then
    JELLYSEERR_NPM_CLI="$JELLYSEERR_NODE_ROOT/lib/node_modules/npm/bin/npm-cli.js"
fi
if [ -z "$JELLYSEERR_NODE_SHIMS_DIR" ] && [ -d "$JELLYSEERR_NODE_ROOT/lib/node_modules/corepack/shims" ]; then
    JELLYSEERR_NODE_SHIMS_DIR="$JELLYSEERR_NODE_ROOT/lib/node_modules/corepack/shims"
fi

read_required_node_major() {
    "$JELLYSEERR_NODE_BIN" - "$JELLYSEERR_PACKAGE_JSON" <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const range = String(pkg.engines?.node || '');
const match = range.match(/\^(\d+)/);
if (match) {
  process.stdout.write(match[1]);
}
NODE
}

ensure_compatible_node() {
    local node_version="" current_major="" required_major=""

    [ -x "$JELLYSEERR_NODE_BIN" ] || {
        echo "Jellyseerr requires node, but it is not installed on this host." >&2
        return 1
    }

    node_version="$("$JELLYSEERR_NODE_BIN" -v 2>/dev/null || true)"
    current_major="${node_version#v}"
    current_major="${current_major%%.*}"
    required_major="$(read_required_node_major 2>/dev/null || true)"

    if [ -n "$required_major" ] && [ "$current_major" != "$required_major" ]; then
        echo "Jellyseerr requires Node ${required_major}.x on this host, but found ${node_version}. Install/switch to Node ${required_major} and rerun scripts/install-media-automation.sh with INSTALL_JELLYSEERR=1." >&2
        return 1
    fi
}

run_jellyseerr_package_manager() {
    local action="$1"
    local package_manager=""
    local runtime_path="$PATH"

    if [ -d "$JELLYSEERR_NODE_ROOT/bin" ]; then
        runtime_path="$JELLYSEERR_NODE_ROOT/bin:$runtime_path"
    fi
    if [ -d "$JELLYSEERR_NODE_SHIMS_DIR" ]; then
        runtime_path="$JELLYSEERR_NODE_SHIMS_DIR:$runtime_path"
    fi

    package_manager="$("$JELLYSEERR_NODE_BIN" -p "require(process.argv[1]).packageManager || ''" "$JELLYSEERR_PACKAGE_JSON" 2>/dev/null || true)"

    if [ -n "$package_manager" ] && printf '%s' "$package_manager" | grep -q '^pnpm@'; then
        if [ -f "$JELLYSEERR_COREPACK_CLI" ]; then
            case "$action" in
                install) PATH="$runtime_path" CYPRESS_INSTALL_BINARY=0 "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_COREPACK_CLI" pnpm install --frozen-lockfile --config.engine-strict=false ;;
                build) PATH="$runtime_path" CYPRESS_INSTALL_BINARY=0 "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_COREPACK_CLI" pnpm build --config.engine-strict=false ;;
                *) echo "Unsupported Jellyseerr package-manager action: $action" >&2; return 1 ;;
            esac
            return 0
        fi
        echo "Jellyseerr requires corepack support to bootstrap pnpm." >&2
        return 1
    fi

    [ -f "$JELLYSEERR_NPM_CLI" ] || {
        echo "Jellyseerr npm CLI is unavailable for fallback package-manager actions." >&2
        return 1
    }
    case "$action" in
        install) PATH="$runtime_path" "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_NPM_CLI" install --legacy-peer-deps ;;
        build) PATH="$runtime_path" "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_NPM_CLI" run build ;;
        *) echo "Unsupported Jellyseerr package-manager action: $action" >&2; return 1 ;;
    esac
}

ensure_build_output() {
    [ -f "$JELLYSEERR_DIST_PATH" ] && return 0

    ensure_compatible_node || return 1

    if [ ! -d "$JELLYSEERR_APP_DIR/node_modules" ]; then
        printf '[%s] Jellyseerr dependencies are missing; bootstrapping install before build.\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$JELLYSEERR_LOG_PATH"
        (cd "$JELLYSEERR_APP_DIR" && run_jellyseerr_package_manager install) >> "$JELLYSEERR_LOG_PATH" 2>&1 || {
            echo "Jellyseerr dependency install failed; inspect $JELLYSEERR_LOG_PATH" >&2
            return 1
        }
    fi

    printf '[%s] Jellyseerr build output missing; attempting local rebuild.\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$JELLYSEERR_LOG_PATH"
    (cd "$JELLYSEERR_APP_DIR" && run_jellyseerr_package_manager build) >> "$JELLYSEERR_LOG_PATH" 2>&1 || {
        echo "Jellyseerr build failed; inspect $JELLYSEERR_LOG_PATH" >&2
        return 1
    }

    [ -f "$JELLYSEERR_DIST_PATH" ] || {
        echo "Jellyseerr build completed without producing $JELLYSEERR_DIST_PATH; inspect $JELLYSEERR_LOG_PATH" >&2
        return 1
    }
}

doctor_install() {
    [ -f "$JELLYSEERR_PACKAGE_JSON" ] || {
        echo "Jellyseerr app is missing; run scripts/install-media-automation.sh with INSTALL_JELLYSEERR=1" >&2
        return 1
    }

    ensure_compatible_node || return 1

    [ -d "$JELLYSEERR_APP_DIR/node_modules" ] || {
        echo "Jellyseerr dependencies are missing; rerun scripts/install-media-automation.sh with INSTALL_JELLYSEERR=1" >&2
        return 1
    }

    [ -f "$JELLYSEERR_DIST_PATH" ] || {
        echo "Jellyseerr build output is missing; run '$0 start' to trigger a rebuild after fixing prerequisites, or rerun scripts/install-media-automation.sh with INSTALL_JELLYSEERR=1." >&2
        return 1
    }

    echo "Jellyseerr install is ready."
}

is_running() {
    local pid=""
    [ -f "$JELLYSEERR_PID_PATH" ] || return 1
    pid="$(cat "$JELLYSEERR_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && is_listening
}

is_listening() {
    python3 - "$JELLYSEERR_BIND_HOST" "$JELLYSEERR_PORT" <<'PY' >/dev/null 2>&1
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

with socket.create_connection((host, port), timeout=2):
    pass
PY
}

ensure_install() {
    [ -f "$JELLYSEERR_PACKAGE_JSON" ] || {
        echo "Jellyseerr app is missing; run scripts/install-media-automation.sh first" >&2
        return 1
    }
    ensure_build_output
}

start_service() {
    if is_running; then
        return 0
    fi

    ensure_install
    local runtime_path="$PATH"
    if [ -d "$JELLYSEERR_NODE_ROOT/bin" ]; then
        runtime_path="$JELLYSEERR_NODE_ROOT/bin:$runtime_path"
    fi
    if [ -d "$JELLYSEERR_NODE_SHIMS_DIR" ]; then
        runtime_path="$JELLYSEERR_NODE_SHIMS_DIR:$runtime_path"
    fi
    if command -v setsid >/dev/null 2>&1; then
        setsid env NODE_ENV=production PORT="$JELLYSEERR_PORT" HOST="$JELLYSEERR_BIND_HOST" CONFIG_DIRECTORY="$JELLYSEERR_DATA_DIR" BASE_URL="$JELLYSEERR_BASE_PATH" PATH="$runtime_path" \
            "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_DIST_PATH" > "$JELLYSEERR_LOG_PATH" 2>&1 < /dev/null &
    else
        nohup env NODE_ENV=production PORT="$JELLYSEERR_PORT" HOST="$JELLYSEERR_BIND_HOST" CONFIG_DIRECTORY="$JELLYSEERR_DATA_DIR" BASE_URL="$JELLYSEERR_BASE_PATH" PATH="$runtime_path" \
            "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_DIST_PATH" > "$JELLYSEERR_LOG_PATH" 2>&1 &
    fi
    printf '%s\n' "$!" > "$JELLYSEERR_PID_PATH"
    for _ in $(seq 1 30); do
        sleep 1
        if is_running; then
            return 0
        fi
    done
    rm -f "$JELLYSEERR_PID_PATH"
    return 1
}

stop_service() {
    local pid=""

    [ -f "$JELLYSEERR_PID_PATH" ] || return 0
    pid="$(cat "$JELLYSEERR_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi
    rm -f "$JELLYSEERR_PID_PATH"
}

status_json() {
    local running=false
    local status="stopped"
    local checked_at=""
    local status_code=1

    if is_running; then
        running=true
        status="running"
        status_code=0
    fi

    checked_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '{"service":"%s","running":%s,"status":"%s","checkedAt":"%s"}\n' \
        "$SERVICE_NAME" \
        "$running" \
        "$status" \
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
    doctor)
        doctor_install
        ;;
    status)
        if [ "${2:-}" = "--json" ]; then
            status_json
        else
            is_running
        fi
        ;;
    *)
        echo "usage: $0 {start|stop|restart|doctor|status [--json]}" >&2
        exit 1
        ;;
esac
