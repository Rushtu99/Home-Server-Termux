#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

PROJECT="/data/data/com.termux/files/home/home-server"
LOG_DIR="$PROJECT/logs"
BOOT_LOG_PATH="$LOG_DIR/termux-boot.log"

mkdir -p "$LOG_DIR"
exec >>"$BOOT_LOG_PATH" 2>&1

printf '[%s] termux:boot launcher starting\n' "$(date '+%Y-%m-%d %H:%M:%S')"
if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock || true
fi

cd "$PROJECT"
exec bash "$PROJECT/start.sh"
