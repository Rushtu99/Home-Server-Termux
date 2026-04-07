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
SERVICE_NAME="jellyseerr"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$JELLYSEERR_HOME" "$JELLYSEERR_DATA_DIR"

read_required_node_major() {
    node - "$JELLYSEERR_PACKAGE_JSON" <<'NODE'
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

    command -v node >/dev/null 2>&1 || {
        echo "Jellyseerr requires node, but it is not installed on this host." >&2
        return 1
    }

    node_version="$(node -v 2>/dev/null || true)"
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

    package_manager="$(node -p "require(process.argv[1]).packageManager || ''" "$JELLYSEERR_PACKAGE_JSON" 2>/dev/null || true)"

    if [ -n "$package_manager" ] && printf '%s' "$package_manager" | grep -q '^pnpm@'; then
        if command -v corepack >/dev/null 2>&1; then
            case "$action" in
                install) CYPRESS_INSTALL_BINARY=0 corepack pnpm install --frozen-lockfile --config.engine-strict=false ;;
                build) CYPRESS_INSTALL_BINARY=0 corepack pnpm build --config.engine-strict=false ;;
                *) echo "Unsupported Jellyseerr package-manager action: $action" >&2; return 1 ;;
            esac
            return 0
        fi

        command -v npx >/dev/null 2>&1 || {
            echo "Jellyseerr requires corepack or npx to bootstrap pnpm." >&2
            return 1
        }

        case "$action" in
            install) CYPRESS_INSTALL_BINARY=0 npx --yes "$package_manager" install --frozen-lockfile --config.engine-strict=false ;;
            build) CYPRESS_INSTALL_BINARY=0 npx --yes "$package_manager" build --config.engine-strict=false ;;
            *) echo "Unsupported Jellyseerr package-manager action: $action" >&2; return 1 ;;
        esac
        return 0
    fi

    case "$action" in
        install) npm install --legacy-peer-deps ;;
        build) npm run build ;;
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
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
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
    if command -v setsid >/dev/null 2>&1; then
        setsid env NODE_ENV=production PORT="$JELLYSEERR_PORT" HOST="$JELLYSEERR_BIND_HOST" CONFIG_DIRECTORY="$JELLYSEERR_DATA_DIR" BASE_URL="$JELLYSEERR_BASE_PATH" \
            node "$JELLYSEERR_DIST_PATH" > "$JELLYSEERR_LOG_PATH" 2>&1 < /dev/null &
    else
        nohup env NODE_ENV=production PORT="$JELLYSEERR_PORT" HOST="$JELLYSEERR_BIND_HOST" CONFIG_DIRECTORY="$JELLYSEERR_DATA_DIR" BASE_URL="$JELLYSEERR_BASE_PATH" \
            node "$JELLYSEERR_DIST_PATH" > "$JELLYSEERR_LOG_PATH" 2>&1 &
    fi
    printf '%s\n' "$!" > "$JELLYSEERR_PID_PATH"
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
