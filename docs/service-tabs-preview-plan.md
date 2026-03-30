# Service Tabs, Optional Controller, GitHub Pages Preview, and Final Production Pass Plan

## Summary
Restructure the dashboard into service-aware tabs, reduce the generic controller to true optional services, add descriptions for every service, and apply one UX system across `Home`, `Media`, `ARR`, `Filesystem`, `FTP`, `Terminal`, and `Settings`.

The GitHub Pages target remains a static UI preview only, not a working NAS app, because the real dashboard is server-backed, auth-gated, and depends on live `/api/*` data and `:8088` service routes.

Locked decisions:
- No Figma or design-file deliverable.
- `Bazarr` and `Jellyseerr` remain placeholder cards until runnable on this host.
- The generic lockable controller keeps only `FTP`, `copyparty`, `syncthing`, `samba`, and `sshd`.
- GitHub Pages hosts a visual preview build with mock data and no live NAS controls.
- The implementation ends with a full consistency, cleanup, production-readiness, git-commit, and push pass.

Current service inventory to model:
- Platform: `nginx`, backend API, frontend, `ttyd`
- Media: `jellyfin`, `qbittorrent`, `jellyseerr` placeholder
- ARR: `sonarr`, `radarr`, `prowlarr`, `bazarr` placeholder
- Data: `postgres`, `redis`
- Optional access/sync: `ftp`, `copyparty`, `syncthing`, `samba`, `sshd`

## Key Changes

### 1. Add a backend-owned service catalog
Extend `/api/dashboard` and `/api/services` so the UI renders from one service catalog instead of a flat boolean map.

Each catalog entry should include:
- `key`
- `label`
- `description`
- `group`: `platform | media | arr | data | access`
- `surface`: `home | media | arr | terminal | settings`
- `controlMode`: `always_on | optional`
- `status`: `working | stopped | stalled | unavailable`
- `available`
- `placeholder`
- `blocker` for unavailable placeholder services
- `route` when the service has a gateway URL

Use the backend as the source of truth for:
- grouping
- descriptions
- placeholder vs live-card rendering
- which services remain in the controller

Keep the existing `services` boolean map for compatibility, but make the UI render from the catalog.

### 2. Replace the flat dashboard tabs with service-aware tabs
Use these top-level tabs:
- `Home`
- `Media`
- `ARR`
- `Filesystem`
- `FTP`
- `Terminal`
- `Settings`

Tab responsibilities:
- `Home`
  - system summary
  - platform health
  - optional services controller
  - grouped all-services overview
- `Media`
  - `Jellyfin`, `qBittorrent`, `Jellyseerr` placeholder
  - workflow strip: `Requests -> Downloads -> Library -> Streaming`
  - deep links to `/jellyfin/` and `/qb/`
- `ARR`
  - `Sonarr`, `Radarr`, `Prowlarr`, `Bazarr` placeholder
  - workflow strip: `Indexer -> Discovery -> Download -> Subtitle`
  - deep links to `/sonarr/`, `/radarr/`, `/prowlarr/`
- `Filesystem`, `FTP`, `Terminal`, `Settings`
  - keep their current function
  - move them onto the same header, spacing, and card system as the new service tabs

Do not create one tab per service. Group by workflow and user task.

### 3. Shrink the generic controller to optional services only
The generic controller on `Home` becomes an `Optional Services` module.

Keep only:
- `ftp`
- `copyparty`
- `syncthing`
- `samba`
- `sshd`

Remove from the generic controller:
- `jellyfin`
- `qbittorrent`
- `sonarr`
- `radarr`
- `prowlarr`
- `bazarr`
- `jellyseerr`
- `postgres`
- `redis`

Behavior:
- optional services keep `Start / Stop / Restart`
- always-on services do not appear in the generic controller
- always-on service cards in `Media` and `ARR` show:
  - `Open`
  - `Restart`
  - `Start` only if unexpectedly down
- no primary `Stop` action for always-on grouped services in the normal dashboard UX

### 4. Add descriptions and consistent service cards
Every service card should include:
- service name
- one-line description
- status badge
- short context/dependency line
- primary action
- secondary admin action when appropriate

Descriptions to ship:
- `Jellyfin`: Streams your movie and series library to local clients.
- `qBittorrent`: Handles automated and manual torrent downloads for the media stack.
- `Jellyseerr`: Request portal for adding movies and shows into the automation flow.
- `Sonarr`: Automates series discovery, tracking, and download handoff.
- `Radarr`: Automates movie discovery, tracking, and download handoff.
- `Prowlarr`: Central indexer manager for Sonarr and Radarr.
- `Bazarr`: Subtitle automation for imported media libraries.
- `PostgreSQL`: Persistent database for IPTV services and future media metadata.
- `Redis`: Cache and worker coordination for IPTV and background jobs.
- `FTP`: Legacy remote access and PS4-compatible transfer path.
- `copyparty`: High-throughput uploads, drop folders, and browser-based transfer.
- `Syncthing`: Device sync and backup across phones, laptops, and shares.
- `Samba`: LAN file sharing for desktop and TV clients.
- `sshd`: Shell access for maintenance and recovery.
- `ttyd`: Browser terminal access inside the dashboard.

Placeholder rules:
- `Bazarr` shows its current Python/native-dependency blocker.
- `Jellyseerr` shows its current Android-native Node/chroot blocker.
- placeholders use neutral unavailable styling, not runtime-failure styling.

### 5. Apply one UX system across all tabs
Use the referenced UI/UX guidance to make the dashboard denser, clearer, and more operational.

