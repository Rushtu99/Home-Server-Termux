#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/../utils/env.sh"
[ -f "$PROJECT/scripts/drive-common.sh" ] && . "$PROJECT/scripts/drive-common.sh"

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

writable_path() {
  local path="$1" probe=""
  mkdir -p "$path" >/dev/null 2>&1 || return 1
  probe="$path/.hmstx-write-test.$$"
  printf test > "$probe" 2>/dev/null || return 1
  rm -f "$probe" >/dev/null 2>&1 || true
}

first_writable() {
  local candidate=""
  for candidate in "$@"; do
    [ -n "$candidate" ] || continue
    if writable_path "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

vault_primary="${MEDIA_VAULT_ROOT:-}"
scratch_primary="${MEDIA_SCRATCH_ROOT:-}"
if [ -z "$vault_primary" ] && type resolve_drive_dir >/dev/null 2>&1; then
  vault_primary="$(resolve_drive_dir "${MEDIA_VAULT_DRIVES:-D}" 2>/dev/null || true)/${MEDIA_VAULT_DIR_NAME:-VAULT}"
fi
if [ -z "$scratch_primary" ] && type resolve_drive_dir >/dev/null 2>&1; then
  scratch_primary="$(resolve_drive_dir "${MEDIA_SCRATCH_DRIVES:-E}" 2>/dev/null || true)/${MEDIA_SCRATCH_DIR_NAME:-SCRATCH}/${MEDIA_SCRATCH_MEDIA_SUBDIR:-HmSTxScratch}"
fi

vault_fallback="${MEDIA_VAULT_FALLBACK_ROOT:-$PROJECT/runtime/vault-fallback}"
scratch_fallback="${MEDIA_SCRATCH_FALLBACK_ROOT:-$PROJECT/runtime/HmSTxScratch}"
vault="$(first_writable "$vault_primary" "$vault_fallback" || printf '%s' "$vault_fallback")"
scratch="$(first_writable "$scratch_primary" "$scratch_fallback" || printf '%s' "$scratch_fallback")"

printf '{"generatedAt":"%s","vault":{"path":"%s","fallback":%s},"scratch":{"path":"%s","fallback":%s},"roots":["%s","%s"]}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  "$(json_escape "$vault")" \
  "$([ "$vault" = "$vault_fallback" ] && printf true || printf false)" \
  "$(json_escape "$scratch")" \
  "$([ "$scratch" = "$scratch_fallback" ] && printf true || printf false)" \
  "$(json_escape "$vault")" \
  "$(json_escape "$scratch")"
