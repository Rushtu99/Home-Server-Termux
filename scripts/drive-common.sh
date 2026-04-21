#!/data/data/com.termux/files/usr/bin/bash

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
DRIVES_DIR="${DRIVES_DIR:-$USER_HOME/Drives}"
DRIVES_STATE_DIR="${DRIVES_STATE_DIR:-$DRIVES_DIR/.state}"
LEGACY_ALIAS_BACKUP_DIR="${LEGACY_ALIAS_BACKUP_DIR:-$DRIVES_STATE_DIR/legacy-alias-backups}"
DRIVES_C_DIR="${DRIVES_C_DIR:-$DRIVES_DIR/C}"
VAULT_MAIN_LABEL="${VAULT_MAIN_LABEL:-Rushtu 4TB}"
SCRATCH_MAIN_LABEL="${SCRATCH_MAIN_LABEL:-T exFAT 2TB}"
VAULT_FALLBACK_LABEL="${VAULT_FALLBACK_LABEL:-VAULT_fallback}"
SCRATCH_FALLBACK_LABEL="${SCRATCH_FALLBACK_LABEL:-SCRATCH_fallback}"
DRIVES_D_MAIN_DIR="${DRIVES_D_MAIN_DIR:-$DRIVES_DIR/D ($VAULT_MAIN_LABEL)}"
DRIVES_E_MAIN_DIR="${DRIVES_E_MAIN_DIR:-$DRIVES_DIR/E ($SCRATCH_MAIN_LABEL)}"
DRIVES_D_FALLBACK_DIR="${DRIVES_D_FALLBACK_DIR:-$DRIVES_DIR/D ($VAULT_FALLBACK_LABEL)}"
DRIVES_E_FALLBACK_DIR="${DRIVES_E_FALLBACK_DIR:-$DRIVES_DIR/E ($SCRATCH_FALLBACK_LABEL)}"
DRIVES_D_DIR="${DRIVES_D_DIR:-$DRIVES_D_FALLBACK_DIR}"
DRIVES_E_DIR="${DRIVES_E_DIR:-$DRIVES_E_FALLBACK_DIR}"
DRIVES_PS4_DIR="${DRIVES_PS4_DIR:-$DRIVES_DIR/PS4}"
TERMUX_DRIVES_MIRROR_ROOT="${TERMUX_DRIVES_MIRROR_ROOT:-/mnt/termux-drives}"
INTERNAL_STORAGE="${INTERNAL_STORAGE:-/storage/emulated/0}"
D_SOURCE="${D_SOURCE:-}"
E_SOURCE="${E_SOURCE:-}"
DRIVE_DETECT_RETRIES="${DRIVE_DETECT_RETRIES:-6}"
DRIVE_DETECT_DELAY="${DRIVE_DETECT_DELAY:-1}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
MOUNT_RUNTIME_DIR="${MOUNT_RUNTIME_DIR:-$RUNTIME_DIR/mounts}"
EXFAT_E_RAW_DIR="${EXFAT_E_RAW_DIR:-$MOUNT_RUNTIME_DIR/E-raw}"
HMSTX_DRIVE_ROLE_FILE_NAME="${HMSTX_DRIVE_ROLE_FILE_NAME:-.hmstx-role.conf}"
DRIVE_MIRROR_STATE_FILE="${DRIVE_MIRROR_STATE_FILE:-$RUNTIME_DIR/drive-mount-mirror-state.json}"
USB_MOUNT_SERVICE_CMD="${USB_MOUNT_SERVICE_CMD:-$PROJECT/scripts/usb-mount-service.sh}"
STORAGE_PRIMARY_CHECK_TIMEOUT_SEC="${STORAGE_PRIMARY_CHECK_TIMEOUT_SEC:-60}"
STORAGE_PRIMARY_CHECK_STATE_FILE="${STORAGE_PRIMARY_CHECK_STATE_FILE:-$RUNTIME_DIR/storage-primary-check.state}"
STORAGE_PRIMARY_CHECK_LOCK_FILE="${STORAGE_PRIMARY_CHECK_LOCK_FILE:-$RUNTIME_DIR/storage-primary-check.lock}"

