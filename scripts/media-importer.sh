#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"

load_shell_env_file() {
    local env_file="$1"
    local line=""
    local key=""
    local value=""

    [ -f "$env_file" ] || return 0

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ''|\#*) continue ;;
        esac

        key="${line%%=*}"
        value="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        case "$value" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
        esac
        if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            continue
        fi
        export "$key=$value"
    done < "$env_file"
}

load_shell_env_file "$SERVER_ENV_FILE"

if [ "${1:-run}" = "status" ]; then
    STATUS_JSON_FAST=0
    if [ "${2:-}" = "--json" ]; then
        STATUS_JSON_FAST=1
    fi

    MEDIA_IMPORT_LOG_DIR_FAST="${MEDIA_IMPORT_LOG_DIR:-}"
    if [ -z "$MEDIA_IMPORT_LOG_DIR_FAST" ] && [ -n "${MEDIA_SCRATCH_ROOT:-}" ]; then
        MEDIA_IMPORT_LOG_DIR_FAST="$MEDIA_SCRATCH_ROOT/logs"
    fi
    if [ -z "$MEDIA_IMPORT_LOG_DIR_FAST" ]; then
        MEDIA_IMPORT_LOG_DIR_FAST="$PROJECT/runtime/HmSTxScratch/logs"
    fi

    first_existing_file_fast() {
        local fallback="$1"
        shift || true
        local candidate=""
        for candidate in "$@"; do
            [ -n "$candidate" ] || continue
            if [ -f "$candidate" ]; then
                printf '%s\n' "$candidate"
                return 0
            fi
        done
        printf '%s\n' "$fallback"
        return 1
    }

    MEDIA_IMPORT_STATUS_FILE_FAST="$(first_existing_file_fast \
        "${MEDIA_IMPORT_STATUS_FILE:-$MEDIA_IMPORT_LOG_DIR_FAST/import-status.json}" \
        "${MEDIA_IMPORT_STATUS_FILE:-}" \
        "$MEDIA_IMPORT_LOG_DIR_FAST/import-status.json" \
        "${MEDIA_SCRATCH_ROOT:-}/logs/import-status.json" \
        "$PROJECT/runtime/HmSTxScratch/logs/import-status.json")"
    MEDIA_CLEANUP_STATUS_FILE_FAST="$(first_existing_file_fast \
        "${MEDIA_CLEANUP_STATUS_FILE:-$MEDIA_IMPORT_LOG_DIR_FAST/cleanup-status.json}" \
        "${MEDIA_CLEANUP_STATUS_FILE:-}" \
        "$MEDIA_IMPORT_LOG_DIR_FAST/cleanup-status.json" \
        "${MEDIA_SCRATCH_ROOT:-}/logs/cleanup-status.json" \
        "$PROJECT/runtime/HmSTxScratch/logs/cleanup-status.json")"

    import_payload_fast="$(cat "$MEDIA_IMPORT_STATUS_FILE_FAST" 2>/dev/null || true)"
    cleanup_payload_fast="$(cat "$MEDIA_CLEANUP_STATUS_FILE_FAST" 2>/dev/null || true)"

    if [ "$STATUS_JSON_FAST" -eq 1 ]; then
        printf '{\n'
        printf '  "import": %s,\n' "${import_payload_fast:-null}"
        printf '  "cleanup": %s\n' "${cleanup_payload_fast:-null}"
        printf '}\n'
    else
        if [ -n "$import_payload_fast" ]; then
            printf 'Import status:\n%s\n' "$import_payload_fast"
        else
            printf 'Import status: none\n'
        fi

        if [ -n "$cleanup_payload_fast" ]; then
            printf '\nCleanup status:\n%s\n' "$cleanup_payload_fast"
        else
            printf '\nCleanup status: none\n'
        fi
    fi
    exit 0
fi

. "$PROJECT/scripts/drive-common.sh"

if type ensure_primary_mounts_checked_cached >/dev/null 2>&1; then
    ensure_primary_mounts_checked_cached "vault,scratch" >/dev/null 2>&1 || true
fi

MEDIA_VAULT_DRIVES="${MEDIA_VAULT_DRIVES:-D}"
MEDIA_SCRATCH_DRIVES="${MEDIA_SCRATCH_DRIVES:-E}"
DEFAULT_VAULT_DRIVE_DIR=""
DEFAULT_SCRATCH_DRIVE_DIR=""
if type resolve_drive_dir >/dev/null 2>&1; then
    DEFAULT_VAULT_DRIVE_DIR="$(resolve_drive_dir "${MEDIA_VAULT_DRIVES%%,*}" || true)"
    DEFAULT_SCRATCH_DRIVE_DIR="$(resolve_drive_dir "${MEDIA_SCRATCH_DRIVES%%,*}" || true)"
fi
MEDIA_VAULT_ROOT="${MEDIA_VAULT_ROOT:-${DEFAULT_VAULT_DRIVE_DIR:+$DEFAULT_VAULT_DRIVE_DIR/VAULT/Media}}"
MEDIA_SCRATCH_ROOT="${MEDIA_SCRATCH_ROOT:-${DEFAULT_SCRATCH_DRIVE_DIR:+$DEFAULT_SCRATCH_DRIVE_DIR/SCRATCH/HmSTxScratch}}"
if [ -z "$MEDIA_VAULT_ROOT" ]; then
    MEDIA_VAULT_ROOT="$DRIVES_D_DIR/VAULT/Media"
fi
if [ -z "$MEDIA_SCRATCH_ROOT" ]; then
    MEDIA_SCRATCH_ROOT="$DRIVES_E_DIR/SCRATCH/HmSTxScratch"
