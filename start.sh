#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

# -------------------------------
# Home Server Start Script
# -------------------------------
# Absolute paths
USER_HOME="/data/data/com.termux/files/home"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
DRIVES_DIR="${DRIVES_DIR:-$USER_HOME/Drives}"
DRIVES_C_DIR="${DRIVES_C_DIR:-$DRIVES_DIR/C}"
DRIVES_D_DIR="${DRIVES_D_DIR:-$DRIVES_DIR/D}"
DRIVES_E_DIR="${DRIVES_E_DIR:-$DRIVES_DIR/E}"
DRIVES_PS4_DIR="${DRIVES_PS4_DIR:-$DRIVES_DIR/PS4}"
INTERNAL_STORAGE="${INTERNAL_STORAGE:-/storage/emulated/0}"
FILESYSTEM_ROOT="${FILESYSTEM_ROOT:-$DRIVES_DIR}"
D_SOURCE="${D_SOURCE:-}"
E_SOURCE="${E_SOURCE:-}"
D_UUID="${D_UUID:-16BA8F9DBA8F784F}"
E_UUID="${E_UUID:-8097-A8C4}"
D_LABEL="${D_LABEL:-Rushtu 4TB}"
E_LABEL="${E_LABEL:-T exFAT 2TB}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
MOUNT_RUNTIME_DIR="${MOUNT_RUNTIME_DIR:-$RUNTIME_DIR/mounts}"
EXFAT_E_RAW_DIR="${EXFAT_E_RAW_DIR:-$MOUNT_RUNTIME_DIR/E-raw}"
FILEBROWSER_DB_PATH="${FILEBROWSER_DB_PATH:-$RUNTIME_DIR/filebrowser.db}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=128}"

mkdir -p "$LOG_DIR" "$RUNTIME_DIR" "$MOUNT_RUNTIME_DIR"
START_LOG="$LOG_DIR/start.log"
exec > >(tee -a "$START_LOG") 2>&1

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

log_info() {
    printf '[%s] INFO  %s\n' "$(timestamp)" "$1"
}

log_warn() {
    printf '[%s] WARN  %s\n' "$(timestamp)" "$1"
}

log_error() {
    printf '[%s] ERROR %s\n' "$(timestamp)" "$1"
}

log_info "Starting Home Server"

