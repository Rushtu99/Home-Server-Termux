# Media Stack Status

## Implemented

- Stable media share created at `/data/data/com.termux/files/home/Drives/Media`
- Media folders created:
  - `movies`
  - `series`
  - `downloads/movies`
  - `downloads/series`
  - `downloads/manual`
  - `iptv-cache`
  - `iptv-epg`
- Native service wrappers added:
  - `scripts/jellyfin-service.sh`
  - `scripts/qbittorrent-service.sh`
  - `scripts/redis-service.sh`
  - `scripts/postgres-service.sh`
  - `scripts/loopback-lockdown.sh`
- Backend service controller now exposes:
  - `redis`
  - `postgres`
  - `jellyfin`
  - `qbittorrent`
  - `sonarr`
  - `radarr`
  - `prowlarr`
  - `bazarr`
  - `jellyseerr`
- nginx routes added:
  - `/jellyfin/`
  - `/qb/`
  - `/sonarr/`
  - `/radarr/`
  - `/prowlarr/`
  - `/bazarr/`
  - `/requests/`

## Implemented In This Slice

- Root-chroot Servarr runner stabilized in `scripts/servarr-proot-service.sh`
- Environment leak fixed so Servarr apps no longer inherit the shell's stray `PORT`
- Cached media automation installer added and hardened in `scripts/install-media-automation.sh`
- Sonarr extracted into the Debian rootfs at `/opt/home-server/sonarr`
- Radarr extracted into the Debian rootfs at `/opt/home-server/radarr`
- Prowlarr extracted into the Debian rootfs at `/opt/home-server/prowlarr`
- Default installer path now stops at the working foundation:
  - Sonarr
  - Radarr
  - Prowlarr
  - Bazarr and Jellyseerr stay opt-in until their chroot install path exists

## Validated

- `redis` starts and answers `PONG`
- `postgres` initializes a local cluster and answers SQL queries
- `jellyfin` starts with explicit `DOTNET_ROOT` and Jellyfin-bundled ffmpeg
- `qbittorrent` starts and serves WebUI on the internal port
- `/jellyfin/web/` serves through nginx
- `/qb/` serves through nginx behind dashboard auth
- `Media` appears as a share in `/api/fs/list`
- `radarr` starts inside the Debian chroot and serves on `127.0.0.1:7878`
- `sonarr` starts inside the Debian chroot and serves on `127.0.0.1:8989`
- `prowlarr` starts inside the Debian chroot and serves on `127.0.0.1:9696`
- `/radarr/`, `/sonarr/`, and `/prowlarr/` return `401` through nginx when unauthenticated, which confirms auth-gated proxying is live

## Host Notes

- The Termux `ffmpeg` package is currently broken on this host due a library-linking issue.
- `jellyfin-ffmpeg` works and is used by Jellyfin instead.
- Jellyfin ignores loopback bind hints and still reports `0.0.0.0`; `scripts/loopback-lockdown.sh` applies root firewall rules to keep internal service ports behind nginx.
- Servarr apps do not run reliably under `proot` on this device because `getcwd()`-related paths break in that environment. Root `chroot` is the working runtime.

## Not Implemented Yet

- Bazarr
- Jellyseerr
- Custom IPTV API
- IPTV ingestion worker
- IPTV normalized M3U/XMLTV export

## Current Blockers

- Bazarr native Termux install is blocked by Python native-extension requirements:
  - `lxml` needs `libxml2` and `libxslt` development headers
  - practical next step: move Bazarr into the Debian chroot instead of using a Termux venv
- Jellyseerr native Termux install is blocked by Android-native Node module builds:
  - `@swc/core` falls back to wasm because no Android arm64 native binding exists
  - `bcrypt` falls back to `node-gyp` and then fails on Android-specific build variables
  - practical next step: move Jellyseerr into the Debian chroot with a Linux/glibc Node runtime
  - the default installer no longer attempts this broken native path automatically

## Current Routes

- Dashboard: `http://192.168.1.69:8088/`
- Filesystem: `http://192.168.1.69:8088/files`
- Jellyfin: `http://192.168.1.69:8088/jellyfin/`
- qBittorrent: `http://192.168.1.69:8088/qb/`
- Sonarr: `http://192.168.1.69:8088/sonarr/`
- Radarr: `http://192.168.1.69:8088/radarr/`
- Prowlarr: `http://192.168.1.69:8088/prowlarr/`
- Jellyseerr (planned): `http://192.168.1.69:8088/requests/`
