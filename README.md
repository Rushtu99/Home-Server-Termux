# HmSTx

HmSTx is a Termux-first home server control plane for an Android-hosted NAS.

It combines:
- a Next.js dashboard (`dashboard/`)
- an Express backend API (`server/`)
- an nginx gateway (`nginx.conf`)
- shell-based service wrappers and workflow workers (`scripts/`)

The stack is private-by-default: nginx is the public entrypoint, while dashboard and backend stay loopback-bound by default.

## What This Repo Does

### Core functionality

- Authenticated operations dashboard (workspace-based UI)
- Service lifecycle control (`start`, `stop`, `restart`, status)
- Media automation and playback stack orchestration (ARR + qB + Jellyfin)
- Filesystem operations API (browse, upload, download, move/copy/delete jobs)
- FTP remote integration (saved favourites, browse, upload/download, mount/unmount)
- Storage health protection and guarded service resume
- Drive discovery and mount helper integration
- Local LLM control plane (local and online model management + chat)
- OpenAI-compatible API surface for local/managed models

### Operator workflow model

- Main lifecycle entrypoint: `scripts/hmstx-control.sh`
- Startup orchestrator: `start.sh`
- API service catalog and control metadata are backend-owned (frontend does not guess)
- Media storage model is split into Vault (long-term) and Scratch (working set)

## Runtime Architecture

Request flow:
1. `nginx` receives traffic on `:8088`.
2. Dashboard serves from Next.js (`:3000`, loopback by default).
3. Backend API serves from Express (`:4000`, loopback by default).
4. Backend invokes service wrappers in `scripts/` for host-level control.

Primary roots:
- `dashboard/` -> frontend app
- `server/` -> backend runtime, routes, handlers
- `scripts/` -> microservice wrappers + automation workers
- `runtime/` and `logs/` -> runtime state and diagnostics (ignored)

## Microservices Inventory

The backend service catalog is defined in `server/src/main/kernel.js` (`BASE_SERVICE_CATALOG_META`) and runtime controls map to wrappers in `scripts/`.

### Core platform services

| Service | Role | Script / Control surface |
| --- | --- | --- |
| `nginx` | Public gateway and reverse proxy | `nginx.conf`, started by `start.sh` |
| `ttyd` | Browser terminal surface | backend control + nginx route `/term/` |
| `sshd` | Optional SSH access for maintenance | managed by `start.sh` |

### Access and file-sharing services

| Service | Role | Script |
| --- | --- | --- |
| `ftp` | Legacy/PS4-compatible FTP transfer path | backend command service in `kernel.js` |
| `copyparty` | Browser-based high-throughput transfer | `scripts/copyparty-service.sh` |
| `syncthing` | Device sync / replication | `scripts/syncthing-service.sh` |
| `samba` | LAN SMB file sharing | `scripts/samba-service.sh` |

### Media + data services

| Service | Role | Script |
| --- | --- | --- |
| `redis` | Cache/coordination for media workflows | `scripts/redis-service.sh` |
| `postgres` | Persistent DB for IPTV/media metadata lanes | `scripts/postgres-service.sh` |
| `jellyfin` | Media server | `scripts/jellyfin-service.sh` |
| `qbittorrent` | Torrent download client | `scripts/qbittorrent-service.sh` |
| `sonarr` | Series automation | `scripts/sonarr-service.sh` |
| `radarr` | Movie automation | `scripts/radarr-service.sh` |
| `prowlarr` | Indexer management | `scripts/prowlarr-service.sh` |
| `bazarr` | Subtitle automation | `scripts/bazarr-service.sh` |
| `flarearr` | Optional Cloudflare challenge helper | `scripts/flarearr-service.sh` |
| `jellyseerr` | Request portal for media intake | `scripts/jellyseerr-service.sh` |

### AI services

| Service | Role | Script |
| --- | --- | --- |
| `llm` | Local llama.cpp-based inference service | `scripts/llm-service.sh` |
| `codex_revamped` | Optional Codex ReVamped gateway/service | launcher configured in backend env |

### Network overlay service

| Service | Role | Script |
| --- | --- | --- |
| `tailscale` | Private tailnet exposure path (optional mode) | `scripts/tailscale-service.sh` |

