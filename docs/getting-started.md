# Getting Started

## Target Host

HmSTx is built around a rooted Android + Termux host:
- run [start.sh](../start.sh) as the normal Termux app user
- use `su` only where the mount and firewall helpers need root
- expect `~/home-server` as the repo root and `~/Drives` as the managed filesystem root

For Linux or WSL development, use [start-wsl.sh](../start-wsl.sh) instead of trying to fake the Android mount model.

## Prerequisites

Required for the core web stack:
- `bash`
- `node` and `npm`
- `nginx`

Expected for the full Android runtime:
- `termux-drive-agent`
- root access for drive mounts and loopback lockdown
- service binaries you actually plan to run, such as `jellyfin-server`, `qbittorrent-nox`, `redis-server`, `postgres`, `llama-server`, or `ttyd`

Optional helpers:
- `bindfs` for clean exFAT exposure
- `ntfs-3g` for NTFS external drives

## First Boot

```bash
cd ~/home-server
cp server/.env.example server/.env
```

Edit `server/.env` before starting:
- replace `JWT_SECRET`
- replace `APP_AUTH_SECRET`
- replace `DASHBOARD_PASS`
- replace `ADMIN_ACTION_PASSWORD`
- review the media drive roots if your vault/scratch drives are not `D` and `E`

Install app dependencies explicitly:

```bash
npm --prefix server install
npm --prefix dashboard install
```

`start.sh` now fails fast if dependencies are missing or stale.

## Preflight Checks

```bash
npm --prefix server run check
cd dashboard && npx tsc --noEmit && cd ..
bash -n start.sh
for script in scripts/*.sh; do bash -n "$script"; done
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
```

## Start The Stack

```bash
bash start.sh
```

What `start.sh` does:
- loads `server/.env`
- prepares `~/Drives`
- refreshes external-drive state through `termux-drive-agent`
- enforces the managed media layout and compatibility symlinks
- starts backend, nginx, dashboard, media helpers, and optional local LLM helpers when available

Default ports:
- `8088`: nginx gateway
- `3000`: dashboard, loopback-bound
- `4000`: backend API, loopback-bound

## Linux / WSL Development

```bash
bash start-wsl.sh
```

That helper is intentionally simpler:
- no Android drive-mount logic
- no loopback firewall setup
- frontend build first, then dev fallback if build fails

Use it for UI and API iteration, not for validating Android-specific storage behavior.
