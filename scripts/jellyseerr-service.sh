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
JELLYSEERR_NEXT_BUILD_ID_PATH="${JELLYSEERR_NEXT_BUILD_ID_PATH:-$JELLYSEERR_APP_DIR/.next/BUILD_ID}"
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
POSTGRES_BIND_HOST="${POSTGRES_BIND_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-homeserver_media}"
POSTGRES_USER="${POSTGRES_USER:-homeserver_media}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
JELLYSEERR_DB_TYPE="${JELLYSEERR_DB_TYPE:-postgres}"
JELLYSEERR_DB_HOST="${JELLYSEERR_DB_HOST:-$POSTGRES_BIND_HOST}"
JELLYSEERR_DB_PORT="${JELLYSEERR_DB_PORT:-$POSTGRES_PORT}"
JELLYSEERR_DB_NAME="${JELLYSEERR_DB_NAME:-$POSTGRES_DB}"
JELLYSEERR_DB_USER="${JELLYSEERR_DB_USER:-$POSTGRES_USER}"
JELLYSEERR_DB_PASS="${JELLYSEERR_DB_PASS:-$POSTGRES_PASSWORD}"
JELLYSEERR_BCRYPT_SHIM="${JELLYSEERR_BCRYPT_SHIM:-$PROJECT/scripts/jellyseerr-bcrypt-shim.cjs}"
SERVICE_NAME="jellyseerr"
SFQ_HELPER="${SFQ_HELPER:-$PROJECT/scripts/service-fail-quiet.sh}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$JELLYSEERR_HOME" "$JELLYSEERR_DATA_DIR"
[ -f "$SFQ_HELPER" ] && . "$SFQ_HELPER"

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
                build) PATH="$runtime_path" CYPRESS_INSTALL_BINARY=0 "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_COREPACK_CLI" pnpm build ;;
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

patch_next_swc_for_android() {
    local platform=""
    local swc_file=""
    local patch_status=0

    platform="$("$JELLYSEERR_NODE_BIN" -p "process.platform" 2>/dev/null || true)"
    [ "$platform" = "android" ] || return 0

    swc_file="$JELLYSEERR_APP_DIR/node_modules/next/dist/build/swc/index.js"
    [ -f "$swc_file" ] || return 0

    if grep -q 'process.platform === "android"' "$swc_file"; then
        return 0
    fi

    "$JELLYSEERR_NODE_BIN" - "$swc_file" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const source = fs.readFileSync(path, 'utf8');
const from = 'const shouldLoadWasmFallbackFirst = !disableWasmFallback && unsupportedPlatform && useWasmBinary || isWebContainer;';
const to = 'const shouldLoadWasmFallbackFirst = !disableWasmFallback && unsupportedPlatform && (useWasmBinary || process.platform === "android") || isWebContainer;';
if (!source.includes(from)) {
  process.exit(2);
}
fs.writeFileSync(path, source.replace(from, to), 'utf8');
NODE
    patch_status=$?
    if [ "$patch_status" -eq 2 ]; then
        echo "Jellyseerr SWC patch target did not match expected content: $swc_file" >&2
        return 1
    fi
    return "$patch_status"
}

build_node_options() {
    local options="${NODE_OPTIONS:-}"
    local platform=""

    platform="$("$JELLYSEERR_NODE_BIN" -p "process.platform" 2>/dev/null || true)"
    if [ "$platform" = "android" ] && [ -f "$JELLYSEERR_BCRYPT_SHIM" ]; then
        case " $options " in
            *" --require=$JELLYSEERR_BCRYPT_SHIM "*) ;;
            *)
                if [ -n "$options" ]; then
                    options="$options --require=$JELLYSEERR_BCRYPT_SHIM"
                else
                    options="--require=$JELLYSEERR_BCRYPT_SHIM"
                fi
                ;;
        esac
    fi

    printf '%s\n' "$options"
}