role_primary_mount_dir() {
    case "$1" in
        vault)
            printf '%s\n' "$DRIVES_D_MAIN_DIR"
            ;;
        scratch)
            printf '%s\n' "$DRIVES_E_MAIN_DIR"
            ;;
        *)
            return 1
            ;;
    esac
}

role_primary_mount_present() {
    local role="$1"
    local mount_dir=""

    mount_dir="$(role_primary_mount_dir "$role" 2>/dev/null || true)"
    [ -n "$mount_dir" ] || return 1
    [ -d "$mount_dir" ] || return 1
    path_is_direct_mount_in_proc "$mount_dir"
}

read_primary_check_state() {
    local line=""
    local key=""
    local value=""

    PRIMARY_CHECK_LAST_EPOCH=0
    PRIMARY_CHECK_LAST_RESULT=0
    [ -f "$STORAGE_PRIMARY_CHECK_STATE_FILE" ] || return 0

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ''|\#*) continue ;;
        esac
        key="${line%%=*}"
        value="${line#*=}"
        case "$key" in
            last_epoch)
                if [ "$value" -eq "$value" ] 2>/dev/null; then
                    PRIMARY_CHECK_LAST_EPOCH="$value"
                fi
                ;;
            last_result)
                if [ "$value" -eq "$value" ] 2>/dev/null; then
                    PRIMARY_CHECK_LAST_RESULT="$value"
                fi
                ;;
        esac
    done < "$STORAGE_PRIMARY_CHECK_STATE_FILE"
}

write_primary_check_state() {
    local now_epoch="$1"
    local result_code="$2"
    local tmp_file=""

    mkdir -p "$RUNTIME_DIR"
    tmp_file="${STORAGE_PRIMARY_CHECK_STATE_FILE}.tmp.$$"
    cat > "$tmp_file" <<EOF
last_epoch=$now_epoch
last_result=$result_code
EOF
    mv -f "$tmp_file" "$STORAGE_PRIMARY_CHECK_STATE_FILE"
}

has_unavailable_primary_role() {
    local roles_csv="$1"
    local roles=()
    local role=""

    IFS=',' read -r -a roles <<< "$roles_csv"
    for role in "${roles[@]}"; do
        role="$(printf '%s' "$role" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$role" ] || continue
        case "$role" in
            vault|scratch)
                if ! role_primary_mount_present "$role"; then
                    return 0
                fi
                ;;
        esac
    done

    return 1
}

ensure_primary_mounts_checked_cached() {
    local roles_csv="${1:-vault,scratch}"
    local now_epoch=0
    local age_sec=0
    local result_code=0
    local exit_code=0

    if ! has_unavailable_primary_role "$roles_csv"; then
        return 0
    fi

    if ! command -v flock >/dev/null 2>&1; then
        if [ -x "$USB_MOUNT_SERVICE_CMD" ]; then
            "$USB_MOUNT_SERVICE_CMD" --scan-now >/dev/null 2>&1 || true
        fi
        has_unavailable_primary_role "$roles_csv" && return 1
        return 0
    fi

    mkdir -p "$RUNTIME_DIR"
    exec 9>"$STORAGE_PRIMARY_CHECK_LOCK_FILE"
    if ! flock -w 1 9; then
        exec 9>&-
        has_unavailable_primary_role "$roles_csv" && return 1
        return 0
    fi

    now_epoch="$(date +%s)"
    read_primary_check_state
    age_sec=$((now_epoch - PRIMARY_CHECK_LAST_EPOCH))
    if [ "$age_sec" -lt 0 ]; then
        age_sec="$STORAGE_PRIMARY_CHECK_TIMEOUT_SEC"
    fi

    if [ "$age_sec" -ge "$STORAGE_PRIMARY_CHECK_TIMEOUT_SEC" ] && [ -x "$USB_MOUNT_SERVICE_CMD" ]; then
        if "$USB_MOUNT_SERVICE_CMD" --scan-now >/dev/null 2>&1; then
            result_code=0
        else
            result_code=1
        fi
        write_primary_check_state "$now_epoch" "$result_code"
    fi

    if has_unavailable_primary_role "$roles_csv"; then
        exit_code=1
    fi
    flock -u 9
    exec 9>&-
    return "$exit_code"
}

