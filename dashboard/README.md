# Dashboard

This directory contains the production Next.js dashboard and the GitHub Pages demo build.

Common commands:

```bash
npm install
npm run dev
npm run build
npm test
npm run test:coverage
npx tsc --noEmit
npm run build:demo
```

Notes:
- `npm run build:demo` enables demo mode and exports the same app shell used in production.
- Runtime API behavior is defined in [demo-api.ts](/data/data/com.termux/files/home/home-server/dashboard/app/demo-api.ts) for demo builds and in [index.js](/data/data/com.termux/files/home/home-server/server/index.js) for the live stack.
- The canonical UI/API surface map lives in [document.MD](/data/data/com.termux/files/home/home-server/document.MD).
- Repo-level setup, operations, and architecture docs live in the root [README.md](/data/data/com.termux/files/home/home-server/README.md) and [docs/](/data/data/com.termux/files/home/home-server/docs/README.md).
- The Pages preview should stay honest: if onboarding copy, docs links, or preview navigation changes here, update the gh-pages workflow inputs too.
