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
. "$PROJECT/scripts/drive-common.sh"

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
MEDIA_IMPORT_STATUS_FILE="${MEDIA_IMPORT_STATUS_FILE:-$MEDIA_IMPORT_LOG_DIR/import-status.json}"
MEDIA_CLEANUP_STATUS_FILE="${MEDIA_CLEANUP_STATUS_FILE:-$MEDIA_IMPORT_LOG_DIR/cleanup-status.json}"
MEDIA_IMPORTED_INDEX_FILE="${MEDIA_IMPORTED_INDEX_FILE:-$MEDIA_IMPORT_LOG_DIR/imported-items.tsv}"
MEDIA_IMPORT_EVENTS_FILE="${MEDIA_IMPORT_EVENTS_FILE:-$MEDIA_IMPORT_LOG_DIR/import-events.tsv}"

LOGFILE="$MEDIA_IMPORT_LOG_DIR/media-importer.log"
LOCK_FILE="$MEDIA_IMPORT_LOG_DIR/media-importer.lock"
MIN_VAULT_FREE_BYTES=$((MEDIA_IMPORT_ABORT_FREE_GB * 1024 * 1024 * 1024))
SMALL_DOWNLOAD_MAX_BYTES=$((MEDIA_SMALL_DOWNLOADS_MAX_MB * 1024 * 1024))
SCRATCH_MIN_FREE_BYTES=$((MEDIA_SCRATCH_MIN_FREE_GB * 1024 * 1024 * 1024))
RETENTION_SECONDS=$((MEDIA_SCRATCH_RETENTION_DAYS * 24 * 60 * 60))
PRESSURE_GRACE_SECONDS=$((24 * 60 * 60))

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

safe_remove_path() {
    local path="$1"
    if [ "$DRY_RUN" -eq 1 ]; then
        return 0
    fi
    rm -rf -- "$path"
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

resolve_source_type() {
    local path="$1"
    if path_within "$path" "$MEDIA_DOWNLOADS_MOVIES_DIR"; then
        printf 'movies\n'
    elif path_within "$path" "$MEDIA_DOWNLOADS_SERIES_DIR"; then
        printf 'series\n'
    elif path_within "$path" "$MEDIA_DOWNLOADS_MANUAL_DIR"; then
        printf 'manual\n'
    else
        printf 'manual\n'
    fi
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
    local entry_size=""
    dest="$dest_base/$(basename "$src")"

    [ -e "$src" ] || return 0
    SCANNED_ITEMS=$((SCANNED_ITEMS + 1))

    if [ -e "$dest" ]; then
        SKIPPED_EXISTING_COUNT=$((SKIPPED_EXISTING_COUNT + 1))
        COLLISION_COUNT=$((COLLISION_COUNT + 1))
        log INFO "$label skipped (destination exists): $dest"
        record_event "import" "skipped-existing" "$src" "$dest" "destination exists"
        return 0
    fi

    entry_size="$(file_size_bytes "$src")"
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
        log INFO "$label would import to $dest"
        record_event "import" "dry-run" "$src" "$dest" "planned"
        return 0
    fi

    if [ -d "$src" ]; then
        mkdir -p "$dest"
        if [ "$HAS_RSYNC" -eq 1 ]; then
            rsync -a --ignore-existing "$src/" "$dest/" >/dev/null
        else
            cp -a "$src/." "$dest/"
        fi
    else
        if [ "$HAS_RSYNC" -eq 1 ]; then
            rsync -a --ignore-existing "$src" "$dest_base/" >/dev/null
        else
            cp -a -n "$src" "$dest_base/"
        fi
    fi

    if [ ! -e "$dest" ]; then
        FAILED_COUNT=$((FAILED_COUNT + 1))
        log WARN "$label failed verification after copy: $dest"
        record_event "import" "failed" "$src" "$dest" "destination missing after copy"
        return 0
    fi

    IMPORTED_COUNT=$((IMPORTED_COUNT + 1))
    log INFO "$label imported to $dest"
    record_event "import" "copied" "$src" "$dest" ""
    if [ "$dest_base" = "$MEDIA_SMALL_DOWNLOADS_DIR" ]; then
        log INFO "$label moved into small downloads storage: $dest"
        record_event "import" "stored-small" "$src" "$dest" ""
        safe_remove_path "$src"
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

    [ -d "$source_root" ] || return 0

    shopt -s nullglob dotglob
    for entry in "$source_root"/*; do
        [ -e "$entry" ] || continue
        copy_entry "$entry" "$dest_root" "$source_type" "$label $(basename "$entry")"
    done
    shopt -u nullglob dotglob
}

run_import_pass() {
    local entry=""

    if [ "${#SOURCE_PATHS[@]}" -gt 0 ]; then
        local source=""
        for source in "${SOURCE_PATHS[@]}"; do
            process_source_path "$source"
        done
        return 0
    fi

    process_root_directory "$MEDIA_DOWNLOADS_MOVIES_DIR" "$MEDIA_MOVIES_DIR" "movies" "movie"
    process_root_directory "$MEDIA_DOWNLOADS_SERIES_DIR" "$MEDIA_SERIES_DIR" "series" "series"

    if [ -d "$MEDIA_DOWNLOADS_MANUAL_DIR" ]; then
        shopt -s nullglob dotglob
        for entry in "$MEDIA_DOWNLOADS_MANUAL_DIR"/*; do
            [ -e "$entry" ] || continue
            process_source_path "$entry"
        done
        shopt -u nullglob dotglob
    fi
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
