# Live NAS Roadmap

This page tracks the next maintenance work required to turn HmSTx into a fully operated private home NAS, not just a control dashboard.

## Target State

The target system is:

- a private home NAS for one household
- operated through the HmSTx dashboard and repo scripts
- exposed remotely through VPN or tunnel access, not direct public WAN exposure
- safe to reboot, recover, audit, and maintain without ad hoc shell fixes

## What Already Exists

The current repo already has strong foundations:

- a loopback-first backend, frontend, and nginx gateway
- managed service wrappers for media, storage, FTP, terminal, and optional LLM services
- a real share model in the backend and dashboard
- storage watchdog and media workflow automation
- a GitHub Pages demo built from the same dashboard shell

The next phase should close the remaining operational gaps instead of replacing those systems.

## Phase 1: Operability

First priority is removing manual repo babysitting:

- add repo-wide `start`, `stop`, `restart`, and `status` commands
- persist service runtime health, last failure, last healthy transition, and restart recommendation
- expose degraded, blocked, and crashed states distinctly in the dashboard
- add startup preflight checks for missing binaries, invalid secrets, busy ports, and unwritable paths

Exit criteria:

- an operator can tell whether the stack is healthy without reading raw logs
- restart decisions do not depend on memory of what failed last time
- the repo can be started and stopped cleanly through a single supported path

## Phase 2: NAS Workflows

Second priority is making storage and sharing feel like a NAS product:

- unify SMB, Syncthing, FTP, and file-serving surfaces as managed share resources
- validate share paths and permissions before changes are applied
- surface share health, access mode, and protocol mappings in one dashboard flow
- add backup snapshot creation, listing, verification, and restore runbooks

Exit criteria:

- shares are manageable as first-class resources
- config backups are versioned and operator-visible
- file-serving workflows no longer feel like disconnected helper wrappers

## Phase 3: Data Safety

Third priority is protecting content and operator recovery:

- back up app DB, env/config state, nginx config, and managed service metadata
- add safe maintenance mode for storage operations and destructive cleanup windows
- add importer verification and duplicate or collision reporting
- persist audit logs for service actions, config changes, unlock events, and admin operations

Exit criteria:

- there is a documented way to recover the control plane after storage or host failure
- important admin actions survive restarts
- media and storage health can be reviewed historically, not only live

## Phase 4: Remote Access Hardening

Remote access should stay private and explicit:

- document and support VPN-first access patterns such as Tailscale or WireGuard
- keep backend and dashboard loopback or LAN scoped by default
- add session inventory, forced logout, failed login counters, and optional allowlists
- document secret rotation and session invalidation after rotation

Exit criteria:

- remote access works without opening the NAS directly to the public internet
- access decisions are visible and revocable from the dashboard

## Phase 5: Observability and Upgrades

A live NAS needs boring maintenance paths:

- add structured health snapshots and machine-friendly status output
- document safe upgrade, rollback, and backup-before-upgrade procedures
- add storage trend visibility and stale cache cleanup candidates
- maintain a short runbook set for first boot, drive replacement, recovery, and upgrades

Exit criteria:

- upgrades and failures have a documented operator path
- the dashboard can explain why a service is healthy, degraded, or blocked

## GitHub Pages Expectations

The Pages preview should remain a truthful public shell of the product:

- build from the same dashboard app used in production
- keep docs and roadmap links current inside the demo UI
- republish when docs or preview-facing dashboard content changes

That keeps the public preview aligned with the actual operator experience instead of drifting into a fake mock.
