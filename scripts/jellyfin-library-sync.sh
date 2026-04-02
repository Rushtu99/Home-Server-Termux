#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"

load_shell_env_file() {
    local env_file="$1"
    local line="" key="" value=""

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
        if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            continue
        fi

        case "$value" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
        esac

        export "$key=$value"
    done < "$env_file"
}

load_shell_env_file "$SERVER_ENV_FILE"

if [ -f "$PROJECT/scripts/drive-common.sh" ]; then
    . "$PROJECT/scripts/drive-common.sh"
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
    MEDIA_VAULT_ROOT="${DRIVES_D_DIR:-$USER_HOME/Drives/D}/VAULT/Media"
fi
if [ -z "$MEDIA_SCRATCH_ROOT" ]; then
    MEDIA_SCRATCH_ROOT="${DRIVES_E_DIR:-$USER_HOME/Drives/E}/SCRATCH/HmSTxScratch"
fi

MEDIA_MOVIES_DIR="${MEDIA_MOVIES_DIR:-$MEDIA_VAULT_ROOT/movies}"
MEDIA_SERIES_DIR="${MEDIA_SERIES_DIR:-$MEDIA_VAULT_ROOT/series}"
MEDIA_MUSIC_DIR="${MEDIA_MUSIC_DIR:-$MEDIA_VAULT_ROOT/music}"
MEDIA_AUDIOBOOKS_DIR="${MEDIA_AUDIOBOOKS_DIR:-$MEDIA_VAULT_ROOT/audiobooks}"
MEDIA_SCRATCH_LIBRARY_ROOT="${MEDIA_SCRATCH_LIBRARY_ROOT:-$MEDIA_SCRATCH_ROOT/media}"
MEDIA_SCRATCH_MOVIES_DIR="${MEDIA_SCRATCH_MOVIES_DIR:-$MEDIA_SCRATCH_LIBRARY_ROOT/movies}"
MEDIA_SCRATCH_SERIES_DIR="${MEDIA_SCRATCH_SERIES_DIR:-$MEDIA_SCRATCH_LIBRARY_ROOT/series}"
MEDIA_SCRATCH_MUSIC_DIR="${MEDIA_SCRATCH_MUSIC_DIR:-$MEDIA_SCRATCH_LIBRARY_ROOT/music}"
MEDIA_SCRATCH_AUDIOBOOKS_DIR="${MEDIA_SCRATCH_AUDIOBOOKS_DIR:-$MEDIA_SCRATCH_LIBRARY_ROOT/audiobooks}"

MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
JELLYFIN_HOME="${JELLYFIN_HOME:-$MEDIA_SERVICES_HOME/jellyfin}"
JELLYFIN_DATA_DIR="${JELLYFIN_DATA_DIR:-$JELLYFIN_HOME/data}"
JELLYFIN_VIRTUAL_ROOT="${JELLYFIN_VIRTUAL_ROOT:-$JELLYFIN_DATA_DIR/root/default}"
JELLYFIN_DB_PATH="${JELLYFIN_DB_PATH:-$JELLYFIN_DATA_DIR/data/jellyfin.db}"