ensure_build_output() {
    if [ -f "$JELLYSEERR_DIST_PATH" ] && [ -f "$JELLYSEERR_NEXT_BUILD_ID_PATH" ]; then
        return 0
    fi

    ensure_compatible_node || return 1

    if [ ! -d "$JELLYSEERR_APP_DIR/node_modules" ]; then
        printf '[%s] Jellyseerr dependencies are missing; bootstrapping install before build.\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$JELLYSEERR_LOG_PATH"
        (cd "$JELLYSEERR_APP_DIR" && run_jellyseerr_package_manager install) >> "$JELLYSEERR_LOG_PATH" 2>&1 || {
            echo "Jellyseerr dependency install failed; inspect $JELLYSEERR_LOG_PATH" >&2
            return 1
        }
    fi

    printf '[%s] Jellyseerr build output missing; attempting local rebuild.\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$JELLYSEERR_LOG_PATH"
    patch_next_swc_for_android >> "$JELLYSEERR_LOG_PATH" 2>&1 || {
        echo "Jellyseerr SWC Android patch failed; inspect $JELLYSEERR_LOG_PATH" >&2
        return 1
    }
    (cd "$JELLYSEERR_APP_DIR" && run_jellyseerr_package_manager build) >> "$JELLYSEERR_LOG_PATH" 2>&1 || {
        echo "Jellyseerr build failed; inspect $JELLYSEERR_LOG_PATH" >&2
        return 1
    }

    if [ ! -f "$JELLYSEERR_DIST_PATH" ] || [ ! -f "$JELLYSEERR_NEXT_BUILD_ID_PATH" ]; then
        echo "Jellyseerr build completed without required outputs ($JELLYSEERR_DIST_PATH, $JELLYSEERR_NEXT_BUILD_ID_PATH); inspect $JELLYSEERR_LOG_PATH" >&2
        return 1
    fi
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

    if [ ! -f "$JELLYSEERR_DIST_PATH" ] || [ ! -f "$JELLYSEERR_NEXT_BUILD_ID_PATH" ]; then
        echo "Jellyseerr build outputs are missing; run '$0 start' to trigger a rebuild after fixing prerequisites, or rerun scripts/install-media-automation.sh with INSTALL_JELLYSEERR=1." >&2
        return 1
    fi

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

postgres_dependency_ready() {
    [ "$JELLYSEERR_DB_TYPE" = "postgres" ] || return 0

    python3 - "$JELLYSEERR_DB_HOST" "$JELLYSEERR_DB_PORT" <<'PY' >/dev/null 2>&1
import socket
import sys
host = sys.argv[1]
port = int(sys.argv[2])
with socket.create_connection((host, port), timeout=2):
    pass
PY
}

start_service() {
    local node_options=""
    local cooldown_left=0

    if is_running; then
        if type sfq_mark_success >/dev/null 2>&1; then
            sfq_mark_success "$RUNTIME_DIR" "$SERVICE_NAME"
        fi
        return 0
    fi

    if type sfq_is_cooldown_active >/dev/null 2>&1 && sfq_is_cooldown_active "$RUNTIME_DIR" "$SERVICE_NAME"; then
        cooldown_left="$(sfq_remaining_cooldown "$RUNTIME_DIR" "$SERVICE_NAME" 2>/dev/null || echo 0)"
        printf '[%s] %s is in fail-quiet cooldown (%ss remaining)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$SERVICE_NAME" "$cooldown_left" >> "$JELLYSEERR_LOG_PATH"
        return 1
    fi

    if ! postgres_dependency_ready; then
        if type sfq_record_failure >/dev/null 2>&1; then
            sfq_record_failure "$RUNTIME_DIR" "$SERVICE_NAME" "$JELLYSEERR_LOG_PATH" "postgres dependency unavailable"
        fi
        return 1
    fi

    if ! ensure_install; then
        if type sfq_record_failure >/dev/null 2>&1; then
            sfq_record_failure "$RUNTIME_DIR" "$SERVICE_NAME" "$JELLYSEERR_LOG_PATH" "install/build prerequisite check failed"
        fi
        return 1
    fi
    node_options="$(build_node_options)"
    local runtime_path="$PATH"
    if [ -d "$JELLYSEERR_NODE_ROOT/bin" ]; then
        runtime_path="$JELLYSEERR_NODE_ROOT/bin:$runtime_path"
    fi
    if [ -d "$JELLYSEERR_NODE_SHIMS_DIR" ]; then
        runtime_path="$JELLYSEERR_NODE_SHIMS_DIR:$runtime_path"
    fi
    if command -v setsid >/dev/null 2>&1; then
        (
            cd "$JELLYSEERR_APP_DIR"
            exec setsid env NODE_ENV=production PORT="$JELLYSEERR_PORT" HOST="$JELLYSEERR_BIND_HOST" CONFIG_DIRECTORY="$JELLYSEERR_DATA_DIR" BASE_URL="$JELLYSEERR_BASE_PATH" PATH="$runtime_path" \
            DB_TYPE="$JELLYSEERR_DB_TYPE" DB_HOST="$JELLYSEERR_DB_HOST" DB_PORT="$JELLYSEERR_DB_PORT" DB_NAME="$JELLYSEERR_DB_NAME" DB_USER="$JELLYSEERR_DB_USER" DB_PASS="$JELLYSEERR_DB_PASS" \
            NODE_OPTIONS="$node_options" \
            "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_DIST_PATH" > "$JELLYSEERR_LOG_PATH" 2>&1 < /dev/null
        ) &
    else
        (
            cd "$JELLYSEERR_APP_DIR"
            exec nohup env NODE_ENV=production PORT="$JELLYSEERR_PORT" HOST="$JELLYSEERR_BIND_HOST" CONFIG_DIRECTORY="$JELLYSEERR_DATA_DIR" BASE_URL="$JELLYSEERR_BASE_PATH" PATH="$runtime_path" \
            DB_TYPE="$JELLYSEERR_DB_TYPE" DB_HOST="$JELLYSEERR_DB_HOST" DB_PORT="$JELLYSEERR_DB_PORT" DB_NAME="$JELLYSEERR_DB_NAME" DB_USER="$JELLYSEERR_DB_USER" DB_PASS="$JELLYSEERR_DB_PASS" \
            NODE_OPTIONS="$node_options" \
            "$JELLYSEERR_NODE_BIN" "$JELLYSEERR_DIST_PATH" > "$JELLYSEERR_LOG_PATH" 2>&1
        ) &
    fi
    printf '%s\n' "$!" > "$JELLYSEERR_PID_PATH"
    for _ in $(seq 1 30); do
        sleep 1
        if is_running; then
            if type sfq_mark_success >/dev/null 2>&1; then
                sfq_mark_success "$RUNTIME_DIR" "$SERVICE_NAME"
            fi
            return 0
        fi
    done
    rm -f "$JELLYSEERR_PID_PATH"
    if type sfq_record_failure >/dev/null 2>&1; then
        sfq_record_failure "$RUNTIME_DIR" "$SERVICE_NAME" "$JELLYSEERR_LOG_PATH" "listener not ready after launch"
    fi
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
