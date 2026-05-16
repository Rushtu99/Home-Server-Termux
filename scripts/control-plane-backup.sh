#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
BACKUP_DIR="${CONTROL_PLANE_BACKUP_DIR:-$RUNTIME_DIR/backups/control-plane}"

mkdir -p "$BACKUP_DIR"

timestamp_utc() {
  date -u +"%Y%m%dT%H%M%SZ"
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

collect_paths() {
  local -n out_ref=$1
  out_ref=()

  local candidates=(
    "server/.env"
    "server/.env.example"
    "nginx.conf"
    "start.sh"
    "scripts/usb-mount-service.conf"
    "runtime/app.db"
    "runtime/control-plane"
    "runtime/storage-watchdog-state.json"
    "runtime/storage-watchdog-events.jsonl"
    "runtime/media-reconcile.last-epoch"
    "runtime/llm-active-model.txt"
    "runtime/drive-mount-mirror-state.json"
    "runtime/qb-fallback-paused.hashes"
    "runtime/storage-primary-check.state"
    "runtime/mounts"
  )

  local path=""
  for path in "${candidates[@]}"; do
    if [ -e "$PROJECT/$path" ]; then
      out_ref+=("$path")
    fi
  done
}

create_backup() {
  local label="${1:-}"
  local ts=""
  local archive=""
  local checksum_path=""
  local manifest_path=""
  local tmp_manifest=""
  local paths=()
  local path=""
  local first=1

  collect_paths paths
  if [ "${#paths[@]}" -eq 0 ]; then
    echo "no backup candidates found under $PROJECT" >&2
    return 1
  fi

  ts="$(timestamp_utc)"
  if [ -n "$label" ]; then
    archive="$BACKUP_DIR/control-plane-${ts}-$(printf '%s' "$label" | tr -cs '[:alnum:]_-' '-').tar.gz"
  else
    archive="$BACKUP_DIR/control-plane-${ts}.tar.gz"
  fi

  tar -C "$PROJECT" -czf "$archive" "${paths[@]}"

  checksum_path="$archive.sha256"
  (cd "$(dirname "$archive")" && sha256sum "$(basename "$archive")" > "$(basename "$checksum_path")")

  manifest_path="$archive.manifest.json"
  tmp_manifest="$manifest_path.tmp.$$"
  {
    printf '{\n'
    printf '  "createdAt": "%s",\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    printf '  "archive": "%s",\n' "$(json_escape "$archive")"
    printf '  "projectRoot": "%s",\n' "$(json_escape "$PROJECT")"
    printf '  "paths": [\n'
    for path in "${paths[@]}"; do
      if [ "$first" -eq 1 ]; then
        first=0
      else
        printf ',\n'
      fi
      printf '    "%s"' "$(json_escape "$path")"
    done
    printf '\n  ]\n'
    printf '}\n'
  } > "$tmp_manifest"
  mv -f "$tmp_manifest" "$manifest_path"

  printf 'created: %s\n' "$archive"
  printf 'checksum: %s\n' "$checksum_path"
  printf 'manifest: %s\n' "$manifest_path"
}

list_backups() {
  if ! ls -1 "$BACKUP_DIR"/*.tar.gz >/dev/null 2>&1; then
    echo "no control-plane backups in $BACKUP_DIR"
    return 0
  fi

  ls -1t "$BACKUP_DIR"/*.tar.gz
}

verify_backup() {
  local archive_path="${1:-}"
  local checksum_path=""

  [ -n "$archive_path" ] || {
    echo "usage: $0 verify <archive.tar.gz>" >&2
    return 1
  }
  [ -f "$archive_path" ] || {
    echo "archive not found: $archive_path" >&2
    return 1
  }

  checksum_path="$archive_path.sha256"
  if [ -f "$checksum_path" ]; then
    (cd "$(dirname "$archive_path")" && sha256sum -c "$(basename "$checksum_path")")
  else
    echo "checksum file not found: $checksum_path" >&2
    return 1
  fi

  tar -tzf "$archive_path" >/dev/null
  echo "verified: $archive_path"
}

extract_backup() {
  local archive_path="${1:-}"
  local target_dir="${2:-}"

  [ -n "$archive_path" ] || {
    echo "usage: $0 extract <archive.tar.gz> <target-dir>" >&2
    return 1
  }
  [ -n "$target_dir" ] || {
    echo "usage: $0 extract <archive.tar.gz> <target-dir>" >&2
    return 1
  }
  [ -f "$archive_path" ] || {
    echo "archive not found: $archive_path" >&2
    return 1
  }

  mkdir -p "$target_dir"
  tar -xzf "$archive_path" -C "$target_dir"
  echo "extracted: $archive_path -> $target_dir"
}

case "${1:-}" in
  create)
    shift
    create_backup "${1:-}"
    ;;
  list)
    list_backups
    ;;
  verify)
    shift
    verify_backup "${1:-}"
    ;;
  extract)
    shift
    extract_backup "${1:-}" "${2:-}"
    ;;
  *)
    cat >&2 <<USAGE
usage: $0 {create [label]|list|verify <archive.tar.gz>|extract <archive.tar.gz> <target-dir>}
USAGE
    exit 1
    ;;
esac
