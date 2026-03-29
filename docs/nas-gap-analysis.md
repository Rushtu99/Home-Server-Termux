# Home Server NAS Gap Analysis

This document compares the current `home-server` codebase against production-oriented NAS systems and commercial NAS operating systems, then lists the missing features, risky design choices, and implementation TODOs required before this project can be considered a serious NAS product.

Benchmark systems used for comparison:

- Synology DSM
- TrueNAS SCALE
- Unraid
- QNAP QTS / QuTS hero

Current repo baseline used for comparison:

- custom web UI at `/files`
- `nginx` gateway on `:8088`
- Next.js frontend
- Express backend
- SQLite auth/settings DB
- `~/Drives` as the live storage root
- external Android helpers for removable drives and rooted FTP mounts

## Executive Verdict

Current status: **advanced rooted-Android home server with NAS-like workflows**

Current classification:

- Good enough for a personal self-hosted appliance
- Not ready to be described as a production NAS
- Not yet comparable to DSM, TrueNAS, Unraid, or QNAP in data safety, storage abstraction, permissions, protocol support, observability, or lifecycle operations

Hard conclusion:

- **No-Go** for any “production NAS” claim today
- **Go** only for “experimental rooted Android home server / personal NAS prototype”

The biggest reasons are:

1. no storage integrity layer or redundancy model
2. no snapshots, versioning, or restore workflows
3. no SMB/NFS/iSCSI style NAS protocol layer
4. incomplete multi-user authorization model for file access
5. limited auditing, metrics history, alerts, and operational hardening
6. Android/Termux/root/FUSE constraints create a platform ceiling that commercial NAS systems do not have

## What The Current System Already Does Well

Strengths worth keeping:

- single public gateway pattern through `nginx` on `:8088`
- loopback-only internal services by default
- custom filesystem UI instead of a generic embedded file manager
- working upload/download/create/rename/delete/copy/cut/paste flows inside `~/Drives`
- removable-drive manifest/event model through an external helper
- root-helper approach for FTP mounting instead of running the whole app as root
- SQLite-backed auth and app state instead of env-only state
- decent foundation for dashboard telemetry, logs, and service control

This is a solid foundation for a controlled home-server appliance. It is not yet a complete storage platform.

## Comparison Matrix

Legend:

- `Yes` = current repo has a meaningful implementation
- `Partial` = early implementation or adjacent behavior exists
- `No` = missing

| Capability | Current Home Server | Synology / TrueNAS / Unraid / QNAP Baseline |
| --- | --- | --- |
| Web admin UI | Yes | Yes |
| Authenticated dashboard | Yes | Yes |
| Service control UI | Yes | Yes |
| Multi-user roles for file access | Partial | Yes |
| Groups + folder ACLs | No | Yes |
| Per-share permissions | No | Yes |
| Quotas | No | Yes |
| SMB file sharing | No | Yes |
| NFS file sharing | No | Yes |
| iSCSI / block storage | No | Partial to Yes depending on product |
| Share abstraction | No | Yes |
| Storage pools / volumes | No | Yes |
| RAID / parity / mirror model | No | Yes |
| Checksum-based integrity | No | Yes on ZFS/Btrfs systems |
| Scrub / repair workflows | No | Yes |
| Snapshots | No | Yes |
| Versioning / recycle bin | No | Yes |
| Scheduled backups | No | Yes |
| Replication | No | Yes |
| Restore UI / restore flow | No | Yes |
| Search / indexing | No | Yes or Partial |
| Thumbnails / previews | No | Yes |
| Historical metrics | No | Yes or Partial |
| Alerts / notifications | No | Yes |
| Audit logs | Partial | Yes |
| Hardware health / SMART | No | Yes |
| HTTPS remote posture | Partial | Yes |
| Secure remote access product model | No | Yes |

## Missing Features And Shortcomings

### P0: Data Safety Gaps

These are the main reasons the system is not a production NAS.

1. **No storage integrity layer**
   - The system currently exposes raw mounted filesystems under `~/Drives`.
   - There is no checksum-based protection comparable to ZFS or Btrfs integrity features.
   - There is no periodic scrub or corruption-detection workflow.
   - Impact: silent corruption, partial media failure, and cross-drive inconsistency are not managed.

