#!/data/data/com.termux/files/usr/bin/sh
exec node "$(dirname "$0")/backend/api/cli.js" "$@"
