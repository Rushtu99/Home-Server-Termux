#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

RUNNER_PATH="/data/adb/termux-home-server-unlock-runner.sh"

if ! command -v su >/dev/null 2>&1; then
    printf 'su is required to trigger the post-unlock launcher.\n' >&2
    exit 1
fi

if ! su -c "[ -x '$RUNNER_PATH' ]"; then
    printf 'Runner not installed at %s\n' "$RUNNER_PATH" >&2
    printf 'Run scripts/install-post-unlock-launcher.sh first.\n' >&2
    exit 1
fi

su -c "'$RUNNER_PATH' --force"