2. **No redundancy model**
   - No mirror, RAID, parity, or erasure-like protection exists.
   - A disk loss is a disk loss.
   - Impact: zero fault tolerance.

3. **No snapshots or point-in-time recovery**
   - No immutable snapshots
   - No point-in-time restore
   - No safe rollback after accidental edits, ransomware-style deletion, or user error
   - Impact: destructive file actions are final.

4. **No backup engine**
   - No scheduler
   - No retention model
   - No local/offsite backup target abstraction
   - No restore experience
   - Impact: this is a file host, not a recoverable storage platform.

5. **No versioning or recycle bin**
   - Delete is a hard delete.
   - Rename/move/cut flows have no built-in recovery history.
   - Impact: high operational risk for a shared system.

### P0: NAS Storage Model Gaps

6. **No storage abstraction layer**
   - The UI and backend operate directly on `~/Drives`.
   - Physical device names, mount names, and user-visible file roots are tightly coupled.
   - There is no “share”, “dataset”, “volume”, or “pool” layer separating hardware from user-facing paths.
   - Impact: weak manageability and poor long-term extensibility.

7. **No share model**
   - Production NAS systems expose managed shares with permissions, protocol settings, recycle-bin settings, quotas, indexing policy, snapshots, and backup policy.
   - Current system exposes directory trees directly.
   - Impact: hard to add policy, delegation, or safe multi-user access later.

8. **No pool or volume manager**
   - No concept of combining or partitioning storage as logical pools.
   - No storage provisioning lifecycle.
   - Impact: the system remains “mounted folders + UI”, not a storage platform.

### P0: Access Control Gaps

9. **Authentication exists, but authorization is still incomplete**
   - There is dashboard auth.
   - There is not yet a complete file-access authorization model across all file APIs.
   - No share-scoped policy model exists.
   - Impact: current auth is necessary but not sufficient for a real NAS.

10. **No groups, ACLs, or delegated permissions**
   - No user groups
   - No per-folder ACLs
   - No inheritance model
   - No read-only share enforcement for one user and read-write for another
   - Impact: multi-user storage collaboration is not production-ready.

11. **No quotas**
   - No per-user quota
   - No per-share quota
   - No reserve / hard-limit model
   - Impact: storage exhaustion and fairness are unmanaged.

### P0: NAS Protocol Gaps

12. **No SMB**
   - This is the single biggest interoperability gap for a home or office NAS.

13. **No NFS**
   - Important for Linux clients, containers, and appliance integrations.

14. **No iSCSI / block export**
   - Missing for virtualization or advanced storage use.

15. **FTP is not a NAS primary interface**
   - FTP support is useful as a compatibility or device workflow.
   - It is not an adequate replacement for SMB/NFS/WebDAV-like access patterns.

### P1: Recovery / Backup / Replication Gaps

16. **No backup policy engine**
   - No scheduled jobs
   - No retention policy
   - No target profiles
   - No encryption policy for backups

17. **No replication**
   - No local replica
   - No remote replica
   - No snapshot-based delta replication

18. **No restore UX**
   - No “restore previous version”
   - No file/folder level restore flow
   - No disaster-recovery workflow

### P1: Search, Previews, And Data Intelligence

19. **No indexing system**
   - No background filename index
   - No metadata database for fast search
   - No tags

20. **No preview pipeline**
   - No image thumbnailing
   - No video metadata extraction
   - No text/document previewing

21. **No background worker system**
   - Indexing, previews, backups, snapshot cleanup, and health scans all need durable background jobs.
   - The project currently has API-driven workflows, not a real job orchestration layer.

### P1: Security Gaps

22. **Remote security posture is incomplete**
   - Good: single public gateway design
   - Missing: default HTTPS termination, remote identity hardening, admin-audit completeness, IP-level response options, and secure-share model

23. **No full audit log**
   - Current logs are operational/debug oriented.
   - Production NAS requires “who accessed what, when, from where, and what changed”.

