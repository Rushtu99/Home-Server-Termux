#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
PROOT_DISTRO_ALIAS="${PROOT_DISTRO_ALIAS:-debian-hs}"
CHROOT_ROOTFS="${CHROOT_ROOTFS:-/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/$PROOT_DISTRO_ALIAS}"
APP_SLUG="${APP_SLUG:?APP_SLUG is required}"
APP_NAME="${APP_NAME:?APP_NAME is required}"
APP_BINARY_NAME="${APP_BINARY_NAME:?APP_BINARY_NAME is required}"
APP_LOG_PATH="${APP_LOG_PATH:-$LOG_DIR/$APP_SLUG.log}"
APP_PID_PATH="${APP_PID_PATH:-$RUNTIME_DIR/$APP_SLUG.pid}"
APP_BIND_HOST="${APP_BIND_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:?APP_PORT is required}"
APP_URL_BASE="${APP_URL_BASE:-/$APP_SLUG}"
APP_INSTALL_DIR_IN_CHROOT="${APP_INSTALL_DIR_IN_CHROOT:-/opt/home-server/$APP_SLUG/app}"
APP_DATA_DIR_IN_CHROOT="${APP_DATA_DIR_IN_CHROOT:-/opt/home-server/$APP_SLUG/data}"
APP_CONFIG_PATH="${APP_CONFIG_PATH:-$CHROOT_ROOTFS$APP_DATA_DIR_IN_CHROOT/config.xml}"
TERMUX_DRIVES_PATH="${TERMUX_DRIVES_PATH:-$USER_HOME/Drives}"
CHROOT_DRIVES_PATH="${CHROOT_DRIVES_PATH:-/mnt/termux-drives}"
CHROOT_SYSTEM_PATH="${CHROOT_SYSTEM_PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
CHROOT_LANG="${CHROOT_LANG:-C.UTF-8}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

if [ -e "$APP_LOG_PATH" ] && [ ! -w "$APP_LOG_PATH" ]; then
    APP_LOG_PATH="$LOG_DIR/$APP_SLUG.user.log"
fi

have_root_su() {
    command -v su >/dev/null 2>&1 && su -c true >/dev/null 2>&1
}

signal_pid() {
    local pid="$1"

    if have_root_su; then
        su -c "kill -0 '$pid'" >/dev/null 2>&1
    else
        kill -0 "$pid" >/dev/null 2>&1
    fi
}

kill_pid() {
    local pid="$1"
    local signal="${2:-TERM}"

    if have_root_su; then
        su -c "kill -s '$signal' '$pid'" >/dev/null 2>&1
    else
        kill "-$signal" "$pid" >/dev/null 2>&1
    fi
}

list_matching_pids() {
    local pattern=""

    printf -v pattern '%s -nobrowser -data=%s' "$APP_BINARY_NAME" "$APP_DATA_DIR_IN_CHROOT"
    if have_root_su; then
        su -c "ps -A -o PID=,ARGS= 2>/dev/null | grep -F -- '$pattern' | grep -v grep | awk '{ print \$1 }'" 2>/dev/null || true
    else
        ps -A -o PID=,ARGS= 2>/dev/null | grep -F -- "$pattern" | grep -v grep | awk '{ print $1 }' || true
    fi
}

read_pid() {
    local pid=""

    if [ -f "$APP_PID_PATH" ]; then
        pid="$(tr -d '[:space:]' < "$APP_PID_PATH" 2>/dev/null || true)"
    fi
    case "$pid" in
        ''|*[!0-9]*)
            pid=""
            ;;
    esac
    if [ -n "$pid" ] && signal_pid "$pid"; then
        printf '%s\n' "$pid"
        return 0
    fi

    pid="$(list_matching_pids | head -n 1)"
    if [ -n "$pid" ]; then
        printf '%s\n' "$pid" > "$APP_PID_PATH"
        printf '%s\n' "$pid"
        return 0
    fi

    return 1
}

is_running() {
    local pid=""
    pid="$(read_pid || true)"
    [ -n "$pid" ] && signal_pid "$pid"
}

ensure_rootfs() {
    [ -d "$CHROOT_ROOTFS" ] || {
        echo "chroot rootfs '$CHROOT_ROOTFS' is missing; run scripts/install-media-automation.sh first" >&2
        return 1
    }
}

ensure_install() {
    [ -x "$CHROOT_ROOTFS$APP_INSTALL_DIR_IN_CHROOT/$APP_BINARY_NAME" ] || {
        echo "$APP_NAME is not installed inside $CHROOT_ROOTFS$APP_INSTALL_DIR_IN_CHROOT; run scripts/install-media-automation.sh first" >&2
        return 1
    }
}

