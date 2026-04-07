# Operations

## Repo Lifecycle Control

Use the repo-level control script for normal operator actions:

```bash
bash scripts/hmstx-control.sh preflight
bash scripts/hmstx-control.sh start
bash scripts/hmstx-control.sh status
bash scripts/hmstx-control.sh audit --json
bash scripts/hmstx-control.sh restart
bash scripts/hmstx-control.sh stop
```

- `preflight` checks the host before booting the stack.
- `start` brings the managed stack up.
- `status` reports the current lifecycle state and major blockers.
- `audit` reports core ports, gateway exposure, unauthenticated route behavior, and Tailscale/remote-access metadata.
- `restart` performs a clean stop/start cycle.
- `stop` shuts the stack down cleanly.

Use `preflight` after changing env files, paths, storage, or installed binaries. Use `status` when you need a quick answer without opening the dashboard.

`start.sh` remains the lower-level bootstrap path, but day-to-day control should go through `hmstx-control.sh`.

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

## Lifecycle States

The canonical service lifecycle contract is:

| State | Meaning | Usual operator action |
| --- | --- | --- |
| `healthy` | Service is up and passing checks. | No action. |
| `degraded` | Service is reachable but unhealthy, slow, or missing requirements. | Inspect reason, then repair/restart. |
| `blocked` | Service is intentionally blocked (for example by storage protection). | Remove blocker, then resume/restart. |
| `crashed` | Service should be running but checks fail. | Restart and inspect logs. |
| `stopped` | Service is intentionally off. | Start when needed. |

For compatibility, payloads may still include legacy `status` aliases such as `working`, `stalled`, and `unavailable`.

Storage protection has its own state values:

| State | Meaning |
| --- | --- |
| `healthy` | No storage blockers are active. |
| `degraded` | One or more services are blocked by storage protection. |
| `recovered` | Storage is healthy again, but any services stopped by the watchdog still need manual resume. |

## Service Wrappers

Most helpers share a simple contract:

```bash
scripts/jellyfin-service.sh start
scripts/qbittorrent-service.sh restart
scripts/jellyseerr-service.sh status
scripts/llm-service.sh status
scripts/storage-watchdog-service.sh check-now
```

Use the wrappers instead of launching raw binaries by hand. That preserves pid files, logs, and managed paths.

When the ARR/qB pipeline drifts, run the stack-specific repair pass instead of hand-editing download client settings inside the web UIs:

```bash
scripts/configure-arr-stack.sh
```

That script restores the expected qBittorrent save paths plus the Sonarr/Radarr remote path mappings for this Termux + proot layout.

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
scripts/qbittorrent-service.sh status --json
scripts/sonarr-service.sh status --json
scripts/radarr-service.sh status --json
scripts/jellyseerr-service.sh status --json
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

The preview workflow should also run when operator docs or preview-facing copy changes. The Pages build is still the real dashboard shell, so the public preview should keep its docs links and onboarding text aligned with the repo.
