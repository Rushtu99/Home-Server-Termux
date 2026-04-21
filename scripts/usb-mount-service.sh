#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="${USB_MOUNT_CONFIG_PATH:-$SCRIPT_DIR/usb-mount-service.conf}"

if [ -f "$CONFIG_PATH" ]; then
    # shellcheck source=/dev/null
    . "$CONFIG_PATH"
fi

DRIVE_COMMON_SCRIPT="${DRIVE_COMMON_SCRIPT:-$SCRIPT_DIR/drive-common.sh}"
if [ ! -f "$DRIVE_COMMON_SCRIPT" ]; then
    printf 'Missing shared helper script: %s\n' "$DRIVE_COMMON_SCRIPT" >&2
    exit 1
fi
# shellcheck source=/dev/null
. "$DRIVE_COMMON_SCRIPT"

USB_MOUNT_PATHS_CSV="${USB_MOUNT_PATHS:-$USER_HOME/Drives,/mnt/termux-drives}"
USB_MOUNT_VAULT_UUID="${USB_MOUNT_VAULT_UUID:-16BA8F9DBA8F784F}"
USB_MOUNT_VAULT_LABEL="${USB_MOUNT_VAULT_LABEL:-Rushtu 4TB}"
USB_MOUNT_SCRATCH_UUID="${USB_MOUNT_SCRATCH_UUID:-8097-A8C4}"
USB_MOUNT_SCRATCH_LABEL="${USB_MOUNT_SCRATCH_LABEL:-T exFAT 2TB}"
USB_MOUNT_VAULT_MAIN_LABEL="${USB_MOUNT_VAULT_MAIN_LABEL:-$USB_MOUNT_VAULT_LABEL}"
USB_MOUNT_SCRATCH_MAIN_LABEL="${USB_MOUNT_SCRATCH_MAIN_LABEL:-$USB_MOUNT_SCRATCH_LABEL}"
USB_MOUNT_VAULT_FALLBACK_LABEL="${USB_MOUNT_VAULT_FALLBACK_LABEL:-${VAULT_FALLBACK_LABEL:-VAULT_fallback}}"
USB_MOUNT_SCRATCH_FALLBACK_LABEL="${USB_MOUNT_SCRATCH_FALLBACK_LABEL:-${SCRATCH_FALLBACK_LABEL:-SCRATCH_fallback}}"
USB_MOUNT_COMPAT_ALIASES="${USB_MOUNT_COMPAT_ALIASES:-false}"
USB_MOUNT_INTERVAL_SEC="${USB_MOUNT_INTERVAL_SEC:-15}"
USB_MOUNT_STATE_PATH="${USB_MOUNT_STATE_PATH:-$DRIVES_STATE_DIR/drives.json}"
USB_MOUNT_EVENTS_PATH="${USB_MOUNT_EVENTS_PATH:-$DRIVES_STATE_DIR/drive-events.jsonl}"
USB_MOUNT_LOG_PATH="${USB_MOUNT_LOG_PATH:-$PROJECT/logs/usb-mount-service.log}"
USB_MOUNT_PID_PATH="${USB_MOUNT_PID_PATH:-$PROJECT/runtime/usb-mount-service.pid}"

mkdir -p "$(dirname "$USB_MOUNT_STATE_PATH")" "$(dirname "$USB_MOUNT_EVENTS_PATH")" "$(dirname "$USB_MOUNT_LOG_PATH")" "$(dirname "$USB_MOUNT_PID_PATH")"

split_csv_into_array() {
    local csv="$1"
    local out_ref="$2"
    local cleaned

    cleaned="$(printf '%s' "$csv" | tr ';' ',' | tr '\n' ',' | sed 's/[[:space:]]*,[[:space:]]*/,/g; s/^,*//; s/,*$//')"
    local -a items=()
    local token

    IFS=',' read -r -a items <<< "$cleaned"
    local -a normalized=()
    for token in "${items[@]}"; do
        token="${token#${token%%[![:space:]]*}}"
        token="${token%${token##*[![:space:]]}}"
        [ -n "$token" ] && normalized+=("$token")
    done

    eval "$out_ref=()"
    for token in "${normalized[@]}"; do
        eval "$out_ref+=(\"$token\")"
    done
}

