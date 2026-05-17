# Migration Guide: Legacy Stack to v2 Orchestration

v2 is parallel and opt-in. Existing commands remain valid:

```bash
bash start.sh
bash scripts/hmstx-control.sh status
scripts/service-status.sh --json
```

## What Changed

- Service metadata now lives in `services/<service>/service.yaml`.
- Cluster metadata now lives in `clusters/<cluster>/cluster.yaml`.
- `./hs` provides the new unified CLI.
- The backend control plane merges v2 descriptors into the existing catalog and cluster APIs.
- The dashboard admin workspace renders cluster/service controls dynamically from backend payloads.

## Safe Adoption Path

1. Run `./hs doctor` to validate descriptors and Termux power API availability.
2. Run `./hs status` and compare with `scripts/service-status.sh --json`.
3. Start one low-risk cluster, for example `./hs start torrent`, and verify qBittorrent plus filesystem state.
4. Use the dashboard Admin workspace to confirm clusters, health, and service controls render correctly.
5. Move custom service metadata from hardcoded scripts into `services/<name>/service.yaml`.

## Compatibility Notes

- Existing wrappers under `scripts/` remain the process-level implementation for current services.
- v2 service scripts are thin adapters around those wrappers, so pid handling and service-specific setup stay intact.
- Legacy cluster config under `orchestrator/config/clusters.js` is still loaded, but same-name v2 clusters take precedence in the merged control plane.
- Runtime state under `runtime/` is still used by legacy scripts; v2 adds persistent state under `state/`.

## Rollback

Stop using `./hs` and return to the legacy control path:

```bash
bash scripts/hmstx-control.sh status
bash scripts/hmstx-control.sh restart
```

Because v2 is additive, no rollback migration is required unless custom overrides were added under `config/services` or `config/clusters`.
