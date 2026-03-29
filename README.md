# Home-Server-Termux

Termux-first home server stack for Android, with optional Linux/WSL contributor tooling.

## Stack
- Frontend: Next.js dashboard in `dashboard/`
- Backend: Express API in `server/`
- Reverse proxy: nginx in `nginx.conf`
- Services: FileBrowser, ttyd, sshd, optional local FTP server, remote FTP client tab

## Runtime Ports
- `3000` dashboard frontend
- `4000` backend API
- `8088` nginx gateway
- `8080` FileBrowser, bound to localhost
- `7681` ttyd, bound to localhost
- `8022` sshd
- `2121` common remote FTP port for PS4 GoldHEN and the optional local FTP server provider

## Quick Start (Termux)
```bash
cd ~/home-server
cp server/.env.example server/.env
bash start.sh
```

`start.sh` prepares `~/Drives` as the file-system root and:
- bind-mounts Android shared storage at `~/Drives/C`
- auto-mounts the first detected external NTFS partition at `~/Drives/D` with `ntfs-3g`
- auto-mounts the first detected external exFAT partition at `~/Drives/E`
- keeps `~/Drives/PS4` as the local mirror target for the PS4 FTP client

FileBrowser serves `~/Drives`, and ttyd opens in `~/home-server`.

If Android enumerates your external disks differently, you can override the source block devices for startup:

```bash
D_SOURCE=/dev/block/sde1 E_SOURCE=/dev/block/sdf1 bash start.sh
```

The default automount now prefers stable identifiers instead of shifting device names:
- `D` prefers UUID `16BA8F9DBA8F784F` and label `Rushtu 4TB`
- `E` prefers UUID `8097-A8C4` and label `T exFAT 2TB`

You can override those in `server/.env` or the shell with `D_UUID`, `E_UUID`, `D_LABEL`, and `E_LABEL`.

## Auto-Mount On Detect
`start.sh` now launches [drive-watcher.sh](/data/data/com.termux/files/home/home-server/scripts/drive-watcher.sh), which polls every 5 seconds and mounts:
- NTFS to `~/Drives/D` with `ntfs-3g`
- exFAT to `~/Drives/E`

This is polling-based, not kernel hotplug based. It works as soon as Android exposes the drives as block devices.

For boot-time startup with Termux:Boot, copy or symlink [home-server.sh](/data/data/com.termux/files/home/home-server/termux-boot/home-server.sh) into `~/.termux/boot/`.

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
- Backend accepts JWT from either bearer header or auth cookie.
- nginx protects `/files` and `/term` through `auth_request` against `/api/auth/verify`.
- Service control requires `ADMIN_ACTION_PASSWORD`.
- nginx is excluded from dashboard controls to avoid self-lockout.
- FileBrowser and ttyd stay on loopback so only nginx is externally exposed.

## Backend Environment
Start from `server/.env.example`:

```env
PORT=4000
CORS_ORIGIN=*
FILEBROWSER_ROOT=/data/data/com.termux/files/home/Drives
RUNTIME_DIR=/data/data/com.termux/files/home/home-server/runtime
FILEBROWSER_DB_PATH=/data/data/com.termux/files/home/home-server/runtime/filebrowser.db
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
FTP_CLIENT_DOWNLOAD_ROOT=/data/data/com.termux/files/home/Drives/PS4
FTP_CLIENT_HOST=
FTP_CLIENT_PORT=2121
FTP_CLIENT_USER=anonymous
FTP_CLIENT_SECURE=false
```

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

This clears old frontend/backend processes and starts the stack again in the expected order.

### `/files` or `/term` returns `401`
Login through the dashboard first. Those routes are protected by nginx and require the dashboard auth cookie.

### Remote PS4 FTP access
Open the FTP tab in the dashboard and enter your PS4 host details. The dashboard FTP client can:
- browse remote directories
- pull remote files into `~/Drives/PS4`
- upload a local server file path to the remote host
- create remote folders

If your PS4 GoldHEN setup uses different credentials or port, override them in the form or in `server/.env`.

### Local FTP server is not available
The optional local FTP server only appears in service controls when one of these providers exists:
- `python3 -m pyftpdlib`
- BusyBox `ftpd`

If neither is installed, use SFTP over SSH on port `8022`.

## Contributor Notes
- Keep API response shapes aligned between `server/index.js` and `dashboard/app/page.tsx`.
- Keep service command parity across `server/index.js`, `start.sh`, and `start-wsl.sh`.
- Keep runtime-only artifacts out of git.
