# Media and Storage

## Layout

Default role split:
- vault: `~/Drives/D/VAULT/Media`
- scratch: `~/Drives/E/SCRATCH/HmSTxScratch`

Compatibility paths still live under `~/Drives/Media`, but the managed services should use the scoped vault/scratch paths.

Default vault directories:
- `movies`
- `series`
- `music`
- `audiobooks`

Default scratch directories:
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

## qBittorrent

[scripts/qbittorrent-service.sh](../scripts/qbittorrent-service.sh) now enforces managed paths:
- default save path: `downloads/manual`
- category paths: `downloads/movies`, `downloads/series`, `downloads/manual`
- temp path: `tmp/qbittorrent`
- finish hook: calls the importer with the completed path

The hook is a backstop, not the only mechanism. A sweeper also runs on an interval.

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
- classifies manual entries heuristically
- routes ambiguous manual items into the review queue
- never overwrites an existing vault destination
- records status files and TSV event/index artifacts
- runs scratch cleanup for imported non-manual items and cache roots

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
