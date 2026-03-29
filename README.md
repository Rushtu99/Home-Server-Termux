# Home-Server-Termux

Termux-first home server stack for Android, with optional Linux/WSL contributor tooling.

## Stack
- Frontend: Next.js dashboard in `dashboard/`
- Backend: Express API in `server/`
- Reverse proxy: nginx in `nginx.conf`
- Services: FileBrowser, ttyd, sshd, optional local FTP server, remote FTP client tab

## Runtime Ports
- `8088` nginx gateway, intended as the only network-exposed entrypoint
- `3000` dashboard frontend, bound to loopback
- `4000` backend API, bound to loopback
- `8080` FileBrowser, bound to loopback
- `7681` ttyd, bound to loopback
- `8022` sshd, disabled by default in single-port mode
- `2121` optional local FTP server, bound to loopback when enabled

## Quick Start (Termux)
```bash
cd ~/home-server
cp server/.env.example server/.env
bash start.sh
```

`start.sh` loads `server/.env`, prepares `~/Drives` as the file-system root, and:
- bind-mounts Android shared storage at `~/Drives/C`
- keeps removable-drive ownership outside the repo through `termux-drive-agent`
- treats `C` as the only always-present drive until the external agent detects and mounts removable storage
- binds the dashboard/backend/helper services to loopback so nginx on `:8088` is the default public entrypoint
- triggers the external `termux-drive-agent` to refresh removable drive mounts and write `~/Drives/.state/drives.json`

FileBrowser serves `~/Drives`, and ttyd opens in `~/home-server`.
Run `start.sh` from the normal Termux app user, not from a root shell.

If Android enumerates your external disks differently, you can override the source block devices for startup:

```bash
D_SOURCE=/dev/block/sde1 E_SOURCE=/dev/block/sdf1 bash start.sh
```

## Drive Mounting
`termux-drive-agent` now owns removable-drive detection and mount cleanup:
- it installs to `/data/data/com.termux/files/usr/bin/termux-drive-agent`
- it writes `~/Drives/.state/drives.json` and `~/Drives/.state/drive-events.jsonl`
- it names connected removable drives as `D (Label)`, `E (Label)`, `F (Label)`, and so on
- it removes those directories when the underlying device disconnects or is unmounted

`start.sh` only prepares `C` and asks the external agent for one sync pass. The continuous 60s retry loop is expected to come from the Termux:Boot launcher at `~/.termux/boot/termux-drive-agent.sh`.

For boot-time startup with Termux:Boot, run:

```bash
cd ~/home-server
bash scripts/install-termux-boot.sh
```

That installs a symlinked launcher at `~/.termux/boot/home-server.sh` and disables the older conflicting boot entries.

## Optional Linux/WSL Dev Helper
```bash
cd /path/to/Home-Server-Termux
bash start-wsl.sh
```

This is contributor tooling only. The Android runtime path stays on `start.sh`.

## Optional Web Research Helper
```bash
cd ~/home-server
bash analyze-web.sh https://your-deployed-app.example
```

This requires `tools/agent-browser-workspace` to exist locally. Output is written to `research/<timestamp>/`.

## Auth and Security
- Dashboard login uses JWT.
- Backend uses the httpOnly auth cookie for the dashboard, stores users/settings in the embedded SQLite app DB, and tracks active sessions server-side.
- nginx protects `/files` and `/term` through `auth_request` against `/api/auth/verify`.
- Service control requires `ADMIN_ACTION_PASSWORD`.
- nginx is excluded from dashboard controls to avoid self-lockout.
- Dashboard, backend, FileBrowser, ttyd, and the optional local FTP server stay on loopback so only nginx is externally exposed by default.
- sshd is disabled by default via `ENABLE_SSHD=false`; if you re-enable it, it binds to loopback unless you override `SSHD_BIND_HOST`.
- Login attempts are rate-limited and sessions expire on idle and absolute timeouts.

## Backend Environment
Start from `server/.env.example`:

```env
PORT=4000
CORS_ORIGIN=
EXEC_SHELL=
BACKEND_BIND_HOST=127.0.0.1
FILEBROWSER_ROOT=/data/data/com.termux/files/home/Drives
FILEBROWSER_BIND_HOST=127.0.0.1
RUNTIME_DIR=/data/data/com.termux/files/home/home-server/runtime
APP_DB_PATH=/data/data/com.termux/files/home/home-server/runtime/app.db
FILEBROWSER_DB_PATH=/data/data/com.termux/files/home/home-server/runtime/filebrowser.db
SERVER_NODE_OPTIONS=--max-old-space-size=192
DASHBOARD_NODE_OPTIONS=--max-old-space-size=384
TTYD_BIND_HOST=127.0.0.1
FTP_BIND_HOST=127.0.0.1
FTP_SERVER_PORT=2121
DRIVE_AGENT_CMD=/data/data/com.termux/files/usr/bin/termux-drive-agent
TERMUX_CLOUD_MOUNT_CMD=/data/data/com.termux/files/usr/bin/termux-cloud-mount
TERMUX_CLOUD_MOUNT_ROOT=/mnt/cloud/home-server
DRIVE_STATE_PATH=/data/data/com.termux/files/home/Drives/.state/drives.json
DRIVE_EVENTS_PATH=/data/data/com.termux/files/home/Drives/.state/drive-events.jsonl
DRIVE_REFRESH_INTERVAL_MS=60000
ENABLE_SSHD=false
SSHD_BIND_HOST=127.0.0.1
SSHD_PORT=8022
DRIVE_DETECT_RETRIES=6
DRIVE_DETECT_DELAY=1
JWT_SECRET=replace-with-a-long-random-secret
TOKEN_TTL=12h
DASHBOARD_USER=admin
DASHBOARD_PASS=change-me
ADMIN_ACTION_PASSWORD=change-me-too
AUTH_COOKIE_NAME=hs_jwt
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
COOKIE_DOMAIN=
FTP_ROOT=/data/data/com.termux/files/home/Drives
FTP_CLIENT_DOWNLOAD_ROOT=/data/data/com.termux/files/home/Drives
FTP_CLIENT_HOST=192.168.1.8
FTP_CLIENT_PORT=2121
FTP_CLIENT_USER=anonymous
FTP_CLIENT_PASSWORD=anonymous@
FTP_CLIENT_SECURE=false
```

`DASHBOARD_USER` and `DASHBOARD_PASS` now act as first-run bootstrap credentials for the embedded app DB. Once the initial admin user is seeded, later logins come from `runtime/app.db`.

Removable disks are now expected to be managed by the external `termux-drive-agent`, which installs to `/data/data/com.termux/files/usr/bin/termux-drive-agent` and writes a manifest plus event log under `~/Drives/.state/`.

## Validation Commands
```bash
npm --prefix server run check
npm --prefix dashboard run build
bash -n start.sh
bash -n start-wsl.sh
bash -n analyze-web.sh
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
```

## Troubleshooting

### Blank or stale dashboard
Rerun:

```bash
bash start.sh
```

This reloads `server/.env`, clears the repo-managed service processes, and starts the stack again in the expected order.

### `/files` or `/term` returns `401`
Login through the dashboard first. Those routes are protected by nginx and require the dashboard auth cookie.

### Remote FTP access
Open the FTP tab in the dashboard. It now supports saved favourites, direct browsing, and root-helper mount/unmount into `~/Drives/<FavouriteName>`. The default preset is the PS4 host at `192.168.1.8:2121`.

The dashboard FTP client can:
- browse remote directories
- pull remote files or whole folders into `~/Drives`
- upload a local server file path to the remote host
- create remote folders
- save favourite remotes with a drive folder name
- mount or unmount saved favourites through `termux-cloud-mount`

If your PS4 GoldHEN setup uses different credentials or port, override them in the form or in `server/.env`.

`termux-cloud-mount` runs `rclone mount` through Magisk root in the global mount namespace and exposes the mounted remote back into `~/Drives` as a symlink. If that helper is unavailable or root FUSE fails, the favourite stays saved and browseable and the UI falls back to browse-only mode.

### Local FTP server is not available
The optional local FTP server only appears in service controls when one of these providers exists:
- `python3 -m pyftpdlib`
- BusyBox `ftpd`

If neither is installed, use SFTP over SSH on port `8022`.

## Contributor Notes
- Keep API response shapes aligned between `server/index.js` and `dashboard/app/page.tsx`.
- Keep service command parity across `server/index.js`, `start.sh`, and `start-wsl.sh`.
- Keep runtime-only artifacts out of git.
