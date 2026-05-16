# Architecture

## Runtime Pieces

- [start.sh](../start.sh): startup orchestrator, drive prep, media layout preflight, service boot order
- [nginx.conf](../nginx.conf): single public gateway, reverse proxy, protected internal tools
- [dashboard/](../dashboard): Next.js frontend used for both production and demo mode
- [server/index.js](../server/index.js): stable backend entrypoint wrapper (`node server/index.js` contract)
- [server/src/](../server/src): backend runtime modules (`main/`, auth/domain/observability scaffolding, route/runtime contracts)
- [scripts/](../scripts): service wrappers and host-specific helpers

## Runtime Contracts

Backend runtime contract stability is guarded by parity tests under `server/test/`:
- route manifest parity
- startup invariants parity
- runtime API contract checks
- control-plane handler and route tests

Dashboard workspace contract stability is guarded by `dashboard/app/v2/*` tests and shared API client typing.

## Request Flow

Normal user flow:

1. `nginx` serves the dashboard and internal proxied tools on `:8088`
2. the dashboard calls the backend on `:4000`
3. the backend owns the service catalog, health probes, auth/session state, and operator actions
4. service wrappers under `scripts/` translate those actions into host-specific commands

This keeps the frontend thin. Grouping, blocker text, storage-protection state, and placeholder handling are backend contracts, not client guesses.

## Service Model

The dashboard is organized around surfaces instead of a flat process list:
- `Media`: Jellyfin, qBittorrent, Redis, PostgreSQL, request portal status
- `ARR`: Sonarr, Radarr, Prowlarr, Bazarr
- `Filesystem`, `FTP`, `Terminal`, `LLM`, `Settings`: operator workflows and helper services

Optional services remain lock-gated. Backend responses include:
- label and description
- group and surface
- route
- status and health metadata
- availability and blocker text
- storage watchdog blockers and manual-resume requirements

## Storage Model

The repo treats `~/Drives` as the stable filesystem root.

Managed media layout:
- vault roots under `<Drive>/VAULT/Media`
- scratch roots under `<Drive>/SCRATCH/HmSTxScratch`
- compatibility paths under `~/Drives/Media/*`

The scratch side holds:
- downloads
- transcode and misc cache
- IPTV cache/EPG
- media workflow logs and status files

The vault side holds:
- long-term media libraries for Jellyfin and the ARR stack

### Mount Source-Of-Truth

Runtime mount mapping is:
- physical mount (or ntfs/exfat raw mount) under `runtime/mounts/*-raw` when bindfs staging is required
- operator-visible mount under `~/Drives/<Letter (Label)>`
- chroot mirror mount under `/mnt/termux-drives/<Letter (Label)>`

`~/Drives/.state/drives.json` is the canonical dashboard feed. Its `rawMountPoint` now reflects the actual runtime raw mount path when staging is used.

Fallback roots (`D (VAULT_fallback)`, `E (SCRATCH_fallback)`) are internal compatibility paths, not removable-drive proof.

## Safety Layers

The stack now has three distinct storage protections:
- `start.sh` preflight refuses obviously broken vault/scratch layouts in strict mode
- `scripts/storage-watchdog-service.sh` blocks or resumes affected services when mounts degrade
- `scripts/media-importer.sh` refuses imports that would drop vault free space below the configured threshold

## Demo Build

The GitHub Pages preview is not a separate app. `dashboard/app/demo-api.ts` simulates backend data so the same dashboard shell can be published statically via:

```bash
cd dashboard
npm run build:demo
```
