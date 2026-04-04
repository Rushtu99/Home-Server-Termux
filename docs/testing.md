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
npm test
npm run test:coverage
npm run build
npm run build:demo
```

Coverage thresholds (Vitest):
- statements >= 75
- branches >= 65
- functions >= 75
- lines >= 75

## CI Workflows

- `.github/workflows/test-server.yml`
- `.github/workflows/test-dashboard.yml`

Both workflows run on `push` and `pull_request` with path filters, and both enforce coverage gates.