fi
MEDIA_VAULT_ROOTS="${MEDIA_VAULT_ROOTS:-}"
MEDIA_SCRATCH_ROOTS="${MEDIA_SCRATCH_ROOTS:-}"
MEDIA_MOVIES_DIR="${MEDIA_MOVIES_DIR:-$MEDIA_VAULT_ROOT/movies}"
MEDIA_SERIES_DIR="${MEDIA_SERIES_DIR:-$MEDIA_VAULT_ROOT/series}"
MEDIA_MUSIC_DIR="${MEDIA_MUSIC_DIR:-$MEDIA_VAULT_ROOT/music}"
MEDIA_AUDIOBOOKS_DIR="${MEDIA_AUDIOBOOKS_DIR:-$MEDIA_VAULT_ROOT/audiobooks}"
MEDIA_DOWNLOADS_DIR="${MEDIA_DOWNLOADS_DIR:-$MEDIA_SCRATCH_ROOT/downloads}"
MEDIA_DOWNLOADS_MOVIES_DIR="${MEDIA_DOWNLOADS_MOVIES_DIR:-$MEDIA_DOWNLOADS_DIR/movies}"
MEDIA_DOWNLOADS_SERIES_DIR="${MEDIA_DOWNLOADS_SERIES_DIR:-$MEDIA_DOWNLOADS_DIR/series}"
MEDIA_DOWNLOADS_MANUAL_DIR="${MEDIA_DOWNLOADS_MANUAL_DIR:-$MEDIA_DOWNLOADS_DIR/manual}"
MEDIA_DOWNLOADS_TORRENT_DIR="${MEDIA_DOWNLOADS_TORRENT_DIR:-$MEDIA_DOWNLOADS_DIR/torrent}"
MEDIA_DOWNLOADS_TORRENT_QBIT_DIR="${MEDIA_DOWNLOADS_TORRENT_QBIT_DIR:-$MEDIA_DOWNLOADS_TORRENT_DIR/qbit}"
MEDIA_SMALL_DOWNLOADS_DIR="${MEDIA_SMALL_DOWNLOADS_DIR:-$DRIVES_C_DIR/Download/Home-Server/small}"
MEDIA_SMALL_DOWNLOADS_MAX_MB="${MEDIA_SMALL_DOWNLOADS_MAX_MB:-256}"
MEDIA_IMPORT_REVIEW_DIR="${MEDIA_IMPORT_REVIEW_DIR:-$MEDIA_SCRATCH_ROOT/review}"
MEDIA_IMPORT_LOG_DIR="${MEDIA_IMPORT_LOG_DIR:-$MEDIA_SCRATCH_ROOT/logs}"
MEDIA_TRANSCODE_DIR="${MEDIA_TRANSCODE_DIR:-$MEDIA_SCRATCH_ROOT/cache/jellyfin}"
MEDIA_MISC_CACHE_DIR="${MEDIA_MISC_CACHE_DIR:-$MEDIA_SCRATCH_ROOT/cache/misc}"
MEDIA_IPTV_CACHE_DIR="${MEDIA_IPTV_CACHE_DIR:-$MEDIA_SCRATCH_ROOT/iptv-cache}"
MEDIA_IPTV_EPG_DIR="${MEDIA_IPTV_EPG_DIR:-$MEDIA_SCRATCH_ROOT/iptv-epg}"
MEDIA_QBIT_TMP_DIR="${MEDIA_QBIT_TMP_DIR:-$MEDIA_SCRATCH_ROOT/tmp/qbittorrent}"
MEDIA_IMPORT_ABORT_FREE_GB="${MEDIA_IMPORT_ABORT_FREE_GB:-200}"
MEDIA_SCRATCH_RETENTION_DAYS="${MEDIA_SCRATCH_RETENTION_DAYS:-30}"
MEDIA_SCRATCH_MIN_FREE_GB="${MEDIA_SCRATCH_MIN_FREE_GB:-200}"
MEDIA_SCRATCH_WARN_USED_PERCENT="${MEDIA_SCRATCH_WARN_USED_PERCENT:-85}"
MEDIA_SCRATCH_CLEANUP_ENABLED="${MEDIA_SCRATCH_CLEANUP_ENABLED:-true}"
MEDIA_IMPORT_REQUIRE_EXTERNAL_VAULT="${MEDIA_IMPORT_REQUIRE_EXTERNAL_VAULT:-true}"
MEDIA_IMPORT_CHECKSUM_MAX_MB="${MEDIA_IMPORT_CHECKSUM_MAX_MB:-1024}"
MEDIA_IMPORT_FORCE_COPY_MOVE="${MEDIA_IMPORT_FORCE_COPY_MOVE:-false}"
MEDIA_IMPORT_FAULT_INJECT="${MEDIA_IMPORT_FAULT_INJECT:-}"
MEDIA_IMPORT_STATUS_FILE="${MEDIA_IMPORT_STATUS_FILE:-$MEDIA_IMPORT_LOG_DIR/import-status.json}"
MEDIA_CLEANUP_STATUS_FILE="${MEDIA_CLEANUP_STATUS_FILE:-$MEDIA_IMPORT_LOG_DIR/cleanup-status.json}"
MEDIA_IMPORTED_INDEX_FILE="${MEDIA_IMPORTED_INDEX_FILE:-$MEDIA_IMPORT_LOG_DIR/imported-items.tsv}"
MEDIA_IMPORT_EVENTS_FILE="${MEDIA_IMPORT_EVENTS_FILE:-$MEDIA_IMPORT_LOG_DIR/import-events.tsv}"
QBITTORRENT_BIND_HOST="${QBITTORRENT_BIND_HOST:-127.0.0.1}"
QBITTORRENT_PORT="${QBITTORRENT_PORT:-8081}"
QBITTORRENT_WEBUI_USERNAME="${QBITTORRENT_WEBUI_USERNAME:-}"
QBITTORRENT_WEBUI_PASSWORD="${QBITTORRENT_WEBUI_PASSWORD:-}"

LOGFILE="$MEDIA_IMPORT_LOG_DIR/media-importer.log"
LOCK_FILE="$MEDIA_IMPORT_LOG_DIR/media-importer.lock"
MIN_VAULT_FREE_BYTES=$((MEDIA_IMPORT_ABORT_FREE_GB * 1024 * 1024 * 1024))
SMALL_DOWNLOAD_MAX_BYTES=$((MEDIA_SMALL_DOWNLOADS_MAX_MB * 1024 * 1024))
SCRATCH_MIN_FREE_BYTES=$((MEDIA_SCRATCH_MIN_FREE_GB * 1024 * 1024 * 1024))
RETENTION_SECONDS=$((MEDIA_SCRATCH_RETENTION_DAYS * 24 * 60 * 60))
PRESSURE_GRACE_SECONDS=$((24 * 60 * 60))
CHECKSUM_MAX_BYTES=$((MEDIA_IMPORT_CHECKSUM_MAX_MB * 1024 * 1024))

mkdir -p \
    "$RUNTIME_DIR" \
    "$MEDIA_IMPORT_LOG_DIR" \
    "$MEDIA_IMPORT_REVIEW_DIR" \
    "$MEDIA_DOWNLOADS_MOVIES_DIR" \
    "$MEDIA_DOWNLOADS_SERIES_DIR" \
    "$MEDIA_DOWNLOADS_MANUAL_DIR" \
    "$MEDIA_DOWNLOADS_TORRENT_DIR" \
    "$MEDIA_DOWNLOADS_TORRENT_QBIT_DIR" \
    "$MEDIA_SMALL_DOWNLOADS_DIR" \
    "$MEDIA_QBIT_TMP_DIR" \
    "$MEDIA_TRANSCODE_DIR" \
    "$MEDIA_MISC_CACHE_DIR" \
    "$MEDIA_IPTV_CACHE_DIR" \
    "$MEDIA_IPTV_EPG_DIR"

HAS_RSYNC=0
if command -v rsync >/dev/null 2>&1; then
    HAS_RSYNC=1
fi

HAS_SHA256=0
SHA256_CMD=""
if command -v sha256sum >/dev/null 2>&1; then
    HAS_SHA256=1
    SHA256_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    HAS_SHA256=1
    SHA256_CMD="shasum -a 256"
fi

COMMAND="run"
RUN_TRIGGER="manual"
DRY_RUN=0
SKIP_CLEANUP=0
STATUS_JSON=0
declare -a SOURCE_PATHS=()

SCANNED_ITEMS=0
IMPORTED_COUNT=0
SKIPPED_EXISTING_COUNT=0
COLLISION_COUNT=0
FAILED_COUNT=0
AMBIGUOUS_REVIEW_COUNT=0
ABORTED=0
ABORT_REASON=""

DELETED_ITEMS=0
DELETED_BYTES=0
DELETED_IMPORTED_ITEMS=0
DELETED_CACHE_ITEMS=0
SCRATCH_PRESSURE_BEFORE=0
SCRATCH_PRESSURE_AFTER=0
declare -a DOWNLOAD_SCAN_ROOTS=()
declare -a QB_COMPLETED_SOURCES=()
declare -A QB_SOURCE_HINTS=()
declare -A IMPORT_SOURCE_SEEN=()

usage() {
    cat <<'EOF'
usage: media-importer.sh {run|import|cleanup|status} [options]

commands:
  run, import    Import downloads into the managed media layout and run cleanup.
  cleanup        Run scratch cleanup only.
  status         Print the latest import and cleanup status.

options:
  --trigger NAME   Annotate the run source (default: manual)
  --source PATH    Import only the given file or directory (repeatable)
  --dry-run        Report planned work without changing files
  --skip-cleanup   Skip cleanup during an import run
  --json           Print status as JSON (status command only)
EOF
}

parse_args() {
    if [ "$#" -gt 0 ]; then
        case "$1" in
            run|import|cleanup|status)
                COMMAND="$1"
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
        esac
    fi

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --trigger)
                shift
                RUN_TRIGGER="${1:-manual}"
                ;;
            --source)
                shift
                [ -n "${1:-}" ] || {
                    echo "missing value for --source" >&2
                    exit 1
                }
                SOURCE_PATHS+=("$1")
                ;;
            --dry-run)
                DRY_RUN=1
                ;;
            --skip-cleanup)
                SKIP_CLEANUP=1
                ;;
            --json)
                STATUS_JSON=1
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                echo "unknown argument: $1" >&2
                usage >&2
                exit 1
                ;;
        esac
        shift
    done
}

