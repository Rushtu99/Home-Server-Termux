#!/data/data/com.termux/files/usr/bin/bash

set -u

USER_HOME="/data/data/com.termux/files/home"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
DRIVES_DIR="${DRIVES_DIR:-$USER_HOME/Drives}"
DRIVES_C_DIR="${DRIVES_C_DIR:-$DRIVES_DIR/C}"
DRIVES_D_DIR="${DRIVES_D_DIR:-$DRIVES_DIR/D}"
DRIVES_E_DIR="${DRIVES_E_DIR:-$DRIVES_DIR/E}"
DRIVES_PS4_DIR="${DRIVES_PS4_DIR:-$DRIVES_DIR/PS4}"
INTERNAL_STORAGE="${INTERNAL_STORAGE:-/storage/emulated/0}"
D_SOURCE="${D_SOURCE:-}"
E_SOURCE="${E_SOURCE:-}"
D_UUID="${D_UUID:-16BA8F9DBA8F784F}"
E_UUID="${E_UUID:-8097-A8C4}"
D_LABEL="${D_LABEL:-Rushtu 4TB}"
E_LABEL="${E_LABEL:-T exFAT 2TB}"
WATCH_INTERVAL="${WATCH_INTERVAL:-15}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
MOUNT_RUNTIME_DIR="${MOUNT_RUNTIME_DIR:-$RUNTIME_DIR/mounts}"
EXFAT_E_RAW_DIR="${EXFAT_E_RAW_DIR:-$MOUNT_RUNTIME_DIR/E-raw}"

log() {
    printf '[%s] [drive-watcher] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

prepare_devices_root() {
    mkdir -p "$DRIVES_DIR" "$DRIVES_PS4_DIR" "$MOUNT_RUNTIME_DIR"

    if [ ! -e "$DRIVES_C_DIR" ]; then
        mkdir -p "$DRIVES_C_DIR"
    fi

    if [ ! -d "$INTERNAL_STORAGE" ]; then
        return 0
    fi

    if grep -Fq " $DRIVES_C_DIR " /proc/mounts 2>/dev/null; then
        return 0
    fi

    if command -v su >/dev/null 2>&1; then
        su -c "mkdir -p '$DRIVES_C_DIR' && mount --bind '$INTERNAL_STORAGE' '$DRIVES_C_DIR'" >/dev/null 2>&1 || true
    fi

    if [ -d "$DRIVES_C_DIR" ] && [ -z "$(ls -A "$DRIVES_C_DIR" 2>/dev/null)" ]; then
        rmdir "$DRIVES_C_DIR" 2>/dev/null || true
        ln -sfn "$INTERNAL_STORAGE" "$DRIVES_C_DIR" 2>/dev/null || true
    fi
}

resolve_external_device() {
    local FS_TYPE="$1"
    local OVERRIDE="${2:-}"
    local EXPECTED_UUID="${3:-}"
    local EXPECTED_LABEL="${4:-}"
    local MATCH=""

    if [ -n "$OVERRIDE" ] && [ -b "$OVERRIDE" ]; then
        printf '%s\n' "$OVERRIDE"
        return 0
    fi

    if ! command -v su >/dev/null 2>&1; then
        return 1
    fi

    if [ -n "$EXPECTED_UUID" ]; then
        MATCH="$(su -c "blkid 2>/dev/null | awk '/TYPE=\"$FS_TYPE\"/ && /UUID=\"$EXPECTED_UUID\"/ { sub(/:.*/, \"\", \$1); print \$1; exit }'" 2>/dev/null || true)"
    fi

    if [ -z "$MATCH" ] && [ -n "$EXPECTED_LABEL" ]; then
        MATCH="$(su -c "blkid 2>/dev/null | awk '/TYPE=\"$FS_TYPE\"/ && /LABEL=\"$EXPECTED_LABEL\"/ { sub(/:.*/, \"\", \$1); print \$1; exit }'" 2>/dev/null || true)"
    fi

    if [ -z "$MATCH" ]; then
        MATCH="$(su -c "blkid 2>/dev/null | awk '/TYPE=\"$FS_TYPE\"/ { sub(/:.*/, \"\", \$1); print \$1; exit }'" 2>/dev/null || true)"
    fi

    if [ -n "$MATCH" ] && [ -b "$MATCH" ]; then
        printf '%s\n' "$MATCH"
        return 0
    fi

    return 1
}

mount_external_drive() {
    local MOUNT_POINT="$1"
    local FS_TYPE="$2"
    local OVERRIDE="${3:-}"
    local EXPECTED_UUID="${4:-}"
    local EXPECTED_LABEL="${5:-}"
    local DEVICE=""
    local TERMUX_UID TERMUX_GID NTFS_3G_BIN

    mkdir -p "$MOUNT_POINT"

    if grep -Fq " $MOUNT_POINT " /proc/mounts 2>/dev/null; then
        printf 'mounted\n'
        return 0
    fi

    DEVICE="$(resolve_external_device "$FS_TYPE" "$OVERRIDE" "$EXPECTED_UUID" "$EXPECTED_LABEL" || true)"
    if [ -z "$DEVICE" ]; then
        printf 'waiting\n'
        return 0
    fi

    TERMUX_UID="$(id -u)"
    TERMUX_GID="$(id -g)"

    case "$FS_TYPE" in
        ntfs)
            NTFS_3G_BIN="$(command -v ntfs-3g || true)"
            if [ -z "$NTFS_3G_BIN" ]; then
                printf 'missing-ntfs-3g\n'
                return 0
            fi
            if su -c "\"$NTFS_3G_BIN\" \"$DEVICE\" \"$MOUNT_POINT\" -o uid=$TERMUX_UID,gid=$TERMUX_GID,umask=022,big_writes" >/dev/null 2>&1; then
                printf 'mounted\n'
                return 0
            fi
            ;;
        exfat)
            if mount | grep -F " $MOUNT_POINT " | grep -Fq "fuse.bindfs"; then
                printf 'mounted\n'
                return 0
            fi
            if ! command -v bindfs >/dev/null 2>&1; then
                printf 'missing-bindfs\n'
                return 0
            fi
            su -c "umount -l \"$MOUNT_POINT\" 2>/dev/null || true; umount -l \"$EXFAT_E_RAW_DIR\" 2>/dev/null || true; mkdir -p \"$EXFAT_E_RAW_DIR\" \"$MOUNT_POINT\"" >/dev/null 2>&1 || true
            if su -c "mount -t exfat \"$DEVICE\" \"$EXFAT_E_RAW_DIR\" && $(command -v bindfs) --force-user=$TERMUX_UID --force-group=$TERMUX_GID --perms=0770 \"$EXFAT_E_RAW_DIR\" \"$MOUNT_POINT\"" >/dev/null 2>&1; then
                printf 'mounted\n'
                return 0
            fi
            ;;
    esac

    printf 'failed:%s\n' "$DEVICE"
}

last_d=""
last_e=""

prepare_devices_root

while true; do
    prepare_devices_root

    current_d="$(mount_external_drive "$DRIVES_D_DIR" "ntfs" "$D_SOURCE" "$D_UUID" "$D_LABEL")"
    if [ "$current_d" != "$last_d" ]; then
        log "D -> $current_d"
        last_d="$current_d"
    fi

    current_e="$(mount_external_drive "$DRIVES_E_DIR" "exfat" "$E_SOURCE" "$E_UUID" "$E_LABEL")"
    if [ "$current_e" != "$last_e" ]; then
        log "E -> $current_e"
        last_e="$current_e"
    fi

    sleep "$WATCH_INTERVAL"
done