prepare_devices_root() {
    mkdir -p "$DRIVES_DIR" "$DRIVES_PS4_DIR"

    if [ ! -e "$DRIVES_C_DIR" ]; then
        mkdir -p "$DRIVES_C_DIR"
    fi

    if [ ! -d "$INTERNAL_STORAGE" ]; then
        log_warn "Internal storage path not found: $INTERNAL_STORAGE"
        return 0
    fi

    if grep -Fq " $DRIVES_C_DIR " /proc/mounts 2>/dev/null; then
        return 0
    fi

    if command -v su >/dev/null 2>&1; then
        if su -c "mkdir -p '$DRIVES_C_DIR' && mount --bind '$INTERNAL_STORAGE' '$DRIVES_C_DIR'" >/dev/null 2>&1; then
            log_info "Mounted internal storage at $DRIVES_C_DIR"
            return 0
        fi
    fi

    if [ -L "$DRIVES_C_DIR" ]; then
        ln -sfn "$INTERNAL_STORAGE" "$DRIVES_C_DIR"
        log_info "Using symlink fallback for $DRIVES_C_DIR"
        return 0
    fi

    if [ -d "$DRIVES_C_DIR" ] && [ -z "$(ls -A "$DRIVES_C_DIR" 2>/dev/null)" ]; then
        rmdir "$DRIVES_C_DIR" 2>/dev/null || true
        ln -s "$INTERNAL_STORAGE" "$DRIVES_C_DIR"
        log_info "Using symlink fallback for $DRIVES_C_DIR"
        return 0
    fi

    log_warn "Could not bind mount or safely replace $DRIVES_C_DIR"
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
    local LETTER="$1"
    local MOUNT_POINT="$2"
    local FS_TYPE="$3"
    local OVERRIDE="${4:-}"
    local EXPECTED_UUID="${5:-}"
    local EXPECTED_LABEL="${6:-}"
    local DEVICE=""
    local TERMUX_UID TERMUX_GID NTFS_3G_BIN

    mkdir -p "$MOUNT_POINT"

    if grep -Fq " $MOUNT_POINT " /proc/mounts 2>/dev/null; then
        return 0
    fi

    DEVICE="$(resolve_external_device "$FS_TYPE" "$OVERRIDE" "$EXPECTED_UUID" "$EXPECTED_LABEL" || true)"
    if [ -z "$DEVICE" ]; then
        log_info "No $FS_TYPE external drive found for $LETTER at $MOUNT_POINT"
        return 0
    fi

    TERMUX_UID="$(id -u)"
    TERMUX_GID="$(id -g)"

    case "$FS_TYPE" in
        ntfs)
            NTFS_3G_BIN="$(command -v ntfs-3g || true)"
            if [ -z "$NTFS_3G_BIN" ]; then
                log_warn "ntfs-3g not found, skipping $LETTER mount"
                return 0
            fi
            if su -c "\"$NTFS_3G_BIN\" \"$DEVICE\" \"$MOUNT_POINT\" -o uid=$TERMUX_UID,gid=$TERMUX_GID,umask=022,big_writes" >/dev/null 2>&1; then
                log_info "Mounted NTFS drive $DEVICE at $MOUNT_POINT"
                return 0
            fi
            ;;
        exfat)
            if mount | grep -F " $MOUNT_POINT " | grep -Fq "fuse.bindfs"; then
                return 0
            fi
            if ! command -v bindfs >/dev/null 2>&1; then
                log_warn "bindfs not found, cannot expose exFAT drive $LETTER cleanly"
                return 0
            fi
            su -c "umount -l \"$MOUNT_POINT\" 2>/dev/null || true; umount -l \"$EXFAT_E_RAW_DIR\" 2>/dev/null || true; mkdir -p \"$EXFAT_E_RAW_DIR\" \"$MOUNT_POINT\"" >/dev/null 2>&1 || true
            if su -c "mount -t exfat \"$DEVICE\" \"$EXFAT_E_RAW_DIR\" && $(command -v bindfs) --force-user=$TERMUX_UID --force-group=$TERMUX_GID --perms=0770 \"$EXFAT_E_RAW_DIR\" \"$MOUNT_POINT\"" >/dev/null 2>&1; then
                log_info "Mounted exFAT drive $DEVICE at $MOUNT_POINT via bindfs"
                return 0
            fi
            ;;
    esac

    log_warn "Failed to mount $FS_TYPE drive $DEVICE at $MOUNT_POINT"
}

start_drive_watcher() {
    local WATCHER="$PROJECT/scripts/drive-watcher.sh"
    local WATCHER_LOG="$LOG_DIR/drive-watcher.log"

    if [ ! -f "$WATCHER" ]; then
        log_warn "Drive watcher script not found: $WATCHER"
        return 0
    fi

    if pgrep -f "$WATCHER" >/dev/null 2>&1; then
        log_info "Drive watcher already running"
        return 0
    fi

    PROJECT="$PROJECT" \
    DRIVES_DIR="$DRIVES_DIR" \
    DRIVES_C_DIR="$DRIVES_C_DIR" \
    DRIVES_D_DIR="$DRIVES_D_DIR" \
    DRIVES_E_DIR="$DRIVES_E_DIR" \
    DRIVES_PS4_DIR="$DRIVES_PS4_DIR" \
    INTERNAL_STORAGE="$INTERNAL_STORAGE" \
    D_SOURCE="$D_SOURCE" \
    E_SOURCE="$E_SOURCE" \
    D_UUID="$D_UUID" \
    E_UUID="$E_UUID" \
    D_LABEL="$D_LABEL" \
    E_LABEL="$E_LABEL" \
    RUNTIME_DIR="$RUNTIME_DIR" \
    MOUNT_RUNTIME_DIR="$MOUNT_RUNTIME_DIR" \
    EXFAT_E_RAW_DIR="$EXFAT_E_RAW_DIR" \
    nohup bash "$WATCHER" >> "$WATCHER_LOG" 2>&1 </dev/null &
    log_info "Drive watcher started"
}

prepare_devices_root
mount_external_drive "D" "$DRIVES_D_DIR" "ntfs" "$D_SOURCE" "$D_UUID" "$D_LABEL"
mount_external_drive "E" "$DRIVES_E_DIR" "exfat" "$E_SOURCE" "$E_UUID" "$E_LABEL"
start_drive_watcher

