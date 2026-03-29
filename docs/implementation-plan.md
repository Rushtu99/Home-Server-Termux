# Home Server Expansion Plan

## Goals
- Move removable-drive mounting out of `home-server` and into a Termux-level companion agent so the dashboard only consumes drive state instead of owning low-level disk discovery.
- Replace ad-hoc FTP actions with mountable FTP drives, saved favourites, and default PS4 connection presets.
- Reduce public attack surface so only nginx on `:8088` is externally reachable.
- Add a local embedded database for users, settings, favourites, and drive/event state.
- Build a first-party filesystem UI with better control, while keeping legacy FileBrowser available as a fallback.

## Chosen Architecture

### 1. Drive ownership split
- Keep `~/Drives/C` as the only always-present drive inside `home-server`.
- Introduce a separate Termux system script named `termux-drive-agent` installed to `/data/data/com.termux/files/usr/bin/termux-drive-agent`.
- Run the agent from Termux:Boot and let it own removable local disks only.
- Agent behavior:
  - Detect removable block devices.
  - Assign letters `D`, `E`, `F`, ... in stable order.
  - Create mount directories as `~/Drives/<LETTER> (<LABEL>)`.
  - Sanitize label to `[A-Za-z0-9 _-]`, collapse whitespace, trim to 15 visible characters, and fall back to `Drive` if blank.
  - Remove the directory after a clean unmount/disconnect if it is no longer mounted.
  - Write a machine-readable manifest to `~/Drives/.state/drives.json`.
  - Append structured events to `~/Drives/.state/drive-events.jsonl`.
- `home-server` stops mounting removable drives directly. It only:
  - reads the manifest
  - polls for updates every 60 seconds
  - exposes a manual `Check Drives` action in the Filesystem tab to force an immediate refresh
  - keeps the existing `C` bind mount logic for internal storage

### 2. FTP-as-drive model
- Remove the always-present `~/Drives/PS4` folder from the default layout.
- Add default FTP favourite values:
  - host: `192.168.1.8`
  - port: `2121`
  - label: `PS4`
- Use `rclone` for FTP remote definitions and mounts.
- Run `rclone rcd` locally on `127.0.0.1:5572` with auth enabled and a repo-independent config path.
- For each saved FTP favourite:
  - store connection metadata in the app DB
  - create/update the `rclone` remote via RC `config/create` or `config/update`
  - mount/unmount via RC `mount/mount`, `mount/unmount`, and `mount/listmounts`
  - mount into `~/Drives/<FavouriteName>` after sanitization and uniqueness checks
- Favourite name rules:
  - max 32 chars
  - allowed chars `[A-Za-z0-9 _-]`
  - reject collisions with existing drive directories, case-insensitive
- FTP favourites replace the current one-off PS4 mirror model.

### 3. App database
- Use Node’s built-in `node:sqlite` module as the primary DB layer.
- Store the DB at `runtime/app.db`.
- Wrap DB access behind a small repository layer so the app can swap implementations later if `node:sqlite` changes.
- Use `crypto.scrypt` for password hashing to avoid native addon friction on Termux.
- Initial schema:
  - `users`
  - `sessions`
  - `app_settings`
  - `ftp_favourites`
  - `drive_events`
  - `drive_mounts`
- Bootstrap behavior:
  - on first run, import `DASHBOARD_USER` and `DASHBOARD_PASS` into `users`
  - keep `JWT_SECRET`, cookie settings, and admin bootstrap controls in env
  - deprecate env-based steady-state credentials after migration

### 4. Network exposure model
- Only nginx on `:8088` is externally reachable.
- Bind these to `127.0.0.1` only:
  - dashboard app `:3000`
  - backend API `:4000`
  - legacy FileBrowser `:8080`
  - ttyd `:7681`
  - `rclone rcd` `:5572`
  - sshd `:8022` if retained
- Remove the optional public local FTP server from the normal exposed-service story.
- Treat sshd as local-only in single-port mode; do not promise remote SSH access while single-port mode is enabled.

### 5. Filesystem UI direction
- Build a first-party filesystem browser in Next.js.
- Keep a user-facing toggle for `custom` vs `legacy` mode so FileBrowser stays available if the custom browser has regressions.
- Custom browser composition:
  - left tree using `react-arborist`
  - main list/detail grid using `@tanstack/react-table`
  - server-backed search, sort, pagination, and file actions
- The custom browser becomes the default after parity is reached.

## Planned Product Changes

### Filesystem tab
- Add drive summary cards for `C`, removable drives, and mounted FTP drives.
- Add `Check Drives` button to trigger immediate manifest reload.
- Add drive-state logger panel with a toggle for live polling and persisted event view.
- Add mode toggle:
  - `Custom Browser`
  - `Legacy FileBrowser`
- Surface mount health separately from service health so “drive missing” and “web service down” are not conflated.

### FTP tab
- Replace the current single-session form-first flow with:
  - `Favourites`
  - `Browser`
  - `Transfers`
- Store favourites in DB with create/edit/delete/test/mount actions.
- Add a row action menu on the right side of each FTP entry using a three-dots button.
- Entry actions:
  - open
  - download file
  - queue directory sync
  - upload into directory
  - create folder
  - mount favourite drive
  - unmount favourite drive
- Keep direct ad-hoc connect for debugging, but position favourites as the main path.

### Admin settings
- Restrict the Settings admin section to admin users only.
- Add management UI for:
  - users and roles
  - FTP favourites defaults
  - PS4 preset values
  - filesystem UI mode default
  - drive logger defaults
  - single-port mode flags

## Backend and API Work

