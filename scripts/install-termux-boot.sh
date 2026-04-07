#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

PROJECT="/data/data/com.termux/files/home/home-server"
BOOT_DIR="/data/data/com.termux/files/home/.termux/boot"
DISABLED_DIR="$BOOT_DIR/disabled"
SOURCE_SCRIPT="$PROJECT/scripts/termux-boot-home-server.sh"
TARGET_SCRIPT="$BOOT_DIR/home-server.sh"
MIGRATE_LEGACY_BOOT_SCRIPTS="${MIGRATE_LEGACY_BOOT_SCRIPTS:-false}"

mkdir -p "$BOOT_DIR"
chmod 700 "$SOURCE_SCRIPT"

if [ "$MIGRATE_LEGACY_BOOT_SCRIPTS" = "true" ]; then
    mkdir -p "$DISABLED_DIR"
    for LEGACY_SCRIPT in start-services.sh start-sshd.sh; do
        if [ -f "$BOOT_DIR/$LEGACY_SCRIPT" ]; then
            mv "$BOOT_DIR/$LEGACY_SCRIPT" "$DISABLED_DIR/$LEGACY_SCRIPT.disabled"
        fi
    done
fi

if command -v sv >/dev/null 2>&1; then
    sv down nginx >/dev/null 2>&1 || true
fi

if command -v sv-disable >/dev/null 2>&1; then
    sv-disable nginx >/dev/null 2>&1 || true
fi

ln -sfn "$SOURCE_SCRIPT" "$TARGET_SCRIPT"
chmod 700 "$TARGET_SCRIPT"

printf 'Installed Termux:Boot launcher at %s\n' "$TARGET_SCRIPT"
if [ "$MIGRATE_LEGACY_BOOT_SCRIPTS" = "true" ]; then
    printf 'Disabled conflicting boot scripts under %s\n' "$DISABLED_DIR"
else
    printf 'Legacy boot script migration skipped (set MIGRATE_LEGACY_BOOT_SCRIPTS=true to move old entries)\n'
fi