parse_args "$@"

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

timestamp_iso() {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

log() {
    local level="$1"
    local msg="$2"
    printf '[%s] %5s %s\n' "$(timestamp)" "$level" "$msg" | tee -a "$LOGFILE"
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g; s/\n/\\n/g'
}

tsv_escape() {
    printf '%s' "$1" | tr '\t\r\n' '   '
}

path_within() {
    local path="$1"
    local parent="$2"
    case "$path" in
        "$parent"/*|"$parent")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

canonical_path() {
    local raw_path="$1"
    if [ -e "$raw_path" ]; then
        realpath "$raw_path" 2>/dev/null || realpath -m "$raw_path" 2>/dev/null || printf '%s\n' "$raw_path"
        return 0
    fi
    realpath -m "$raw_path" 2>/dev/null || printf '%s\n' "$raw_path"
}

path_mount_fstype_import() {
    local target="$1"
    findmnt -nr -T "$target" -o FSTYPE 2>/dev/null | head -n 1
}

path_mount_source_import() {
    local target="$1"
    findmnt -nr -T "$target" -o SOURCE 2>/dev/null | head -n 1
}

fs_type_is_non_external_import() {
    case "$1" in
        ''|unknown|f2fs|tmpfs|overlay)
            return 0
            ;;
    esac
    return 1
}

path_on_external_mount() {
    local target="$1"
    local fs_type=""
    fs_type="$(path_mount_fstype_import "$target" || true)"
    [ -n "$fs_type" ] || return 1
    if fs_type_is_non_external_import "$fs_type"; then
        return 1
    fi
    return 0
}

path_looks_like_fallback_root() {
    local target="$1"
    case "$target" in
        *"(VAULT_fallback)"*|*"(SCRATCH_fallback)"*)
            return 0
            ;;
    esac
    return 1
}

path_within_resolved() {
    local maybe_child="$1"
    local maybe_parent="$2"
    local resolved_child=""
    local resolved_parent=""

    resolved_child="$(canonical_path "$maybe_child")"
    resolved_parent="$(canonical_path "$maybe_parent")"
    path_within "$resolved_child" "$resolved_parent"
}

path_is_device_endpoint() {
    local maybe_path="$1"
    local resolved=""
    resolved="$(canonical_path "$maybe_path")"
    [ -b "$resolved" ] && return 0
    case "$resolved" in
        /dev|/dev/*)
            return 0
            ;;
    esac
    return 1
}

path_allowed_for_cleanup_delete() {
    local maybe_path="$1"
    local scratch_roots=()
    local scratch_root=""
    local role_root=""

    csv_to_array_local "$MEDIA_SCRATCH_ROOTS" scratch_roots
    array_push_unique_local scratch_roots "$MEDIA_SCRATCH_ROOT"

    for scratch_root in "${scratch_roots[@]}"; do
        [ -n "$scratch_root" ] || continue
        for role_root in \
            "$scratch_root/downloads" \
            "$scratch_root/tmp/qbittorrent" \
            "$scratch_root/cache/jellyfin" \
            "$scratch_root/cache/misc" \
            "$scratch_root/iptv-cache" \
            "$scratch_root/iptv-epg"; do
            if path_within_resolved "$maybe_path" "$role_root"; then
                return 0
            fi
        done
    done

    return 1
}

path_is_within_vault_roots() {
    local maybe_path="$1"
    local vault_roots=()
    local vault_root=""

    csv_to_array_local "$MEDIA_VAULT_ROOTS" vault_roots
    array_push_unique_local vault_roots "$MEDIA_VAULT_ROOT"
    for vault_root in "${vault_roots[@]}"; do
        [ -n "$vault_root" ] || continue
        if path_within_resolved "$maybe_path" "$vault_root"; then
            return 0
        fi
    done
    return 1
}

copy_paths_are_safe() {
    local src="$1"
    local dest="$2"
    local src_resolved=""
    local dest_resolved=""

    src_resolved="$(canonical_path "$src")"
    dest_resolved="$(canonical_path "$dest")"

    if path_is_device_endpoint "$src_resolved" || path_is_device_endpoint "$dest_resolved"; then
        return 1
    fi
    if [ "$src_resolved" = "$dest_resolved" ]; then
        return 1
    fi
    if path_within "$dest_resolved" "$src_resolved"; then
        return 1
    fi
    if path_within "$src_resolved" "$dest_resolved"; then
        return 1
    fi

    return 0
}

normalize_csv_list_local() {
    local input="$1"
    printf '%s\n' "$input" | tr ';' ',' | tr '\n' ',' | tr -s ',' | sed 's/^,*//; s/,*$//'
}

csv_to_array_local() {
    local csv="$1"
    local out_name="$2"
    local token=""
    local -n out_ref="$out_name"

    out_ref=()
    csv="$(normalize_csv_list_local "$csv")"
    [ -n "$csv" ] || return 0

    while IFS= read -r token; do
        token="$(printf '%s' "$token" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$token" ] || continue
        out_ref+=("$token")
    done < <(printf '%s\n' "$csv" | tr ',' '\n')
}

array_push_unique_local() {
    local out_name="$1"
    local value="$2"
    local item=""
    local -n out_ref="$out_name"

    for item in "${out_ref[@]}"; do
        if [ "$item" = "$value" ]; then
            return 0
        fi
    done
    out_ref+=("$value")
}

build_download_scan_roots() {
    local scratch_roots=()
    local scratch_root=""
    local downloads_root=""

    DOWNLOAD_SCAN_ROOTS=()
    array_push_unique_local DOWNLOAD_SCAN_ROOTS "$MEDIA_DOWNLOADS_DIR"

    csv_to_array_local "$MEDIA_SCRATCH_ROOTS" scratch_roots
    for scratch_root in "${scratch_roots[@]}"; do
        downloads_root="$scratch_root/downloads"
        array_push_unique_local DOWNLOAD_SCAN_ROOTS "$downloads_root"
    done

    if [ -n "$MEDIA_SCRATCH_ROOT" ]; then
        array_push_unique_local DOWNLOAD_SCAN_ROOTS "$MEDIA_SCRATCH_ROOT/downloads"
    fi
}

normalize_qb_source_type() {
    case "${1,,}" in
        movies|movie)
            printf 'movies\n'
            ;;
        series|tv|sonarr)
            printf 'series\n'
            ;;
        *)
            printf 'manual\n'
            ;;
    esac
}

populate_qb_source_hints() {
    local qb_lines=""
    local line=""
    local source_type=""
    local source_path=""
    local parsed_type=""

    QB_COMPLETED_SOURCES=()
    QB_SOURCE_HINTS=()
    command -v node >/dev/null 2>&1 || return 0

    qb_lines="$(node - "$QBITTORRENT_BIND_HOST" "$QBITTORRENT_PORT" "$QBITTORRENT_WEBUI_USERNAME" "$QBITTORRENT_WEBUI_PASSWORD" <<'JS'
const [host, port, username, password] = process.argv.slice(2);
const base = `http://${host}:${port}`;
let sidCookie = '';

const login = async () => {
  if (!username && !password) return false;
  const body = new URLSearchParams({ username, password });
  const response = await fetch(`${base}/api/v2/auth/login`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
  });
  if (!response.ok) return false;
  const setCookie = response.headers.get('set-cookie') || '';
  const sidPair = setCookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('SID='));
  if (!sidPair) return false;
  sidCookie = sidPair;
  return true;
};

