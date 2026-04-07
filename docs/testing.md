# Testing Guide

## Backend (`server/`)

```bash
cd server
npm test
npm run test:coverage
npm run check
```

Coverage thresholds (Vitest):
- statements >= 80
- branches >= 70
- functions >= 80
- lines >= 80

## Dashboard (`dashboard/`)

```bash
cd dashboard
npx tsc --noEmit
npm run build
```

## CI Workflows

- `.github/workflows/test-server.yml`
- `.github/workflows/test-dashboard.yml`

`test-server.yml` enforces backend unit/coverage checks and runtime-core static validation.
`test-dashboard.yml` enforces dashboard typecheck + production build.