xml_escape() {
    printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

sql_escape() {
    printf '%s' "$1" | sed "s/'/''/g"
}

build_json_string_array() {
    local first=1
    local entry=""

    printf '['
    for entry in "$@"; do
        [ -n "$entry" ] || continue
        if [ "$first" -eq 0 ]; then
            printf ','
        fi
        printf '"%s"' "$(json_escape "$entry")"
        first=0
    done
    printf ']'
}

build_path_infos_block() {
    local path=""

    printf '  <PathInfos>\n'
    printf '    <MediaPathInfo>\n'
    printf '      <Path>/</Path>\n'
    printf '    </MediaPathInfo>\n'
    for path in "$@"; do
        [ -n "$path" ] || continue
        printf '    <MediaPathInfo>\n'
        printf '      <Path>%s</Path>\n' "$(xml_escape "$path")"
        printf '    </MediaPathInfo>\n'
    done
    printf '  </PathInfos>\n'
}

write_library_options() {
    local options_path="$1"
    shift
    local path_infos=""
    local tmp_file=""

    path_infos="$(build_path_infos_block "$@")"
    path_infos="${path_infos}"$'\n'
    tmp_file="$(mktemp)"

    if [ -f "$options_path" ] && grep -q '<PathInfos>' "$options_path"; then
        awk -v replacement="$path_infos" '
            BEGIN { in_block = 0 }
            /<PathInfos>/ {
                printf "%s", replacement
                in_block = 1
                next
            }
            in_block && /<\/PathInfos>/ {
                in_block = 0
                next
            }
            !in_block { print }
        ' "$options_path" > "$tmp_file"
    else
        cat > "$tmp_file" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<LibraryOptions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Enabled>true</Enabled>
  <EnableRealtimeMonitor>true</EnableRealtimeMonitor>
$path_infos  <SaveLocalMetadata>false</SaveLocalMetadata>
  <AutomaticRefreshIntervalDays>0</AutomaticRefreshIntervalDays>
</LibraryOptions>
EOF
    fi

    mv "$tmp_file" "$options_path"
}

repair_collection_item_data() {
    local folder_path="$1"
    shift
    local locations_json=""
    local now_utc=""

    [ -f "$JELLYFIN_DB_PATH" ] || return 0

    locations_json="$(build_json_string_array "$folder_path" "$@")"
    now_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

    sqlite3 "$JELLYFIN_DB_PATH" <<EOF >/dev/null
UPDATE BaseItems
SET
    Data = json_set(
        COALESCE(Data, '{}'),
        '$.PhysicalLocationsList', json('$(sql_escape "$locations_json")'),
        '$.DateLastSaved', '$(sql_escape "$now_utc")'
    ),
    DateLastSaved = '$(sql_escape "$now_utc")'
WHERE Type = 'MediaBrowser.Controller.Entities.CollectionFolder'
  AND Path = '$(sql_escape "$folder_path")';
EOF
}

sync_library() {
    local display_name="$1"
    local collection_type="$2"
    shift 2
    local folder_path="$JELLYFIN_VIRTUAL_ROOT/$display_name"
    local options_path="$folder_path/options.xml"
    local marker_path="$folder_path/$collection_type.collection"
    local managed_index=0
    local media_path=""

    mkdir -p "$folder_path"
    find "$folder_path" -maxdepth 1 -type f -name '*.collection' -delete 2>/dev/null || true
    find "$folder_path" -maxdepth 1 -type f -name '*.mblink' -delete 2>/dev/null || true

    : > "$marker_path"

    for media_path in "$@"; do
        [ -n "$media_path" ] || continue
        mkdir -p "$media_path"
        managed_index=$((managed_index + 1))
        printf '%s' "$media_path" > "$folder_path/managed-$managed_index.mblink"
    done

    write_library_options "$options_path" "$@"
    repair_collection_item_data "$folder_path" "$@"
}

sync_all() {
    mkdir -p \
        "$JELLYFIN_VIRTUAL_ROOT" \
        "$MEDIA_MOVIES_DIR" \
        "$MEDIA_SERIES_DIR" \
        "$MEDIA_MUSIC_DIR" \
        "$MEDIA_AUDIOBOOKS_DIR" \
        "$MEDIA_SCRATCH_MOVIES_DIR" \
        "$MEDIA_SCRATCH_SERIES_DIR" \
        "$MEDIA_SCRATCH_MUSIC_DIR" \
        "$MEDIA_SCRATCH_AUDIOBOOKS_DIR"

    sync_library "Movies" "movies" "$MEDIA_MOVIES_DIR" "$MEDIA_SCRATCH_MOVIES_DIR"
    sync_library "Series" "tvshows" "$MEDIA_SERIES_DIR" "$MEDIA_SCRATCH_SERIES_DIR"
    sync_library "Music" "music" "$MEDIA_MUSIC_DIR" "$MEDIA_SCRATCH_MUSIC_DIR"
    sync_library "Audiobooks" "books" "$MEDIA_AUDIOBOOKS_DIR" "$MEDIA_SCRATCH_AUDIOBOOKS_DIR"
}

case "${1:-sync}" in
    sync)
        sync_all
        ;;
    *)
        echo "usage: $0 {sync}" >&2
        exit 1
        ;;
esac