### Workflow/worker microservices (non-UI app services)

| Worker | Role | Script |
| --- | --- | --- |
| `media-workflow` | Scheduled importer/cleanup loop | `scripts/media-workflow-service.sh` |
| `media-importer` | Safe media move/copy with verification, events, cleanup integration | `scripts/media-importer.sh` |
| `storage-watchdog` | Storage health checks + service blocking/resume guardrails | `scripts/storage-watchdog-service.sh` |
| `usb-mount-service` | Drive scan/mount helper service | `scripts/usb-mount-service.sh` |
| `jellyfin-library-sync` | Ensures Jellyfin library paths stay aligned with vault/scratch model | `scripts/jellyfin-library-sync.sh` |

## API Overview (Backend)

API routes are registered in `server/src/routes/register-api-routes.js` and exposed as both `/<path>` and `/api/<path>` through `registerDualRoute(...)`.

Major API domains:
- Auth/session: `/auth/*`
- Dashboard/workspaces/control: `/services`, `/dashboard`, `/ui/*`, `/control*`
- Storage and drives: `/storage*`, `/drives*`, `/shares*`
- Filesystem operations: `/fs/*` and `/fs/operations/*`
- FTP integration: `/ftp/*`
- Media torrent intake: `/media/torrents/add`
- LLM control/chat: `/llm/*`
- OpenAI-compatible API: `/openai/v1/models`, `/openai/v1/chat/completions`

## Codebase Overview

### Frontend (`dashboard/`)

- `dashboard/app/page.tsx`: V2 dashboard shell entry
- `dashboard/app/v2/`: workspace UI, data shaping, component composition
- `dashboard/app/files/page.tsx`: dedicated filesystem UI
- `dashboard/app/term/page.tsx`: dedicated terminal UI
- `dashboard/app/demo-api.ts`: static demo data adapter used for Pages build

### Backend (`server/`)

- `server/index.js`: stable backend entrypoint
- `server/src/main/kernel.js`: runtime kernel, service command map, service catalog metadata, environment wiring
- `server/src/routes/register-api-routes.js`: canonical route registration
- `server/src/handlers/`: route handlers split by domain (`service`, `files`, `ftp`, `llm`)
- `server/lib/`: shared backend utilities (`storage-*`, `torrent` helpers)

### Runtime scripts (`scripts/`)

- `hmstx-control.sh`: lifecycle command surface (`preflight`, `start`, `stop`, `restart`, `status`, `audit`)
- `configure-arr-stack.sh`: ARR/qB path mappings and cross-service reconciliation
- `install-media-automation.sh`: optional media stack bootstrap helper
- service wrappers: `*-service.sh` scripts used by backend and startup orchestration

## Storage Model

Managed layout under `~/Drives`:
- Vault roots: `<Drive>/VAULT/Media` (long-term libraries)
- Scratch roots: `<Drive>/SCRATCH/HmSTxScratch` (downloads, temp, cache, workflow logs)

Compatibility paths are maintained, but managed services should target vault/scratch scoped paths.

## Quick Start

```bash
cd ~/home-server
cp server/.env.example server/.env
npm --prefix server install
npm --prefix dashboard install
npm --prefix server run check
cd dashboard && npx tsc --noEmit && cd ..
bash -n start.sh
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
bash scripts/hmstx-control.sh preflight
bash scripts/hmstx-control.sh start
```

Required bootstrap secrets in `server/.env`:
- `JWT_SECRET`
- `APP_AUTH_SECRET`
- `DASHBOARD_PASS`
- `ADMIN_ACTION_PASSWORD`

## Validation

```bash
npm --prefix server run check
cd dashboard && npx tsc --noEmit && cd ..
for script in scripts/*.sh; do bash -n "$script"; done
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
```

Optional test runs:

```bash
npm --prefix server test
npm --prefix dashboard test
```

## Documentation Index

- `docs/README.md`
- `docs/getting-started.md`
- `docs/architecture.md`
- `docs/configuration.md`
- `docs/media-storage.md`
- `docs/operations.md`
- `docs/testing.md`
- `docs/troubleshooting.md`
- `document.MD` (full feature/UI/API inventory)