append_event() {
    local level="$1"
    local event="$2"
    local message="$3"
    local meta="${4:-}"
    local ts

    ts="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    if [ -n "$meta" ]; then
        printf '{"timestamp":"%s","level":"%s","event":"%s","message":"%s","meta":%s}\n' \
            "$ts" "$(json_escape "$level")" "$(json_escape "$event")" "$(json_escape "$message")" "$meta" >> "$USB_MOUNT_EVENTS_PATH"
    else
        printf '{"timestamp":"%s","level":"%s","event":"%s","message":"%s"}\n' \
            "$ts" "$(json_escape "$level")" "$(json_escape "$event")" "$(json_escape "$message")" >> "$USB_MOUNT_EVENTS_PATH"
    fi
}

is_truthy() {
    case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

get_usb_device_rows() {
    local -a usb_parts=()
    local disk=""
    local part=""
    local line=""
    local uuid=""
    local label=""
    local fstype=""
    local blkid_cache=""

    mapfile -t usb_parts < <(su -c "lsblk -nr -o NAME,TYPE,PKNAME,TRAN" 2>/dev/null | awk '
        $2=="disk" && $4=="usb" { usb[$1]=1; next }
        $2=="part" && ($4=="usb" || usb[$3]) { print $1 }
    ')
    for part in "${usb_parts[@]}"; do
        [ -n "$part" ] || continue
        disk="$(printf '%s\n' "$part" | sed 's/p\{0,1\}[0-9]\+$//')"
        [ -z "$disk" ] && disk="$part"
        line="$(su -c "blkid /dev/block/$part 2>/dev/null" 2>/dev/null || true)"
        uuid="$(printf '%s\n' "$line" | sed -n 's/.* UUID="\([^"]*\)".*/\1/p')"
        label="$(printf '%s\n' "$line" | sed -n 's/.* LABEL="\([^"]*\)".*/\1/p')"
        fstype="$(printf '%s\n' "$line" | sed -n 's/.* TYPE="\([^"]*\)".*/\1/p')"
        [ -z "$uuid" ] && uuid="-"
        [ -z "$label" ] && label="-"
        [ -z "$fstype" ] && fstype="unknown"
        printf '%s\t%s\t%s\t%s\t%s\n' "$disk" "$part" "$uuid" "$label" "$fstype"
    done

    if [ "${#usb_parts[@]}" -gt 0 ]; then
        return 0
    fi

    # Fallback path for hosts where lsblk transport metadata is unavailable.
    blkid_cache="$(su -c "blkid 2>/dev/null" 2>/dev/null || true)"
    local role_uuid=""
    for role_uuid in "$USB_MOUNT_VAULT_UUID" "$USB_MOUNT_SCRATCH_UUID"; do
        [ -n "$role_uuid" ] || continue
        line="$(printf '%s\n' "$blkid_cache" | awk -v uuid="$role_uuid" 'index($0, "UUID=\"" uuid "\"") { print; exit }')"
        [ -n "$line" ] || continue

        local device=""
        device="$(printf '%s\n' "$line" | sed 's/:.*//')"
        part="${device##*/}"
        disk="$(printf '%s\n' "$part" | sed 's/p\{0,1\}[0-9]\+$//')"
        [ -z "$disk" ] && disk="$part"

        uuid="$(printf '%s\n' "$line" | sed -n 's/.* UUID="\([^"]*\)".*/\1/p')"
        label="$(printf '%s\n' "$line" | sed -n 's/.* LABEL="\([^"]*\)".*/\1/p')"
        fstype="$(printf '%s\n' "$line" | sed -n 's/.* TYPE="\([^"]*\)".*/\1/p')"
        [ -z "$uuid" ] && uuid="-"
        [ -z "$label" ] && label="-"
        [ -z "$fstype" ] && fstype="unknown"
        printf '%s\t%s\t%s\t%s\t%s\n' "$disk" "$part" "$uuid" "$label" "$fstype"
    done
}

role_for_uuid() {
    local uuid="$1"

    if [ "$uuid" = "$USB_MOUNT_VAULT_UUID" ]; then
        printf 'VAULT\n'
        return 0
    fi
    if [ "$uuid" = "$USB_MOUNT_SCRATCH_UUID" ]; then
        printf 'SCRATCH\n'
        return 0
    fi

    printf 'USB\n'
}

role_letter() {
    local role="$1"
    case "$role" in
        VAULT) printf 'D\n' ;;
        SCRATCH) printf 'E\n' ;;
        *) printf '\n' ;;
    esac
}

role_main_label() {
    local role="$1"
    case "$role" in
        VAULT) printf '%s\n' "$USB_MOUNT_VAULT_MAIN_LABEL" ;;
        SCRATCH) printf '%s\n' "$USB_MOUNT_SCRATCH_MAIN_LABEL" ;;
        *) printf '\n' ;;
    esac
}

role_fallback_label() {
    local role="$1"
    case "$role" in
        VAULT) printf '%s\n' "$USB_MOUNT_VAULT_FALLBACK_LABEL" ;;
        SCRATCH) printf '%s\n' "$USB_MOUNT_SCRATCH_FALLBACK_LABEL" ;;
        *) printf '\n' ;;
    esac
}

role_uuid() {
    local role="$1"
    case "$role" in
        VAULT) printf '%s\n' "$USB_MOUNT_VAULT_UUID" ;;
        SCRATCH) printf '%s\n' "$USB_MOUNT_SCRATCH_UUID" ;;
        *) printf '-\n' ;;
    esac
}

named_mount_dir() {
    local letter="$1"
    local label="$2"
    local cleaned_label=""

    if [ -z "$letter" ]; then
        printf '\n'
        return 0
    fi

    if [ -z "$label" ] || [ "$label" = "-" ]; then
        printf '%s\n' "$letter"
        return 0
    fi

    cleaned_label="$(printf '%s' "$label" | tr '\r\n' ' ' | sed 's#/#-#g; s/[[:space:]]\+/ /g; s/^ //; s/ $//')"
    if [ -z "$cleaned_label" ]; then
        printf '%s\n' "$letter"
        return 0
    fi

    printf '%s (%s)\n' "$letter" "$cleaned_label"
}

mount_role_drive() {
    local mount_token="$1"
    local part="$2"
    local uuid="$3"
    local label="$4"
    local fstype="$5"
    local primary_target="$6"
    shift 6
    local extra_targets=("$@")
    local device="/dev/block/$part"
    local status=""

    if path_is_direct_mount_in_proc "$primary_target"; then
        local existing_fs=""
        existing_fs="$(path_mount_fstype "$primary_target" || true)"
        case "$existing_fs" in
            f2fs|tmpfs|overlay)
                # Stale/self mount on internal storage; clear and remount properly.
                remove_partial_bind_mount_path "$primary_target" || true
                status="$(mount_external_drive "$mount_token" "$primary_target" "$fstype" "$device" "$uuid" "$label")"
                ;;
            *)
                status="mounted"
                ;;
        esac
    else
        status="$(mount_external_drive "$mount_token" "$primary_target" "$fstype" "$device" "$uuid" "$label")"
    fi

    if [ "$status" = "mounted" ]; then
        local target=""
        for target in "${extra_targets[@]}"; do
            [ "$target" = "$primary_target" ] && continue
            ensure_bind_mount_path "$primary_target" "$target" || true
        done
    fi

    printf '%s\n' "$status"
}

