#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"
TERMUX_DRIVES_PATH="${TERMUX_DRIVES_PATH:-$USER_HOME/Drives}"
CHROOT_DRIVES_PATH="${CHROOT_DRIVES_PATH:-/mnt/termux-drives}"

if [ -f "$PROJECT/scripts/drive-common.sh" ]; then
    . "$PROJECT/scripts/drive-common.sh"
fi

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

MEDIA_VAULT_DRIVES="${MEDIA_VAULT_DRIVES:-D}"
MEDIA_SCRATCH_DRIVES="${MEDIA_SCRATCH_DRIVES:-E}"
MEDIA_VAULT_DIR_NAME="${MEDIA_VAULT_DIR_NAME:-VAULT}"
MEDIA_SCRATCH_DIR_NAME="${MEDIA_SCRATCH_DIR_NAME:-SCRATCH}"
MEDIA_VAULT_MEDIA_SUBDIR="${MEDIA_VAULT_MEDIA_SUBDIR:-Media}"
MEDIA_SCRATCH_MEDIA_SUBDIR="${MEDIA_SCRATCH_MEDIA_SUBDIR:-HmSTxScratch}"
DEFAULT_VAULT_DRIVE_DIR=""
DEFAULT_SCRATCH_DRIVE_DIR=""
if type resolve_drive_dir >/dev/null 2>&1; then
    DEFAULT_VAULT_DRIVE_DIR="$(resolve_drive_dir "${MEDIA_VAULT_DRIVES%%,*}" || true)"
    DEFAULT_SCRATCH_DRIVE_DIR="$(resolve_drive_dir "${MEDIA_SCRATCH_DRIVES%%,*}" || true)"
fi
MEDIA_VAULT_ROOT="${MEDIA_VAULT_ROOT:-${DEFAULT_VAULT_DRIVE_DIR:+$DEFAULT_VAULT_DRIVE_DIR/$MEDIA_VAULT_DIR_NAME/$MEDIA_VAULT_MEDIA_SUBDIR}}"
MEDIA_SCRATCH_ROOT="${MEDIA_SCRATCH_ROOT:-${DEFAULT_SCRATCH_DRIVE_DIR:+$DEFAULT_SCRATCH_DRIVE_DIR/$MEDIA_SCRATCH_DIR_NAME/$MEDIA_SCRATCH_MEDIA_SUBDIR}}"
if [ -z "$MEDIA_VAULT_ROOT" ]; then
    MEDIA_VAULT_ROOT="$USER_HOME/Drives/D/$MEDIA_VAULT_DIR_NAME/$MEDIA_VAULT_MEDIA_SUBDIR"
fi
if [ -z "$MEDIA_SCRATCH_ROOT" ]; then
    MEDIA_SCRATCH_ROOT="$USER_HOME/Drives/E/$MEDIA_SCRATCH_DIR_NAME/$MEDIA_SCRATCH_MEDIA_SUBDIR"