const qbFetch = async (path, allowRetry = true) => {
  const headers = {};
  if (sidCookie) headers.Cookie = sidCookie;
  const response = await fetch(`${base}${path}`, { headers });
  if (response.status === 403 && allowRetry) {
    const authed = await login();
    if (authed) {
      return qbFetch(path, false);
    }
  }
  return response;
};

const categoryToType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'movies' || raw === 'movie') return 'movies';
  if (raw === 'series' || raw === 'tv' || raw === 'sonarr') return 'series';
  return 'manual';
};

const emitPath = (type, pathValue) => {
  const normalized = String(pathValue || '').trim();
  if (!normalized) return;
  process.stdout.write(`${type}\t${normalized}\n`);
};

qbFetch('/api/v2/torrents/info')
  .then(async (response) => {
    if (!response.ok) return;
    const torrents = await response.json().catch(() => []);
    for (const torrent of Array.isArray(torrents) ? torrents : []) {
      const completionOn = Number(torrent.completion_on || 0);
      const progress = Number(torrent.progress || 0);
      if (completionOn <= 0 && progress < 1) continue;

      const type = categoryToType(torrent.category);
      const contentPath = String(torrent.content_path || '').trim();
      const savePath = String(torrent.save_path || '').trim();
      const name = String(torrent.name || '').trim();

      if (contentPath) emitPath(type, contentPath);
      if (savePath && name) emitPath(type, `${savePath}/${name}`);
    }
  })
  .catch(() => {});
JS
)" || true

    [ -n "$qb_lines" ] || return 0

    while IFS= read -r line; do
        [ -n "$line" ] || continue
        IFS=$'\t' read -r source_type source_path <<EOF
$line
EOF
        [ -n "$source_path" ] || continue
        [ -e "$source_path" ] || continue
        parsed_type="$(normalize_qb_source_type "$source_type")"
        QB_SOURCE_HINTS["$source_path"]="$parsed_type"
        QB_COMPLETED_SOURCES+=("$source_path")
    done <<< "$qb_lines"
}

write_file_atomic() {
    local path="$1"
    local content="$2"
    local tmp_file=""

    mkdir -p "$(dirname "$path")"
    tmp_file="$(mktemp "$RUNTIME_DIR/$(basename "$path").XXXXXX")"
    printf '%s' "$content" > "$tmp_file"
    mv "$tmp_file" "$path"
}

append_tsv_line() {
    local path="$1"
    shift
    local first=1
    local field=""

    mkdir -p "$(dirname "$path")"
    for field in "$@"; do
        if [ "$first" -eq 0 ]; then
            printf '\t' >> "$path"
        fi
        printf '%s' "$(tsv_escape "$field")" >> "$path"
        first=0
    done
    printf '\n' >> "$path"
}

acquire_lock() {
    exec 200>"$LOCK_FILE"
    if ! flock -n 200; then
        log WARN "Importer already running (lock held); exiting"
        exit 0
    fi
}

release_lock() {
    flock -u 200 2>/dev/null || true
}

path_free_bytes() {
    local target="$1"
    local free_bytes=""

    free_bytes="$(df -Pk "$target" 2>/dev/null | awk 'NR==2 && $4 ~ /^[0-9]+$/ {print $4 * 1024}' || true)"
    if [ -n "$free_bytes" ]; then
        printf '%s\n' "$free_bytes"
        return 0
    fi

    stat -f -c '%a %S' "$target" 2>/dev/null | awk 'NR==1 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {print $1 * $2}'
}

path_used_percent() {
    local target="$1"
    local used_percent=""

    used_percent="$(df -Pk "$target" 2>/dev/null | awk 'NR==2 {gsub(/%/, "", $5); if ($5 ~ /^[0-9]+$/) print $5 + 0}' || true)"
    if [ -n "$used_percent" ]; then
        printf '%s\n' "$used_percent"
        return 0
    fi

    stat -f -c '%a %b' "$target" 2>/dev/null | awk '
        NR==1 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ && $2 > 0 {
            used = $2 - $1
            printf "%.0f\n", (used * 100) / $2
        }
    '
}

space_ok() {
    local needed="$1"
    local available=""
    available="$(path_free_bytes "$MEDIA_VAULT_ROOT")"
    if [ -z "$available" ]; then
        log WARN "Unable to read vault free space"
        return 1
    fi
    [ "$available" -ge "$((MIN_VAULT_FREE_BYTES + needed))" ]
}

scratch_is_under_pressure() {
    local free_bytes=""
    local used_percent=""

    free_bytes="$(path_free_bytes "$MEDIA_SCRATCH_ROOT")"
    used_percent="$(path_used_percent "$MEDIA_SCRATCH_ROOT")"

    if [ -n "$free_bytes" ] && [ "$free_bytes" -lt "$SCRATCH_MIN_FREE_BYTES" ]; then
        return 0
    fi

    if [ -n "$used_percent" ] && [ "$used_percent" -ge "$MEDIA_SCRATCH_WARN_USED_PERCENT" ]; then
        return 0
    fi

    return 1
}

ensure_runtime_paths() {
    local vault_resolved=""
    local scratch_resolved=""
    local vault_fs_type=""
    local vault_mount_source=""
    if [ ! -d "$MEDIA_VAULT_ROOT" ]; then
        ABORTED=1
        ABORT_REASON="vault root missing: $MEDIA_VAULT_ROOT"
        return 1
    fi

    if [ ! -d "$MEDIA_SCRATCH_ROOT" ]; then
        ABORTED=1
        ABORT_REASON="scratch root missing: $MEDIA_SCRATCH_ROOT"
        return 1
    fi

    if path_is_device_endpoint "$MEDIA_VAULT_ROOT"; then
        ABORTED=1
        ABORT_REASON="vault root points to a device endpoint: $MEDIA_VAULT_ROOT"
        return 1
    fi
    if path_is_device_endpoint "$MEDIA_SCRATCH_ROOT"; then
        ABORTED=1
        ABORT_REASON="scratch root points to a device endpoint: $MEDIA_SCRATCH_ROOT"
        return 1
    fi

    vault_resolved="$(canonical_path "$MEDIA_VAULT_ROOT")"
    scratch_resolved="$(canonical_path "$MEDIA_SCRATCH_ROOT")"
    if [ "$vault_resolved" = "$scratch_resolved" ]; then
        ABORTED=1
        ABORT_REASON="vault and scratch roots resolve to the same path: $vault_resolved"
        return 1
    fi

    if [ "$MEDIA_IMPORT_REQUIRE_EXTERNAL_VAULT" = "true" ]; then
        if path_looks_like_fallback_root "$MEDIA_VAULT_ROOT"; then
            ABORTED=1
            ABORT_REASON="vault root resolves to fallback path while strict external-vault mode is enabled: $MEDIA_VAULT_ROOT"
            return 1
        fi
        if ! path_on_external_mount "$MEDIA_VAULT_ROOT"; then
            vault_fs_type="$(path_mount_fstype_import "$MEDIA_VAULT_ROOT" || true)"
            vault_mount_source="$(path_mount_source_import "$MEDIA_VAULT_ROOT" || true)"
            ABORTED=1
            ABORT_REASON="vault root is not on an external mount (source=${vault_mount_source:-unknown}, fstype=${vault_fs_type:-unknown}): $MEDIA_VAULT_ROOT"
            return 1
        fi
    fi

    mkdir -p \
        "$MEDIA_MOVIES_DIR" \
        "$MEDIA_SERIES_DIR" \
        "$MEDIA_MUSIC_DIR" \
        "$MEDIA_AUDIOBOOKS_DIR" \
        "$MEDIA_IMPORT_REVIEW_DIR"
}

file_size_bytes() {
    local path="$1"
    local size=""
    if [ -d "$path" ]; then
        size="$(du -sb "$path" 2>/dev/null | awk '{print $1}')"
    else
        size="$(wc -c < "$path" 2>/dev/null | tr -d '[:space:]')"
    fi
    printf '%s\n' "${size:-0}"
}

