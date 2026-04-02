# HmSTx

HmSTx is a Termux-first home server control plane for an Android-hosted NAS. The repo combines a Next.js dashboard, an Express API, an nginx gateway, and service wrappers for media, files, FTP, terminal access, and an optional local LLM.

The runtime model is opinionated:
- `nginx` on `:8088` is the public entrypoint
- dashboard (`dashboard/`) and API (`server/index.js`) stay loopback-bound
- service control flows through backend-owned metadata instead of frontend guesses
- media storage is split into vault storage and scratch storage under `~/Drives`
- the GitHub Pages demo is built from the same dashboard shell, not a separate mock app

## Repo Layout

- `dashboard/`: Next.js app and demo-mode frontend
- `server/`: Express API, auth/session logic, service catalog, app DB
- `scripts/`: service wrappers, drive helpers, media workflow, storage watchdog, LLM helpers
- `start.sh`: Termux startup/orchestration entrypoint
- `start-wsl.sh`: Linux/WSL development helper
- `docs/`: operator docs and reference pages
- `nginx.conf`: reverse proxy and protected internal routes

## Quick Start

1. Install dependencies explicitly. `start.sh` will not run `npm install` for you.
2. Copy the backend env file and replace the bootstrap secrets before the first start.
3. Run the validation commands.
4. Start the stack from the Termux app user.

```bash
cd ~/home-server
cp server/.env.example server/.env
npm --prefix server install
npm --prefix dashboard install
npm --prefix server run check
cd dashboard && npx tsc --noEmit && cd ..
bash -n start.sh
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
bash start.sh
```

Required first-boot settings in `server/.env`:
- `JWT_SECRET`
- `APP_AUTH_SECRET`
- `DASHBOARD_PASS`
- `ADMIN_ACTION_PASSWORD`

`server/.env.example` now sets `STRICT_BOOTSTRAP=true`, so the API will refuse to start until those values are replaced.

## Validation

Static checks:

```bash
npm --prefix server run check
cd dashboard && npx tsc --noEmit && cd ..
bash -n start.sh
for script in scripts/*.sh; do bash -n "$script"; done
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
```

Useful runtime probes:

```bash
curl -I http://127.0.0.1:8088/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/auth/me
scripts/media-importer.sh status --json
scripts/storage-watchdog-service.sh check-now
```

## Documentation

- [Docs Hub](/data/data/com.termux/files/home/home-server/docs/README.md)
- [Getting Started](/data/data/com.termux/files/home/home-server/docs/getting-started.md)
- [Architecture](/data/data/com.termux/files/home/home-server/docs/architecture.md)
- [Configuration](/data/data/com.termux/files/home/home-server/docs/configuration.md)
- [Media and Storage](/data/data/com.termux/files/home/home-server/docs/media-storage.md)
- [Live NAS Roadmap](/data/data/com.termux/files/home/home-server/docs/roadmap.md)
- [Operations](/data/data/com.termux/files/home/home-server/docs/operations.md)
- [Troubleshooting](/data/data/com.termux/files/home/home-server/docs/troubleshooting.md)

## Roadmap

The next maintenance phase is focused on turning HmSTx into a full private home NAS without changing its private-by-default model:

- complete repo-wide lifecycle control and service health persistence
- finish the operator-facing share and backup workflows
- add stronger recovery, audit, and remote VPN access guidance
- keep GitHub Pages aligned with the real dashboard shell and real operator docs

## Development Notes

- Use `bash start.sh` on the Android/Termux host.
- Use `bash start-wsl.sh` for a Linux or WSL dev session.
- Build the Pages demo from the real dashboard shell with `cd dashboard && npm run build:demo`.
- Local runtime state lives under ignored `logs/` and `runtime/`; treat those as diagnostics, not source.