fi
MEDIA_DOWNLOADS_DIR="${MEDIA_DOWNLOADS_DIR:-$MEDIA_SCRATCH_ROOT/downloads}"
MEDIA_DOWNLOADS_MOVIES_DIR="${MEDIA_DOWNLOADS_MOVIES_DIR:-$MEDIA_DOWNLOADS_DIR/movies}"
MEDIA_DOWNLOADS_SERIES_DIR="${MEDIA_DOWNLOADS_SERIES_DIR:-$MEDIA_DOWNLOADS_DIR/series}"
MEDIA_MOVIES_DIR="${MEDIA_MOVIES_DIR:-$MEDIA_VAULT_ROOT/movies}"
MEDIA_SERIES_DIR="${MEDIA_SERIES_DIR:-$MEDIA_VAULT_ROOT/series}"
QBITTORRENT_BIND_HOST="${QBITTORRENT_BIND_HOST:-127.0.0.1}"
QBITTORRENT_PORT="${QBITTORRENT_PORT:-8081}"
SONARR_PORT="${SONARR_PORT:-8989}"
RADARR_PORT="${RADARR_PORT:-7878}"
PROWLARR_PORT="${PROWLARR_PORT:-9696}"
JELLYFIN_PORT="${JELLYFIN_PORT:-8096}"
BAZARR_PORT="${BAZARR_PORT:-6767}"
JELLYSEERR_PORT="${JELLYSEERR_PORT:-5055}"
SONARR_BASE_PATH="${SONARR_BASE_PATH:-/sonarr}"
RADARR_BASE_PATH="${RADARR_BASE_PATH:-/radarr}"
PROWLARR_BASE_PATH="${PROWLARR_BASE_PATH:-/prowlarr}"
BAZARR_BASE_PATH="${BAZARR_BASE_PATH:-/bazarr}"
JELLYSEERR_BASE_PATH="${JELLYSEERR_BASE_PATH:-/requests}"
QBITTORRENT_SERVICE_CMD="${QBITTORRENT_SERVICE_CMD:-$PROJECT/scripts/qbittorrent-service.sh}"
JELLYFIN_SERVICE_CMD="${JELLYFIN_SERVICE_CMD:-$PROJECT/scripts/jellyfin-service.sh}"
SONARR_SERVICE_CMD="${SONARR_SERVICE_CMD:-$PROJECT/scripts/sonarr-service.sh}"
RADARR_SERVICE_CMD="${RADARR_SERVICE_CMD:-$PROJECT/scripts/radarr-service.sh}"
PROWLARR_SERVICE_CMD="${PROWLARR_SERVICE_CMD:-$PROJECT/scripts/prowlarr-service.sh}"
BAZARR_SERVICE_CMD="${BAZARR_SERVICE_CMD:-$PROJECT/scripts/bazarr-service.sh}"
JELLYSEERR_SERVICE_CMD="${JELLYSEERR_SERVICE_CMD:-$PROJECT/scripts/jellyseerr-service.sh}"
JELLYFIN_LIBRARY_SYNC_CMD="${JELLYFIN_LIBRARY_SYNC_CMD:-$PROJECT/scripts/jellyfin-library-sync.sh}"
BAZARR_HOME="${BAZARR_HOME:-$USER_HOME/services/bazarr}"
BAZARR_CONFIG_PATH="${BAZARR_CONFIG_PATH:-$BAZARR_HOME/data/config/config.yaml}"
JELLYFIN_DB_PATH="${JELLYFIN_DB_PATH:-$USER_HOME/services/jellyfin/data/data/jellyfin.db}"
JELLYSEERR_HOME="${JELLYSEERR_HOME:-$USER_HOME/services/jellyseerr}"
JELLYSEERR_SETTINGS_PATH="${JELLYSEERR_SETTINGS_PATH:-$JELLYSEERR_HOME/data/settings.json}"

mkdir -p "$MEDIA_MOVIES_DIR" "$MEDIA_SERIES_DIR" 2>/dev/null || true

export TERMUX_DRIVES_PATH CHROOT_DRIVES_PATH MEDIA_MOVIES_DIR MEDIA_SERIES_DIR
export MEDIA_DOWNLOADS_MOVIES_DIR MEDIA_DOWNLOADS_SERIES_DIR
export QBITTORRENT_BIND_HOST QBITTORRENT_PORT SONARR_PORT RADARR_PORT PROWLARR_PORT
export JELLYFIN_PORT BAZARR_PORT JELLYSEERR_PORT
export SONARR_BASE_PATH RADARR_BASE_PATH PROWLARR_BASE_PATH BAZARR_BASE_PATH JELLYSEERR_BASE_PATH
export BAZARR_CONFIG_PATH JELLYFIN_DB_PATH JELLYSEERR_SETTINGS_PATH

python3 - <<'PY'
import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
import yaml

TERMUX_DRIVES_PATH = os.environ["TERMUX_DRIVES_PATH"]
CHROOT_DRIVES_PATH = os.environ["CHROOT_DRIVES_PATH"]
MEDIA_MOVIES_DIR = os.environ["MEDIA_MOVIES_DIR"]
MEDIA_SERIES_DIR = os.environ["MEDIA_SERIES_DIR"]

