# Runbook: Drive Replacement

## Goal

Replace vault or scratch media drives without losing path compatibility for running services.

## Steps

1. Stop stack cleanly.

```bash
bash scripts/hmstx-control.sh stop
```

2. Connect replacement drive and run mount detection.

```bash
scripts/usb-mount-service.sh --scan-now
scripts/usb-mount-service.sh status --json
```

3. Verify expected mount aliases and role state.

```bash
cat ~/Drives/.state/drives.json
```

4. Confirm vault/scratch layout roots exist.

- Vault: `<Drive>/VAULT/Media`
- Scratch: `<Drive>/SCRATCH/HmSTxScratch`

5. Start stack and verify.

```bash
bash start.sh
scripts/service-status.sh
scripts/storage-watchdog-service.sh check-now
```

## Recovery Notes

- If watchdog blocks services, inspect `runtime/storage-watchdog-state.json`.
- If mount role mapping is wrong, correct `scripts/usb-mount-service.conf` and rescan.