resolve_mountpoint_for_device() {
    local device="$1"
    findmnt -nr -S "$device" -o TARGET 2>/dev/null | head -n 1
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

clear_role_mount_targets() {
    local letter="$1"
    local dir_name="$2"
    local include_aliases="${3:-false}"
    shift 3
    local mount_paths=("$@")
    local target_base=""
    local target=""

    for target_base in "${mount_paths[@]}"; do
        if is_truthy "$include_aliases"; then
            target="$target_base/$letter"
            if path_is_direct_mount_in_proc "$target"; then
                remove_partial_bind_mount_path "$target" || true
            fi
        fi

        target="$target_base/$dir_name"
        if path_is_direct_mount_in_proc "$target"; then
            remove_partial_bind_mount_path "$target" || true
        fi
    done
}

scan_once() {
    local now
    now="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

    local -a mount_paths=()
    split_csv_into_array "$USB_MOUNT_PATHS_CSV" mount_paths
    if [ "${#mount_paths[@]}" -eq 0 ]; then
        mount_paths=("$USER_HOME/Drives")
    fi

    local base=""
    for base in "${mount_paths[@]}"; do
        mkdir -p "$base"
    done

    prepare_drives_root

    local primary_root="${mount_paths[0]}"
    local drives_json=""
    local drives_sep=""
    local detected=0
    local vault_seen=0
    local scratch_seen=0
    local compat_aliases_enabled="false"

    if is_truthy "$USB_MOUNT_COMPAT_ALIASES"; then
        compat_aliases_enabled="true"
    fi

    while IFS=$'\t' read -r disk part uuid label fstype; do
        [ -n "$part" ] || continue
        detected=$((detected + 1))

        local role=""
        role="$(role_for_uuid "$uuid")"

        local mount_role="usb"
        local letter=""
        local dir_name=""
        local mount_point=""
        local raw_mount_point=""
        local state="unmounted"
        local err=""
        local status=""
        local display_name=""
        local device="/dev/block/$part"

        if [ "$role" = "VAULT" ] || [ "$role" = "SCRATCH" ]; then
            local main_label=""
            main_label="$(role_main_label "$role")"
            mount_role="$(printf '%s' "$role" | tr '[:upper:]' '[:lower:]')"
            letter="$(role_letter "$role")"
            dir_name="$(named_mount_dir "$letter" "$main_label")"
            mount_point="$primary_root/$dir_name"
            raw_mount_point="$DRIVES_STATE_DIR/raw/${letter}-raw"
            local service_mount_point="$mount_point"

            local -a bind_targets=("$service_mount_point")
            local target_base=""
            for target_base in "${mount_paths[@]}"; do
                bind_targets+=("$target_base/$dir_name")
                if [ "$compat_aliases_enabled" = "true" ]; then
                    bind_targets+=("$target_base/$letter")
                fi
            done

            status="$(mount_role_drive "$letter" "$part" "$uuid" "$main_label" "$fstype" "$service_mount_point" "${bind_targets[@]}")"
            case "$status" in
                mounted)
                    state="mounted"
                    ;;
                waiting)
                    state="starting"
                    ;;
                missing-ntfs-3g)
                    state="error"
                    err="ntfs-3g not found"
                    ;;
                missing-bindfs)
                    state="error"
                    err="bindfs not found"
                    ;;
                failed:*)
                    state="error"
                    err="mount failed (${status#failed:})"
                    ;;
                *)
                    state="error"
                    err="$status"
                    ;;
            esac

            if [ "$role" = "VAULT" ]; then
                vault_seen=1
            else
                scratch_seen=1
            fi

            if [ "$state" != "mounted" ]; then
                clear_role_mount_targets "$letter" "$dir_name" "$compat_aliases_enabled" "${mount_paths[@]}"
            fi

            if [ "$state" = "error" ]; then
                append_event "warn" "mount_error" "Failed to mount $role" "{\"role\":\"$(json_escape "$role")\",\"device\":\"$(json_escape "$device")\",\"error\":\"$(json_escape "$err")\"}"
            fi

            if [ "$main_label" != "-" ]; then
                display_name="$main_label"
            else
                display_name="$dir_name"
            fi
        else
            mount_point="$(resolve_mountpoint_for_device "$device" || true)"
            if [ -n "$mount_point" ]; then
                state="mounted"
            else
                state="unmounted"
                err="unmanaged usb drive"
            fi

            if [ "$label" != "-" ]; then
                dir_name="$label"
            else
                dir_name="$disk"
            fi

            if [ "$label" != "-" ]; then
                display_name="$label"
            else
                display_name="$dir_name"
            fi
        fi

        drives_json+="$drives_sep{\"device\":\"$(json_escape "$device")\",\"dirName\":\"$(json_escape "$dir_name")\",\"error\":\"$(json_escape "$err")\",\"filesystem\":\"$(json_escape "$fstype")\",\"letter\":\"$(json_escape "$letter")\",\"mountPoint\":\"$(json_escape "$mount_point")\",\"mountRole\":\"$(json_escape "$mount_role")\",\"name\":\"$(json_escape "$display_name")\",\"rawMountPoint\":\"$(json_escape "$raw_mount_point")\",\"role\":\"$(json_escape "$role")\",\"state\":\"$(json_escape "$state")\",\"uuid\":\"$(json_escape "$uuid")\"}"
        drives_sep=","
    done < <(get_usb_device_rows)

    local role_name=""
    for role_name in VAULT SCRATCH; do
        local role_seen=0
        local role_mount_role=""
        local role_letter_value=""
        local role_main_label=""
        local role_main_dir=""
        local role_fallback_label=""
        local role_fallback_dir=""
        local role_fallback_source=""
        local role_fallback_state="standby"
        local role_fallback_error=""
        local role_fallback_base=""
        local role_fallback_target=""
        local role_fallback_mount_point=""
        local role_fallback_uuid=""

        role_mount_role="$(printf '%s' "$role_name" | tr '[:upper:]' '[:lower:]')"
        role_letter_value="$(role_letter "$role_name")"
        role_main_label="$(role_main_label "$role_name")"
        role_main_dir="$(named_mount_dir "$role_letter_value" "$role_main_label")"
        role_fallback_label="$(role_fallback_label "$role_name")"
        role_fallback_dir="$(named_mount_dir "$role_letter_value" "$role_fallback_label")"
        role_fallback_source="$DRIVES_DIR/$role_fallback_dir"
        role_fallback_mount_point="$primary_root/$role_fallback_dir"
        role_fallback_uuid="$(role_uuid "$role_name")"

        if [ "$role_name" = "VAULT" ]; then
            role_seen="$vault_seen"
        else
            role_seen="$scratch_seen"
        fi

        if [ "$role_seen" -eq 0 ]; then
            role_fallback_state="mounted"
            clear_role_mount_targets "$role_letter_value" "$role_main_dir" "$compat_aliases_enabled" "${mount_paths[@]}"
        fi

        mkdir -p "$role_fallback_source"
        if type is_writable_dir >/dev/null 2>&1 && ! is_writable_dir "$role_fallback_source"; then
            role_fallback_state="error"
            role_fallback_error="fallback root is not writable"
        fi

        for role_fallback_base in "${mount_paths[@]}"; do
            role_fallback_target="$role_fallback_base/$role_fallback_dir"
            if [ "$role_fallback_target" != "$role_fallback_source" ]; then
                ensure_bind_mount_path "$role_fallback_source" "$role_fallback_target" || true
            fi
            if [ "$compat_aliases_enabled" = "true" ]; then
                ensure_bind_mount_path "$role_fallback_source" "$role_fallback_base/$role_letter_value" || true
            fi
        done

        drives_json+="$drives_sep{\"device\":\"-\",\"dirName\":\"$(json_escape "$role_fallback_dir")\",\"error\":\"$(json_escape "$role_fallback_error")\",\"filesystem\":\"internal\",\"letter\":\"$(json_escape "$role_letter_value")\",\"mountPoint\":\"$(json_escape "$role_fallback_mount_point")\",\"mountRole\":\"$(json_escape "${role_mount_role}-fallback")\",\"name\":\"$(json_escape "$role_fallback_label")\",\"rawMountPoint\":\"\",\"role\":\"$(json_escape "$role_name")\",\"state\":\"$(json_escape "$role_fallback_state")\",\"uuid\":\"$(json_escape "$role_fallback_uuid")\"}"
        drives_sep=","
    done

    local tmp_file
    tmp_file="${USB_MOUNT_STATE_PATH}.tmp.$$"
    cat > "$tmp_file" <<JSON
{
  "agentVersion": 2,
  "generatedAt": "$now",
  "intervalMs": $((USB_MOUNT_INTERVAL_SEC * 1000)),
  "drives": [${drives_json}]
}
JSON
    mv "$tmp_file" "$USB_MOUNT_STATE_PATH"

    append_event "info" "scan_complete" "USB scan complete" "{\"detected\":$detected}"
}