QBITTORRENT_BIND_HOST = os.environ["QBITTORRENT_BIND_HOST"]
QBITTORRENT_PORT = int(os.environ["QBITTORRENT_PORT"])
SONARR_PORT = int(os.environ["SONARR_PORT"])
RADARR_PORT = int(os.environ["RADARR_PORT"])
PROWLARR_PORT = int(os.environ["PROWLARR_PORT"])
JELLYFIN_PORT = int(os.environ["JELLYFIN_PORT"])
BAZARR_PORT = int(os.environ["BAZARR_PORT"])
JELLYSEERR_PORT = int(os.environ["JELLYSEERR_PORT"])
SONARR_BASE_PATH = os.environ["SONARR_BASE_PATH"]
RADARR_BASE_PATH = os.environ["RADARR_BASE_PATH"]
PROWLARR_BASE_PATH = os.environ["PROWLARR_BASE_PATH"]
BAZARR_BASE_PATH = os.environ["BAZARR_BASE_PATH"]
JELLYSEERR_BASE_PATH = os.environ["JELLYSEERR_BASE_PATH"]
BAZARR_CONFIG_PATH = Path(os.environ["BAZARR_CONFIG_PATH"])
JELLYFIN_DB_PATH = Path(os.environ["JELLYFIN_DB_PATH"])
JELLYSEERR_SETTINGS_PATH = Path(os.environ["JELLYSEERR_SETTINGS_PATH"])

ROOT = Path("/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/debian-hs/opt/home-server")
SONARR_CONFIG = ROOT / "sonarr/data/config.xml"
RADARR_CONFIG = ROOT / "radarr/data/config.xml"
PROWLARR_CONFIG = ROOT / "prowlarr/data/config.xml"

def read_api_key(config_path: Path) -> str:
    root = ET.fromstring(config_path.read_text())
    node = root.find("ApiKey")
    if node is None or not (node.text or "").strip():
        raise SystemExit(f"Missing ApiKey in {config_path}")
    return node.text.strip()

def wait_for_url(url: str, headers=None, timeout=60):
    headers = headers or {}
    started = time.time()
    last_error = None
    while time.time() - started < timeout:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                return exc.code
            last_error = exc
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(1)
    raise SystemExit(f"Timed out waiting for {url}: {last_error}")

def request_json(method: str, url: str, headers=None, payload=None):
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as response:
        body = response.read().decode() or "null"
        return json.loads(body)