24. **Root helper boundary is still high risk**
   - Root is needed for some Android mount operations.
   - That is practical on this platform, but it is still a security and recovery risk.
   - Missing: formal boundary design, helper command constraints, and tamper-resistant auditing of privileged operations.

25. **No hardened secret/config lifecycle**
   - Env/bootstrap credentials are acceptable for development.
   - Production NAS needs secrets rotation, admin lifecycle controls, and safer credential management patterns.

### P1: Operations / Observability Gaps

26. **No historical metrics**
   - Current telemetry is current-state oriented.
   - Production NAS needs retained metrics history.

27. **No alerting**
   - No warning thresholds
   - No low-space, drive-health, service-crash, or failed-backup notifications

28. **No hardware health model**
   - No SMART checks
   - No disk temperature monitoring
   - No UPS integration
   - No thermal-policy response model

29. **No maintenance workflows**
   - No scrub scheduler
   - No integrity verification jobs
   - No health summary lifecycle

### P1: Product / UX Gaps

30. **No share-centric admin experience**
   - Production NAS products are organized around shares, users, apps, backup, storage pools, snapshots, permissions, and health.
   - Current project is still organized around files, services, and drive mounts.

31. **No onboarding for a non-technical admin**
   - No install wizard
   - No guided storage setup
   - No share setup wizard
   - No safe defaults walkthrough

32. **No mobile/desktop client story**
   - No sync client
   - No share client
   - No public link/download workflow

## Current Malpractices / Architecture Debt

These are not just “missing features”; they are design choices that should be corrected.

1. **Raw drive exposure as product surface**
   - Presenting `~/Drives` directly as the primary namespace is convenient but not a strong product abstraction.
   - It couples UI semantics to current mount details.

2. **Legacy naming debt**
   - Internal names like `FILEBROWSER_ROOT` still exist even though FileBrowser is removed.
   - This increases confusion and future maintenance cost.

3. **Policy and data model are not yet separated**
   - Filesystem actions exist before share/policy objects exist.
   - A production NAS should model shares, policies, principals, and storage objects explicitly.

4. **Platform privilege is carrying product design**
   - Root helpers are doing work that commercial NAS systems solve at the OS/storage layer.
   - This is acceptable for Android pragmatism, but it should not be mistaken for a clean long-term architecture.

5. **No durable task system**
   - Important workflows still depend on request/response style control rather than job orchestration.
   - That makes backups, indexing, preview generation, and repair workflows much harder.

6. **No explicit disaster-recovery strategy**
   - There is no documented recovery model for:
     - DB corruption
     - lost mount state
     - app reinstall
     - helper failure
     - device migration

## Android / Termux / Root Platform Constraints

This section is critical. Some gaps are not just missing code; they are consequences of the platform.

1. **Android is not a standard NAS OS**
   - It is weaker for long-running service supervision, storage administration, SMART access, kernel module behavior, and hardware lifecycle operations than Linux NAS systems.

2. **Root/FUSE/mount namespace complexity is structural**
   - The repo already needs privileged helper flows for some mount cases.
   - That increases failure modes and support complexity.

3. **External USB disk lifecycle is less predictable**
   - Android device enumeration, permission behavior, and filesystem support are less stable than purpose-built NAS OS storage stacks.

4. **Storage integrity features depend on host filesystem choices outside the app**
   - Commercial NAS products solve data integrity at the storage layer.
   - This project currently sits above whatever disks/filesystems Android presents.

5. **Production hardware operations are constrained**
   - SMART, drive bay lifecycle, UPS behavior, LED/warning integration, safe shutdown, and hot-swap workflows are not first-class here.

Practical implication:

- If the target remains Android, the product should be framed as a personal rooted storage appliance.
- If the target is true production NAS parity, replatforming should remain on the table.

## Ordered TODO Roadmap

This is ordered by dependency, not just importance.

### Phase A: Minimum “serious NAS” foundation

1. Introduce a storage abstraction layer
   - pools, volumes, shares, and policies
   - stop treating raw `~/Drives` layout as the product boundary

2. Implement full RBAC + file/share authorization
   - roles
   - groups
   - folder/share permissions
   - policy enforcement in every file API

