#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: bash analyze-web.sh <url> [run-name]"
  exit 1
fi

URL="$1"
RUN_NAME="${2:-$(date +%Y%m%d-%H%M%S)}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ABW_DIR="$ROOT_DIR/tools/agent-browser-workspace"
OUT_DIR="$ROOT_DIR/research/$RUN_NAME"

if [ ! -d "$ABW_DIR" ]; then
  echo "agent-browser-workspace not found at: $ABW_DIR"
  exit 1
fi

mkdir -p "$OUT_DIR"

cd "$ABW_DIR"

if [ ! -d node_modules ]; then
  echo "Installing agent-browser-workspace dependencies..."
  npm install
fi

echo "Starting Chrome CDP in background..."
npm run chrome >/dev/null 2>&1 || true
sleep 2

echo "Extracting content + forms from: $URL"
node scripts/getAll.js \
  --cdp \
  --url "$URL" \
  --dir "$OUT_DIR" \
  --name content.md \
  --forms-output "$OUT_DIR/forms.json"

echo "Saving screenshot..."
node utils/browserUse.js --cdp --goto "$URL" --screenshot "$OUT_DIR/screenshot.png" >/dev/null

echo "Research artifacts created: $OUT_DIR"
echo "- Markdown:   $OUT_DIR/content.md"
echo "- Forms JSON: $OUT_DIR/forms.json"
echo "- Screenshot: $OUT_DIR/screenshot.png"