mtime_seconds() {
    local path="$1"
    stat -c '%Y' "$path" 2>/dev/null || echo 0
}

paths_share_filesystem() {
    local left="$1"
    local right="$2"
    local left_dev=""
    local right_dev=""

    left_dev="$(stat -c '%d' "$left" 2>/dev/null || true)"
    right_dev="$(stat -c '%d' "$right" 2>/dev/null || true)"
    [ -n "$left_dev" ] || return 1
    [ -n "$right_dev" ] || return 1
    [ "$left_dev" = "$right_dev" ]
}

inject_move_fault() {
    local step="$1"
    if [ "$MEDIA_IMPORT_FAULT_INJECT" = "$step" ]; then
        log WARN "Injected fault at step '$step'"
        return 0
    fi
    return 1
}

file_checksum_if_applicable() {
    local path="$1"
    local size_bytes="$2"

    if [ "$HAS_SHA256" -ne 1 ] || [ ! -f "$path" ]; then
        return 0
    fi
    if [ "$size_bytes" -gt "$CHECKSUM_MAX_BYTES" ]; then
        return 0
    fi

    if [ "$SHA256_CMD" = "sha256sum" ]; then
        sha256sum -- "$path" 2>/dev/null | awk 'NR==1 {print $1}'
    else
        shasum -a 256 -- "$path" 2>/dev/null | awk 'NR==1 {print $1}'
    fi
}

entry_fingerprint() {
    local path="$1"
    local kind="missing"
    local file_count=0
    local dir_count=0
    local size_bytes=0
    local checksum=""

    if [ -d "$path" ]; then
        kind="dir"
        file_count="$(find "$path" -type f -print 2>/dev/null | wc -l | tr -d '[:space:]')"
        dir_count="$(find "$path" -type d -print 2>/dev/null | wc -l | tr -d '[:space:]')"
        size_bytes="$(du -sb "$path" 2>/dev/null | awk 'NR==1 {print $1}')"
    elif [ -e "$path" ]; then
        kind="file"
        file_count=1
        dir_count=0
        size_bytes="$(file_size_bytes "$path")"
        checksum="$(file_checksum_if_applicable "$path" "$size_bytes" || true)"
    fi

    printf '%s\t%s\t%s\t%s\t%s\n' "$kind" "${file_count:-0}" "${dir_count:-0}" "${size_bytes:-0}" "$checksum"
}

verify_entry_fingerprint() {
    local path="$1"
    local expected="$2"
    local current=""

    current="$(entry_fingerprint "$path")"
    [ "$current" = "$expected" ]
}

safe_remove_move_target() {
    local target="$1"
    local parent="$2"
    local resolved_target=""
    local resolved_parent=""

    resolved_target="$(canonical_path "$target")"
    resolved_parent="$(canonical_path "$parent")"

    if [ -z "$resolved_target" ] || [ "$resolved_target" = "/" ]; then
        log WARN "Refusing rollback delete for unsafe target: ${target:-<empty>}"
        return 1
    fi
    if path_is_device_endpoint "$resolved_target"; then
        log WARN "Refusing rollback delete for device target: $resolved_target"
        return 1
    fi
    if ! path_within "$resolved_target" "$resolved_parent"; then
        log WARN "Refusing rollback delete outside destination root: $resolved_target"
        return 1
    fi
    rm -rf -- "$resolved_target"
}

rollback_promoted_move() {
    local src="$1"
    local dest="$2"
    local dest_base="$3"

    [ -e "$dest" ] || [ -L "$dest" ] || return 0

    if [ -e "$src" ] || [ -L "$src" ]; then
        log WARN "Rollback removing destination because source still exists: $dest"
        safe_remove_move_target "$dest" "$dest_base" || true
        return 0
    fi

    mkdir -p "$(dirname "$src")"
    if mv -- "$dest" "$src" 2>/dev/null; then
        log WARN "Rollback restored source from destination: $src"
        return 0
    fi

    log WARN "Rollback could not restore source from destination: $dest -> $src"
    return 1
}

move_without_overwrite() {
    local src="$1"
    local dest="$2"

    if [ -e "$dest" ] || [ -L "$dest" ]; then
        return 2
    fi

    if mv -n -- "$src" "$dest" 2>/dev/null; then
        if [ -e "$src" ] || [ -L "$src" ]; then
            if [ -e "$dest" ] || [ -L "$dest" ]; then
                return 2
            fi
            return 1
        fi
        return 0
    fi

    if [ -e "$dest" ] || [ -L "$dest" ]; then
        return 2
    fi
    return 1
}

safe_remove_path() {
    local path="$1"
    local resolved=""
    if [ "$DRY_RUN" -eq 1 ]; then
        return 0
    fi
    resolved="$(canonical_path "$path")"
    if [ -z "$resolved" ] || [ "$resolved" = "/" ]; then
        log WARN "Refusing cleanup delete for unsafe path: ${path:-<empty>}"
        return 1
    fi
    if path_is_device_endpoint "$resolved"; then
        log WARN "Refusing cleanup delete for device path: $resolved"
        return 1
    fi
    if path_is_within_vault_roots "$resolved"; then
        log WARN "Refusing cleanup delete inside vault root: $resolved"
        return 1
    fi
    if ! path_allowed_for_cleanup_delete "$resolved"; then
        log WARN "Refusing cleanup delete outside approved scratch/cache roots: $resolved"
        return 1
    fi
    rm -rf -- "$resolved"
}

record_event() {
    append_tsv_line \
        "$MEDIA_IMPORT_EVENTS_FILE" \
        "$(timestamp_iso)" \
        "$1" \
        "$2" \
        "$RUN_TRIGGER" \
        "${3:-}" \
        "${4:-}" \
        "${5:-}"
}

record_import_index() {
    local source_type="$1"
    local source_path="$2"
    local dest_path="$3"
    append_tsv_line \
        "$MEDIA_IMPORTED_INDEX_FILE" \
        "$(timestamp_iso)" \
        "$RUN_TRIGGER" \
        "$source_type" \
        "$source_path" \
        "$dest_path"
}

write_import_status() {
    local status="$1"
    local last_run_at
    last_run_at="$(timestamp_iso)"
    write_file_atomic "$MEDIA_IMPORT_STATUS_FILE" "$(cat <<EOF
{
  "status": "$(json_escape "$status")",
  "trigger": "$(json_escape "$RUN_TRIGGER")",
  "lastRunAt": "$last_run_at",
  "dryRun": $( [ "$DRY_RUN" -eq 1 ] && printf 'true' || printf 'false' ),
  "aborted": $( [ "$ABORTED" -eq 1 ] && printf 'true' || printf 'false' ),
  "abortReason": "$(json_escape "$ABORT_REASON")",
  "scannedItems": $SCANNED_ITEMS,
  "imported": $IMPORTED_COUNT,
  "skippedExisting": $SKIPPED_EXISTING_COUNT,
  "collisionCount": $COLLISION_COUNT,
  "failed": $FAILED_COUNT,
  "ambiguousReview": $AMBIGUOUS_REVIEW_COUNT
}
EOF
)"
}

write_cleanup_status() {
    local status="$1"
    local last_run_at
    last_run_at="$(timestamp_iso)"
    write_file_atomic "$MEDIA_CLEANUP_STATUS_FILE" "$(cat <<EOF
{
  "status": "$(json_escape "$status")",
  "trigger": "$(json_escape "$RUN_TRIGGER")",
  "lastRunAt": "$last_run_at",
  "dryRun": $( [ "$DRY_RUN" -eq 1 ] && printf 'true' || printf 'false' ),
  "cleanupMode": "hybrid_age_and_size",
  "deletedItems": $DELETED_ITEMS,
  "deletedBytes": $DELETED_BYTES,
  "deletedImportedItems": $DELETED_IMPORTED_ITEMS,
  "deletedCacheItems": $DELETED_CACHE_ITEMS,
  "scratchPressureBefore": $( [ "$SCRATCH_PRESSURE_BEFORE" -eq 1 ] && printf 'true' || printf 'false' ),
  "scratchPressureAfter": $( [ "$SCRATCH_PRESSURE_AFTER" -eq 1 ] && printf 'true' || printf 'false' )
}
EOF
)"
}