Layout rules:
- one-line page title only
- compact meta strip below the title
- first visible row is operational content, not hero decoration
- cards share one structure: identity, status, description, actions
- keep explanatory copy short
- no table-based service overview
- strongest action visible, secondary actions subdued
- progressive disclosure for blockers and setup notes

Responsive behavior:
- desktop: two-column or split-stack layout
- tablet: single main column with grouped secondary cards below
- mobile: stacked cards, compact headers, no wrapped nav-button rows
- workflow strips may scroll horizontally on narrow screens; action bars should not

Tab-specific UX:
- `Media` and `ARR` get workflow strips plus dense service cards
- `Home` gets grouped service summaries plus the optional controller
- `Filesystem`, `FTP`, and `Terminal` reuse the same header rhythm and card density
- `Settings` keeps segmented sections but adopts the same layout system

### 6. Add a static GitHub Pages preview
Create a separate static preview target for GitHub Pages instead of trying to publish the live NAS app.

Preview implementation:
- create a dedicated static preview app under a separate directory, recommended: `dashboard-preview/`
- reuse the same visual system and as many presentational components as possible from the real dashboard
- feed it mocked service, storage, drive, and FTP data snapshots
- disable or stub all real control actions
- show a persistent `Preview only` banner
- no auth, no `/api/*`, no live service routing

Preview coverage:
- `Home`
- `Media`
- `ARR`
- `Filesystem`
- `FTP`
- `Terminal`
- `Settings`
- desktop, tablet, and mobile states represented in the preview

Deployment:
- build the preview statically
- publish the built output to `gh-pages` with GitHub Actions
- keep the real app on the NAS only
- do not try to host the working dashboard on GitHub Pages

### 7. End with a full consistency and production-readiness pass
Finish the implementation with one repo-wide cleanup and hardening step before git operations.

This pass should include:
- API consistency
  - align naming, payload shape, status semantics, and error formatting across dashboard/service endpoints
  - remove UI-side assumptions that duplicate backend truth where possible
  - ensure placeholder services, optional services, and grouped services use one consistent contract
- frontend consistency
  - normalize tab/header/card patterns across all tabs
  - remove leftover one-off styling patterns that conflict with the new system
  - ensure the same status language, spacing, and action hierarchy is used everywhere
- code-writing consistency
  - normalize naming, helper structure, and control-flow style in the touched backend and frontend code
  - remove dead branches and stale service-controller assumptions
  - unify service labels, route labels, and user-facing copy
- comments
  - add concise comments only where behavior is non-obvious, especially:
    - service catalog/source-of-truth behavior
    - optional-vs-always-on service behavior
    - GitHub Pages preview boundaries
    - placeholder-service rendering intent
- production-readiness
  - run full checks
  - review touched code for obvious regressions
  - verify no accidental debug-only preview logic leaks into the live dashboard path
  - verify routes, service controls, and preview build all behave as intended
- final git step
  - commit the completed work in one coherent commit or a small set of intentional commits
  - push to the tracked remote branch

## Public APIs / Interfaces
Recommended payload shape:

```ts
type ServiceCatalogEntry = {
  key: string;
  label: string;
  description: string;
  group: 'platform' | 'media' | 'arr' | 'data' | 'access';
  surface: 'home' | 'media' | 'arr' | 'terminal' | 'settings';
  controlMode: 'always_on' | 'optional';
  status: 'working' | 'stopped' | 'stalled' | 'unavailable';
  available: boolean;
  placeholder: boolean;
  blocker?: string;
  route?: string;
};

type ServicesPayload = {
  services: Record<string, boolean>;
  serviceCatalog: ServiceCatalogEntry[];
  serviceGroups: Record<string, string[]>;
  controller: {
    locked: boolean;
    optionalServices: string[];
  };
};
```

No new service-control endpoints are required.
Reuse:
- `/api/control`
- `/api/control/unlock`
- `/api/control/lock`

## Test Plan
- Backend
  - `/api/dashboard` and `/api/services` include the service catalog and correct grouping
  - controller only returns `ftp`, `copyparty`, `syncthing`, `samba`, `sshd`
  - `Bazarr` and `Jellyseerr` appear as unavailable placeholders
- Home tab
  - optional controller only shows optional services
  - grouped all-services overview includes every service
- Media tab
  - `Jellyfin`, `qBittorrent`, and `Jellyseerr` placeholder render with descriptions and correct actions
- ARR tab
  - `Sonarr`, `Radarr`, `Prowlarr`, and `Bazarr` placeholder render with descriptions and correct actions
- Responsive
  - `360x800`, `768x1024`, `1280x800`
  - titles stay one line
  - workflow strips remain usable
  - no wrapped nav rows
  - no clipped action clusters
- Permissions
  - admin sees maintenance actions
  - non-admin sees status and safe links only
- GitHub Pages preview
  - builds without backend access
  - renders all top-level tabs with mock data
  - includes preview-only indicator
  - publishes to `gh-pages` successfully
- Final consistency pass
  - touched APIs and UI use one consistent naming/style model
  - comments exist only where behavior is non-obvious
  - full repo checks for the touched surfaces pass
  - final code review of touched areas finds no blocking issues before commit/push

## Assumptions
- Core grouped services are expected to stay on and should leave the generic controller.
- Placeholder-only rendering is correct for services not currently runnable on this host.
- GitHub Pages is for visual preview only; the working dashboard remains NAS-hosted.
- The implementation ends with a cleanup/hardening/commit/push pass before handoff.
