#!/data/data/com.termux/files/usr/bin/bash

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
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
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
MOUNT_RUNTIME_DIR="${MOUNT_RUNTIME_DIR:-$RUNTIME_DIR/mounts}"
EXFAT_E_RAW_DIR="${EXFAT_E_RAW_DIR:-$MOUNT_RUNTIME_DIR/E-raw}"

prepare_drives_root() {
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

    if [ -L "$DRIVES_C_DIR" ]; then
        ln -sfn "$INTERNAL_STORAGE" "$DRIVES_C_DIR" 2>/dev/null || true
        return 0
    fi

    if [ -d "$DRIVES_C_DIR" ] && [ -z "$(ls -A "$DRIVES_C_DIR" 2>/dev/null)" ]; then
        rmdir "$DRIVES_C_DIR" 2>/dev/null || true
        ln -sfn "$INTERNAL_STORAGE" "$DRIVES_C_DIR" 2>/dev/null || true
    fi
}

resolve_external_device() {
    local fs_type="$1"
    local override="${2:-}"
    local expected_uuid="${3:-}"
    local expected_label="${4:-}"
    local match=""

    if [ -n "$override" ] && [ -b "$override" ]; then
        printf '%s\n' "$override"
        return 0
    fi

    if ! command -v su >/dev/null 2>&1; then
        return 1
    fi

    if [ -n "$expected_uuid" ]; then
        match="$(su -c "blkid 2>/dev/null | awk '/TYPE=\"$fs_type\"/ && /UUID=\"$expected_uuid\"/ { sub(/:.*/, \"\", \$1); print \$1; exit }'" 2>/dev/null || true)"
    fi

    if [ -z "$match" ] && [ -n "$expected_label" ]; then
        match="$(su -c "blkid 2>/dev/null | awk '/TYPE=\"$fs_type\"/ && /LABEL=\"$expected_label\"/ { sub(/:.*/, \"\", \$1); print \$1; exit }'" 2>/dev/null || true)"
    fi

    if [ -z "$match" ]; then
        match="$(su -c "blkid 2>/dev/null | awk '/TYPE=\"$fs_type\"/ { sub(/:.*/, \"\", \$1); print \$1; exit }'" 2>/dev/null || true)"
    fi

    if [ -n "$match" ] && [ -b "$match" ]; then
        printf '%s\n' "$match"
        return 0
    fi

    return 1
}

mount_external_drive() {
    local letter="$1"
    local mount_point="$2"
    local fs_type="$3"
    local override="${4:-}"
    local expected_uuid="${5:-}"
    local expected_label="${6:-}"
    local device=""
    local termux_uid termux_gid ntfs_3g_bin bindfs_bin raw_dir

    mkdir -p "$mount_point"

    if grep -Fq " $mount_point " /proc/mounts 2>/dev/null; then
        printf 'mounted\n'
        return 0
    fi

    device="$(resolve_external_device "$fs_type" "$override" "$expected_uuid" "$expected_label" || true)"
    if [ -z "$device" ]; then
        printf 'waiting\n'
        return 0
    fi

    termux_uid="$(id -u)"
    termux_gid="$(id -g)"

    case "$fs_type" in
        ntfs)
            ntfs_3g_bin="$(command -v ntfs-3g || true)"
            if [ -z "$ntfs_3g_bin" ]; then
                printf 'missing-ntfs-3g\n'
                return 0
            fi

            if su -c "\"$ntfs_3g_bin\" \"$device\" \"$mount_point\" -o uid=$termux_uid,gid=$termux_gid,umask=022,big_writes" >/dev/null 2>&1; then
                printf 'mounted\n'
                return 0
            fi
            ;;
        exfat)
            if mount | grep -F " $mount_point " | grep -Fq "fuse.bindfs"; then
                printf 'mounted\n'
                return 0
            fi

            bindfs_bin="$(command -v bindfs || true)"
            if [ -z "$bindfs_bin" ]; then
                printf 'missing-bindfs\n'
                return 0
            fi

            raw_dir="$MOUNT_RUNTIME_DIR/${letter}-raw"
            su -c "umount -l \"$mount_point\" 2>/dev/null || true; umount -l \"$raw_dir\" 2>/dev/null || true; mkdir -p \"$raw_dir\" \"$mount_point\"" >/dev/null 2>&1 || true
            if su -c "mount -t exfat \"$device\" \"$raw_dir\" && \"$bindfs_bin\" --force-user=$termux_uid --force-group=$termux_gid --perms=0770 \"$raw_dir\" \"$mount_point\"" >/dev/null 2>&1; then
                printf 'mounted\n'
                return 0
            fi
            ;;
    esac

    printf 'failed:%s\n' "$device"
}
