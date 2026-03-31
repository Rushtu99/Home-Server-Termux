# HmSTx

HmSTx is a Termux-first home server dashboard and operations layer built for an Android-hosted NAS. It is designed for a Pixel-class phone acting as a loopback-bound server, fronted by nginx, and controlled through a production Next.js dashboard that also exports a dummy-data demo build for GitHub Pages.

The project is opinionated:
- nginx on `:8088` is the intended public entrypoint
- dashboard and API stay loopback-bound
- always-on services are grouped by stack instead of exposed as generic toggles
- optional services remain lock-gated behind an admin action password
- the GitHub Pages demo uses the same frontend shell as production and swaps only the data layer

## What HmSTx Does

HmSTx combines several roles into one operational surface:
- server dashboard for health, storage, sessions, logs, and service control
- media stack control plane for Jellyfin, qBittorrent, Sonarr, Radarr, Prowlarr, Redis, and PostgreSQL
- filesystem and drive console for Android shared storage, removable media, and share shortcuts
- FTP client workspace for saved remotes, browse/pull/upload flows, and root-helper mounts
- terminal and admin settings surface for session, logging, and account management

The current frontend is tab-driven:
- `Home`
- `Media`
- `ARR`
- `Terminal`
- `Filesystem`
- `FTP`
- `Settings`

## Architecture

### Runtime
- Frontend: Next.js app in `dashboard/`
- Backend: Express API in `server/index.js`
- Reverse proxy: `nginx.conf`
- Startup/orchestration: `start.sh`
- Service wrappers: `scripts/`

### Network model
- `8088` nginx gateway, intended to be the only exposed port
- `3000` dashboard frontend, loopback-bound
- `4000` backend API, loopback-bound
- internal companion services such as ttyd, Jellyfin, qBittorrent, Sonarr, Radarr, Prowlarr, Redis, and PostgreSQL bind to loopback and are routed through nginx when needed

### Storage model
HmSTx treats `~/Drives` as the stable top-level filesystem root. `start.sh` prepares and maintains:
- `~/Drives/C` for Android shared storage
- removable-drive mount folders managed by `termux-drive-agent`
- the `Media` share layout for the streaming stack

Current media directories:
- `~/Drives/Media/movies`
- `~/Drives/Media/series`
- `~/Drives/Media/downloads`
- `~/Drives/Media/downloads/manual`
- `~/Drives/Media/iptv-cache`
- `~/Drives/Media/iptv-epg`

## Dashboard Model

### Service catalog
The dashboard no longer infers service grouping in the client. The backend owns:
- service label
- description
- group
- surface/tab
- control mode
- route
- status
- availability / placeholder state
- blocker text
- health metadata such as latency, uptime, and last transition

This keeps the live app and the GitHub Pages demo aligned on one contract.

### Service grouping
Always-on services stay grouped inside stack tabs:
- `Media`: Jellyfin, qBittorrent, Jellyseerr placeholder, Redis, PostgreSQL
- `ARR`: Sonarr, Radarr, Prowlarr, Bazarr placeholder
- `Platform`: nginx, ttyd

Optional services remain in the lockable controller:
- FTP
- copyparty
- Syncthing
- Samba
- sshd

### Telemetry
The backend now exposes:
- `/api/dashboard` for full page hydrate
- `/api/telemetry` for lightweight refreshes
- `/api/services` for lock/controller state and service catalog refresh

The frontend uses:
- full dashboard hydrate for storage, connections, and logs
- lighter telemetry polling for monitor + service health
- low-power mode to slow refresh intervals and reduce chart work

### UX systems implemented
- persistent theme cycling: dark, light, high-contrast
- pre-hydration theme bootstrapping to avoid flash
- skeleton loading shell instead of plain loading text
- service alert banner when a service regresses out of working state
- command palette for services, actions, and docs
- onboarding modal for first-time users
- low-power mode for phone-hosted operation
- dismissible demo banner when running the exported Pages build
- per-service uptime / latency metadata on service cards
- log filtering and log export
- session disconnect flow for dashboard sessions visible in the connections list
- PWA shell assets and service worker for cached shell loading

## Media and Streaming Stack

HmSTx is moving toward a self-hosted media platform built around:
- Jellyfin
- qBittorrent
- Sonarr
- Radarr
- Prowlarr
- Redis
- PostgreSQL

Current state in this repo:
- Jellyfin, qBittorrent, Redis, PostgreSQL, Sonarr, Radarr, and Prowlarr are represented in the service catalog and routed through the dashboard/gateway model
- Bazarr and Jellyseerr remain explicit placeholder services when they are not runnable on this Android host
- the dashboard UI is already grouped around the media workflow and ARR workflow rather than treating every process as a generic card