increment_cleanup_totals() {
    local bytes="$1"
    local kind="$2"
    DELETED_ITEMS=$((DELETED_ITEMS + 1))
    DELETED_BYTES=$((DELETED_BYTES + bytes))
    case "$kind" in
        imported) DELETED_IMPORTED_ITEMS=$((DELETED_IMPORTED_ITEMS + 1)) ;;
        cache) DELETED_CACHE_ITEMS=$((DELETED_CACHE_ITEMS + 1)) ;;
    esac
}

heuristic_manual_dest() {
    local candidate="$1"
    local entry_size="${2:-0}"
    local name=""
    name="$(basename "$candidate")"

    if [ "$entry_size" -gt 0 ] && [ "$entry_size" -le "$SMALL_DOWNLOAD_MAX_BYTES" ]; then
        printf '%s\n' "$MEDIA_SMALL_DOWNLOADS_DIR"
        return
    fi

    if [[ "$name" =~ [sS][0-9]{2}[eE][0-9]{2} ]] || [[ "$name" =~ Season[[:space:]_-]?[0-9]+ ]] || [[ "$name" =~ Episode ]]; then
        printf '%s\n' "$MEDIA_SERIES_DIR"
        return
    fi

    case "${name,,}" in
        *.m4b|*.aax|*.aaxc)
            printf '%s\n' "$MEDIA_AUDIOBOOKS_DIR"
            return
            ;;
        *.flac|*.mp3|*.m4a|*.ogg|*.opus|*.wav|*.alac|*.aac)
            printf '%s\n' "$MEDIA_MUSIC_DIR"
            return
            ;;
        *.mkv|*.mp4|*.avi|*.mov|*.mpg|*.mpeg|*.m4v|*.wmv)
            printf '%s\n' "$MEDIA_MOVIES_DIR"
            return
            ;;
    esac

    printf '%s\n' "$MEDIA_IMPORT_REVIEW_DIR"
}

lookup_source_hint() {
    local path="$1"
    local probe="$path"
    local hint=""

    while [ -n "$probe" ] && [ "$probe" != "/" ] && [ "$probe" != "." ]; do
        hint="${QB_SOURCE_HINTS[$probe]:-}"
        if [ -n "$hint" ]; then
            printf '%s\n' "$hint"
            return 0
        fi
        probe="$(dirname "$probe")"
    done

    return 1
}

resolve_source_type() {
    local path="$1"
    local hint=""
    local downloads_root=""

    hint="$(lookup_source_hint "$path" || true)"
    if [ -n "$hint" ]; then
        printf '%s\n' "$hint"
        return 0
    fi

    for downloads_root in "${DOWNLOAD_SCAN_ROOTS[@]}"; do
        if path_within "$path" "$downloads_root/movies"; then
            printf 'movies\n'
            return 0
        fi
        if path_within "$path" "$downloads_root/series"; then
            printf 'series\n'
            return 0
        fi
        if path_within "$path" "$downloads_root/manual"; then
            printf 'manual\n'
            return 0
        fi
    done

    printf 'manual\n'
}

resolve_dest_for_source() {
    local path="$1"
    local source_type=""
    local entry_size=""
    source_type="$(resolve_source_type "$path")"
    entry_size="$(file_size_bytes "$path")"
    case "$source_type" in
        movies)
            printf '%s\n' "$MEDIA_MOVIES_DIR"
            ;;
        series)
            printf '%s\n' "$MEDIA_SERIES_DIR"
            ;;
        *)
            heuristic_manual_dest "$path" "$entry_size"
            ;;
    esac
}

