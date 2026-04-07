# Troubleshooting

## `start.sh` Refuses To Boot

Common causes:
- `server/node_modules` or `dashboard/node_modules` is missing
- `package.json` or `package-lock.json` is newer than `node_modules`
- `STRICT_BOOTSTRAP=true` and placeholder secrets are still present

Fix:

```bash
npm --prefix server install
npm --prefix dashboard install
```

Then re-check `server/.env`.

## Another `start.sh` Instance Is Running

`start.sh` uses `runtime/start.lock.d`.

If the lock remains after a crash, confirm no current instance is active and then remove it manually:

```bash
rm -rf runtime/start.lock.d
```

## Services Are Marked Blocked By Storage Protection

Inspect the watchdog directly:

```bash
scripts/storage-watchdog-service.sh check-now
cat runtime/storage-watchdog-state.json
```

Typical causes:
- vault drive missing
- scratch drive missing
- drive mounted somewhere other than the configured root

If the drives are healthy again, resume stopped services from the dashboard or the storage-protection API.

## Media Imports Are Not Landing In The Vault

Check:

```bash
scripts/media-importer.sh status --json
tail -n 50 ~/Drives/E/SCRATCH/HmSTxScratch/logs/media-importer.log
```

Look for:
- destination collisions
- vault free-space threshold hits
- source paths landing in the review queue instead of a library

If qBittorrent completed items are not triggering imports, inspect the managed qBittorrent config and confirm the finish command was written by the wrapper.

## ARR/qB Path Mappings Drift Or Imports Stall

Re-apply the managed wiring first:

```bash
scripts/configure-arr-stack.sh
```

Then verify the service wrappers still agree with the repo-managed layout:
- qBittorrent default save path should resolve to `~/Drives/E/SCRATCH/HmSTxScratch/downloads/manual`
- qBittorrent temp path should resolve to `~/Drives/E/SCRATCH/HmSTxScratch/tmp/qbittorrent`
- Sonarr should import from the `series` lane
- Radarr should import from the `movies` lane

If this keeps drifting, re-check `MEDIA_VAULT_ROOT`, `MEDIA_SCRATCH_ROOT`, and the `/mnt/termux-drives` bind mount inside the proot environment.

## Jellyseerr `/requests` Is Unavailable

Check:

```bash
scripts/jellyseerr-service.sh doctor
tail -n 100 logs/jellyseerr.log
```

Typical causes:
- Jellyseerr source was unpacked but `dist/index.js` was never built
- `node_modules` is missing under `~/services/jellyseerr/app`
- the host Node runtime does not satisfy Jellyseerr's pinned engine (currently Node 22.x; Node 25.x will fail with `ERR_PNPM_UNSUPPORTED_ENGINE`)

Recovery path:

```bash
INSTALL_JELLYSEERR=1 scripts/install-media-automation.sh
```

If the source tree and dependencies already exist, `scripts/jellyseerr-service.sh start` now attempts a one-time rebuild before launching. If the doctor command reports a Node-major mismatch, switch the Termux Node install to the required major first; nginx already proxies `/requests/`, so a Node-engine mismatch is a host runtime blocker rather than a proxy/config issue.

## Local LLM Fails To Start

Check:

```bash
scripts/llm-service.sh start
tail -n 100 logs/llm.log
```

Common causes:
- `llama-server` not installed
- no `.gguf` model in `LLM_MODELS_DIR`
- `LLM_DEFAULT_MODEL_PATH` points to a missing file

## Frontend Build Problems

Use:

```bash
cd dashboard
npx tsc --noEmit
npm run build
```

If the production build is the problem but type-checking passes, fall back to `start-wsl.sh` for a Linux-hosted build/debug session instead of debugging Next.js platform issues on Android first.