if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock
fi

detect_host_ip() {
    local HOST_IP=""

    if command -v ifconfig >/dev/null 2>&1; then
        HOST_IP=$(ifconfig wlan0 2>/dev/null | awk '/inet / { print $2; exit }')
        if [ -z "$HOST_IP" ]; then
            HOST_IP=$(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" { print $2; exit }')
        fi
    fi

    if [ -n "$HOST_IP" ]; then
        printf '%s\n' "$HOST_IP"
    else
        printf '127.0.0.1\n'
    fi
}

# --- Helper: wait for port ---
wait_for_port() {
    local PORT=$1
    local NAME=$2
    local SLEEP=1
    local ATTEMPTS=0

    log_info "Waiting for $NAME on port $PORT"
    while true; do
        if command -v nc >/dev/null 2>&1; then
            if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
                log_info "$NAME is up on port $PORT"
                return 0
            fi
        elif ss -tuln 2>/dev/null | grep -q ":$PORT\\b"; then
            log_info "$NAME is up on port $PORT"
            return 0
        fi

        ATTEMPTS=$((ATTEMPTS + 1))
        if [ $((ATTEMPTS % 5)) -eq 0 ]; then
            log_info "Still waiting for $NAME on port $PORT"
        fi
        sleep $SLEEP
    done
}

# --- Cleanup ---
log_info "Cleaning old processes"
pkill -f "node index.js" 2>/dev/null || true
pkill -f "next dev --webpack --hostname 0.0.0.0" 2>/dev/null || true
pkill -f "next start -H 0.0.0.0" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
pkill filebrowser 2>/dev/null || true
pkill nginx 2>/dev/null || true
pkill ttyd 2>/dev/null || true

# ⚠ Do NOT kill sshd
# pkill sshd

# --- SSH ---
log_info "Checking SSH"
if command -v sshd >/dev/null 2>&1; then
    pgrep sshd >/dev/null || sshd
fi
sleep 1

# --- Backend ---
log_info "Starting backend"
cd "$PROJECT/server" || { log_error "Backend directory not found"; exit 1; }
node index.js > "$LOG_DIR/backend.log" 2>&1 &
wait_for_port 4000 "Backend"

# --- Filebrowser ---
log_info "Starting FileBrowser"
if command -v filebrowser >/dev/null 2>&1; then
    filebrowser config set -d "$FILEBROWSER_DB_PATH" --auth.method=noauth >/dev/null 2>&1 || true
    filebrowser -d "$FILEBROWSER_DB_PATH" -r "$FILESYSTEM_ROOT" -p 8080 -a 127.0.0.1 -b /files --noauth > "$LOG_DIR/filebrowser.log" 2>&1 &
    wait_for_port 8080 "FileBrowser"
else
    log_warn "Skipping FileBrowser (command not found)"
fi

# --- Nginx ---
log_info "Starting nginx"
if command -v nginx >/dev/null 2>&1; then
    mkdir -p "$PROJECT/logs"
    nginx -p "$PROJECT" -c "$PROJECT/nginx.conf"
    wait_for_port 8088 "nginx"
else
    log_warn "Skipping nginx (command not found)"
fi

# --- Terminal ---
log_info "Starting ttyd"
if command -v ttyd >/dev/null 2>&1; then
    ttyd -W -i 127.0.0.1 -p 7681 -w "$PROJECT" bash -l > "$LOG_DIR/ttyd.log" 2>&1 &
    wait_for_port 7681 "ttyd"
else
    log_warn "Skipping ttyd (command not found)"
fi

# --- Frontend ---
log_info "Starting frontend"
cd "$PROJECT/dashboard" || { log_error "Dashboard directory not found"; exit 1; }
if [ -f ".next/BUILD_ID" ]; then
    npm start > "$LOG_DIR/frontend.log" 2>&1 &
else
    npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
fi
wait_for_port 3000 "Frontend"

# --- Done ---
HOST_IP=$(detect_host_ip)
log_info "Home Server started"
printf '[%s] INFO  Dashboard: http://%s:8088\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Files:     http://%s:8088/files\n' "$(timestamp)" "$HOST_IP"
printf '[%s] INFO  Terminal:  http://%s:8088/term\n' "$(timestamp)" "$HOST_IP"

# --- Keep script alive ---
wait
