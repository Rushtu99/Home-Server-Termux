# Architecture

## Runtime Pieces

- [start.sh](../start.sh): startup orchestrator, drive prep, media layout preflight, service boot order
- [nginx.conf](../nginx.conf): single public gateway, reverse proxy, protected internal tools
- [dashboard/](../dashboard): Next.js frontend used for both production and demo mode
- [server/index.js](../server/index.js): auth, dashboard payloads, service control, storage telemetry, file and FTP APIs
- [scripts/](../scripts): service wrappers and host-specific helpers

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
