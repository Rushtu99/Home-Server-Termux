# Operations

## Start and Reload

Primary startup entrypoint:

```bash
bash start.sh
```

During an interactive session, `start.sh` listens for `R` to reload services in place.

There is no separate repo-wide stop script. Normal control paths are:
- stop the foreground `start.sh` session
- use dashboard service controls
- call the specific service wrapper under `scripts/`

## Logs and Runtime State

Ignored runtime directories:
- `logs/`
- `runtime/`

Important files:
- `logs/start.log`
- `logs/backend.log`
- `logs/frontend.log`
- `logs/nginx` logs via the nginx config
- `runtime/*.pid`
- media workflow status under scratch `logs/`

Use those for debugging, not as versioned state.

## Service Wrappers

Most helpers share a simple contract:

```bash
scripts/jellyfin-service.sh start
scripts/qbittorrent-service.sh restart
scripts/llm-service.sh status
scripts/storage-watchdog-service.sh check-now
```

Use the wrappers instead of launching raw binaries by hand. That preserves pid files, logs, and managed paths.

## Static Validation

```bash
npm --prefix server run check
cd dashboard && npx tsc --noEmit && cd ..
bash -n start.sh
for script in scripts/*.sh; do bash -n "$script"; done
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
```

## Runtime Smoke Checks

After startup:

```bash
curl -I http://127.0.0.1:8088/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/auth/me
scripts/media-importer.sh status --json
scripts/storage-watchdog-service.sh check-now
```

If you need a lightweight repo-only media smoke test, point the importer at temporary vault/scratch directories and set test-sized thresholds such as `MEDIA_IMPORT_ABORT_FREE_GB=0`.

## Demo Publishing

The Pages workflow publishes from the real dashboard build:

```bash
cd dashboard
npm install
npm run build:demo
```

CI publishes `dashboard/out` to `gh-pages` through `.github/workflows/deploy-dashboard-preview.yml`.