proc_mounts_escape_path() {
    local target="$1"

    target="${target//\\/\\134}"
    target="${target// /\\040}"
    target="${target//$'\t'/\\011}"
    target="${target//$'\n'/\\012}"
    printf '%s\n' "$target"
}

path_is_direct_mount_in_proc() {
    local target="$1"
    local escaped_target=""
    local resolved_target=""
    local escaped_resolved_target=""

    [ -n "$target" ] || return 1
    escaped_target="$(proc_mounts_escape_path "$target")"
    if grep -Fq " $escaped_target " /proc/mounts 2>/dev/null; then
        return 0
    fi

    resolved_target="$(realpath -m "$target" 2>/dev/null || true)"
    if [ -n "$resolved_target" ] && [ "$resolved_target" != "$target" ]; then
        escaped_resolved_target="$(proc_mounts_escape_path "$resolved_target")"
        if grep -Fq " $escaped_resolved_target " /proc/mounts 2>/dev/null; then
            return 0
        fi
    fi

    return 1
}

path_mount_source() {
    local target="$1"

    [ -n "$target" ] || return 1
    findmnt -no SOURCE --target "$target" 2>/dev/null || true
}

path_mount_source_matches() {
    local target="$1"
    local expected="$2"
    local source=""
    local bind_source=""
    local normalized_expected=""
    local normalized_bind_source=""

    [ -n "$target" ] || return 1
    [ -n "$expected" ] || return 1
    source="$(path_mount_source "$target")"
    [ -n "$source" ] || return 1

    normalized_expected="$(realpath -m "$expected" 2>/dev/null || printf '%s\n' "$expected")"
    bind_source="${source##*[}"
    bind_source="${bind_source%]}"
    normalized_bind_source="$(realpath -m "$bind_source" 2>/dev/null || printf '%s\n' "$bind_source")"

    case "$source" in
        "$expected"|*"[$expected]")
            return 0
            ;;
    esac

    if [ -n "$bind_source" ] && [ "$normalized_bind_source" = "$normalized_expected" ]; then
        return 0
    fi

    return 1
}

path_mount_fstype() {
    local path="$1"
    findmnt -nr -T "$path" -o FSTYPE 2>/dev/null | head -n 1
}

path_is_external_candidate_mount() {
    local path="$1"
    local fs_type=""

    path_is_direct_mount_in_proc "$path" || return 1
    fs_type="$(path_mount_fstype "$path" || true)"
    case "$fs_type" in
        ''|f2fs|tmpfs|overlay)
            return 1
            ;;
    esac
    return 0
}

block_device_exists() {
    local device="$1"

    if [ -b "$device" ]; then
        return 0
    fi

    if command -v su >/dev/null 2>&1; then
        su -c "[ -b '$device' ]" >/dev/null 2>&1
        return $?
    fi

    return 1
}

