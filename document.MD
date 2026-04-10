# Home Server Feature, UI, and API Inventory

## Scope

This document inventories the current app surface in this repo:

1. All operator-facing features exposed by the app, with the backend APIs or gateway routes that support them.
2. How features are divided across the UI tabs, workspaces, and dedicated routes.
3. The backend API surface exposed from `server/index.js`.

## Source of Truth for This Inventory

This inventory was derived from these canonical files:

- Backend routes and auth logic: `server/index.js`
- Current V2 route/workspace shell: `dashboard/app/page.tsx`, `dashboard/app/v2/DashboardV2.tsx`, `dashboard/app/v2/workspaces.tsx`, `dashboard/app/v2/api.ts`
- Dedicated tool routes: `dashboard/app/files/page.tsx`, `dashboard/app/term/page.tsx`, `dashboard/app/legacy/page.tsx`
- Legacy dashboard API consumers and tab layout: `dashboard/app/DashboardClient.tsx`
- Gateway/proxy surfaces: `nginx.conf`
- Supporting context: `docs/architecture.md`, `docs/media-storage.md`

## Canonicalization Rules

- For most backend routes, the canonical path in this document omits the `/api` prefix.
- `registerDualRoute(...)` exposes both `/<path>` and `/api/<path>` for the same handler.
- Auth routes are duplicated manually and are also available with and without `/api`.
- Route params are preserved as `:paramName`.
- Query strings are not treated as separate endpoints.
- Streaming endpoints remain distinct from non-streaming endpoints, for example `/llm/chat` vs `/llm/chat/stream`.
- `/openai/v1/*` is treated as a separate external-facing contract, not merged into `/llm/*`.
- Gateway routes from `nginx.conf` are listed separately from backend JSON APIs even when they are operator-visible features.
- `binding_type` meanings:
  - `mapped`: feature is backed by one or more backend JSON APIs.
  - `gateway-route`: feature is exposed mainly through nginx-proxied service routes rather than backend JSON APIs.
  - `local-only`: feature is UI-only state or navigation.
  - `unverified`: source suggests the feature exists, but the direct API contract is not explicit.

## Deterministic Classification Rules

### Endpoint class

- `feature-mapped`: endpoint is directly used by one or more UI features.
- `compatibility-alias`: endpoint is an alias of another canonical endpoint, most commonly the `/api/...` twin.
- `external-client`: endpoint is primarily an integration surface rather than a dashboard-only contract.
- `unmapped`: endpoint exists in backend, but no first-class feature mapping was proven from the UI code reviewed here.

### Confidence

- `high`: proven by both a backend route definition and a frontend or gateway consumer.
- `medium`: proven by backend route definition and indirect UI use through aggregate/workspace payloads.
- `low`: UI- or gateway-visible, but the direct contract is implied rather than explicitly consumed in the reviewed code.

## Join Logic Used for Feature-to-API Mapping

1. If a feature calls a dedicated endpoint directly from `dashboard/app/v2/api.ts`, `dashboard/app/files/page.tsx`, or `dashboard/app/DashboardClient.tsx`, it is `mapped` with `high` confidence.
2. If a feature is rendered from workspace or dashboard snapshot payloads rather than a dedicated action endpoint, it is still `mapped`, but may be `medium` confidence when the exact subfield contract is aggregate.
3. If a feature is opened via nginx route (`/term/`, `/jellyfin/`, `/qb/`, etc.), it is `gateway-route`.
4. If a screen is a navigation shell or route wrapper with no direct backend contract, it is `local-only`.
5. Every canonical backend endpoint is listed once in the API catalog; `/api/...` forms are treated as `compatibility-alias` behavior unless they are one of the manually duplicated auth routes.

## UI Surface Map

### Primary Routes

| Route | Status | Purpose |
| --- | --- | --- |
| `/` | Primary | Dashboard V2 shell with workspace navigation. |
| `/legacy` | Legacy | Older single-page dashboard with tabbed sections. |
| `/files` | Dedicated tool | Full filesystem workspace with shares, operations queue, upload, drag/drop, and browser actions. |
| `/term` | Dedicated tool | Embedded terminal route with standalone launcher. |