copy_entry() {
    local src="$1"
    local dest_base="$2"
    local source_type="$3"
    local label="$4"
    local dest=""
    local stage_path=""
    local src_fingerprint=""
    local src_kind=""
    local src_file_count=0
    local src_dir_count=0
    local entry_size=""
    local src_checksum=""
    local use_atomic_rename=0
    local move_rc=0
    dest="$dest_base/$(basename "$src")"

    [ -e "$src" ] || return 0
    SCANNED_ITEMS=$((SCANNED_ITEMS + 1))

    if [ -e "$dest" ] || [ -L "$dest" ]; then
        SKIPPED_EXISTING_COUNT=$((SKIPPED_EXISTING_COUNT + 1))
        COLLISION_COUNT=$((COLLISION_COUNT + 1))
        log INFO "$label skipped (destination exists): $dest"
        record_event "import" "skipped-existing" "$src" "$dest" "destination exists"
        return 0
    fi

    if ! copy_paths_are_safe "$src" "$dest"; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        log WARN "$label blocked by safety guard (unsafe copy path pair): $src -> $dest"
        record_event "import" "failed" "$src" "$dest" "blocked by safety guard"
        return 0
    fi

    src_fingerprint="$(entry_fingerprint "$src")"
    IFS=$'\t' read -r src_kind src_file_count src_dir_count entry_size src_checksum <<EOF
$src_fingerprint
EOF
    if [ "$src_kind" = "missing" ] || [ -z "$entry_size" ]; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        log WARN "$label failed pre-move validation (source fingerprint unavailable): $src"
        record_event "import" "failed" "$src" "$dest" "source fingerprint unavailable"
        return 0
    fi
    if [ "$src_kind" = "file" ] && [ ! -r "$src" ]; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        log WARN "$label failed pre-move validation (source not readable): $src"
        record_event "import" "failed" "$src" "$dest" "source not readable"
        return 0
    fi

    if path_within "$dest_base" "$MEDIA_VAULT_ROOT"; then
        if ! space_ok "$entry_size"; then
            FAILED_COUNT=$((FAILED_COUNT + 1))
            log WARN "$label skipped (vault would dip below ${MEDIA_IMPORT_ABORT_FREE_GB}GiB): $src"
            record_event "import" "skipped-space" "$src" "$dest" "vault free space threshold"
            return 0
        fi
    fi

    if [ "$dest_base" = "$MEDIA_IMPORT_REVIEW_DIR" ]; then
        AMBIGUOUS_REVIEW_COUNT=$((AMBIGUOUS_REVIEW_COUNT + 1))
    fi

    mkdir -p "$dest_base"
    if [ "$DRY_RUN" -eq 1 ]; then
        IMPORTED_COUNT=$((IMPORTED_COUNT + 1))
        log INFO "$label would move to $dest"
        record_event "import" "dry-run" "$src" "$dest" "planned move"
        return 0
    fi

    if [ "$MEDIA_IMPORT_FORCE_COPY_MOVE" != "true" ] && paths_share_filesystem "$src" "$dest_base"; then
        use_atomic_rename=1
    fi

    if [ "$use_atomic_rename" -eq 1 ]; then
        log INFO "$label moving via atomic rename"
        if move_without_overwrite "$src" "$dest"; then
            move_rc=0
        else
            move_rc=$?
        fi
        if [ "$move_rc" -ne 0 ]; then
            if [ "$move_rc" -eq 2 ]; then
                SKIPPED_EXISTING_COUNT=$((SKIPPED_EXISTING_COUNT + 1))
                COLLISION_COUNT=$((COLLISION_COUNT + 1))
                log INFO "$label skipped (destination exists during rename): $dest"
                record_event "import" "skipped-existing" "$src" "$dest" "destination exists during rename"
                return 0
            fi
            FAILED_COUNT=$((FAILED_COUNT + 1))
            log WARN "$label failed atomic rename: $src -> $dest"
            record_event "import" "failed" "$src" "$dest" "atomic rename failed"
            return 0
        fi

        if inject_move_fault "after-rename"; then
            FAILED_COUNT=$((FAILED_COUNT + 1))
            rollback_promoted_move "$src" "$dest" "$dest_base" || true
            record_event "import" "failed" "$src" "$dest" "injected fault after rename"
            return 0
        fi
    else
        if [ -d "$src" ]; then
            stage_path="$(mktemp -d "$dest_base/.import-stage-$(basename "$src").XXXXXX")"
            if [ "$HAS_RSYNC" -eq 1 ]; then
                if ! rsync -a --safe-links --no-specials --no-devices "$src/" "$stage_path/" >/dev/null; then
                    FAILED_COUNT=$((FAILED_COUNT + 1))
                    log WARN "$label failed while staging directory copy: $src"
                    safe_remove_move_target "$stage_path" "$dest_base" || true
                    record_event "import" "failed" "$src" "$dest" "staging directory copy failed"
                    return 0
                fi
            else
                if ! cp -a "$src/." "$stage_path/"; then
                    FAILED_COUNT=$((FAILED_COUNT + 1))
                    log WARN "$label failed while staging directory copy: $src"
                    safe_remove_move_target "$stage_path" "$dest_base" || true
                    record_event "import" "failed" "$src" "$dest" "staging directory copy failed"
                    return 0
                fi
            fi
        else
            stage_path="$(mktemp "$dest_base/.import-stage-$(basename "$src").XXXXXX")"
            if [ "$HAS_RSYNC" -eq 1 ]; then
                if ! rsync -a --safe-links --no-specials --no-devices "$src" "$stage_path" >/dev/null; then
                    FAILED_COUNT=$((FAILED_COUNT + 1))
                    log WARN "$label failed while staging file copy: $src"
                    safe_remove_move_target "$stage_path" "$dest_base" || true
                    record_event "import" "failed" "$src" "$dest" "staging file copy failed"
                    return 0
                fi
            else
                if ! cp -a "$src" "$stage_path"; then
                    FAILED_COUNT=$((FAILED_COUNT + 1))
                    log WARN "$label failed while staging file copy: $src"
                    safe_remove_move_target "$stage_path" "$dest_base" || true
                    record_event "import" "failed" "$src" "$dest" "staging file copy failed"
                    return 0
                fi
            fi
        fi

        if inject_move_fault "after-stage-copy"; then
            FAILED_COUNT=$((FAILED_COUNT + 1))
            safe_remove_move_target "$stage_path" "$dest_base" || true
            record_event "import" "failed" "$src" "$dest" "injected fault after stage copy"
            return 0
        fi

        if ! verify_entry_fingerprint "$stage_path" "$src_fingerprint"; then
            FAILED_COUNT=$((FAILED_COUNT + 1))
            log WARN "$label failed staged verification before promote: $stage_path"
            safe_remove_move_target "$stage_path" "$dest_base" || true
            record_event "import" "failed" "$src" "$dest" "staged fingerprint mismatch"
            return 0
        fi

        if move_without_overwrite "$stage_path" "$dest"; then
            move_rc=0
        else
            move_rc=$?
        fi
        if [ "$move_rc" -ne 0 ]; then
            if [ "$move_rc" -eq 2 ]; then
                SKIPPED_EXISTING_COUNT=$((SKIPPED_EXISTING_COUNT + 1))
                COLLISION_COUNT=$((COLLISION_COUNT + 1))
                log INFO "$label skipped (destination exists during promote): $dest"
                record_event "import" "skipped-existing" "$src" "$dest" "destination exists during promote"
                safe_remove_move_target "$stage_path" "$dest_base" || true
                return 0
            fi
            FAILED_COUNT=$((FAILED_COUNT + 1))
            log WARN "$label failed to promote staged move target: $stage_path -> $dest"
            safe_remove_move_target "$stage_path" "$dest_base" || true
            record_event "import" "failed" "$src" "$dest" "stage promote failed"
            return 0
        fi

        if inject_move_fault "after-promote"; then
            FAILED_COUNT=$((FAILED_COUNT + 1))
            rollback_promoted_move "$src" "$dest" "$dest_base" || true
            record_event "import" "failed" "$src" "$dest" "injected fault after promote"
            return 0
        fi
    fi

    if [ ! -e "$dest" ] || ! verify_entry_fingerprint "$dest" "$src_fingerprint"; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        log WARN "$label failed post-move verification: $dest"
        rollback_promoted_move "$src" "$dest" "$dest_base" || true
        record_event "import" "failed" "$src" "$dest" "post-move fingerprint mismatch"
        return 0
    fi

    if [ "$use_atomic_rename" -eq 0 ]; then
        if ! safe_remove_path "$src"; then
            FAILED_COUNT=$((FAILED_COUNT + 1))
            log WARN "$label failed to remove source after move: $src"
            rollback_promoted_move "$src" "$dest" "$dest_base" || true
            record_event "import" "failed" "$src" "$dest" "source removal failed"
            return 0
        fi
    fi
    if [ -e "$src" ] || [ -L "$src" ]; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        log WARN "$label failed post-move verification (source still present): $src"
        rollback_promoted_move "$src" "$dest" "$dest_base" || true
        record_event "import" "failed" "$src" "$dest" "source still present after move"
        return 0
    fi

    IMPORTED_COUNT=$((IMPORTED_COUNT + 1))
    log INFO "$label moved to $dest"
    record_event "import" "moved" "$src" "$dest" ""
    if [ "$dest_base" = "$MEDIA_SMALL_DOWNLOADS_DIR" ]; then
        log INFO "$label moved into small downloads storage lane: $dest"
        record_event "import" "stored-small" "$src" "$dest" ""
        return 0
    fi
    if [ "$dest_base" != "$MEDIA_IMPORT_REVIEW_DIR" ]; then
        record_import_index "$source_type" "$src" "$dest"
    fi
}

process_source_path() {
    local entry="$1"
    local source_type=""
    local dest_root=""
    local resolved_entry=""

    resolved_entry="$(realpath -m "$entry" 2>/dev/null || printf '%s\n' "$entry")"
    if [ -n "${IMPORT_SOURCE_SEEN[$resolved_entry]:-}" ]; then
        return 0
    fi
    IMPORT_SOURCE_SEEN["$resolved_entry"]=1

    if [ ! -e "$entry" ]; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        log WARN "source missing: $entry"
        record_event "import" "missing-source" "$entry" "" "source missing"
        return 0
    fi

    if path_within "$entry" "$MEDIA_DOWNLOADS_TORRENT_QBIT_DIR"; then
        log INFO "source skipped (standalone qbit root): $entry"
        record_event "import" "skip-standalone" "$entry" "" "source under standalone qbit root"
        return 0
    fi

    if path_is_within_vault_roots "$entry"; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        log WARN "source skipped (inside vault roots): $entry"
        record_event "import" "failed" "$entry" "" "source inside vault roots"
        return 0
    fi

    source_type="$(resolve_source_type "$entry")"
    dest_root="$(resolve_dest_for_source "$entry")"
    copy_entry "$entry" "$dest_root" "$source_type" "$source_type $(basename "$entry")"
}

