# Runbook: Upgrade And Rollback

## Goal

Upgrade safely with a rollback path that preserves control-plane state.

## Pre-Upgrade

1. Capture backup snapshot.

```bash
scripts/control-plane-backup.sh create pre-upgrade
```

2. Validate working baseline.

```bash
scripts/service-status.sh
scripts/hmstx-control.sh status --json
```

3. Run static checks on target revision.

```bash
npm --prefix server run check
cd dashboard && npx tsc --noEmit && cd ..
for script in scripts/*.sh; do bash -n "$script"; done
```

## Upgrade

```bash
bash scripts/hmstx-control.sh restart
scripts/service-status.sh
```

## Rollback Trigger

Rollback if one of these persists after restart:
- Core services cannot reach healthy status.
- Auth/session endpoints regress.
- Storage watchdog stays blocked unexpectedly.

## Rollback

1. Return code to previous known-good revision.
2. Restore control-plane files from verified backup archive (staged extract first).
3. Restart stack and re-run smoke checks.

## Post-Upgrade Checklist

- `scripts/service-status.sh` shows expected service state.
- Dashboard paths (`/`, `/files`, `/term`) respond through nginx.
- ARR + qB mappings reconcile (`scripts/configure-arr-stack.sh`).