ensure_chroot_mounts() {
    if have_root_su; then
        su -c "mkdir -p '$CHROOT_ROOTFS/dev' '$CHROOT_ROOTFS/proc' '$CHROOT_ROOTFS/sys' '$CHROOT_ROOTFS$CHROOT_DRIVES_PATH' '$CHROOT_ROOTFS$APP_DATA_DIR_IN_CHROOT'"
        su -c "grep -q ' $CHROOT_ROOTFS/dev ' /proc/mounts || mount --bind /dev '$CHROOT_ROOTFS/dev'"
        su -c "grep -q ' $CHROOT_ROOTFS/proc ' /proc/mounts || mount -t proc proc '$CHROOT_ROOTFS/proc'"
        su -c "grep -q ' $CHROOT_ROOTFS/sys ' /proc/mounts || mount -t sysfs sysfs '$CHROOT_ROOTFS/sys'"
        su -c "grep -q ' $CHROOT_ROOTFS$CHROOT_DRIVES_PATH ' /proc/mounts || mount --bind '$TERMUX_DRIVES_PATH' '$CHROOT_ROOTFS$CHROOT_DRIVES_PATH'"
        return 0
    fi

    mkdir -p "$CHROOT_ROOTFS$CHROOT_DRIVES_PATH" "$CHROOT_ROOTFS$APP_DATA_DIR_IN_CHROOT"
}

ensure_config() {
    local url_base=""

    mkdir -p "$(dirname "$APP_CONFIG_PATH")"
    [ -f "$APP_CONFIG_PATH" ] && return 0

    url_base="${APP_URL_BASE#/}"
    cat > "$APP_CONFIG_PATH" <<EOF
<Config>
  <BindAddress>$APP_BIND_HOST</BindAddress>
  <Port>$APP_PORT</Port>
  <UrlBase>$url_base</UrlBase>
  <LaunchBrowser>False</LaunchBrowser>
</Config>
EOF
}

start_service() {
    local chroot_cmd=""
    local root_cmd=""
    local proot_cmd=""
    local pid=""

    if is_running; then
        return 0
    fi

    ensure_rootfs
    ensure_install
    ensure_chroot_mounts
    ensure_config

    rm -f "$APP_PID_PATH"
    if have_root_su; then
        su -c "rm -f '$CHROOT_ROOTFS$APP_DATA_DIR_IN_CHROOT/${APP_SLUG}.pid'"
    else
        rm -f "$CHROOT_ROOTFS$APP_DATA_DIR_IN_CHROOT/${APP_SLUG}.pid"
    fi

    printf -v chroot_cmd 'cd %q && PATH=%q HOME=/root TMPDIR=/tmp LANG=%q LC_ALL=%q exec %q -nobrowser %q' \
        "$APP_DATA_DIR_IN_CHROOT" \
        "$CHROOT_SYSTEM_PATH" \
        "$CHROOT_LANG" \
        "$CHROOT_LANG" \
        "$APP_INSTALL_DIR_IN_CHROOT/$APP_BINARY_NAME" \
        "-data=$APP_DATA_DIR_IN_CHROOT"

    if have_root_su; then
        printf -v root_cmd 'umask 022; nohup chroot %q /bin/sh -lc %q >> %q 2>&1 </dev/null & echo $! > %q' \
            "$CHROOT_ROOTFS" \
            "$chroot_cmd" \
            "$APP_LOG_PATH" \
            "$APP_PID_PATH"

        su -c "$root_cmd"
    else
        printf -v proot_cmd 'cd %q && PATH=%q HOME=/root TMPDIR=/tmp LANG=%q LC_ALL=%q exec %q -nobrowser %q' \
            "$APP_DATA_DIR_IN_CHROOT" \
            "$CHROOT_SYSTEM_PATH" \
            "$CHROOT_LANG" \
            "$CHROOT_LANG" \
            "$APP_INSTALL_DIR_IN_CHROOT/$APP_BINARY_NAME" \
            "-data=$APP_DATA_DIR_IN_CHROOT"
        nohup proot-distro login "$PROOT_DISTRO_ALIAS" \
            --shared-tmp \
            --fix-low-ports \
            --bind "$TERMUX_DRIVES_PATH:$CHROOT_DRIVES_PATH" \
            -- /bin/sh -lc "$proot_cmd" >> "$APP_LOG_PATH" 2>&1 </dev/null &
        printf '%s\n' "$!" > "$APP_PID_PATH"
    fi
    sleep 2

    pid="$(read_pid || true)"
    if [ -z "$pid" ] || ! signal_pid "$pid"; then
        rm -f "$APP_PID_PATH"
        return 1
    fi
}

stop_service() {
    local pid=""

    pid="$(read_pid || true)"
    if [ -n "$pid" ] && kill_pid "$pid" TERM; then
        sleep 1
        if signal_pid "$pid"; then
            kill_pid "$pid" KILL || true
        fi
    fi

    list_matching_pids | while read -r extra_pid; do
        [ -n "$extra_pid" ] || continue
        kill_pid "$extra_pid" TERM || true
        sleep 1
        if signal_pid "$extra_pid"; then
            kill_pid "$extra_pid" KILL || true
        fi
    done
    rm -f "$CHROOT_ROOTFS$APP_DATA_DIR_IN_CHROOT/${APP_SLUG}.pid"
    rm -f "$APP_PID_PATH"
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
        is_running
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status}" >&2
        exit 1
        ;;
esac
