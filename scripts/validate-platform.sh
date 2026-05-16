#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"

cd "$PROJECT"

echo "[validate] server checks"
npm --prefix server run check

echo "[validate] server tests"
npm --prefix server test

echo "[validate] dashboard typecheck"
(
  cd dashboard
  npx tsc --noEmit
)

echo "[validate] dashboard tests"
npm --prefix dashboard test

echo "[validate] script syntax"
for script in scripts/*.sh; do
  bash -n "$script"
done

echo "[validate] done"
