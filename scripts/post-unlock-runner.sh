#!/system/bin/sh

set -e

LOG_PATH="${LOG_PATH:-/data/adb/termux-home-server-unlock.log}"
STATE_PATH="${STATE_PATH:-/data/adb/termux-home-server-unlock.state}"
FORCE_RUN=0

if [ "${1:-}" = "--force" ]; then
    FORCE_RUN=1
fi

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

mkdir -p /data/adb 2>/dev/null || true
exec >>"$LOG_PATH" 2>&1

BOOT_ID="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || true)"
if [ -z "$BOOT_ID" ]; then
    BOOT_ID="unknown"
fi

if [ "$FORCE_RUN" -ne 1 ] && [ -f "$STATE_PATH" ]; then
    if grep -q "boot_id=$BOOT_ID" "$STATE_PATH" 2>/dev/null; then
        log "boot_id $BOOT_ID already handled; exiting"
        exit 0
    fi
fi

while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 1
done

log "boot completed; waiting for user unlock"

TERMUX_UID="${TERMUX_UID:-}"
if [ -z "$TERMUX_UID" ]; then
    TERMUX_UID="$(cmd package list packages -U --user 0 2>/dev/null | sed -n 's/^package:com.termux uid:\([0-9]*\)$/\1/p' | head -1)"
fi
if [ -z "$TERMUX_UID" ]; then
    TERMUX_UID="10188"
fi

TERMUX_HOME="${TERMUX_HOME:-/data/data/com.termux/files/home}"
TERMUX_PREFIX="${TERMUX_PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_PATH="${TERMUX_PATH:-$TERMUX_PREFIX/bin:/system/bin:/system/xbin}"
BOOT_SCRIPT="${BOOT_SCRIPT:-$TERMUX_HOME/home-server/scripts/termux-boot-home-server.sh}"

attempt=0
while true; do
    if su "$TERMUX_UID" -c "HOME='$TERMUX_HOME' PREFIX='$TERMUX_PREFIX' PATH='$TERMUX_PATH' test -r '$BOOT_SCRIPT'"; then
        break
    fi
    attempt=$((attempt + 1))
    if [ $((attempt % 10)) -eq 0 ]; then
        log "waiting for unlock (boot script not accessible yet)"
    fi
    sleep 1
done

log "unlock detected; launching boot script"
if su "$TERMUX_UID" -c "HOME='$TERMUX_HOME' PREFIX='$TERMUX_PREFIX' PATH='$TERMUX_PATH' '$BOOT_SCRIPT'"; then
    printf 'boot_id=%s\n' "$BOOT_ID" > "$STATE_PATH"
    log "boot script executed; state recorded"
    exit 0
fi

log "boot script failed"
exit 1
