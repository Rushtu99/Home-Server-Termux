# Home Server Inventory

This document summarizes what the current `home-server` repo does, how the pieces fit together, and which technologies are used in each area.

## Top-Level Architecture

- Entry gateway: `nginx` on `:8088`
- Frontend app: Next.js dashboard in [`dashboard/`](/data/data/com.termux/files/home/home-server/dashboard)
- Backend API: Express server in [`server/`](/data/data/com.termux/files/home/home-server/server)
- Main runtime launcher: [`start.sh`](/data/data/com.termux/files/home/home-server/start.sh)
- Android/Termux drive helpers: external `termux-drive-agent` and `termux-cloud-mount`
- Persistent app data: SQLite DB in `runtime/app.db`
- Files root exposed to the app: `~/Drives`

## Current User-Facing Functionality

### Dashboard

- Login/logout with cookie-based auth
- Runtime service visibility for:
  - `nginx`
  - backend API
  - frontend app
  - `ttyd`
  - optional local FTP server
- Service control actions from the dashboard
- System telemetry:
  - CPU load
  - memory usage
  - uptime
  - event loop timing
  - network throughput
  - storage mounts
- Debug/event log display
- Verbose logging toggle
- Terminal tab embedding `ttyd`
- Filesystem tab linking to the custom filesystem explorer
- FTP tab for remote FTP access and FTP-as-drive workflows

### Filesystem

- Custom filesystem browser at `/files`
- Rooted at `~/Drives`
- Folder navigation via breadcrumbs and shortcuts
- Drive state banner and removable-drive status cards
- Manual drive recheck trigger
- Optional drive event log display
- Create folder
- Rename entry
- Delete entry
- Download file
- Upload file into current folder
- Copy/cut clipboard flow across folders
- Floating clipboard card with paste into current folder
- Compact per-row dropdown menu for file actions

### Drive Handling

- `C` is the always-present internal storage drive
- Removable drives are mounted outside repo scope by `termux-drive-agent`
- Drive manifest read from `~/Drives/.state/drives.json`
- Drive event log read from `~/Drives/.state/drive-events.jsonl`
- Dashboard can manually trigger a removable-drive scan
- Connected drives appear with names like `D (Label)`, `E (Label)`, `F (Label)`

### FTP

- Manual FTP connection form
- Default PS4 preset support
- Saved FTP favourites
- Create, update, delete FTP favourites
- Browse remote FTP directories
- Download remote files
- Download remote folders recursively
- Upload local files to FTP remote paths
- Create remote folders
- Mount saved FTP favourites into `~/Drives/<name>`
- Unmount mounted FTP favourites
- Browse-only fallback when FTP mount support is unavailable

### Authentication And Sessions

- Dashboard login with JWT-backed httpOnly cookie
- Persistent users stored in SQLite
- First-run bootstrap admin from env vars
- Session verification endpoint used by nginx `auth_request`
- Idle/absolute session expiry
- Login attempt tracking / rate limiting behavior in backend
- Admin password gate for service-control actions

## Tech Used

### Frontend

- Next.js 16
- React 19
- TypeScript
- App Router
- Plain CSS in [`dashboard/app/globals.css`](/data/data/com.termux/files/home/home-server/dashboard/app/globals.css)
- Client-heavy dashboard/components in:
  - [`dashboard/app/DashboardClient.tsx`](/data/data/com.termux/files/home/home-server/dashboard/app/DashboardClient.tsx)
  - [`dashboard/app/files/page.tsx`](/data/data/com.termux/files/home/home-server/dashboard/app/files/page.tsx)

### Backend

- Node.js
- Express
- Built-in Node filesystem/process APIs
- SQLite through [`server/app-db.js`](/data/data/com.termux/files/home/home-server/server/app-db.js)
- JSON-based HTTP APIs under `/api/*`

### Reverse Proxy / Network

- `nginx`
- Loopback-only internal services behind gateway `:8088`
- `auth_request` protection for restricted routes

### Terminal / Shell Integration

- `ttyd` for web terminal access
- Bash startup/runtime scripts
- Termux tooling and Android filesystem paths

### FTP / Remote Mounting

- FTP client flows implemented in backend
- `rclone`-based root-helper mounting through external `termux-cloud-mount`
- Magisk/Kitsune root integration for mount helper flow

### Storage / Filesystem Operations

- Node `fs` APIs for list/create/rename/delete/upload/download
- Safe root confinement to `~/Drives`
- Recursive copy via `fs.cpSync`
- Move via `renameSync`, with cross-device fallback to copy+delete

## Repo Directory Overview

### [`dashboard/`](/data/data/com.termux/files/home/home-server/dashboard)

- Next.js frontend app
- `app/page.tsx`: route wrapper for dashboard client
- `app/DashboardClient.tsx`: main dashboard UI
- `app/files/page.tsx`: custom filesystem explorer
- `app/useGatewayBase.ts`: gateway-origin helper
- `app/globals.css`: shared UI and filesystem styling
- `next.config.ts`: Next config and API rewrites

### [`server/`](/data/data/com.termux/files/home/home-server/server)

- `index.js`: main API server, auth, services, filesystem, FTP, telemetry
- `app-db.js`: SQLite-backed app data layer
- `.env.example`: runtime env template

### [`scripts/`](/data/data/com.termux/files/home/home-server/scripts)

- `drive-common.sh`: shared drive/runtime helpers
- `install-termux-boot.sh`: installs Termux:Boot startup hooks
- `termux-boot-home-server.sh`: boot launcher entry

### Root Scripts

- [`start.sh`](/data/data/com.termux/files/home/home-server/start.sh): Android/Termux runtime launcher
- [`start-wsl.sh`](/data/data/com.termux/files/home/home-server/start-wsl.sh): optional Linux/WSL helper
- [`analyze-web.sh`](/data/data/com.termux/files/home/home-server/analyze-web.sh): optional external web-analysis helper
- [`nginx.conf`](/data/data/com.termux/files/home/home-server/nginx.conf): reverse proxy config

### [`docs/`](/data/data/com.termux/files/home/home-server/docs)

- planning and implementation docs
- this system inventory document

### Runtime / Generated Paths

- `runtime/`: sqlite DB, pid files, temporary artifacts
- `logs/`: service logs
- `~/Drives`: file root presented to the app

## External Dependencies Outside Repo Scope

- `termux-drive-agent`
  - removable-drive detection and mount lifecycle
- `termux-cloud-mount`
  - rooted FTP mount helper
- Magisk / Kitsune root environment
- optional `ttyd`
- optional `nginx`
- optional local FTP server provider:
  - `pyftpdlib`, or
  - BusyBox `ftpd`

## Notes On Removed / No Longer Primary Components

- FileBrowser is no longer the active filesystem UI
- The custom `/files` page is now the only filesystem browser path
- FileBrowser service/proxy startup has been removed from the active stack
- Some internal variable names still use `FILEBROWSER_*` to mean the drives root path; that is naming debt, not a live FileBrowser dependency

## Suggested Cleanup Follow-Up

- Rename `FILEBROWSER_ROOT` and related legacy constants to `DRIVES_ROOT`
- Update README sections that still mention FileBrowser as an active service
- Remove stale runtime artifacts like old `filebrowser.pid` / `filebrowser.db` if they are no longer needed