prepare_drives_root() {
    mkdir -p "$DRIVES_DIR" "$DRIVES_STATE_DIR" "$MOUNT_RUNTIME_DIR" "$LEGACY_ALIAS_BACKUP_DIR"
    mkdir -p "$DRIVES_D_MAIN_DIR" "$DRIVES_E_MAIN_DIR"
    mkdir -p "$DRIVES_D_FALLBACK_DIR" "$DRIVES_E_FALLBACK_DIR"

    if [ ! -e "$DRIVES_C_DIR" ]; then
        mkdir -p "$DRIVES_C_DIR"
    fi

    if [ ! -d "$INTERNAL_STORAGE" ]; then
        return 0
    fi

    if path_is_direct_mount_in_proc "$DRIVES_C_DIR"; then
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

    if [ -n "$override" ] && block_device_exists "$override"; then
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

    if [ -n "$match" ] && block_device_exists "$match"; then
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

    if path_is_direct_mount_in_proc "$mount_point"; then
        printf 'mounted\n'
        return 0
    fi

    local attempt=0

    while [ "$attempt" -le "$DRIVE_DETECT_RETRIES" ]; do
        device="$(resolve_external_device "$fs_type" "$override" "$expected_uuid" "$expected_label" || true)"
        if [ -n "$device" ]; then
            break
        fi

        if [ "$attempt" -lt "$DRIVE_DETECT_RETRIES" ]; then
            sleep "$DRIVE_DETECT_DELAY"
        fi
        attempt=$((attempt + 1))
    done

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

list_external_drive_dirs() {
    find "$DRIVES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
        | while IFS= read -r drive_dir; do
            case "$(basename "$drive_dir")" in
                C|D|E|Media|.state|.recycle-bin|Vault|SCRATCH)
                    continue
                    ;;
                *)
                    printf '%s\n' "$drive_dir"
                    ;;
            esac
        done \
        | sort
}

