# Media and Storage

## Layout

Default role split:
- vault: `~/Drives/<vault-label>/VAULT/Media`
- scratch: `~/Drives/<scratch-label>/SCRATCH/HmSTxScratch`

Compatibility paths still live under `~/Drives/Media`, but the managed services should use the scoped vault/scratch paths.
Active external drives are also mirrored as host bind mounts under `/mnt/termux-drives/<label>` for non-Termux consumers.

Default vault directories:
- `movies`
- `series`
- `music`
- `audiobooks`

Default scratch directories:
- `media/movies`
- `media/series`
- `media/music`
- `media/audiobooks`
- `downloads/movies`
- `downloads/series`
- `downloads/manual`
- `review`
- `logs`
- `cache/jellyfin`
- `cache/misc`
- `iptv-cache`
- `iptv-epg`
- `tmp/qbittorrent`

Small downloads directory:
- `~/Drives/C/Download/Home-Server/small`

## qBittorrent

[scripts/qbittorrent-service.sh](../scripts/qbittorrent-service.sh) now enforces managed paths:
- default save path: `downloads/manual`
- category paths: `downloads/movies`, `downloads/series`, `downloads/manual`
- standalone torrent lane: `downloads/torrent/qbit`
- temp path: `tmp/qbittorrent`
- finish hook: calls the importer with the completed path

The hook is a backstop, not the only mechanism. A sweeper also runs on an interval.

## ARR/qB Runtime and Path Mapping

[scripts/configure-arr-stack.sh](../scripts/configure-arr-stack.sh) is the canonical repair script for the automated torrent pipeline. It starts the qBittorrent + ARR services it needs, then re-applies the expected root folders, download client wiring, and remote path mappings.

Current expected mapping model:
- qBittorrent writes into the Termux scratch tree under `~/Drives/<scratch-label>/SCRATCH/HmSTxScratch/downloads/...`
- Sonarr and Radarr run inside the Debian proot and therefore see the same storage as `/mnt/termux-drives/...`
- the script programs remote path mappings so ARR imports from the chroot-visible download paths back into the host-visible scratch paths
- Sonarr tracks the vault `series` library and Radarr tracks the vault `movies` library

Use this after reinstalling ARR apps, moving drive roots, or noticing completed torrents that never import:

```bash
scripts/configure-arr-stack.sh
```

Successful runs reconcile:
- Sonarr root folder → `/mnt/termux-drives/<vault-label>/VAULT/Media/series`
- Radarr root folder → `/mnt/termux-drives/<vault-label>/VAULT/Media/movies`
- Sonarr remote path mapping → `/mnt/termux-drives/<scratch-label>/SCRATCH/HmSTxScratch/downloads/series/`
- Radarr remote path mapping → `/mnt/termux-drives/<scratch-label>/SCRATCH/HmSTxScratch/downloads/movies/`
- qBittorrent download client entries for Sonarr and Radarr

## Importer

[scripts/media-importer.sh](../scripts/media-importer.sh) owns import and cleanup state.

Commands:

```bash
scripts/media-importer.sh import --trigger manual
scripts/media-importer.sh import --trigger qb-finish --source "/path/to/item"
scripts/media-importer.sh cleanup
scripts/media-importer.sh status --json
```

Current behavior:
- copies movies into the vault `movies` library
- copies series into the vault `series` library
- copies very small manual downloads into the managed C small-downloads directory
- classifies manual entries heuristically
- routes ambiguous manual items into the review queue
- never overwrites an existing vault destination
- records status files and TSV event/index artifacts
- runs scratch cleanup for imported non-manual items and cache roots

Manual routing details:
- qBittorrent still downloads into the scratch workspace first
- media imports land in vault
- tiny manual items can be offloaded into `~/Drives/C/Download/Home-Server/small`

## Jellyseerr

Jellyseerr is optional and is not installed by default. `scripts/install-media-automation.sh` leaves `INSTALL_JELLYSEERR=0` unless you opt in.

Install or rebuild it with:

```bash
INSTALL_JELLYSEERR=1 scripts/install-media-automation.sh
```

Runtime notes:
- the wrapper is [scripts/jellyseerr-service.sh](../scripts/jellyseerr-service.sh)
- the managed app root is `~/services/jellyseerr/app`
- the service expects build output at `~/services/jellyseerr/app/dist/index.js`
- nginx proxies it at `/requests/`

If Jellyseerr is missing or unbuilt, the dashboard intentionally reports the request portal as blocked/unavailable instead of pretending the media automation lane itself is broken.

## Jellyfin Libraries

[scripts/jellyfin-library-sync.sh](../scripts/jellyfin-library-sync.sh) keeps Jellyfin pointed at both the vault and scratch media trees for:
- Movies
- Series
- Music
- Audiobooks

The sync helper runs before Jellyfin starts and manages the virtual folder metadata under Jellyfin's data root.

Status artifacts:
- `import-status.json`
- `cleanup-status.json`
- `imported-items.tsv`
- `import-events.tsv`

## Media Workflow Service

[scripts/media-workflow-service.sh](../scripts/media-workflow-service.sh) runs the importer on a timer:

```bash
scripts/media-workflow-service.sh start
scripts/media-workflow-service.sh run-once
scripts/media-workflow-service.sh status
```

Default interval: `MEDIA_WORKFLOW_INTERVAL_SEC=300`

## Storage Watchdog

[scripts/storage-watchdog-service.sh](../scripts/storage-watchdog-service.sh) protects the stack when the vault or scratch roots disappear or degrade.

Commands:

```bash
scripts/storage-watchdog-service.sh start
scripts/storage-watchdog-service.sh check-now
scripts/storage-watchdog-service.sh status
```

When scratch is unhealthy, it can block:
- qBittorrent
- media workflow

When vault is unhealthy, it can block:
- Jellyfin
- Bazarr
- media workflow

The backend surfaces this state in the dashboard and supports manual resume after healthy mounts return.
