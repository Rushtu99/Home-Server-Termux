# Runbook: First Boot

## Goal

Bring a fresh repo checkout to a working local stack without manual process surgery.

## Steps

1. Install dependencies.

```bash
npm --prefix server install
npm --prefix dashboard install
```

2. Configure secrets.

```bash
cp server/.env.example server/.env
```

Set at least:
- `JWT_SECRET`
- `APP_AUTH_SECRET`
- `DASHBOARD_PASS`
- `ADMIN_ACTION_PASSWORD`

3. Run static checks.

```bash
npm --prefix server run check
cd dashboard && npx tsc --noEmit && cd ..
for script in scripts/*.sh; do bash -n "$script"; done
nginx -t -p "$(pwd)" -c "$(pwd)/nginx.conf"
```

4. Start services.

```bash
bash start.sh
```

5. Verify health.

```bash
scripts/service-status.sh
scripts/hmstx-control.sh status
```

## Success Criteria

- `scripts/service-status.sh` reports core services as `running`.
- `scripts/hmstx-control.sh status` reports `working` or a clear blocker reason.
