# Home-Server-Termux

Termux-first home server stack for Android, with optional Linux/WSL contributor tooling.

## Stack
- Frontend: Next.js dashboard in `dashboard/`
- Backend: Express API in `server/`
- Reverse proxy: nginx in `nginx.conf`
- Services: FileBrowser, ttyd, sshd, optional FTP

## Runtime Ports
- `3000` dashboard frontend
- `4000` backend API
- `8088` nginx gateway
- `8080` FileBrowser, bound to localhost
- `7681` ttyd, bound to localhost
- `8022` sshd
- `2121` optional FTP when a provider is installed

## Quick Start (Termux)
```bash
cd ~/home-server
cp server/.env.example server/.env
bash start.sh
```

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
FILEBROWSER_ROOT=/data/data/com.termux/files/home/nas
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
FTP_ROOT=/data/data/com.termux/files/home/nas
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

### FTP is not available
FTP stays optional. On this repo it only appears when one of these providers exists:
- `python3 -m pyftpdlib`
- BusyBox `ftpd`

If neither is installed, use SFTP over SSH on port `8022`.

## Contributor Notes
- Keep API response shapes aligned between `server/index.js` and `dashboard/app/page.tsx`.
- Keep service command parity across `server/index.js`, `start.sh`, and `start-wsl.sh`.
- Keep runtime-only artifacts out of git.
