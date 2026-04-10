#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"
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

if [ -f "$PROJECT/scripts/drive-common.sh" ]; then
    . "$PROJECT/scripts/drive-common.sh"
fi

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

ensure_root_bind_mount() {
    local source="$1"
    local target="$2"

    [ -n "$source" ] || return 1
    [ -n "$target" ] || return 1

    su -c "mkdir -p '$target'" >/dev/null 2>&1 || return 1
    if type path_mount_source_matches >/dev/null 2>&1 && path_mount_source_matches "$target" "$source"; then
        return 0
    fi
    if type path_is_direct_mount_in_proc >/dev/null 2>&1 && path_is_direct_mount_in_proc "$target"; then
        su -c "umount -l '$target'" >/dev/null 2>&1 || true
    fi
    su -c "mount --bind '$source' '$target'" >/dev/null 2>&1
}

ensure_root_bind_child_mounts() {
    local source_root="$1"
    local target_root="$2"
    local source_dir=""
    local source_name=""
    local target_dir=""
    local desired_names=""

    [ -d "$source_root" ] || return 0
    su -c "mkdir -p '$target_root'" >/dev/null 2>&1 || return 1

    while IFS= read -r source_dir; do
        [ -n "$source_dir" ] || continue
        source_name="$(basename "$source_dir")"
        target_dir="$target_root/$source_name"
        desired_names="${desired_names}${source_name}
"
        ensure_root_bind_mount "$source_dir" "$target_dir" || return 1
    done < <(find "$source_root" -mindepth 1 -maxdepth 1 -type d | sort)

    while IFS= read -r target_dir; do
        [ -n "$target_dir" ] || continue
        source_name="$(basename "$target_dir")"
        if printf '%s\n' "$desired_names" | grep -Fxq "$source_name"; then
            continue
        fi
        if type path_is_direct_mount_in_proc >/dev/null 2>&1 && path_is_direct_mount_in_proc "$target_dir"; then
            su -c "umount -l '$target_dir'" >/dev/null 2>&1 || true
        fi
        su -c "rmdir '$target_dir' 2>/dev/null || true" >/dev/null 2>&1 || true
    done < <(find "$target_root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
}

preferred_chroot_drives_source() {
    if ! have_root_su; then
        printf '%s\n' "$TERMUX_DRIVES_PATH"
        return 0
    fi

    if type preferred_termux_drives_source >/dev/null 2>&1; then
        preferred_termux_drives_source "$TERMUX_DRIVES_PATH"
        return 0
    fi

    printf '%s\n' "$TERMUX_DRIVES_PATH"
}

ensure_chroot_mounts() {
    local preferred_source=""
    local fallback_source="$TERMUX_DRIVES_PATH"
    local selected_source=""

    if have_root_su; then
        su -c "mkdir -p '$CHROOT_ROOTFS/dev' '$CHROOT_ROOTFS/proc' '$CHROOT_ROOTFS/sys' '$CHROOT_ROOTFS$CHROOT_DRIVES_PATH' '$CHROOT_ROOTFS$APP_DATA_DIR_IN_CHROOT'"
        su -c "grep -q ' $CHROOT_ROOTFS/dev ' /proc/mounts || mount --bind /dev '$CHROOT_ROOTFS/dev'"
        su -c "grep -q ' $CHROOT_ROOTFS/proc ' /proc/mounts || mount -t proc proc '$CHROOT_ROOTFS/proc'"
        su -c "grep -q ' $CHROOT_ROOTFS/sys ' /proc/mounts || mount -t sysfs sysfs '$CHROOT_ROOTFS/sys'"
        preferred_source="$(preferred_chroot_drives_source)"
        if ! ensure_root_bind_mount "$preferred_source" "$CHROOT_ROOTFS$CHROOT_DRIVES_PATH"; then
            if [ "$preferred_source" != "$fallback_source" ]; then
                ensure_root_bind_mount "$fallback_source" "$CHROOT_ROOTFS$CHROOT_DRIVES_PATH" || return 1
                selected_source="$fallback_source"
            else
                return 1
            fi
        else
            selected_source="$preferred_source"
        fi
        ensure_root_bind_child_mounts "$selected_source" "$CHROOT_ROOTFS$CHROOT_DRIVES_PATH" || return 1
        return 0
    fi

    mkdir -p "$CHROOT_ROOTFS$CHROOT_DRIVES_PATH" "$CHROOT_ROOTFS$APP_DATA_DIR_IN_CHROOT"
}

ensure_config() {
    local url_base=""

    mkdir -p "$(dirname "$APP_CONFIG_PATH")"
    url_base="${APP_URL_BASE#/}"
    python3 - "$APP_CONFIG_PATH" "$APP_BIND_HOST" "$APP_PORT" "$url_base" <<'PY'
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

config_path = Path(sys.argv[1])
bind_host = sys.argv[2]
port = sys.argv[3]
url_base = sys.argv[4]

if config_path.exists():
    try:
        root = ET.fromstring(config_path.read_text())
    except ET.ParseError:
        root = ET.Element("Config")
else:
    root = ET.Element("Config")

if root.tag != "Config":
    root = ET.Element("Config")

def set_child(name: str, value: str) -> None:
    node = root.find(name)
    if node is None:
        node = ET.SubElement(root, name)
    node.text = value

set_child("BindAddress", bind_host)
set_child("Port", port)
set_child("UrlBase", url_base)
set_child("LaunchBrowser", "False")

ET.ElementTree(root).write(config_path, encoding="unicode")
PY
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
