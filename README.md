# Home-Server-Termux

Termux-first home server stack with a Debian WSL development path.

## Stack
- Frontend: Next.js dashboard (`dashboard/`)
- Backend: Express API (`server/`)
- Reverse proxy: Nginx (`nginx.conf`)
- Services: FileBrowser, ttyd, sshd, optional FTP

## Runtime Ports
- `3000` Next.js frontend
- `4000` backend API
- `8088` nginx gateway
- `8080` FileBrowser (bound to localhost)
- `7681` ttyd (bound to localhost)
- `8022` sshd
- `2121` optional FTP

## Quick Start (WSL)
```bash
cd /home/admin/Home-Server-Termux
bash start-wsl.sh
```

## Quick Start (Termux)
```bash
cd ~/home-server
bash start.sh
```

## Web App Research (Agent Browser Workspace)
Use this to inspect a deployed web app and save reproducible artifacts (markdown content, forms, screenshot).

```bash
cd /home/admin/Home-Server-Termux
bash analyze-web.sh https://your-deployed-app.example
```

Outputs are written to `research/<timestamp>/`:
- `content.md`
- `forms.json`
- `screenshot.png`

Notes:
- Integrated toolkit location: `tools/agent-browser-workspace`
- First run installs toolkit dependencies automatically.
- For best results, install Chrome for Playwright once:
```bash
cd /home/admin/Home-Server-Termux/tools/agent-browser-workspace
npx playwright install chrome
```

## Auth and Security
- Dashboard login uses JWT.
- Backend accepts JWT from bearer header or auth cookie.
- Nginx protects `/files` and `/term` via `auth_request` (`/api/auth/verify`).
- Service control requires `ADMIN_ACTION_PASSWORD`.
- Nginx is excluded from dashboard service controls to avoid lockout.

## Backend Environment
Use `server/.env.example`:
```env
PORT=4000
JWT_SECRET=replace-with-a-long-random-secret
TOKEN_TTL=12h
DASHBOARD_USER=admin
DASHBOARD_PASS=change-me
ADMIN_ACTION_PASSWORD=change-me-too
CORS_ORIGIN=*
AUTH_COOKIE_NAME=hs_jwt
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
COOKIE_DOMAIN=
FILEBROWSER_ROOT=/path/to/files
FTP_ROOT=/path/to/ftp-root
```

## Validation Commands
```bash
npm --prefix server run check
bash -n start.sh
bash -n start-wsl.sh
cd dashboard && NODE_OPTIONS=--max-old-space-size=512 npm run build
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
```

## Troubleshooting

### `NS_ERROR_CORRUPTED_CONTENT` or blank dashboard
Usually caused by stale/crashed frontend process serving mismatched assets.

Run:
```bash
cd /home/admin/Home-Server-Termux
bash start-wsl.sh
```

If still broken, clear browser cache for your dashboard host and reload.

### WSL memory pressure / random Next.js exits
If WSL memory is low (for example ~2GB), Next.js may terminate abruptly.

Use:
```bash
export BUILD_NODE_OPTIONS=--max-old-space-size=512
export RUNTIME_NODE_OPTIONS=--max-old-space-size=256
bash start-wsl.sh
```

### `ECONNREFUSED` from nginx upstream
Upstream service is down. Check:
- `dashboard/frontend.log`
- `server/backend.log`
- `logs/error.log`

## Bot/Contributor Notes
- Keep API response shapes in sync between `server/index.js` and `dashboard/app/page.tsx`.
- Keep service command parity across `server/index.js`, `start.sh`, and `start-wsl.sh`.
- Keep filebrowser and ttyd bound to localhost so only nginx exposes them.