### Dashboard V2 Workspaces

| Workspace | Legacy alias(es) | Major sections / sub-tabs |
| --- | --- | --- |
| `overview` | `home` | Performance graphs, lifecycle health, system telemetry detail, operational todo metrics, mounted drives, storage mounts, active sessions |
| `media` | `media`, `downloads`, `arr` | Media overview, media health dashboard, IPTV support, ARR + qB diagnostics, ARR services, media inventory |
| `files` | `filesystem` | Summary card for drives/shares/protection and a jump into `/files` |
| `transfers` | `ftp` | `Connect`, `Favourites`, `Torrent` |
| `ai` | `ai` | `Chat`, `Manage` |
| `terminal` | `terminal` | Embedded terminal card and route launcher |
| `admin` | `settings` | `Controls`, `Network`, `Logs`, `Help` |

### Transfers Workspace Sub-tabs

| Sub-tab | Purpose |
| --- | --- |
| `Connect` | One-off FTP connection, browse remote directories, upload a local file, create remote folder |
| `Favourites` | Manage saved FTP remotes, browse them, mount/unmount them into `~/Drives` |
| `Torrent` | Submit standalone torrents to qBittorrent, inspect qB diagnostics and torrent-related services |

### AI Workspace Sub-tabs

| Sub-tab | Purpose |
| --- | --- |
| `Chat` | Conversation history, prompt entry, streaming replies, mode selection |
| `Manage` | Local/online model selection, online model refresh, runtime/model inventory |

### Admin Workspace Sub-tabs

| Sub-tab | Purpose |
| --- | --- |
| `Controls` | Controller unlock/lock and service start/stop/restart |
| `Network` | Network exposure audit and remote access details |
| `Logs` | Debug event stream, filter/search, verbose logging toggle |
| `Help` | Operator workflow guidance and recovery notes |

### Legacy Tabs

| Legacy tab | Major sections |
| --- | --- |
| `Home` | System, storage, all services, storage protection, optional services, connected users, debug log |
| `Media` | Workflow, watch, requests, downloads, subtitles, live TV, automation, advanced support |
| `Downloads` | Storage guard, download services |
| `Terminal` | Embedded terminal surface |
| `Filesystem` | Drive summary, quick links, drive log |
| `FTP` | Saved favourites, new/edit favourite, connection, transfer actions |
| `LLM` | Chat and manage subviews |
| `Settings` | Appearance & power, session, logging, users, create user |

## Feature Inventory

Confidence model for this table:

- Default is `high` unless the Notes column says otherwise.
- Rows based mainly on aggregate workspace/dashboard payloads should be read as `medium`.
- Rows backed only by route exposure or navigation composition should be read as `low`.