### New config/env surface
- Add planned settings:
  - `DRIVE_STATE_PATH=~/Drives/.state/drives.json`
  - `DRIVE_EVENTS_PATH=~/Drives/.state/drive-events.jsonl`
  - `DRIVE_REFRESH_INTERVAL_MS=60000`
  - `RCLONE_RC_ADDR=127.0.0.1:5572`
  - `RCLONE_RC_USER=...`
  - `RCLONE_RC_PASS=...`
  - `RCLONE_CONFIG_PATH=...`
  - `DEFAULT_PS4_HOST=192.168.1.8`
  - `DEFAULT_PS4_PORT=2121`
  - `FILESYSTEM_UI_MODE=custom`
  - `ENABLE_LEGACY_FILEBROWSER=true`

### New backend responsibilities
- Add DB bootstrap/migrations.
- Add user CRUD and role checks.
- Add favourites CRUD and FTP mount lifecycle endpoints.
- Add drive manifest/event ingestion endpoints or file readers.
- Add filesystem APIs for the custom browser:
  - list directory
  - stat entry
  - search under root
  - create dir
  - rename
  - delete
  - upload/download hooks
- Add admin-only endpoints for app settings.

### Planned route groups
- `/api/admin/users`
- `/api/admin/settings`
- `/api/drives`
- `/api/drives/check`
- `/api/drives/events`
- `/api/drives/logger`
- `/api/ftp/favourites`
- `/api/ftp/mounts`
- `/api/files/tree`
- `/api/files/list`
- `/api/files/search`
- `/api/files/actions/*`

## Step-by-Step Execution Order
1. Lock the security baseline.
   - Bind all internal services to loopback.
   - Update nginx and startup scripts so only `:8088` is public.
   - Decide whether sshd remains local-only or is disabled by default in single-port mode.

2. Add the embedded DB layer.
   - Introduce `node:sqlite` access wrapper, migrations, and repositories.
   - Migrate auth from env-only credentials to DB-backed users with admin bootstrap import.
   - Keep session JWT flow, but move session persistence to DB.

3. Build the Termux-level drive agent outside `home-server`.
   - Install `termux-drive-agent` into `$PREFIX/bin`.
   - Emit manifest and append-only event logs under `~/Drives/.state/`.
   - Handle directory creation, letter assignment, mount, unmount, and cleanup.

4. Relax `home-server` drive logic.
   - Remove direct removable-drive ownership from startup.
   - Keep only `C` preparation in `home-server`.
   - Add 60-second refresh loop and manual `Check Drives` backend action.
   - Add drive event ingestion and logger API.

5. Introduce `rclone` control plane for FTP drives.
   - Start `rclone rcd` locally with auth.
   - Add backend wrappers for remote create/update/delete, mount/unmount, and mount status.
   - Replace `PS4` mirror assumptions with favourites + mount model.

6. Rework FTP UI around favourites and row actions.
   - Add favourites tab and persistence.
   - Add default PS4 preset.
   - Add three-dots action menu for each entry.
   - Add mount/unmount actions and transfer status surface.

7. Add admin settings panel.
   - Gate by admin role.
   - Expose users, defaults, feature toggles, and single-port settings.

8. Build the custom filesystem browser.
   - Start with read-only tree + list + search.
   - Add drive logger and mount state indicators.
   - Add write actions after read parity is stable.
   - Keep legacy FileBrowser toggle available throughout rollout.

9. Remove obsolete assumptions and docs.
   - Remove `~/Drives/PS4` from defaults.
   - Remove direct D/E mount language from docs and env examples.
   - Document drive-agent install, `rclone` requirements, and rollback to legacy FileBrowser mode.

## Acceptance Criteria
- Only nginx on `:8088` is reachable from the network.
- With no removable disks attached, only `C` is shown by default.
- When a removable disk is attached, the Termux drive agent creates `D/E/F...` directories with truncated labels and removes them when disconnected.
- Filesystem tab can refresh drive state on demand and poll every 60 seconds.
- FTP favourites can be saved, edited, mounted, and unmounted.
- PS4 defaults are prefilled as `192.168.1.8:2121`.
- Admin-only settings work from DB-backed users.
- Custom filesystem browser works for browse/search and can fall back to legacy FileBrowser.

## Research Notes
- Node now ships `node:sqlite`, including `DatabaseSync`, prepared statements, sessions, and defensive options. For this single-host Termux app, it is the lowest-friction embedded DB choice, though it is still release-candidate/experimental and should stay behind a thin adapter.
  - https://nodejs.org/api/sqlite.html
- `rclone` fits the FTP-drive requirement better than custom FTP mount code because it already supports FTP remotes, FUSE mounts, and authenticated RC APIs for `config/create`, `mount/mount`, `mount/unmount`, and `mount/listmounts`.
  - https://rclone.org/ftp/
  - https://rclone.org/commands/rclone_mount/
  - https://rclone.org/rc/
- `rclone` FTP limitations matter for UX and docs:
  - passive mode is required
  - checksums are not supported
  - some timestamp precision may be unavailable
- File Browser is still maintained, but its own repo says it is in maintenance-only mode with no planned new features. That makes it a good fallback, not the best primary UI for the custom drive/logger/admin roadmap.
  - https://github.com/filebrowser/filebrowser
  - https://github.com/filebrowser/filebrowser/security/advisories/GHSA-cm2r-rg7r-p7gg
  - https://github.com/advisories/GHSA-7xqm-7738-642x
- For the custom filesystem browser, `react-arborist` is a strong tree primitive and TanStack Table is a strong headless grid primitive, which fits the need for a controllable file explorer rather than another opaque all-in-one file manager.
  - https://github.com/brimdata/react-arborist
  - https://tanstack.com/table/latest
