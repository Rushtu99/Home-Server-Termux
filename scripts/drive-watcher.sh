#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
WATCH_INTERVAL="${WATCH_INTERVAL:-5}"

. "$PROJECT/scripts/drive-common.sh"

log() {
    printf '[%s] [drive-watcher] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

last_d=""
last_e=""

prepare_drives_root

while true; do
    prepare_drives_root

    current_d="$(mount_external_drive "D" "$DRIVES_D_DIR" "ntfs" "$D_SOURCE" "$D_UUID" "$D_LABEL")"
    if [ "$current_d" != "$last_d" ]; then
        log "D -> $current_d"
        last_d="$current_d"
    fi

    current_e="$(mount_external_drive "E" "$DRIVES_E_DIR" "exfat" "$E_SOURCE" "$E_UUID" "$E_LABEL")"
    if [ "$current_e" != "$last_e" ]; then
        log "E -> $current_e"
        last_e="$current_e"
    fi

    sleep "$WATCH_INTERVAL"
done