process_root_directory() {
    local source_root="$1"
    local dest_root="$2"
    local source_type="$3"
    local label="$4"
    local entry=""
    local resolved_entry=""

    [ -d "$source_root" ] || return 0

    shopt -s nullglob dotglob
    for entry in "$source_root"/*; do
        [ -e "$entry" ] || continue
        resolved_entry="$(realpath -m "$entry" 2>/dev/null || printf '%s\n' "$entry")"
        if [ -n "${IMPORT_SOURCE_SEEN[$resolved_entry]:-}" ]; then
            continue
        fi
        IMPORT_SOURCE_SEEN["$resolved_entry"]=1
        copy_entry "$entry" "$dest_root" "$source_type" "$label $(basename "$entry")"
    done
    shopt -u nullglob dotglob
}

run_import_pass() {
    local entry=""
    local downloads_root=""

    IMPORT_SOURCE_SEEN=()
    build_download_scan_roots
    populate_qb_source_hints

    if [ "${#SOURCE_PATHS[@]}" -gt 0 ]; then
        local source=""
        for source in "${SOURCE_PATHS[@]}"; do
            process_source_path "$source"
        done
        return 0
    fi

    if [ "${#QB_COMPLETED_SOURCES[@]}" -gt 0 ]; then
        for entry in "${QB_COMPLETED_SOURCES[@]}"; do
            process_source_path "$entry"
        done
    fi

    for downloads_root in "${DOWNLOAD_SCAN_ROOTS[@]}"; do
        process_root_directory "$downloads_root/movies" "$MEDIA_MOVIES_DIR" "movies" "movie"
        process_root_directory "$downloads_root/series" "$MEDIA_SERIES_DIR" "series" "series"

        if [ ! -d "$downloads_root/manual" ]; then
            continue
        fi
        shopt -s nullglob dotglob
        for entry in "$downloads_root/manual"/*; do
            [ -e "$entry" ] || continue
            process_source_path "$entry"
        done
        shopt -u nullglob dotglob
    done
}

should_delete_path() {
    local path="$1"
    local min_age_seconds="$2"
    local now=""
    local mtime=""

    [ -e "$path" ] || return 1
    now="$(date +%s)"
    mtime="$(mtime_seconds "$path")"
    [ "$mtime" -gt 0 ] || return 1
    [ $((now - mtime)) -ge "$min_age_seconds" ]
}

cleanup_cache_root() {
    local root="$1"
    local min_age_seconds="$2"
    local entry=""
    local bytes=""

    [ -d "$root" ] || return 0

    shopt -s nullglob dotglob
    for entry in "$root"/*; do
        [ -e "$entry" ] || continue
        if ! should_delete_path "$entry" "$min_age_seconds"; then
            continue
        fi
        bytes="$(file_size_bytes "$entry")"
        increment_cleanup_totals "$bytes" "cache"
        log INFO "cleanup removing cache entry: $entry"
        record_event "cleanup" "delete-cache" "$entry" "" ""
        safe_remove_path "$entry"
    done
    shopt -u nullglob dotglob
}

cleanup_import_index() {
    local tmp_file=""
    local line=""
    local imported_at=""
    local trigger=""
    local source_type=""
    local source_path=""
    local dest_path=""
    local cutoff_seconds="$1"
    local bytes=""

    mkdir -p "$(dirname "$MEDIA_IMPORTED_INDEX_FILE")"
    touch "$MEDIA_IMPORTED_INDEX_FILE"
    tmp_file="$(mktemp "$RUNTIME_DIR/imported-items.XXXXXX")"

    while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] || continue
        IFS=$'\t' read -r imported_at trigger source_type source_path dest_path <<EOF
$line
EOF
        if [ -z "$source_path" ] || [ -z "$dest_path" ]; then
            continue
        fi

        if [ "$source_type" = "manual" ]; then
            printf '%s\n' "$line" >> "$tmp_file"
            continue
        fi

        if [ ! -e "$source_path" ]; then
            continue
        fi

        if ! should_delete_path "$source_path" "$cutoff_seconds"; then
            printf '%s\n' "$line" >> "$tmp_file"
            continue
        fi

        if ! path_within "$source_path" "$MEDIA_DOWNLOADS_MOVIES_DIR" && ! path_within "$source_path" "$MEDIA_DOWNLOADS_SERIES_DIR"; then
            printf '%s\n' "$line" >> "$tmp_file"
            continue
        fi

        bytes="$(file_size_bytes "$source_path")"
        increment_cleanup_totals "$bytes" "imported"
        log INFO "cleanup removing imported scratch item: $source_path"
        record_event "cleanup" "delete-imported" "$source_path" "$dest_path" ""
        if [ "$DRY_RUN" -eq 1 ]; then
            printf '%s\n' "$line" >> "$tmp_file"
        fi
        safe_remove_path "$source_path"
    done < "$MEDIA_IMPORTED_INDEX_FILE"

    mv "$tmp_file" "$MEDIA_IMPORTED_INDEX_FILE"
}

run_cleanup_pass() {
    local age_cutoff="$RETENTION_SECONDS"
    local cache_cutoff="$RETENTION_SECONDS"

    if [ "$MEDIA_SCRATCH_CLEANUP_ENABLED" != "true" ]; then
        write_cleanup_status "disabled"
        log INFO "scratch cleanup disabled"
        return 0
    fi

    if scratch_is_under_pressure; then
        SCRATCH_PRESSURE_BEFORE=1
        age_cutoff="$PRESSURE_GRACE_SECONDS"
        cache_cutoff="$PRESSURE_GRACE_SECONDS"
    fi

    cleanup_import_index "$age_cutoff"
    cleanup_cache_root "$MEDIA_QBIT_TMP_DIR" "$cache_cutoff"
    cleanup_cache_root "$MEDIA_TRANSCODE_DIR" "$cache_cutoff"
    cleanup_cache_root "$MEDIA_MISC_CACHE_DIR" "$cache_cutoff"
    cleanup_cache_root "$MEDIA_IPTV_CACHE_DIR" "$cache_cutoff"
    cleanup_cache_root "$MEDIA_IPTV_EPG_DIR" "$cache_cutoff"

    if scratch_is_under_pressure; then
        SCRATCH_PRESSURE_AFTER=1
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        write_cleanup_status "dry-run"
    elif [ "$DELETED_ITEMS" -gt 0 ]; then
        write_cleanup_status "success"
    else
        write_cleanup_status "idle"
    fi
}

print_status() {
    local import_payload=""
    local cleanup_payload=""
    import_payload="$(cat "$MEDIA_IMPORT_STATUS_FILE" 2>/dev/null || true)"
    cleanup_payload="$(cat "$MEDIA_CLEANUP_STATUS_FILE" 2>/dev/null || true)"

    if [ "$STATUS_JSON" -eq 1 ]; then
        printf '{\n'
        printf '  "import": %s,\n' "${import_payload:-null}"
        printf '  "cleanup": %s\n' "${cleanup_payload:-null}"
        printf '}\n'
        return 0
    fi

    if [ -n "$import_payload" ]; then
        printf 'Import status:\n%s\n' "$import_payload"
    else
        printf 'Import status: none\n'
    fi

    if [ -n "$cleanup_payload" ]; then
        printf '\nCleanup status:\n%s\n' "$cleanup_payload"
    else
        printf '\nCleanup status: none\n'
    fi
}

run_import_and_cleanup() {
    acquire_lock
    trap release_lock EXIT

    if ! ensure_runtime_paths; then
        log WARN "$ABORT_REASON"
        write_import_status "aborted"
        return 1
    fi

    log INFO "Media importer run started (command=$COMMAND trigger=$RUN_TRIGGER dry_run=$DRY_RUN)"
    run_import_pass

    if [ "$ABORTED" -eq 1 ]; then
        write_import_status "aborted"
        return 1
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        write_import_status "dry-run"
    elif [ "$FAILED_COUNT" -gt 0 ]; then
        write_import_status "partial"
    else
        write_import_status "success"
    fi

    if [ "$SKIP_CLEANUP" -eq 0 ]; then
        run_cleanup_pass
    fi

    log INFO "Media importer run complete"
    return 0
}

run_cleanup_only() {
    acquire_lock
    trap release_lock EXIT

    if ! ensure_runtime_paths; then
        log WARN "$ABORT_REASON"
        write_cleanup_status "aborted"
        return 1
    fi

    log INFO "Media importer cleanup started (trigger=$RUN_TRIGGER dry_run=$DRY_RUN)"
    run_cleanup_pass
    log INFO "Media importer cleanup complete"
}

case "$COMMAND" in
    run|import)
        run_import_and_cleanup
        ;;
    cleanup)
        run_cleanup_only
        ;;
    status)
        print_status
        ;;
    *)
        usage >&2
        exit 1
        ;;
esac
