# v2 Dashboard Modules

The production Next.js dashboard still lives in `dashboard/` for compatibility. This directory documents the v2 module boundary used by the orchestration UI:

- `api/`: REST clients for services, clusters, health, events, and logs.
- `clusters/`: dynamic cluster views backed by `/api/clusters`.
- `services/`: dynamic service controls backed by `/api/catalog/services` and `/api/services/*`.
- `components/`: reusable status, health, log, and toggle components.
- `hooks/`: polling and optimistic-control hooks.

Current implementation is wired into `dashboard/app/v2/workspaces/admin.tsx` and uses descriptor-driven backend payloads instead of hardcoded service lists.