| Feature | UI surface(s) | Binding type | Canonical API / route | Notes |
| --- | --- | --- | --- | --- |
| Session login/logout/current-user checks | Login flow, V2 shell, legacy shell | `mapped` | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/verify`, `GET /auth/verify-admin` | Used to gate admin-only areas and protected routes |
| V2 dashboard bootstrap and workspace loading | `/` | `mapped` | `GET /ui/bootstrap`, `GET /ui/initial`, `GET /ui/workspaces/:workspaceKey` | Main data contract for current dashboard |
| Overview telemetry and health | `overview`, legacy `Home` | `mapped` | `GET /ui/workspaces/overview`, `GET /dashboard`, `GET /telemetry`, `GET /services`, `GET /connections`, `GET /storage`, `GET /logs` | V2 relies on workspace payloads; legacy reads broader snapshots directly |
| Active session visibility | `overview`, legacy `Home` | `mapped` | `GET /connections` | Session list is also embedded in workspace/dashboard payloads |
| Disconnect another session | `overview`, legacy `Home` | `mapped` | `POST /connections/:id/disconnect` | Admin action |
| Service catalog visibility | `overview`, `admin`, legacy `Home`, legacy `Downloads`, legacy `Media` | `mapped` | `GET /services`, `GET /dashboard`, `GET /ui/workspaces/admin` | Services are grouped by surface in backend responses |
| Controller unlock/lock | `admin`, legacy `Settings` | `mapped` | `POST /control/unlock`, `POST /control/lock` | Safety gate for service control |
| Start/stop/restart services | `admin`, legacy `Home`/`Settings` | `mapped` | `POST /control` | Optional services are lock-gated |
| Drive inventory | `overview`, `files`, `/files`, legacy `Home`, legacy `Filesystem` | `mapped` | `GET /drives`, `GET /dashboard`, `GET /ui/workspaces/files` | Used in both summary and dedicated files tooling |
| Manual drive scan | `files`, `/files`, legacy `Filesystem` | `mapped` | `POST /drives/check` | Re-runs drive agent / detection checks |
| Storage mount inventory | `overview`, legacy `Home` | `mapped` | `GET /storage`, `GET /dashboard`, `GET /ui/workspaces/overview` | Used for capacity and mount-role display |
| Storage protection state | `files`, `admin`, legacy `Home`, legacy `Downloads` | `mapped` | `GET /storage/protection`, `GET /dashboard`, `GET /ui/workspaces/files`, `GET /ui/workspaces/admin` | Surfaces vault/scratch health and blockers |
| Storage protection recheck | `files`, `admin`, legacy views | `mapped` | `POST /storage/protection/recheck` | Rechecks watchdog state |
| Resume blocked services after healthy mounts | `files`, `admin`, legacy views | `mapped` | `POST /storage/protection/resume` | Manual resume path after watchdog intervention |
| Logs snapshot | `admin`, legacy `Home`, legacy `Settings` | `mapped` | `GET /logs` | Read debug log entries and markdown summary |
| Verbose logging toggle | `admin`, legacy `Settings` | `mapped` | `GET /logging`, `POST /logging` | `GET /logging` exposes state; `POST /logging` changes it |
| User inventory | `/files`, legacy `Settings` | `mapped` | `GET /users` | Used for permission policy and admin user management |
| Create user | `/files`, legacy `Settings` | `mapped` | `POST /users` | Admin-only |
| Update user | `/files`, legacy `Settings` | `mapped` | `PUT /users/:id` | Used for role/password/disable operations |
| Share inventory | `/files` | `mapped` | `GET /shares` | Share shortcuts and permission policy editor |
| Create share | `/files` | `mapped` | `POST /shares` | Root-level share creation from files tool |
| Update share policy | `/files` | `mapped` | `PUT /shares/:id` | Per-share permissions and flags |
| Filesystem listing / browse | `/files` | `mapped` | `GET /fs/list` | Core browser tree / folder listing |
| Create folder | `/files` | `mapped` | `POST /fs/mkdir` | Folder creation in current location |
| Rename entry | `/files` | `mapped` | `POST /fs/rename` | Rename file/folder |
| Download file | `/files` | `mapped` | `GET /fs/download` | Direct file download |
| Direct delete / recycle | `/files` | `mapped` | `POST /fs/delete` | Non-queued delete endpoint still exists |
| Clipboard paste | `/files` | `mapped` | `POST /fs/paste` | Older direct paste path |
| Async copy/move/delete workflow | `/files` | `mapped` | `POST /fs/operations/transfer`, `POST /fs/operations/delete`, `GET /fs/operations`, `GET /fs/operations/:id`, `POST /fs/operations/:id/control` | Current queue model for transfers and delete jobs |
| Async upload workflow | `/files` | `mapped` | `POST /fs/operations/upload`, `POST /fs/operations/:id/file`, `POST /fs/operations/:id/finalize`, `GET /fs/operations`, `POST /fs/operations/:id/control` | Used for file/folder upload, drag/drop, progress queue, cancel/dismiss |
| Legacy raw upload endpoint | Not primary in current UI | `mapped` | `POST /fs/upload` | Exists in backend; current `/files` route favors async operations API |
| FTP defaults | `transfers`, legacy `FTP` | `mapped` | `GET /ftp/defaults` | Seed values for connection form |
| FTP favourites inventory | `transfers`, legacy `FTP` | `mapped` | `GET /ftp/favourites` | Saved remotes list |
| Create FTP favourite | `transfers`, legacy `FTP` | `mapped` | `POST /ftp/favourites` | Save remote preset |
| Update FTP favourite | `transfers`, legacy `FTP` | `mapped` | `PUT /ftp/favourites/:id` | Edit saved preset |
| Delete FTP favourite | `transfers`, legacy `FTP` | `mapped` | `DELETE /ftp/favourites/:id` | Remove preset |
| Mount/unmount FTP favourite into `~/Drives` | `transfers`, legacy `FTP` | `mapped` | `POST /ftp/favourites/:id/mount`, `POST /ftp/favourites/:id/unmount` | Integrates remotes into local drive namespace when host permits |
| Browse FTP directory | `transfers`, legacy `FTP` | `mapped` | `POST /ftp/list` | Remote listing / manual browse |
| Download from FTP | `transfers`, legacy `FTP` | `mapped` | `POST /ftp/download` | Pull file/folder from remote |
| Upload to FTP | `transfers`, legacy `FTP` | `mapped` | `POST /ftp/upload` | Push local path to remote |
| Create remote FTP directory | `transfers`, legacy `FTP` | `mapped` | `POST /ftp/mkdir` | Remote folder creation |
| Standalone torrent submission | `transfers` `Torrent`, legacy `Media` support areas | `mapped` | `POST /media/torrents/add` | Supports `arr` vs `standalone` lane routing |
| Media overview, health, IPTV, ARR/qB diagnostics | `media`, legacy `Media` | `mapped` | `GET /ui/workspaces/media`, `GET /dashboard`, `GET /telemetry` | Mostly snapshot-driven in UI; direct mutating media endpoint is torrent add |
| LLM runtime state | `ai`, legacy `LLM` | `mapped` | `GET /llm/state` | Runtime status, model list, active model, provider data |
| Local model select | `ai` `Manage`, legacy `LLM` manage | `mapped` | `POST /llm/models/select` | Switch active local model |
| Register local model | `ai` `Manage`, legacy `LLM` manage | `mapped` | `POST /llm/models/add-local` | Add local model path/config |
| Pull local model | `ai` `Manage`, legacy `LLM` manage | `mapped` | `POST /llm/models/pull`, `GET /llm/models/pull/:jobId` | Pull/download workflow with status job |
| Refresh online model list | `ai` `Manage`, legacy `LLM` manage | `mapped` | `POST /llm/online/models/refresh` | Reload online provider catalog |
| Select online model | `ai` `Manage`, legacy `LLM` manage | `mapped` | `POST /llm/online/models/select` | Choose active online model |
| List conversations | `ai` `Chat`, legacy `LLM` chat | `mapped` | `GET /llm/conversations` | Conversation list/history |
| Read conversation messages | `ai` `Chat`, legacy `LLM` chat | `mapped` | `GET /llm/conversations/:id/messages` | Thread details |
| Delete conversation | `ai` `Chat`, legacy `LLM` chat | `mapped` | `DELETE /llm/conversations/:id` | History cleanup |
| Non-streaming chat | `ai` `Chat`, legacy `LLM` chat | `mapped` | `POST /llm/chat` | Standard assistant response |
| Streaming chat | `ai` `Chat` | `mapped` | `POST /llm/chat/stream` | SSE/streaming response path |
| OpenAI-compatible model listing | External integration surface, legacy `LLM` manage help text | `mapped` | `GET /openai/v1/models` | Auth can be admin session or LLM API key |
| OpenAI-compatible chat completions | External integration surface, legacy `LLM` manage help text | `mapped` | `POST /openai/v1/chat/completions` | Separate external contract worth documenting explicitly |
| Terminal shell access | `terminal`, `/term`, legacy `Terminal` | `gateway-route` | `/term/` | Proxied through nginx to ttyd |
| Main dashboard frontend | `/` | `gateway-route` | `/` | Proxied by nginx to Next.js frontend |
| Classic dashboard frontend | `/legacy` | `local-only` | `/legacy` | Alternate route rendered by Next.js |
| Files tool route | `/files` | `local-only` | `/files` | Dedicated app route using backend FS APIs |
| Tool/service launcher links | V2 summary cards, legacy cards | `gateway-route` | `/jellyfin/`, `/requests/`, `/sonarr/`, `/radarr/`, `/prowlarr/`, `/bazarr/`, `/qb/`, `/copyparty/`, `/syncthing/`, `/llm/`, `/codex-revamped/` | nginx-proxied tools surfaced from the dashboard |

## Backend API Catalog

All canonical paths below also exist under `/api/...` unless otherwise noted.

### Auth and Session

| Method | Canonical path | Notes |
| --- | --- | --- |
| `POST` | `/auth/login` | Login |
| `GET` | `/auth/me` | Current session user |
| `GET` | `/auth/verify` | Auth session check |
| `GET` | `/auth/verify-admin` | Admin session check |
| `POST` | `/auth/logout` | Logout |

### Dashboard, Bootstrap, Health, and Control

| Method | Canonical path | Notes |
| --- | --- | --- |
| `GET` | `/status` | Basic authenticated status |
| `GET` | `/services` | Service catalog and health |
| `POST` | `/control/unlock` | Unlock controller |
| `POST` | `/control/lock` | Lock controller |
| `POST` | `/control` | Service start/stop/restart |
| `GET` | `/monitor` | Monitor payload |
| `GET` | `/dashboard` | Legacy aggregate dashboard payload |
| `GET` | `/ui/bootstrap` | V2 nav/bootstrap payload |
| `GET` | `/ui/initial` | V2 initial payload wrapper |
| `GET` | `/ui/workspaces/:workspaceKey` | V2 workspace payload |
| `GET` | `/system/network/exposure` | Network exposure audit |
| `GET` | `/connections` | Connected sessions/users |
| `POST` | `/connections/:id/disconnect` | Disconnect session |
| `GET` | `/storage` | Storage mounts snapshot |
| `GET` | `/storage/protection` | Watchdog/protection state |
| `POST` | `/storage/protection/recheck` | Re-evaluate protection |
| `POST` | `/storage/protection/resume` | Resume blocked services |
| `GET` | `/logs` | Debug/event log payload |
| `GET` | `/logging` | Logging configuration |
| `POST` | `/logging` | Update logging configuration |
| `GET` | `/drives` | Drive inventory |
| `POST` | `/drives/check` | Drive scan/check |
| `GET` | `/shares` | Shares inventory |
| `POST` | `/shares` | Create share |
| `PUT` | `/shares/:id` | Update share |
| `GET` | `/users` | Users inventory |
| `POST` | `/users` | Create user |
| `PUT` | `/users/:id` | Update user |
| `GET` | `/telemetry` | Telemetry snapshot |

### Filesystem APIs

| Method | Canonical path | Notes |
| --- | --- | --- |
| `GET` | `/fs/list` | Browse/list entries |
| `POST` | `/fs/mkdir` | Make directory |
| `POST` | `/fs/rename` | Rename entry |
| `GET` | `/fs/operations` | List async jobs |
| `GET` | `/fs/operations/:id` | Async job detail |
| `POST` | `/fs/operations/:id/control` | Control async job (`cancel`, `dismiss`, etc.) |
| `POST` | `/fs/operations/upload` | Create staged upload job |
| `POST` | `/fs/operations/:id/file` | Upload one staged file |
| `POST` | `/fs/operations/:id/finalize` | Finalize staged upload |
| `POST` | `/fs/operations/transfer` | Queue copy/move |
| `POST` | `/fs/operations/delete` | Queue delete |
| `POST` | `/fs/delete` | Direct delete/recycle |
| `GET` | `/fs/download` | Download file |
| `POST` | `/fs/upload` | Raw upload endpoint |
| `POST` | `/fs/paste` | Direct paste/copy helper |

### FTP APIs

| Method | Canonical path | Notes |
| --- | --- | --- |
| `GET` | `/ftp/defaults` | FTP default settings |
| `GET` | `/ftp/favourites` | List favourites |
| `POST` | `/ftp/favourites` | Create favourite |
| `PUT` | `/ftp/favourites/:id` | Update favourite |
| `DELETE` | `/ftp/favourites/:id` | Delete favourite |
| `POST` | `/ftp/favourites/:id/mount` | Mount favourite |
| `POST` | `/ftp/favourites/:id/unmount` | Unmount favourite |
| `POST` | `/ftp/list` | Browse remote path |
| `POST` | `/ftp/download` | Download remote entry |
| `POST` | `/ftp/upload` | Upload local path to remote |
| `POST` | `/ftp/mkdir` | Create remote directory |

### Media API

| Method | Canonical path | Notes |
| --- | --- | --- |
| `POST` | `/media/torrents/add` | Add torrent to qBittorrent with lane/media routing |

### LLM APIs

| Method | Canonical path | Notes |
| --- | --- | --- |
| `GET` | `/llm/state` | Runtime state |
| `POST` | `/llm/models/select` | Select local model |
| `POST` | `/llm/models/add-local` | Add local model |
| `POST` | `/llm/models/pull` | Pull local model |
| `GET` | `/llm/models/pull/:jobId` | Pull job status |
| `POST` | `/llm/online/models/refresh` | Refresh online models |
| `POST` | `/llm/online/models/select` | Select online model |
| `GET` | `/llm/conversations` | List conversations |
| `GET` | `/llm/conversations/:id/messages` | Conversation messages |
| `DELETE` | `/llm/conversations/:id` | Delete conversation |
| `POST` | `/llm/chat` | Non-streaming chat |
| `POST` | `/llm/chat/stream` | Streaming chat |

### OpenAI-Compatible APIs

| Method | Canonical path | Notes |
| --- | --- | --- |
| `GET` | `/openai/v1/models` | OpenAI-style model listing |
| `POST` | `/openai/v1/chat/completions` | OpenAI-style chat completions |

## Gateway / Proxied Tool Surface

These are not backend JSON APIs from `server/index.js`, but they are real app features exposed to operators through the dashboard and nginx gateway.

| Route | Upstream | Auth gate |
| --- | --- | --- |
| `/term/` | ttyd (`127.0.0.1:7681`) | authenticated user |
| `/copyparty/` | Copyparty (`127.0.0.1:3923`) | authenticated user |
| `/syncthing/` | Syncthing (`127.0.0.1:8384`) | admin |
| `/jellyfin/` | Jellyfin (`127.0.0.1:8096`) | gateway proxy; no nginx `auth_request` on this location |
| `/qb/` | qBittorrent (`127.0.0.1:8081`) | admin |
| `/requests/` | Jellyseerr (`127.0.0.1:5055`) | gateway proxy; no nginx `auth_request` on this location |
| `/sonarr/` | Sonarr (`127.0.0.1:8989`) | gateway proxy; no nginx `auth_request` on this location |
| `/radarr/` | Radarr (`127.0.0.1:7878`) | gateway proxy; no nginx `auth_request` on this location |
| `/prowlarr/` | Prowlarr (`127.0.0.1:9696`) | admin |
| `/bazarr/` | Bazarr (`127.0.0.1:6767`) | admin |
| `/llm/` | Local LLM service (`127.0.0.1:11435`) | admin |
| `/codex-revamped/` | Codex ReVamped (`127.0.0.1:2455`) | admin |

## Inventory Gaps and Review Notes

The repo review surfaced a few documentation risks that this document is intended to close:

- There was no canonical feature/API inventory before this file.
- The OpenAI-compatible endpoints are part of the live surface and should be treated as an external integration contract, not just an internal implementation detail.
- The dual-route alias model (`/x` plus `/api/x`) and the V2 workspace payload endpoints are easy to miss unless called out explicitly.
- `/files`, `/term`, and `/legacy` are real operator-facing routes and should be treated as first-class UI surfaces.
- nginx-exposed tool routes form part of the practical app surface even when they are not backend JSON APIs.

## Source Anchors

- Frontend routes and workspaces: `dashboard/app/page.tsx`, `dashboard/app/v2/DashboardV2.tsx`, `dashboard/app/v2/workspaces.tsx`, `dashboard/app/files/page.tsx`, `dashboard/app/term/page.tsx`, `dashboard/app/legacy/page.tsx`
- Frontend API consumers: `dashboard/app/v2/api.ts`, `dashboard/app/DashboardClient.tsx`
- Backend routes: `server/index.js`
- Gateway routes: `nginx.conf`
- Supporting architecture docs: `docs/architecture.md`, `docs/media-storage.md`
