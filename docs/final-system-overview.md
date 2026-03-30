# Home Server Final System Overview

## Current Product Position

`home-server` is now a rooted Android NAS-style appliance with:

- authenticated dashboard access
- admin-only service and system controls
- custom filesystem UI
- managed shares instead of raw top-level folder assumptions
- role and per-user share permissions
- removable-drive integration through an external Termux helper
- FTP favourites, browse flows, and rooted FTP mounts through a root helper

This is still not a parity replacement for DSM / TrueNAS / QNAP / Unraid. The largest remaining gaps are storage integrity, backups, snapshots, SMB/NFS, and richer multi-user policy.

## Runtime Architecture

### Public entrypoint

- `nginx` on `:8088`

### Internal services

- Next.js dashboard on loopback
- Express backend on loopback
- `ttyd` on loopback
- optional local FTP server on loopback

### Persistent app state

- SQLite DB at `runtime/app.db`

### Storage root

- `~/Drives`

### External helpers

- `termux-drive-agent`
  - detects removable drives
  - creates/removes mount directories
  - writes drive manifest and event log
- `termux-cloud-mount`
  - runs rooted `rclone` mounts for FTP favourites
  - exposes mounted FTP drives back into `~/Drives`

## Major Functional Areas

### Authentication and sessions

- JWT + cookie auth
- SQLite-backed users
- bootstrap admin seeding
- rate-limited login attempts
- in-memory active session tracking
- role carried in session/JWT

### Authorization

- admin-only:
  - service control
  - logs
  - monitoring
  - drive checks
  - FTP management
  - user management
  - share management
- share-aware filesystem access:
  - root shows only shares visible to the current user
  - share access resolves by:
    - explicit per-user rule
    - then role default
    - then admin fallback

### Filesystem

- custom `/files` explorer
- breadcrumbs
- folder navigation
- upload
- download
- rename
- copy / cut / paste
- recycle-bin delete flow into `~/Drives/.recycle-bin`
- root-level `New Share`
- share policy editor in sidebar

### Shares

- SQLite-backed `shares` table
- share metadata:
  - name
  - path key
  - description
  - source type
  - hidden flag
  - read-only flag
- `share_permissions` table
- supported permission subjects:
  - role
  - user
- current access levels:
  - `deny`
  - `read`
  - `write`
- default policy on new share:
  - `role=admin -> write`
  - `role=user -> deny`

### Users

- list users
- create users
- update role
- disable / enable users
- reset password
- self-protection rules:
  - current admin cannot disable self
  - current admin cannot demote self from admin

### Drive management

- internal `C`
- removable drives from `termux-drive-agent`
- drive manifest:
  - `~/Drives/.state/drives.json`
- drive events:
  - `~/Drives/.state/drive-events.jsonl`
- manual drive rescan from UI

### FTP

- direct FTP browse
- upload / download
- recursive directory download
- favourites CRUD
- rooted mount / unmount through `termux-cloud-mount`
- favourite secrets encrypted at rest in SQLite
- helper request files rewritten without secrets after mount invocation

### Logging and auditability

- debug/event log feed
- copy-friendly markdown log output
- actor metadata on sensitive events:
  - username
  - role
  - IP
  - session ID
  - user agent

## Tech Stack

### Frontend

- Next.js 16
- React 19
- TypeScript

### Backend

- Node.js
- Express
- `node:sqlite`
- `basic-ftp`

### Web gateway

- `nginx`

### Terminal

- `ttyd`

### Rooted remote mounts

- `rclone`
- Magisk / Kitsune root

## Main Repo Surfaces

- `dashboard/app/DashboardClient.tsx`
  - dashboard shell
  - settings panel
  - admin user controls
- `dashboard/app/files/page.tsx`
  - custom filesystem UI
  - share policy editor
- `server/index.js`
  - auth
  - dashboard APIs
  - filesystem APIs
  - share APIs
  - user APIs
  - FTP APIs
- `server/app-db.js`
  - SQLite schema and data access
- `start.sh`
  - service startup
- `nginx.conf`
  - public gateway

## Completed Validation

### Static checks

- `npm --prefix server run check`
- `npm --prefix dashboard run build`
- `bash -n start.sh`
- `git diff --check`

### Runtime checks performed during implementation

- backend boot and dashboard restart through `./start.sh`
- SQLite probe confirmed FTP favourite secrets now use `enc:v1:`
- role probe confirmed non-admin users are blocked from admin-only filesystem root APIs before share grants
- share probe confirmed:
  - admin root listing syncs top-level shares
  - non-admin root listing only shows explicitly allowed shares
  - non-admin read access into granted share works
- share creation probe confirmed `POST /api/shares` creates a visible share
- share update probe confirmed `PUT /api/shares/:id` persists:
  - name
  - description
  - hidden
  - read-only
  - default user role access
- user management probe confirmed:
  - `POST /api/users` creates a new user
  - `PUT /api/users/:id` disables that user
  - disabled users can no longer log in
- end-to-end ACL probe confirmed:
  - admin can create a share
  - admin can grant explicit per-user read access
  - granted user sees the share at filesystem root
  - granted user can open the share successfully

## Final Code Review Status

### Result

- no new blocking code defects were found in the final user/share-management slice after live probing

### Residual risks still present

- no delete API yet for shares or users
- no group-based permissions yet
- no quotas or per-folder ACL inheritance model
- no transport hardening for internet-facing deployments unless HTTPS is added in front of `:8088`
- Android root / FUSE behavior remains a platform risk for long-term NAS reliability

## Remaining Major Gaps

- SMB / NFS / WebDAV class NAS protocols
- snapshots
- backup engine
- restore workflows
- storage integrity / RAID / pooling
- quotas
- groups
- historical metrics and alerting
- media indexing and previews
- HTTPS-by-default remote posture

## Recommended Next Steps

1. Add group model and group-based share permissions.
2. Add share browser and share/user management to a dedicated admin settings area.
3. Add backup + restore policy engine.
4. Add SMB or WebDAV as the first true NAS protocol layer.
5. Add snapshot/versioning abstractions before broadening multi-user write access.
