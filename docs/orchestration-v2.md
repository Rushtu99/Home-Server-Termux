# v2 Orchestration Platform

The v2 platform is a parallel, descriptor-driven orchestration layer for Android + Termux. It keeps the existing shell wrappers and Node backend, but moves service and cluster ownership into explicit descriptors.

## Layout

- `services/<service>/service.yaml`: service metadata, dependencies, commands, health, restart policy, aliases, and dashboard grouping.
- `services/<service>/{start,stop,status,health,discover,config}.sh`: shell-first service contract.
- `clusters/<cluster>/cluster.yaml`: cluster services and cluster dependencies.
- `backend/`: Node-owned descriptor registry, graph resolver, state engine, health checks, events, logging, power guard, and CLI implementation.
- `core/`: reusable shell modules for adapters, health checks, logging, state, events, power, filesystem discovery, and environment loading.
- `state/services` and `state/clusters`: persistent runtime state.
- `logs/services`, `logs/clusters`, and `logs/orchestrator`: centralized logs.

## CLI

Use `./hs` for the v2 control surface:

```bash
./hs start media
./hs stop torrent
./hs restart jellyfin
./hs status
./hs doctor
./hs logs hs
./hs logs --follow jellyfin
./hs health
./hs health --repair
```

Target resolution checks clusters first, then services. Use explicit forms when needed:

```bash
./hs cluster start media
./hs service restart jellyfin
```

`hs doctor` validates descriptor shape, required service scripts, cluster graph
references, and Android/Termux power APIs. `hs health --repair` checks all
services and restarts unhealthy services that are still marked as desired
running, respecting each descriptor restart budget.

## Descriptors

`service.yaml` and `cluster.yaml` use a restricted YAML subset:

- top-level scalar keys
- arrays of scalars, inline or block style
- one-level maps for command, health, and restart sections
- comments starting with `#`

No anchors, multiline strings, deeply nested maps, or complex YAML tags are supported. This keeps parsing dependency-free and usable from both Node and shell tooling.

## Current Clusters

- `main`: `filesystem`, `backend`, `frontend`, `nginx`
- `torrent`: `filesystem`, `qbittorrent`
- `arr`: `filesystem`, `flarearr`, `prowlarr`, `sonarr`, `radarr`, `bazarr`
- `media`: depends on `arr`, then starts `filesystem`, `jellyfin`
- `llm`: `filesystem`, `llama_cpp`

Aliases include `arrstack -> arr`, `ai -> llm`, `downloads -> torrent`, and `llm/llama.cpp -> llama_cpp` at the descriptor registry level.

## Backend APIs

The existing API remains available. v2 adds compatibility forms:

```text
GET  /api/clusters
POST /api/clusters/:name/start
POST /api/clusters/start/:name
GET  /api/services/status
POST /api/services/:name/start
POST /api/services/start/:name
GET  /api/health
GET  /api/logs
```

The backend remains the canonical orchestrator owner. Shell scripts execute service actions; Node owns descriptor loading, dependency graph resolution, state, health, and API payloads.

## Adding a Service

Minimum required files:

```text
services/newservice/service.yaml
services/newservice/start.sh
services/newservice/stop.sh
services/newservice/health.sh
```

Recommended full contract:

```text
services/newservice/status.sh
services/newservice/discover.sh
services/newservice/config.sh
```

No backend code changes are required if the descriptor follows the supported schema.
`status.sh` is recommended for precise running/stopped state, but `health.sh`
is accepted as the status fallback for minimal service additions.

## Core Shell Modules

- `core/orchestrator/lib.sh`: shell entrypoints for descriptor-backed service
  and cluster actions.
- `core/health/lib.sh`: reusable `health_http`, `health_process`,
  `health_port`, and `health_custom` checks.
- `core/state/lib.sh`: persistent service status, PID, health, uptime, and
  stale PID cleanup helpers.
- `core/events/lib.sh`: JSONL event emission plus lightweight subscriber
  dispatch.
- `core/network/lib.sh`: network reachability, port, and HTTP probes.
- `core/power/android.sh`: wakelock, battery, and thermal guard helpers.