3. Add a proper configuration system
   - validated settings model
   - durable migrations
   - secrets/config separation

4. Add audit logging
   - auth events
   - admin actions
   - file access and file mutation events

### Phase B: Data safety

5. Add recycle bin / soft delete
6. Add snapshots or versioned restore model
7. Add scheduled backup jobs
8. Add restore flows
9. Add integrity verification / hashing strategy

### Phase C: Storage productization

10. Build share manager UI/API
11. Add quotas
12. Add logical storage and health dashboard
13. Add disk health/SMART integration where platform allows
14. Add maintenance jobs and notifications

### Phase D: NAS interoperability

15. Add SMB
16. Add NFS
17. Evaluate WebDAV
18. Optionally add iSCSI for advanced use cases

### Phase E: Search and intelligence

19. Add job runner / worker queue
20. Add indexing database
21. Add previews/thumbnails
22. Add metadata search and tags

### Phase F: Security and remote access

23. Add HTTPS-first remote model
24. Add safer remote-access posture
25. Add alerting and security-event workflows
26. Harden root-helper command boundary and auditing

## Product Positioning Recommendation

### If you keep Android/Termux as the base

Position the product as:

- rooted Android home server
- personal NAS
- portable storage appliance
- advanced self-hosted dashboard over local/removable/networked storage

Do **not** position it as:

- enterprise NAS
- business NAS
- data-safe production appliance
- TrueNAS/Synology/QNAP replacement

### If you want true NAS parity

Then the eventual target platform should move toward:

- standard Linux storage stack
- native SMB/NFS services
- checksum-based storage layer
- snapshot and replication primitives at the OS/storage level

That does not invalidate the current work. It means the current repo is best viewed as a product and UX prototype plus appliance-control layer, not yet the full storage substrate.

## Go / No-Go For Production NAS Claim

### No-Go today because all of these are still missing

- storage integrity layer
- redundancy or mirror/parity
- snapshots/versioning/restore
- backup scheduler and restore workflows
- share abstraction
- SMB/NFS
- file-level authorization model with groups/ACLs
- historical metrics, alerts, and hardware health
- full audit trail

### Go later only when the minimum bar includes

- safe recovery from user error
- safe recovery from device/disk/service failure
- multi-user authorization at share/file layer
- standard NAS protocols
- operational visibility and alerts
- documented and tested recovery procedures

## Sources

Official sources used for comparison:

- Synology DSM user guide: https://global.download.synology.com/download/Document/Software/UserGuide/Os/DSM/7.2/enu/Syno_UsersGuide_NAServer_7_2_enu.pdf
- Synology DSM 7.0 user guide: https://global.download.synology.com/download/Document/Software/UserGuide/Os/DSM/7.0/enu/Syno_UsersGuide_NAServer_7.0_enu.pdf
- Synology Hyper Backup software specs: https://www.synology.com/en-af/dsm/7.3/software_spec/hyper_backup
- Synology Active Insight: https://www.synology.com/en-us/dsm/feature/active-insight
- Synology Hybrid Share specs: https://www.synology.com/en-af/dsm/7.1/software_spec/hybrid_share
- TrueNAS SCALE replication docs: https://www.truenas.com/docs/scale/24.04/scaletutorials/dataprotection/replication/advancedreplication/
- TrueNAS SCALE audit logging: https://cdn.truenas.com/docs/scale/scaletutorials/systemsettings/auditingscale/
- Unraid security fundamentals: https://docs.unraid.net/unraid-os/system-administration/secure-your-server/security-fundamentals/
- Unraid cache pools: https://docs.unraid.net/unraid-os/using-unraid-to/manage-storage/cache-pools/
- Unraid ZFS storage: https://docs.unraid.net/unraid-os/advanced-configurations/optimize-storage/zfs-storage/
- QNAP QTS user guide: https://docs.qnap.com/operating-system/qts/5.0.x/qts5.0.x-ug-en-us.pdf
- QNAP snapshots: https://www.qnap.com/go/software/snapshots
- QNAP Security Counselor: https://www.qnap.com/go/solution/security-counselor/
- QNAP product security: https://www.qnap.com/en/security