resolve_drive_dir() {
    local token="$1"
    local candidate=""
    local normalized_token=""
    local drive_dir=""
    local base_name=""
    local fallback_match=""
    local fallback_labeled_match=""

    case "$token" in
        /*)
            candidate="$token"
            ;;
        *)
            candidate="$DRIVES_DIR/$token"
            ;;
    esac

    if [ -d "$candidate" ] && path_is_direct_mount_in_proc "$candidate"; then
        printf '%s\n' "$candidate"
        return 0
    fi

    normalized_token="$(printf '%s' "$token" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    if [ -n "$normalized_token" ] && [ "${token#/}" = "$token" ]; then
        while IFS= read -r drive_dir; do
            [ -n "$drive_dir" ] || continue
            base_name="$(basename "$drive_dir")"
            case "$base_name" in
                "$normalized_token"|"${normalized_token} "*)
                    if path_is_direct_mount_in_proc "$drive_dir"; then
                        printf '%s\n' "$drive_dir"
                        return 0
                    fi
                    case "$(printf '%s' "$base_name" | tr '[:upper:]' '[:lower:]')" in
                        *"fallback"* )
                            if [ -z "$fallback_labeled_match" ]; then
                                fallback_labeled_match="$drive_dir"
                            fi
                            ;;
                    esac
                    if [ -z "$fallback_match" ]; then
                        fallback_match="$drive_dir"
                    fi
                    ;;
            esac
        done < <(list_external_drive_dirs)
    fi

    if [ -n "$fallback_labeled_match" ]; then
        printf '%s\n' "$fallback_labeled_match"
        return 0
    fi

    if [ -n "$fallback_match" ]; then
        printf '%s\n' "$fallback_match"
        return 0
    fi

    if [ -d "$candidate" ]; then
        printf '%s\n' "$candidate"
        return 0
    fi

    return 1
}

drive_role_file_path() {
    local drive_dir="$1"
    printf '%s/%s\n' "$drive_dir" "$HMSTX_DRIVE_ROLE_FILE_NAME"
}

is_writable_dir() {
    local directory="$1"
    local probe="$directory/.hmstx-write-test.$$"

    if ! mkdir -p "$directory" 2>/dev/null; then
        return 1
    fi

    if ! : > "$probe" 2>/dev/null; then
        return 1
    fi

    rm -f "$probe" 2>/dev/null || true
    return 0
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g; s/\n/\\n/g'
}

list_mirror_drive_dirs() {
    local drive_dir=""

    while IFS= read -r drive_dir; do
        [ -n "$drive_dir" ] || continue
        if [ -f "$(drive_role_file_path "$drive_dir")" ] || path_is_direct_mount_in_proc "$drive_dir"; then
            printf '%s\n' "$drive_dir"
        fi
    done < <(list_external_drive_dirs)
}

ensure_bind_mount_path() {
    local source="$1"
    local target="$2"
    local resolved_source=""
    local resolved_target=""

    [ -n "$source" ] || return 1
    [ -n "$target" ] || return 1
    [ -d "$source" ] || return 1
    command -v su >/dev/null 2>&1 || return 1

    resolved_source="$(realpath -m "$source" 2>/dev/null || printf '%s\n' "$source")"
    resolved_target="$(realpath -m "$target" 2>/dev/null || printf '%s\n' "$target")"
    # Never create a self bind mount; it can mask the real storage state.
    if [ "$resolved_source" = "$resolved_target" ]; then
        return 0
    fi

    su -c "mkdir -p '$target'" >/dev/null 2>&1 || return 1
    if path_mount_source_matches "$target" "$source"; then
        return 0
    fi
    if path_is_direct_mount_in_proc "$target"; then
        su -c "umount -l '$target'" >/dev/null 2>&1 || true
    fi
    su -c "mkdir -p '$target' && mount --bind '$source' '$target'" >/dev/null 2>&1
}

remove_partial_bind_mount_path() {
    local target="$1"

    [ -n "$target" ] || return 0
    if command -v su >/dev/null 2>&1; then
        su -c "umount -l '$target' 2>/dev/null || true" >/dev/null 2>&1 || true
        su -c "rmdir '$target' 2>/dev/null || true" >/dev/null 2>&1 || true
    fi
}

cleanup_stale_drive_mirror_targets() {
    local desired_names="$1"
    local target_dir=""
    local target_name=""
    local source_dir=""

    [ -d "$TERMUX_DRIVES_MIRROR_ROOT" ] || return 0

    while IFS= read -r target_dir; do
        [ -n "$target_dir" ] || continue
        target_name="$(basename "$target_dir")"
        if printf '%s\n' "$desired_names" | grep -Fxq "$target_name"; then
            continue
        fi

        source_dir="$DRIVES_DIR/$target_name"
        if path_mount_source_matches "$target_dir" "$source_dir" || path_is_direct_mount_in_proc "$target_dir"; then
            remove_partial_bind_mount_path "$target_dir"
            continue
        fi

        if [ -d "$target_dir" ] && [ -z "$(find "$target_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
            remove_partial_bind_mount_path "$target_dir"
        fi
    done < <(find "$TERMUX_DRIVES_MIRROR_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
}

cleanup_legacy_drive_aliases() {
    local result_name="$1"
    local alias_name=""
    local alias_path=""
    local backup_path=""
    local timestamp_utc=""
    local entry_json=""
    local entries=()
    local -n result_ref="$result_name"

    mkdir -p "$LEGACY_ALIAS_BACKUP_DIR"
    for alias_name in D E; do
        alias_path="$DRIVES_DIR/$alias_name"
        backup_path=""
        if [ ! -e "$alias_path" ]; then
            entries+=("{\"alias\":\"$(json_escape "$alias_path")\",\"status\":\"absent\"}")
            continue
        fi
        if path_is_direct_mount_in_proc "$alias_path"; then
            entries+=("{\"alias\":\"$(json_escape "$alias_path")\",\"status\":\"conflict-active-mount\"}")
            continue
        fi

        timestamp_utc="$(date -u '+%Y%m%dT%H%M%SZ')"
        backup_path="$LEGACY_ALIAS_BACKUP_DIR/${alias_name}-${timestamp_utc}"
        mv "$alias_path" "$backup_path"
        entries+=("{\"alias\":\"$(json_escape "$alias_path")\",\"status\":\"archived\",\"backupPath\":\"$(json_escape "$backup_path")\"}")
    done

    result_ref='[]'
    if [ "${#entries[@]}" -gt 0 ]; then
        printf -v result_ref '[%s]' "$(IFS=,; printf '%s' "${entries[*]}")"
    fi
}

ensure_termux_drive_mirror() {
    local mode_name="${1:-DRIVE_MIRROR_MODE}"
    local entries_name="${2:-DRIVE_MIRROR_ENTRIES_JSON}"
    local aliases_name="${3:-DRIVE_MIRROR_ALIASES_JSON}"
    local reason_name="${4:-DRIVE_MIRROR_REASON}"
    local drive_dir=""
    local target_dir=""
    local entry_json=""
    local entries=()
    local reason=""
    local degraded=0
    local mode="fallback-termux-drives"
    local desired_names=""
    local drive_name=""
    local timestamp_utc=""
    local state_dir=""
    local -n mode_ref="$mode_name"
    local -n entries_ref="$entries_name"
    local -n aliases_ref="$aliases_name"
    local -n reason_ref="$reason_name"

    entries_ref='[]'
    aliases_ref='[]'
    mode_ref="$mode"
    reason_ref=""

    cleanup_legacy_drive_aliases "$aliases_name"

    if ! command -v su >/dev/null 2>&1; then
        reason="root helper unavailable for host mirror mounts"
        mode="fallback-termux-drives"
    elif ! su -c "mkdir -p '$TERMUX_DRIVES_MIRROR_ROOT'" >/dev/null 2>&1; then
        reason="unable to create $TERMUX_DRIVES_MIRROR_ROOT"
        mode="fallback-termux-drives"
    else
        while IFS= read -r drive_dir; do
            [ -n "$drive_dir" ] || continue
            drive_name="$(basename "$drive_dir")"
            desired_names="${desired_names}${drive_name}
"
            target_dir="$TERMUX_DRIVES_MIRROR_ROOT/$drive_name"
            if ensure_bind_mount_path "$drive_dir" "$target_dir"; then
                entries+=("{\"source\":\"$(json_escape "$drive_dir")\",\"target\":\"$(json_escape "$target_dir")\",\"status\":\"mounted\"}")
            else
                degraded=1
                entries+=("{\"source\":\"$(json_escape "$drive_dir")\",\"target\":\"$(json_escape "$target_dir")\",\"status\":\"failed\"}")
                remove_partial_bind_mount_path "$target_dir"
            fi
        done < <(list_mirror_drive_dirs)
        cleanup_stale_drive_mirror_targets "$desired_names"

        if [ "$degraded" -eq 0 ] && [ "${#entries[@]}" -gt 0 ]; then
            mode="preferred-mirror"
        elif [ "$degraded" -eq 1 ]; then
            reason="one or more host mirror mounts failed"
        else
            reason="no external drive directories resolved for host mirror"
        fi
    fi

    mode_ref="$mode"
    reason_ref="$reason"
    if [ "${#entries[@]}" -gt 0 ]; then
        printf -v entries_ref '[%s]' "$(IFS=,; printf '%s' "${entries[*]}")"
    fi

    timestamp_utc="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    state_dir="$(dirname "$DRIVE_MIRROR_STATE_FILE")"
    mkdir -p "$state_dir"
    cat > "$DRIVE_MIRROR_STATE_FILE" <<EOF
{
  "generatedAt": "$timestamp_utc",
  "mode": "$(json_escape "$mode_ref")",
  "selectedSource": "$(json_escape "$([ "$mode_ref" = "preferred-mirror" ] && printf '%s' "$TERMUX_DRIVES_MIRROR_ROOT" || printf '%s' "$DRIVES_DIR")")",
  "reason": "$(json_escape "$reason_ref")",
  "mirrors": $entries_ref,
  "legacyAliases": $aliases_ref
}
EOF
}

read_drive_mirror_state_field() {
    local field="$1"

    [ -f "$DRIVE_MIRROR_STATE_FILE" ] || return 1
    awk -F'"' -v key="$field" '$2 == key { print $4; exit }' "$DRIVE_MIRROR_STATE_FILE" 2>/dev/null || true
}

preferred_termux_drives_source() {
    local fallback_source="${1:-$DRIVES_DIR}"
    local mode=""

    mode="$(read_drive_mirror_state_field "mode" || true)"
    if [ "$mode" = "preferred-mirror" ] && [ -d "$TERMUX_DRIVES_MIRROR_ROOT" ]; then
        printf '%s\n' "$TERMUX_DRIVES_MIRROR_ROOT"
        return 0
    fi

    printf '%s\n' "$fallback_source"
}
