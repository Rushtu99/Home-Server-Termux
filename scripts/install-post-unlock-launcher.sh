#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

PROJECT="/data/data/com.termux/files/home/home-server"
SOURCE_SCRIPT="$PROJECT/scripts/post-unlock-runner.sh"
RUNNER_PATH="/data/adb/termux-home-server-unlock-runner.sh"
SERVICE_DIR="/data/adb/service.d"
SERVICE_SCRIPT="$SERVICE_DIR/termux-home-server-unlock.sh"

if ! command -v su >/dev/null 2>&1; then
    printf 'su is required to install the post-unlock launcher.\n' >&2
    exit 1
fi

if [ ! -f "$SOURCE_SCRIPT" ]; then
    printf 'Missing runner script at %s\n' "$SOURCE_SCRIPT" >&2
    exit 1
fi

su -c "mkdir -p '$SERVICE_DIR'"
su -c "cp '$SOURCE_SCRIPT' '$RUNNER_PATH'"
su -c "chmod 755 '$RUNNER_PATH'"

su -c "cat > '$SERVICE_SCRIPT' <<'EOF'
#!/system/bin/sh

RUNNER='/data/adb/termux-home-server-unlock-runner.sh'
if [ -x \"\$RUNNER\" ]; then
    \"\$RUNNER\" &
fi
EOF"
su -c "chmod 755 '$SERVICE_SCRIPT'"

printf 'Installed post-unlock launcher at %s\n' "$SERVICE_SCRIPT"
printf 'Runner deployed to %s\n' "$RUNNER_PATH"