daemon_loop() {
    printf '%s\n' "$$" > "$USB_MOUNT_PID_PATH"
    trap 'rm -f "$USB_MOUNT_PID_PATH"' EXIT INT TERM
    append_event "info" "daemon_started" "USB mount daemon started" "{\"intervalSec\":$USB_MOUNT_INTERVAL_SEC}"

    while true; do
        scan_once
        sleep "$USB_MOUNT_INTERVAL_SEC"
    done
}

is_daemon_running() {
    [ -f "$USB_MOUNT_PID_PATH" ] || return 1
    local pid
    pid="$(tr -d '[:space:]' < "$USB_MOUNT_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null
}

start_daemon() {
    if is_daemon_running; then
        printf 'usb-mount-service already running (pid %s)\n' "$(cat "$USB_MOUNT_PID_PATH")"
        return 0
    fi

    nohup "$0" --daemon >> "$USB_MOUNT_LOG_PATH" 2>&1 &
    sleep 1

    if is_daemon_running; then
        printf 'usb-mount-service started (pid %s)\n' "$(cat "$USB_MOUNT_PID_PATH")"
        return 0
    fi

    printf 'Failed to start usb-mount-service; inspect %s\n' "$USB_MOUNT_LOG_PATH" >&2
    return 1
}

stop_daemon() {
    if ! is_daemon_running; then
        rm -f "$USB_MOUNT_PID_PATH"
        printf 'usb-mount-service is not running\n'
        return 0
    fi

    local pid
    pid="$(cat "$USB_MOUNT_PID_PATH")"
    kill "$pid" 2>/dev/null || true

    local wait_count=0
    while kill -0 "$pid" 2>/dev/null && [ "$wait_count" -lt 20 ]; do
        sleep 0.25
        wait_count=$((wait_count + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
    fi

    rm -f "$USB_MOUNT_PID_PATH"
    append_event "info" "daemon_stopped" "USB mount daemon stopped"
    printf 'usb-mount-service stopped\n'
}

status_daemon() {
    if is_daemon_running; then
        printf 'running (pid %s)\n' "$(cat "$USB_MOUNT_PID_PATH")"
    else
        printf 'stopped\n'
    fi
}

usage() {
    cat <<USAGE
Usage: $0 [command]

Commands:
  --scan-now     Run one detect+mount cycle immediately
  --daemon       Run continuous detect+mount loop
  start          Start daemon in background
  stop           Stop daemon
  status         Print daemon status
USAGE
}

case "${1:-}" in
    --scan-now)
        scan_once
        ;;
    --daemon)
        daemon_loop
        ;;
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    status)
        status_daemon
        ;;
    *)
        usage
        exit 1
        ;;
esac
