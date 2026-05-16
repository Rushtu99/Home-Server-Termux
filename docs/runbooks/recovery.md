# Runbook: Control Plane Recovery

## Goal

Recover dashboard/backend control-plane state after host or storage disruption.

## Backup Artifacts

Use:

```bash
scripts/control-plane-backup.sh create
scripts/control-plane-backup.sh list
```

## Verify Backup

```bash
scripts/control-plane-backup.sh verify <archive.tar.gz>
```

## Dry Restore (Safe)

Extract to a staging directory first:

```bash
scripts/control-plane-backup.sh extract <archive.tar.gz> /tmp/hmstx-restore
```

Review extracted files before replacing live paths.

## Live Restore Guidance

1. Stop stack.
2. Take a fresh pre-restore backup.
3. Copy validated staged files into repo/runtime paths.
4. Start stack.
5. Verify with `scripts/service-status.sh` and `scripts/hmstx-control.sh status`.

## Minimum Checks After Restore

- Backend auth works.
- `runtime/app.db` is readable.
- Service wrappers and nginx config are present.
- Storage watchdog and mount state files parse correctly.