The intended operational flow is:

`Requests -> Downloads -> Library -> Streaming`

and

`Indexer -> Discovery -> Download -> Subtitle`

## GitHub Pages Demo

HmSTx supports a dummy-data export for GitHub Pages. The important rule is that the Pages demo must use the same frontend shell as production.

Current design:
- production app: real Next dashboard + real backend API
- Pages demo: same Next dashboard in demo mode via [dashboard/app/demo-api.ts](/data/data/com.termux/files/home/home-server/dashboard/app/demo-api.ts)

The demo intentionally simulates:
- login
- telemetry
- service catalog state
- filesystem browsing
- FTP actions
- logs
- optional-service control

It does not make live NAS API calls on GitHub Pages.

## Security Model

- dashboard auth is cookie-based and server-side session backed
- nginx protects internal tools through auth verification endpoints
- service control remains admin-only
- optional service control requires a separate admin action password and lock/unlock lifecycle
- sessions can be invalidated from the dashboard
- loopback binding remains the default for internal services

Important production requirement:
- do not run with the default bootstrap credentials from `server/.env.example`

## Quick Start

### Android / Termux
```bash
cd ~/home-server
cp server/.env.example server/.env
bash start.sh
```

If you are developing over SSH and want the dashboard frontend reachable from the local network, set:

```bash
FRONTEND_BIND_HOST=0.0.0.0 bash start.sh
```

`start.sh` will:
- load `server/.env`
- prepare runtime directories
- prepare `~/Drives`
- mount Android shared storage into `~/Drives/C`
- refresh removable-drive state through `termux-drive-agent`
- start the dashboard/backend/gateway stack

### Validation
```bash
npm --prefix server run check
cd dashboard && npx next typegen && npx tsc --noEmit
bash -n start.sh
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
```

## PWA and Offline Behavior

The dashboard now ships a manifest and service worker from `dashboard/public/`:
- `manifest.webmanifest`
- `service-worker.js`
- SVG app icons

The service worker is intentionally conservative:
- it caches the app shell and static assets
- it does not cache authenticated `/api/*` responses as offline truth
- it falls back to the cached shell when the network is unavailable

This is useful on Android, where Termux-hosted services may temporarily disappear during reboots, app kills, or thermal pressure.

## Environment and Host Notes

HmSTx is built around a rooted Android / Termux environment. That creates some real constraints:

- background processes can be killed by Android
- thermal throttling matters
- battery state matters
- native Linux packages do not always behave the same as on a normal Debian host
- some services are only viable through wrappers or chroot/proot paths

The dashboard reflects that with:
- low-power mode
- Android device telemetry fields
- explicit placeholder services for unavailable stack members
- loopback + gateway routing instead of exposing every service port directly

## Known Build Constraint on This Host

The Next app can compile successfully on this device, but the final `next build` step on this Android host still hits a framework-level failure:

`Error: invalid type: unit value, expected usize`

This is a Next.js / platform issue, not an application TypeScript failure. Current practical workflow:
- use `npx tsc --noEmit` for app-level type safety on-device
- use the Linux/GitHub runner path for final export/deployment builds when needed

## Operational Endpoints

Primary API endpoints used by the dashboard:
- `/api/dashboard`
- `/api/telemetry`
- `/api/services`
- `/api/control`
- `/api/control/unlock`
- `/api/control/lock`
- `/api/logging`
- `/api/drives`
- `/api/shares`
- `/api/users`
- `/api/connections`
- `/api/connections/:id/disconnect`
- `/api/fs/*`
- `/api/ftp/*`

## Development Notes

- keep live API payloads and `demo-api.ts` in lockstep
- keep the frontend demo path and production path on the same component tree
- keep always-on services out of the optional controller
- do not reintroduce glassmorphism or decorative dashboard filler; the shell is intentionally flat and operational
- prefer backend-owned truth for service grouping, status, and descriptions

## Troubleshooting

### Dashboard loads but telemetry stops moving
- check `/api/telemetry`
- confirm the backend is still running on loopback
- confirm nginx is still proxying the API
- if low-power mode is enabled, expect slower refresh cadence

### Optional service buttons are locked
- unlock the controller with the admin action password
- the unlock is session-scoped and can be manually re-locked

### Pages demo does not match the live UI
- the demo should come from the same Next frontend
- if the demo drifts, update `dashboard/app/demo-api.ts`, not a separate mock dashboard

### Session disconnect fails
- only dashboard sessions with server session IDs are disconnectable
- non-session or external client traffic in the connections table is informational only

### Local Android build fails during `next build`
- rerun `cd dashboard && npx tsc --noEmit` to verify app code first
- use a Linux/GitHub runner for the final production or demo export build