def request_json_optional(method: str, url: str, headers=None, payload=None, default=None):
    try:
        return request_json(method, url, headers=headers, payload=payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return default
        raise

def path_in_chroot(host_path: str) -> str:
    normalized = str(Path(host_path))
    drives_root = str(Path(TERMUX_DRIVES_PATH))
    if normalized == drives_root:
        return CHROOT_DRIVES_PATH
    if normalized.startswith(drives_root + "/"):
        return CHROOT_DRIVES_PATH + normalized[len(drives_root):]
    return normalized

def normalize_dir_path(value: str) -> str:
    normalized = str(Path(value))
    if normalized == "/":
        return normalized
    return normalized.rstrip("/") + "/"

def set_field_value(fields, name, value):
    for field in fields:
        if field.get("name") == name:
            field["value"] = value
            return
    fields.append({"name": name, "value": value})

def normalize_base_url(value: str) -> str:
    if not value:
        return ""
    normalized = "/" + value.strip().strip("/")
    return "" if normalized == "/" else normalized

def deep_merge(base, override):
    if not isinstance(base, dict) or not isinstance(override, dict):
        return override
    merged = dict(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged

def ensure_root_folder(base_url: str, api_key: str, folder_path: str):
    items = request_json("GET", f"{base_url}/rootfolder", {"X-Api-Key": api_key})
    for item in items:
        if item.get("path") == folder_path:
            return item
    try:
        return request_json("POST", f"{base_url}/rootfolder", {"X-Api-Key": api_key}, {"path": folder_path})
    except urllib.error.HTTPError as exc:
        if exc.code == 400:
            return {"path": folder_path, "accessible": False, "skipped": True}
        raise

def ensure_remote_path_mapping(base_url: str, api_key: str, host: str, remote_path: str, local_path: str):
    remote_path = normalize_dir_path(remote_path)
    local_path = normalize_dir_path(local_path)
    items = request_json("GET", f"{base_url}/remotepathmapping", {"X-Api-Key": api_key})
    for item in items:
        existing_remote = normalize_dir_path(item.get("remotePath") or "")
        if item.get("host") == host and existing_remote == remote_path:
            item["remotePath"] = remote_path
            item["localPath"] = local_path
            try:
                return request_json("PUT", f"{base_url}/remotepathmapping/{item['id']}", {"X-Api-Key": api_key}, item)
            except urllib.error.HTTPError as exc:
                if exc.code == 400:
                    return item
                raise
    try:
        return request_json("POST", f"{base_url}/remotepathmapping", {"X-Api-Key": api_key}, {
            "host": host,
            "remotePath": remote_path,
            "localPath": local_path,
        })
    except urllib.error.HTTPError as exc:
        if exc.code == 400:
            return {"host": host, "remotePath": remote_path, "localPath": local_path, "skipped": True}
        raise

def ensure_download_client(base_url: str, api_key: str, category_field: str, category_value: str):
    clients = request_json("GET", f"{base_url}/downloadclient", {"X-Api-Key": api_key})
    existing = next((item for item in clients if item.get("implementation") == "QBittorrent"), None)
    if existing is None:
        schema = request_json("GET", f"{base_url}/downloadclient/schema", {"X-Api-Key": api_key})
        existing = next(item for item in schema if item.get("implementation") == "QBittorrent")
    existing["enable"] = True
    existing["name"] = "HmSTx qBittorrent"
    existing["protocol"] = "torrent"
    existing["priority"] = 1
    existing["removeCompletedDownloads"] = True
    existing["removeFailedDownloads"] = True
    existing.setdefault("tags", [])
    fields = existing.setdefault("fields", [])
    set_field_value(fields, "host", QBITTORRENT_BIND_HOST)
    set_field_value(fields, "port", QBITTORRENT_PORT)
    set_field_value(fields, "useSsl", False)
    set_field_value(fields, "urlBase", "")
    set_field_value(fields, "username", os.environ.get("QBITTORRENT_WEBUI_USERNAME", ""))
    set_field_value(fields, "password", os.environ.get("QBITTORRENT_WEBUI_PASSWORD", ""))
    set_field_value(fields, category_field, category_value)
    imported_field = "tvImportedCategory" if category_field == "tvCategory" else "movieImportedCategory"
    set_field_value(fields, imported_field, "")
    set_field_value(fields, "recentTvPriority" if category_field == "tvCategory" else "recentMoviePriority", 0)
    set_field_value(fields, "olderTvPriority" if category_field == "tvCategory" else "olderMoviePriority", 0)
    set_field_value(fields, "initialState", 0)
    set_field_value(fields, "sequentialOrder", False)
    set_field_value(fields, "firstAndLast", False)
    set_field_value(fields, "contentLayout", 0)
    if existing.get("id"):
        return request_json("PUT", f"{base_url}/downloadclient/{existing['id']}", {"X-Api-Key": api_key}, existing)
    return request_json("POST", f"{base_url}/downloadclient", {"X-Api-Key": api_key}, existing)

def ensure_prowlarr_app(base_url: str, api_key: str, impl: str, target_url: str, target_api_key: str):
    apps = request_json("GET", f"{base_url}/applications", {"X-Api-Key": api_key})
    existing = next((item for item in apps if item.get("implementation") == impl), None)
    if existing is None:
        schema = request_json("GET", f"{base_url}/applications/schema", {"X-Api-Key": api_key})
        existing = next(item for item in schema if item.get("implementation") == impl)
    existing["enable"] = True
    existing["name"] = impl
    existing["syncLevel"] = "fullSync"
    existing.setdefault("tags", [])
    fields = existing.setdefault("fields", [])
    set_field_value(fields, "prowlarrUrl", f"http://127.0.0.1:{PROWLARR_PORT}{PROWLARR_BASE_PATH}")
    set_field_value(fields, "baseUrl", target_url)
    set_field_value(fields, "apiKey", target_api_key)
    if existing.get("id"):
        return request_json("PUT", f"{base_url}/applications/{existing['id']}", {"X-Api-Key": api_key}, existing)
    return request_json("POST", f"{base_url}/applications", {"X-Api-Key": api_key}, existing)

def get_default_quality_profile(base_url: str, api_key: str):
    profiles = request_json("GET", f"{base_url}/qualityprofile", {"X-Api-Key": api_key})
    if not profiles:
        raise SystemExit(f"No quality profiles available at {base_url}")
    preferred = next((item for item in profiles if str(item.get("name", "")).lower() in {"hd-1080p", "any", "default"}), None)
    profile = preferred or profiles[0]
    return int(profile["id"]), str(profile.get("name") or f"Profile {profile['id']}")

def get_default_language_profile(base_url: str, api_key: str):
    profiles = request_json_optional("GET", f"{base_url}/languageprofile", {"X-Api-Key": api_key}, default=[])
    if not profiles:
        return None, None
    profile = profiles[0]
    return int(profile["id"]), str(profile.get("name") or f"Language {profile['id']}")

def read_jellyfin_admin_token():
    con = sqlite3.connect(JELLYFIN_DB_PATH)
    try:
        cur = con.cursor()
        row = cur.execute(
            """
            SELECT Devices.AccessToken, Devices.DeviceId
            FROM Users
            JOIN Devices ON Devices.UserId = Users.Id
            WHERE lower(Users.Username) = 'admin'
            ORDER BY Devices.DateLastActivity DESC, Devices.DateCreated DESC
            LIMIT 1
            """
        ).fetchone()
    finally:
        con.close()
    if not row:
        raise SystemExit(f"Could not find a Jellyfin admin access token in {JELLYFIN_DB_PATH}")
    return row[0], row[1]

def jellyfin_request(path: str, token: str, device_id: str):
    headers = {
        "Authorization": f'MediaBrowser Client="Seerr", Device="Seerr", DeviceId="{device_id}", Version="1.0.0", Token="{token}"',
        "Accept": "application/json",
    }
    return request_json("GET", f"http://127.0.0.1:{JELLYFIN_PORT}{path}", headers=headers)

def configure_bazarr(sonarr_key: str, radarr_key: str):
    config = {}
    if BAZARR_CONFIG_PATH.exists():
        config = yaml.safe_load(BAZARR_CONFIG_PATH.read_text()) or {}
    config.setdefault("general", {})
    config.setdefault("sonarr", {})
    config.setdefault("radarr", {})
    general = config["general"]
    sonarr = config["sonarr"]
    radarr = config["radarr"]
    general["base_url"] = normalize_base_url(BAZARR_BASE_PATH)
    general["embedded_subtitles_parser"] = "ffprobe"
    general["hostname"] = "localhost"
    general["ip"] = "127.0.0.1"
    general["port"] = BAZARR_PORT
    general["use_radarr"] = True
    general["use_sonarr"] = True
    sonarr["apikey"] = sonarr_key
    sonarr["base_url"] = normalize_base_url(SONARR_BASE_PATH) or "/"
    sonarr["ip"] = "127.0.0.1"
    sonarr["port"] = SONARR_PORT
    sonarr["ssl"] = False
    radarr["apikey"] = radarr_key
    radarr["base_url"] = normalize_base_url(RADARR_BASE_PATH) or "/"
    radarr["ip"] = "127.0.0.1"
    radarr["port"] = RADARR_PORT
    radarr["ssl"] = False
    BAZARR_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    BAZARR_CONFIG_PATH.write_text(yaml.safe_dump(config, sort_keys=True))
    return {
        "baseUrl": general["base_url"],
        "port": general["port"],
        "useRadarr": bool(general["use_radarr"]),
        "useSonarr": bool(general["use_sonarr"]),
    }

def configure_jellyseerr(sonarr_key: str, radarr_key: str, series_root: str, movies_root: str):
    token, device_id = read_jellyfin_admin_token()
    public_info = jellyfin_request("/System/Info/Public", token, device_id)
    libraries_response = jellyfin_request("/Library/VirtualFolders", token, device_id)

    libraries = []
    for item in libraries_response:
        collection_type = str(item.get("CollectionType") or "").lower()
        if collection_type not in {"movies", "tvshows"}:
            continue
        libraries.append({
            "id": str(item.get("ItemId") or item.get("Name") or ""),
            "name": str(item.get("Name") or item.get("CollectionType") or "Library"),
            "enabled": True,
            "type": "movie" if collection_type == "movies" else "show",
        })

    radarr_profile_id, radarr_profile_name = get_default_quality_profile(radarr_base, radarr_key)
    sonarr_profile_id, sonarr_profile_name = get_default_quality_profile(sonarr_base, sonarr_key)
    language_profile_id, _ = get_default_language_profile(sonarr_base, sonarr_key)

    existing = {}
    if JELLYSEERR_SETTINGS_PATH.exists():
        existing = json.loads(JELLYSEERR_SETTINGS_PATH.read_text() or "{}")

    merged = deep_merge(existing, {
        "main": {
            "applicationTitle": "HmSTx Requests",
            "applicationUrl": normalize_base_url(JELLYSEERR_BASE_PATH),
            "localLogin": True,
            "mediaServerLogin": True,
            "newPlexLogin": False,
            "mediaServerType": 2,
            "partialRequestsEnabled": True,
            "enableSpecialEpisodes": False,
            "locale": "en",
        },
        "jellyfin": {
            "name": str(public_info.get("ServerName") or "HmSTx"),
            "ip": "127.0.0.1",
            "port": JELLYFIN_PORT,
            "useSsl": False,
            "urlBase": "",
            "externalHostname": "",
            "jellyfinForgotPasswordUrl": "",
            "libraries": libraries,
            "serverId": str(public_info.get("Id") or ""),
            "apiKey": token,
        },
        "radarr": [
            {
                "id": 0,
                "name": "Radarr",
                "hostname": "127.0.0.1",
                "port": RADARR_PORT,
                "apiKey": radarr_key,
                "useSsl": False,
                "baseUrl": normalize_base_url(RADARR_BASE_PATH),
                "activeProfileId": radarr_profile_id,
                "activeProfileName": radarr_profile_name,
                "activeDirectory": movies_root,
                "tags": [],
                "is4k": False,
                "isDefault": True,
                "externalUrl": "",
                "syncEnabled": True,
                "preventSearch": False,
                "tagRequests": False,
                "overrideRule": [],
                "minimumAvailability": "released",
            }
        ],
        "sonarr": [
            {
                "id": 0,
                "name": "Sonarr",
                "hostname": "127.0.0.1",
                "port": SONARR_PORT,
                "apiKey": sonarr_key,
                "useSsl": False,
                "baseUrl": normalize_base_url(SONARR_BASE_PATH),
                "activeProfileId": sonarr_profile_id,
                "activeProfileName": sonarr_profile_name,
                "activeDirectory": series_root,
                "activeLanguageProfileId": language_profile_id,
                "tags": [],
                "is4k": False,
                "isDefault": True,
                "externalUrl": "",
                "syncEnabled": True,
                "preventSearch": False,
                "tagRequests": False,
                "overrideRule": [],
                "seriesType": "standard",
                "animeSeriesType": "anime",
                "enableSeasonFolders": True,
            }
        ],
        "public": {
            "initialized": True,
        },
    })
    JELLYSEERR_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    JELLYSEERR_SETTINGS_PATH.write_text(json.dumps(merged, indent=2))
    return {
        "libraries": len(libraries),
        "radarr": len(merged.get("radarr") or []),
        "serverName": str(public_info.get("ServerName") or ""),
        "settingsPath": str(JELLYSEERR_SETTINGS_PATH),
        "sonarr": len(merged.get("sonarr") or []),
    }

sonarr_key = read_api_key(SONARR_CONFIG)
radarr_key = read_api_key(RADARR_CONFIG)
prowlarr_key = read_api_key(PROWLARR_CONFIG)

sonarr_base = f"http://127.0.0.1:{SONARR_PORT}{SONARR_BASE_PATH}/api/v3"
radarr_base = f"http://127.0.0.1:{RADARR_PORT}{RADARR_BASE_PATH}/api/v3"
prowlarr_base = f"http://127.0.0.1:{PROWLARR_PORT}{PROWLARR_BASE_PATH}/api/v1"

wait_for_url(f"http://127.0.0.1:{QBITTORRENT_PORT}/api/v2/app/version")
wait_for_url(f"{sonarr_base}/system/status", {"X-Api-Key": sonarr_key})
wait_for_url(f"{radarr_base}/system/status", {"X-Api-Key": radarr_key})
wait_for_url(f"{prowlarr_base}/health", {"X-Api-Key": prowlarr_key})

series_root = path_in_chroot(MEDIA_SERIES_DIR)
movies_root = path_in_chroot(MEDIA_MOVIES_DIR)
downloads_series_remote = os.environ.get("MEDIA_DOWNLOADS_SERIES_DIR", "")
downloads_movies_remote = os.environ.get("MEDIA_DOWNLOADS_MOVIES_DIR", "")

ensure_root_folder(sonarr_base, sonarr_key, series_root)
ensure_root_folder(radarr_base, radarr_key, movies_root)
ensure_download_client(sonarr_base, sonarr_key, "tvCategory", "series")
ensure_download_client(radarr_base, radarr_key, "movieCategory", "movies")

if downloads_series_remote:
    ensure_remote_path_mapping(sonarr_base, sonarr_key, QBITTORRENT_BIND_HOST, downloads_series_remote, path_in_chroot(downloads_series_remote))
if downloads_movies_remote:
    ensure_remote_path_mapping(radarr_base, radarr_key, QBITTORRENT_BIND_HOST, downloads_movies_remote, path_in_chroot(downloads_movies_remote))

ensure_prowlarr_app(prowlarr_base, prowlarr_key, "Sonarr", f"http://127.0.0.1:{SONARR_PORT}{SONARR_BASE_PATH}", sonarr_key)
ensure_prowlarr_app(prowlarr_base, prowlarr_key, "Radarr", f"http://127.0.0.1:{RADARR_PORT}{RADARR_BASE_PATH}", radarr_key)

bazarr_summary = configure_bazarr(sonarr_key, radarr_key)
jellyseerr_summary = configure_jellyseerr(sonarr_key, radarr_key, series_root, movies_root)

summary = {
    "sonarr": {
        "rootFolders": len(request_json("GET", f"{sonarr_base}/rootfolder", {"X-Api-Key": sonarr_key})),
        "downloadClients": len(request_json("GET", f"{sonarr_base}/downloadclient", {"X-Api-Key": sonarr_key})),
        "remotePathMappings": len(request_json("GET", f"{sonarr_base}/remotepathmapping", {"X-Api-Key": sonarr_key})),
    },
    "radarr": {
        "rootFolders": len(request_json("GET", f"{radarr_base}/rootfolder", {"X-Api-Key": radarr_key})),
        "downloadClients": len(request_json("GET", f"{radarr_base}/downloadclient", {"X-Api-Key": radarr_key})),
        "remotePathMappings": len(request_json("GET", f"{radarr_base}/remotepathmapping", {"X-Api-Key": radarr_key})),
    },
    "prowlarr": {
        "applications": len(request_json("GET", f"{prowlarr_base}/applications", {"X-Api-Key": prowlarr_key})),
    },
    "bazarr": bazarr_summary,
    "jellyseerr": jellyseerr_summary,
}
print(json.dumps(summary))
PY

"$BAZARR_SERVICE_CMD" restart
JELLYSEERR_START_STATUS="not-installed"
if [ -f "$USER_HOME/services/jellyseerr/app/package.json" ]; then
    if "$JELLYSEERR_SERVICE_CMD" restart; then
        JELLYSEERR_START_STATUS="running"
    else
        JELLYSEERR_START_STATUS="build-failed"
    fi
fi
export JELLYSEERR_START_STATUS

python3 - <<'PY'
import json
import os
import time
import urllib.error
import urllib.request

BAZARR_PORT = int(os.environ["BAZARR_PORT"])
JELLYSEERR_PORT = int(os.environ["JELLYSEERR_PORT"])
USER_HOME = os.environ.get("HOME", "/data/data/com.termux/files/home")
has_jellyseerr = os.path.isfile(f"{USER_HOME}/services/jellyseerr/app/package.json")
jellyseerr_start_status = os.environ.get("JELLYSEERR_START_STATUS", "not-installed")

def wait_for_url(url: str, timeout=90):
    started = time.time()
    last_error = None
    while time.time() - started < timeout:
        req = urllib.request.Request(url)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                return exc.code
            last_error = exc
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(1)
    raise SystemExit(f"Timed out waiting for {url}: {last_error}")

def probe_url(url: str, timeout=90):
    try:
        return wait_for_url(url, timeout=timeout)
    except Exception as exc:  # noqa: BLE001
        return f"unreachable: {exc}"

summary = {
    "bazarrStatus": probe_url(f"http://127.0.0.1:{BAZARR_PORT}/", timeout=10),
    "jellyseerrStatus": probe_url(f"http://127.0.0.1:{JELLYSEERR_PORT}/api/v1/status", timeout=10) if has_jellyseerr and jellyseerr_start_status == "running" else jellyseerr_start_status,
}
print(json.dumps(summary))
PY

if [ -x "$JELLYFIN_LIBRARY_SYNC_CMD" ]; then
    "$JELLYFIN_LIBRARY_SYNC_CMD" sync >/dev/null 2>&1 || true
fi
