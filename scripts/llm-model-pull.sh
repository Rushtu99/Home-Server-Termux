#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

if [ "$#" -lt 3 ]; then
    echo "usage: $0 <job-json-path> <url> <target-path>" >&2
    exit 1
fi

JOB_JSON_PATH="$1"
MODEL_URL="$2"
TARGET_PATH="$3"
TARGET_DIR="$(dirname "$TARGET_PATH")"

mkdir -p "$TARGET_DIR"

if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required" >&2
    exit 1
fi

tmp_file="${TARGET_PATH}.part"
rm -f "$tmp_file"

json_write() {
    local status="$1"
    local message="$2"
    local now=""
    now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    cat > "$JOB_JSON_PATH" <<EOF
{"status":"$status","message":"$message","updatedAt":"$now","targetPath":"$TARGET_PATH","url":"$MODEL_URL"}
EOF
}

json_write "running" "Download started"

if curl -fL --retry 3 --retry-delay 2 --continue-at - -o "$tmp_file" "$MODEL_URL"; then
    mv "$tmp_file" "$TARGET_PATH"
    json_write "success" "Download complete"
    exit 0
fi

rm -f "$tmp_file"
json_write "failed" "Download failed"
exit 1
