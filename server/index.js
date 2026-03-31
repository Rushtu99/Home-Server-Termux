const fs = require('fs');
const path = require('path');
const { loadEnvFile } = require('node:process');
const express = require('express');
const cors = require('cors');
const os = require('os');
const crypto = require('crypto');
const { exec, execFileSync } = require('child_process');
const net = require('net');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const jwt = require('jsonwebtoken');
const ftp = require('basic-ftp');
const { createAppDb, normalizeUsername, verifyPassword } = require('./app-db');

const ENV_FILE = path.resolve(__dirname, '.env');
if (typeof loadEnvFile === 'function' && fs.existsSync(ENV_FILE)) {
  loadEnvFile(ENV_FILE);
}

const parseDurationMs = (input, fallbackMs) => {
  const value = String(input || '').trim();
  if (!value) {
    return fallbackMs;
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackMs;
  }

  const match = value.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
const ROOT_DIR = path.resolve(__dirname, '..');
const HOME_DIR = process.env.HOME || '/data/data/com.termux/files/home';
const MEDIA_SERVICES_HOME = process.env.MEDIA_SERVICES_HOME || path.join(HOME_DIR, 'services');
const PROOT_DISTRO_ALIAS = process.env.PROOT_DISTRO_ALIAS || 'debian-hs';
const CHROOT_ROOTFS = process.env.CHROOT_ROOTFS || path.join('/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs', PROOT_DISTRO_ALIAS);
const FILEBROWSER_ROOT = process.env.FILEBROWSER_ROOT || path.join(HOME_DIR, 'Drives');
const FTP_ROOT = process.env.FTP_ROOT || FILEBROWSER_ROOT;
const FTP_CLIENT_DOWNLOAD_ROOT = process.env.FTP_CLIENT_DOWNLOAD_ROOT || FILEBROWSER_ROOT;
const MEDIA_SHARE_NAME = process.env.MEDIA_SHARE_NAME || 'Media';
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(FILEBROWSER_ROOT, MEDIA_SHARE_NAME);
const MEDIA_MOVIES_DIR = process.env.MEDIA_MOVIES_DIR || path.join(MEDIA_ROOT, 'movies');
const MEDIA_SERIES_DIR = process.env.MEDIA_SERIES_DIR || path.join(MEDIA_ROOT, 'series');
const MEDIA_DOWNLOADS_DIR = process.env.MEDIA_DOWNLOADS_DIR || path.join(MEDIA_ROOT, 'downloads');
const MEDIA_DOWNLOADS_MANUAL_DIR = process.env.MEDIA_DOWNLOADS_MANUAL_DIR || path.join(MEDIA_DOWNLOADS_DIR, 'manual');
const MEDIA_IPTV_CACHE_DIR = process.env.MEDIA_IPTV_CACHE_DIR || path.join(MEDIA_ROOT, 'iptv-cache');
const MEDIA_IPTV_EPG_DIR = process.env.MEDIA_IPTV_EPG_DIR || path.join(MEDIA_ROOT, 'iptv-epg');
const JELLYFIN_LIVE_TV_M3U_URL = process.env.JELLYFIN_LIVE_TV_M3U_URL || process.env.MEDIA_IPTV_PLAYLIST_URL || '';
const JELLYFIN_LIVE_TV_M3U_PATH = process.env.JELLYFIN_LIVE_TV_M3U_PATH || process.env.MEDIA_IPTV_PLAYLIST_PATH || path.join(MEDIA_IPTV_CACHE_DIR, 'playlist.m3u');
const JELLYFIN_LIVE_TV_XMLTV_URL = process.env.JELLYFIN_LIVE_TV_XMLTV_URL || process.env.MEDIA_IPTV_GUIDE_URL || '';
const JELLYFIN_LIVE_TV_XMLTV_PATH = process.env.JELLYFIN_LIVE_TV_XMLTV_PATH || process.env.MEDIA_IPTV_GUIDE_PATH || path.join(MEDIA_IPTV_EPG_DIR, 'guide.xml');
const JELLYFIN_HOME = process.env.JELLYFIN_HOME || path.join(MEDIA_SERVICES_HOME, 'jellyfin');
const JELLYFIN_DATA_DIR = process.env.JELLYFIN_DATA_DIR || path.join(JELLYFIN_HOME, 'data');
const JELLYFIN_DB_PATH = process.env.JELLYFIN_DB_PATH || path.join(JELLYFIN_DATA_DIR, 'data', 'jellyfin.db');
const JELLYFIN_LIVETV_METADATA_DIR = process.env.JELLYFIN_LIVETV_METADATA_DIR || path.join(JELLYFIN_DATA_DIR, 'metadata', 'views', 'livetv');
const QBITTORRENT_HOME = process.env.QBITTORRENT_HOME || path.join(MEDIA_SERVICES_HOME, 'qbittorrent');
const QBITTORRENT_CONFIG_PATH = process.env.QBITTORRENT_CONFIG_PATH || path.join(QBITTORRENT_HOME, 'qBittorrent', 'config', 'qBittorrent.conf');
const RUNTIME_DIR = process.env.RUNTIME_DIR || path.join(ROOT_DIR, 'runtime');
const APP_DB_PATH = process.env.APP_DB_PATH || path.join(RUNTIME_DIR, 'app.db');
const FTP_MOUNT_RUNTIME_DIR = process.env.FTP_MOUNT_RUNTIME_DIR || path.join(RUNTIME_DIR, 'ftp-mounts');
const TERMUX_CLOUD_MOUNT_CMD = process.env.TERMUX_CLOUD_MOUNT_CMD || '/data/data/com.termux/files/usr/bin/termux-cloud-mount';
const TERMUX_CLOUD_MOUNT_ROOT = process.env.TERMUX_CLOUD_MOUNT_ROOT || '/mnt/cloud/home-server';
const NGINX_PID = process.env.NGINX_PID_PATH || path.join(RUNTIME_DIR, 'nginx.pid');
const TTYD_PID = process.env.TTYD_PID_PATH || path.join(RUNTIME_DIR, 'ttyd.pid');
const FTP_PID = process.env.FTP_PID_PATH || path.join(RUNTIME_DIR, 'ftp.pid');
const SSHD_PID = process.env.SSHD_PID_PATH || path.join(RUNTIME_DIR, 'sshd.pid');
const COPYPARTY_PID = process.env.COPYPARTY_PID_PATH || path.join(RUNTIME_DIR, 'copyparty.pid');
const SYNCTHING_PID = process.env.SYNCTHING_PID_PATH || path.join(RUNTIME_DIR, 'syncthing.pid');
const SAMBA_PID = process.env.SAMBA_PID_PATH || path.join(RUNTIME_DIR, 'samba.pid');
const JELLYFIN_PID = process.env.JELLYFIN_PID_PATH || path.join(RUNTIME_DIR, 'jellyfin.pid');
const QBITTORRENT_PID = process.env.QBITTORRENT_PID_PATH || path.join(RUNTIME_DIR, 'qbittorrent.pid');
const REDIS_PID = process.env.REDIS_PID_PATH || path.join(RUNTIME_DIR, 'redis.pid');
const POSTGRES_PID = process.env.POSTGRES_PID_PATH || path.join(RUNTIME_DIR, 'postgres.pid');
const SONARR_PID = process.env.SONARR_PID_PATH || path.join(RUNTIME_DIR, 'sonarr.pid');
const RADARR_PID = process.env.RADARR_PID_PATH || path.join(RUNTIME_DIR, 'radarr.pid');
const PROWLARR_PID = process.env.PROWLARR_PID_PATH || path.join(RUNTIME_DIR, 'prowlarr.pid');
const BAZARR_PID = process.env.BAZARR_PID_PATH || path.join(RUNTIME_DIR, 'bazarr.pid');
const JELLYSEERR_PID = process.env.JELLYSEERR_PID_PATH || path.join(RUNTIME_DIR, 'jellyseerr.pid');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const PORT = Number(process.env.PORT || 4000);
const BACKEND_BIND_HOST = process.env.BACKEND_BIND_HOST || '127.0.0.1';
const TTYD_BIND_HOST = process.env.TTYD_BIND_HOST || '127.0.0.1';
const FTP_BIND_HOST = process.env.FTP_BIND_HOST || '127.0.0.1';
const COPYPARTY_BIND_HOST = process.env.COPYPARTY_BIND_HOST || '127.0.0.1';
const SYNCTHING_GUI_BIND_HOST = process.env.SYNCTHING_GUI_BIND_HOST || '127.0.0.1';
const JELLYFIN_BIND_HOST = process.env.JELLYFIN_BIND_HOST || '127.0.0.1';
const QBITTORRENT_BIND_HOST = process.env.QBITTORRENT_BIND_HOST || '127.0.0.1';
const REDIS_BIND_HOST = process.env.REDIS_BIND_HOST || '127.0.0.1';
const POSTGRES_BIND_HOST = process.env.POSTGRES_BIND_HOST || '127.0.0.1';
const SONARR_BIND_HOST = process.env.SONARR_BIND_HOST || '127.0.0.1';
const RADARR_BIND_HOST = process.env.RADARR_BIND_HOST || '127.0.0.1';
const PROWLARR_BIND_HOST = process.env.PROWLARR_BIND_HOST || '127.0.0.1';
const BAZARR_BIND_HOST = process.env.BAZARR_BIND_HOST || '127.0.0.1';
const JELLYSEERR_BIND_HOST = process.env.JELLYSEERR_BIND_HOST || '127.0.0.1';
const FTP_SERVER_PORT = Number(process.env.FTP_SERVER_PORT || 2121);
const COPYPARTY_PORT = Number(process.env.COPYPARTY_PORT || 3923);
const SYNCTHING_GUI_PORT = Number(process.env.SYNCTHING_GUI_PORT || 8384);
const SAMBA_PORT = Number(process.env.SAMBA_PORT || 445);
const JELLYFIN_PORT = Number(process.env.JELLYFIN_PORT || 8096);
const QBITTORRENT_PORT = Number(process.env.QBITTORRENT_PORT || 8081);
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT || 5432);
const SONARR_PORT = Number(process.env.SONARR_PORT || 8989);
const RADARR_PORT = Number(process.env.RADARR_PORT || 7878);
const PROWLARR_PORT = Number(process.env.PROWLARR_PORT || 9696);
const BAZARR_PORT = Number(process.env.BAZARR_PORT || 6767);
const JELLYSEERR_PORT = Number(process.env.JELLYSEERR_PORT || 5055);
const DEFAULT_PS4_FTP_NAME = process.env.DEFAULT_PS4_FTP_NAME || 'PS4';
const DEFAULT_PS4_HOST = process.env.DEFAULT_PS4_HOST || '192.168.1.8';
const DEFAULT_PS4_PORT = Number(process.env.DEFAULT_PS4_PORT || 2121);
const DEFAULT_PS4_USER = process.env.DEFAULT_PS4_USER || 'anonymous';
const DEFAULT_PS4_PASSWORD = process.env.DEFAULT_PS4_PASSWORD || 'anonymous@';
const DRIVE_AGENT_CMD = process.env.DRIVE_AGENT_CMD || '/data/data/com.termux/files/usr/bin/termux-drive-agent';
const DRIVE_STATE_PATH = process.env.DRIVE_STATE_PATH || path.join(FILEBROWSER_ROOT, '.state', 'drives.json');
const DRIVE_EVENTS_PATH = process.env.DRIVE_EVENTS_PATH || path.join(FILEBROWSER_ROOT, '.state', 'drive-events.jsonl');
const DRIVE_REFRESH_INTERVAL_MS = Math.max(60000, Number(process.env.DRIVE_REFRESH_INTERVAL_MS || 60000) || 60000);
const SSHD_BIND_HOST = process.env.SSHD_BIND_HOST || '127.0.0.1';
const SSHD_PORT = Number(process.env.SSHD_PORT || 8022);
const ENABLE_SSHD = process.env.ENABLE_SSHD === 'true';
const COPYPARTY_BASE_PATH = process.env.COPYPARTY_BASE_PATH || '/copyparty';
const SYNCTHING_BASE_PATH = process.env.SYNCTHING_BASE_PATH || '/syncthing';
const SYNCTHING_HOME = process.env.SYNCTHING_HOME || path.join(RUNTIME_DIR, 'syncthing');
const SAMBA_SERVICE_CMD = process.env.SAMBA_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'samba-service.sh');
const COPYPARTY_SERVICE_CMD = process.env.COPYPARTY_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'copyparty-service.sh');
const SYNCTHING_SERVICE_CMD = process.env.SYNCTHING_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'syncthing-service.sh');
const JELLYFIN_SERVICE_CMD = process.env.JELLYFIN_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'jellyfin-service.sh');
const QBITTORRENT_SERVICE_CMD = process.env.QBITTORRENT_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'qbittorrent-service.sh');
const REDIS_SERVICE_CMD = process.env.REDIS_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'redis-service.sh');
const POSTGRES_SERVICE_CMD = process.env.POSTGRES_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'postgres-service.sh');
const SONARR_SERVICE_CMD = process.env.SONARR_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'sonarr-service.sh');
const RADARR_SERVICE_CMD = process.env.RADARR_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'radarr-service.sh');
const PROWLARR_SERVICE_CMD = process.env.PROWLARR_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'prowlarr-service.sh');
const BAZARR_SERVICE_CMD = process.env.BAZARR_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'bazarr-service.sh');
const JELLYSEERR_SERVICE_CMD = process.env.JELLYSEERR_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'jellyseerr-service.sh');
const SONARR_BASE_PATH = process.env.SONARR_BASE_PATH || '/sonarr';
const RADARR_BASE_PATH = process.env.RADARR_BASE_PATH || '/radarr';
const PROWLARR_BASE_PATH = process.env.PROWLARR_BASE_PATH || '/prowlarr';
const BAZARR_BASE_PATH = process.env.BAZARR_BASE_PATH || '/bazarr';
const JELLYSEERR_BASE_PATH = process.env.JELLYSEERR_BASE_PATH || '/requests';
const SONARR_APP_PATH = path.join(CHROOT_ROOTFS, 'opt', 'home-server', 'sonarr', 'app', 'Sonarr');
const RADARR_APP_PATH = path.join(CHROOT_ROOTFS, 'opt', 'home-server', 'radarr', 'app', 'Radarr');
const PROWLARR_APP_PATH = path.join(CHROOT_ROOTFS, 'opt', 'home-server', 'prowlarr', 'app', 'Prowlarr');
const BAZARR_HOME = process.env.BAZARR_HOME || path.join(MEDIA_SERVICES_HOME, 'bazarr');
const BAZARR_PYTHON_PATH = path.join(BAZARR_HOME, 'venv', 'bin', 'python');
const BAZARR_APP_PATH = path.join(BAZARR_HOME, 'app', 'bazarr.py');
const JELLYSEERR_HOME = process.env.JELLYSEERR_HOME || path.join(MEDIA_SERVICES_HOME, 'jellyseerr');
const JELLYSEERR_DIST_PATH = path.join(JELLYSEERR_HOME, 'app', 'dist', 'index.js');
const BOOTSTRAP_DASHBOARD_USER = normalizeUsername(process.env.DASHBOARD_USER || 'admin') || 'admin';
const BOOTSTRAP_DASHBOARD_PASS = process.env.DASHBOARD_PASS || 'admin123';
const ADMIN_ACTION_PASSWORD = process.env.ADMIN_ACTION_PASSWORD || BOOTSTRAP_DASHBOARD_PASS;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const TOKEN_TTL = process.env.TOKEN_TTL || '12h';
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'hs_jwt';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '';
const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'lax';
const DEFAULT_EXEC_SHELL = fs.existsSync('/data/data/com.termux/files/usr/bin/bash')
  ? '/data/data/com.termux/files/usr/bin/bash'
  : '/bin/sh';
const EXEC_SHELL = process.env.EXEC_SHELL || DEFAULT_EXEC_SHELL;
const STORAGE_FS_TYPES = new Set(['ext2', 'ext3', 'ext4', 'f2fs', 'xfs', 'btrfs', 'ntfs', 'exfat', 'vfat', 'fuse']);
const CONNECTION_TTL_MS = 10 * 60 * 1000;
const MAX_CONNECTIONS = 50;
const FTP_CLIENT_TIMEOUT_MS = 15000;
const SESSION_IDLE_TIMEOUT_MS = parseDurationMs(process.env.SESSION_IDLE_TIMEOUT || '30m', 30 * 60 * 1000);
const SESSION_ABSOLUTE_TIMEOUT_MS = parseDurationMs(process.env.SESSION_ABSOLUTE_TIMEOUT || TOKEN_TTL, 12 * 60 * 60 * 1000);
const MAX_ACTIVE_SESSIONS = Math.max(1, Number(process.env.MAX_ACTIVE_SESSIONS || 4));
const LOGIN_WINDOW_MS = parseDurationMs(process.env.LOGIN_WINDOW || '10m', 10 * 60 * 1000);
const LOGIN_BLOCK_MS = parseDurationMs(process.env.LOGIN_BLOCK_DURATION || '15m', 15 * 60 * 1000);
const LOGIN_MAX_ATTEMPTS = Math.max(1, Number(process.env.LOGIN_MAX_ATTEMPTS || 5));
const NGINX_CMD = `nginx -p "${ROOT_DIR}" -c "${ROOT_DIR}/nginx.conf"`;
const NGINX_MATCH = `nginx -p ${ROOT_DIR} -c ${ROOT_DIR}/nginx.conf`;
const stopPidfileProcess = (pidPath, fallback = '') =>
  `if [ -f "${pidPath}" ]; then pid="$(cat "${pidPath}" 2>/dev/null || true)"; if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill "$pid" >/dev/null 2>&1 || true; sleep 1; if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" >/dev/null 2>&1 || true; fi; fi; rm -f "${pidPath}"; fi${fallback ? `; ${fallback}` : ''}`;
const checkPidfileProcess = (pidPath, fallback = '') =>
  `test -f "${pidPath}" && kill -0 "$(cat "${pidPath}")" >/dev/null 2>&1${fallback ? ` || ${fallback}` : ''}`;
const detachCommand = (pidPath, command) => `nohup sh -c '${command}' >/dev/null 2>&1 & echo $! > "${pidPath}"`;
const appDb = createAppDb({ dbPath: APP_DB_PATH });
const adminBootstrap = appDb.bootstrapAdmin({
  username: BOOTSTRAP_DASHBOARD_USER,
  password: BOOTSTRAP_DASHBOARD_PASS,
  role: 'admin',
});

if (adminBootstrap.seeded) {
  console.info(`[auth] Seeded initial admin user '${adminBootstrap.username}' in ${APP_DB_PATH}`);
}

fs.mkdirSync(FTP_MOUNT_RUNTIME_DIR, { recursive: true });

if (CORS_ORIGIN) {
  const allowList = CORS_ORIGIN
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowList.length > 0) {
    app.use(cors({ origin: allowList, credentials: true }));
  }
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    res.setHeader('Cache-Control', 'no-store');
  }

  next();
});

app.use(express.json({ limit: '256kb' }));

const authError = { error: 'Unauthorized' };

/* ---------------- CONFIG ---------------- */

// Keep dashboard-controlled processes repo-local and pid-backed so service actions
// do not accidentally target unrelated Termux processes with generic names.
const SERVICES = {
  nginx: {
    start: `mkdir -p "${ROOT_DIR}/logs" "${RUNTIME_DIR}" && ${NGINX_CMD}`,
    stop: `if [ -f "${NGINX_PID}" ]; then ${NGINX_CMD} -s quit >/dev/null 2>&1 || true; fi; pkill -f '${NGINX_MATCH}' 2>/dev/null || true; rm -f "${NGINX_PID}"`,
    restart: `if [ -f "${NGINX_PID}" ]; then ${NGINX_CMD} -s quit >/dev/null 2>&1 || true; fi; pkill -f '${NGINX_MATCH}' 2>/dev/null || true; rm -f "${NGINX_PID}"; mkdir -p "${ROOT_DIR}/logs" "${RUNTIME_DIR}" && ${NGINX_CMD}`,
    check: `test -f "${NGINX_PID}" && kill -0 "$(cat "${NGINX_PID}")"`,
    host: '127.0.0.1',
    port: 8088,
    binary: 'nginx',
  },
  ttyd: {
    start: `mkdir -p "${ROOT_DIR}/logs" && ${detachCommand(TTYD_PID, `exec ttyd -W -i "${TTYD_BIND_HOST}" -p 7681 -w "${ROOT_DIR}" bash -l > "${ROOT_DIR}/logs/ttyd.log" 2>&1`)}`,
    stop: stopPidfileProcess(TTYD_PID),
    restart: `${stopPidfileProcess(TTYD_PID)}; mkdir -p "${ROOT_DIR}/logs" && ${detachCommand(TTYD_PID, `exec ttyd -W -i "${TTYD_BIND_HOST}" -p 7681 -w "${ROOT_DIR}" bash -l > "${ROOT_DIR}/logs/ttyd.log" 2>&1`)}`,
    check: checkPidfileProcess(TTYD_PID),
    host: TTYD_BIND_HOST,
    port: 7681,
    binary: 'ttyd',
  },
  sshd: {
    start: ENABLE_SSHD
      ? `mkdir -p "${RUNTIME_DIR}" "${ROOT_DIR}/logs" && ${detachCommand(SSHD_PID, `exec sshd -D -E "${ROOT_DIR}/logs/sshd.log" -o ListenAddress="${SSHD_BIND_HOST}" -o Port="${SSHD_PORT}" > "${ROOT_DIR}/logs/sshd-stdout.log" 2>&1`)}`
      : 'echo "sshd disabled in single-port mode"',
    stop: stopPidfileProcess(SSHD_PID),
    restart: ENABLE_SSHD
      ? `${stopPidfileProcess(SSHD_PID)}; mkdir -p "${RUNTIME_DIR}" "${ROOT_DIR}/logs" && ${detachCommand(SSHD_PID, `exec sshd -D -E "${ROOT_DIR}/logs/sshd.log" -o ListenAddress="${SSHD_BIND_HOST}" -o Port="${SSHD_PORT}" > "${ROOT_DIR}/logs/sshd-stdout.log" 2>&1`)}`
      : 'echo "sshd disabled in single-port mode"',
    check: checkPidfileProcess(SSHD_PID),
    host: SSHD_BIND_HOST,
    port: SSHD_PORT,
    binary: 'sshd',
  },
  ftp: {
    start: `mkdir -p "${ROOT_DIR}/logs" && if command -v python3 >/dev/null 2>&1 && python3 -c "import pyftpdlib" >/dev/null 2>&1; then ${detachCommand(FTP_PID, `exec python3 -m pyftpdlib -i "${FTP_BIND_HOST}" -p "${FTP_SERVER_PORT}" -w -d "${FTP_ROOT}" > "${ROOT_DIR}/logs/ftp.log" 2>&1`)}; elif command -v busybox >/dev/null 2>&1; then ${detachCommand(FTP_PID, `exec busybox tcpsvd -vE "${FTP_BIND_HOST}" "${FTP_SERVER_PORT}" busybox ftpd -w "${FTP_ROOT}" > "${ROOT_DIR}/logs/ftp.log" 2>&1`)}; else echo "No supported FTP server found (install pyftpdlib or busybox)"; exit 1; fi`,
    stop: stopPidfileProcess(FTP_PID),
    restart: `${stopPidfileProcess(FTP_PID)}; mkdir -p "${ROOT_DIR}/logs" && if command -v python3 >/dev/null 2>&1 && python3 -c "import pyftpdlib" >/dev/null 2>&1; then ${detachCommand(FTP_PID, `exec python3 -m pyftpdlib -i "${FTP_BIND_HOST}" -p "${FTP_SERVER_PORT}" -w -d "${FTP_ROOT}" > "${ROOT_DIR}/logs/ftp.log" 2>&1`)}; elif command -v busybox >/dev/null 2>&1; then ${detachCommand(FTP_PID, `exec busybox tcpsvd -vE "${FTP_BIND_HOST}" "${FTP_SERVER_PORT}" busybox ftpd -w "${FTP_ROOT}" > "${ROOT_DIR}/logs/ftp.log" 2>&1`)}; else echo "No supported FTP server found (install pyftpdlib or busybox)"; exit 1; fi`,
    check: checkPidfileProcess(FTP_PID),
    host: FTP_BIND_HOST,
    port: FTP_SERVER_PORT,
    binary: 'python3',
  },
  copyparty: {
    start: `"${COPYPARTY_SERVICE_CMD}" start`,
    stop: `"${COPYPARTY_SERVICE_CMD}" stop`,
    restart: `"${COPYPARTY_SERVICE_CMD}" restart`,
    check: `"${COPYPARTY_SERVICE_CMD}" status`,
    host: COPYPARTY_BIND_HOST,
    port: COPYPARTY_PORT,
    binary: 'copyparty',
  },
  syncthing: {
    start: `"${SYNCTHING_SERVICE_CMD}" start`,
    stop: `"${SYNCTHING_SERVICE_CMD}" stop`,
    restart: `"${SYNCTHING_SERVICE_CMD}" restart`,
    check: `"${SYNCTHING_SERVICE_CMD}" status`,
    host: SYNCTHING_GUI_BIND_HOST,
    port: SYNCTHING_GUI_PORT,
    binary: 'syncthing',
  },
  samba: {
    start: `mkdir -p "${ROOT_DIR}/logs" "${RUNTIME_DIR}" && "${SAMBA_SERVICE_CMD}" start`,
    stop: `"${SAMBA_SERVICE_CMD}" stop`,
    restart: `"${SAMBA_SERVICE_CMD}" restart`,
    check: `"${SAMBA_SERVICE_CMD}" status`,
    host: '127.0.0.1',
    port: SAMBA_PORT,
    binary: 'smbd',
  },
  redis: {
    start: `"${REDIS_SERVICE_CMD}" start`,
    stop: `"${REDIS_SERVICE_CMD}" stop`,
    restart: `"${REDIS_SERVICE_CMD}" restart`,
    check: `"${REDIS_SERVICE_CMD}" status`,
    host: REDIS_BIND_HOST,
    port: REDIS_PORT,
    binary: 'redis-server',
  },
  postgres: {
    start: `"${POSTGRES_SERVICE_CMD}" start`,
    stop: `"${POSTGRES_SERVICE_CMD}" stop`,
    restart: `"${POSTGRES_SERVICE_CMD}" restart`,
    check: `"${POSTGRES_SERVICE_CMD}" status`,
    host: POSTGRES_BIND_HOST,
    port: POSTGRES_PORT,
    binary: 'postgres',
  },
  jellyfin: {
    start: `"${JELLYFIN_SERVICE_CMD}" start`,
    stop: `"${JELLYFIN_SERVICE_CMD}" stop`,
    restart: `"${JELLYFIN_SERVICE_CMD}" restart`,
    check: `"${JELLYFIN_SERVICE_CMD}" status`,
    host: JELLYFIN_BIND_HOST,
    port: JELLYFIN_PORT,
    binary: 'jellyfin',
  },
  qbittorrent: {
    start: `"${QBITTORRENT_SERVICE_CMD}" start`,
    stop: `"${QBITTORRENT_SERVICE_CMD}" stop`,
    restart: `"${QBITTORRENT_SERVICE_CMD}" restart`,
    check: `"${QBITTORRENT_SERVICE_CMD}" status`,
    host: QBITTORRENT_BIND_HOST,
    port: QBITTORRENT_PORT,
    binary: 'qbittorrent-nox',
  },
  sonarr: {
    start: `"${SONARR_SERVICE_CMD}" start`,
    stop: `"${SONARR_SERVICE_CMD}" stop`,
    restart: `"${SONARR_SERVICE_CMD}" restart`,
    check: `"${SONARR_SERVICE_CMD}" status`,
    host: SONARR_BIND_HOST,
    port: SONARR_PORT,
    binary: 'Sonarr',
    installCheckPaths: [SONARR_SERVICE_CMD, SONARR_APP_PATH],
  },
  radarr: {
    start: `"${RADARR_SERVICE_CMD}" start`,
    stop: `"${RADARR_SERVICE_CMD}" stop`,
    restart: `"${RADARR_SERVICE_CMD}" restart`,
    check: `"${RADARR_SERVICE_CMD}" status`,
    host: RADARR_BIND_HOST,
    port: RADARR_PORT,
    binary: 'Radarr',
    installCheckPaths: [RADARR_SERVICE_CMD, RADARR_APP_PATH],
  },
  prowlarr: {
    start: `"${PROWLARR_SERVICE_CMD}" start`,
    stop: `"${PROWLARR_SERVICE_CMD}" stop`,
    restart: `"${PROWLARR_SERVICE_CMD}" restart`,
    check: `"${PROWLARR_SERVICE_CMD}" status`,
    host: PROWLARR_BIND_HOST,
    port: PROWLARR_PORT,
    binary: 'Prowlarr',
    installCheckPaths: [PROWLARR_SERVICE_CMD, PROWLARR_APP_PATH],
  },
  bazarr: {
    start: `"${BAZARR_SERVICE_CMD}" start`,
    stop: `"${BAZARR_SERVICE_CMD}" stop`,
    restart: `"${BAZARR_SERVICE_CMD}" restart`,
    check: `"${BAZARR_SERVICE_CMD}" status`,
    host: BAZARR_BIND_HOST,
    port: BAZARR_PORT,
    binary: 'python',
    installCheckPaths: [BAZARR_SERVICE_CMD, BAZARR_PYTHON_PATH, BAZARR_APP_PATH],
    installCheckCommand: `"${BAZARR_PYTHON_PATH}" -c "import lxml"`,
  },
  jellyseerr: {
    start: `"${JELLYSEERR_SERVICE_CMD}" start`,
    stop: `"${JELLYSEERR_SERVICE_CMD}" stop`,
    restart: `"${JELLYSEERR_SERVICE_CMD}" restart`,
    check: `"${JELLYSEERR_SERVICE_CMD}" status`,
    host: JELLYSEERR_BIND_HOST,
    port: JELLYSEERR_PORT,
    binary: 'node',
    installCheckPaths: [JELLYSEERR_SERVICE_CMD, JELLYSEERR_DIST_PATH],
  },
};

// The dashboard renders service tabs from this catalog instead of inferring
// labels, grouping, or control rules in the client.
const SERVICE_CATALOG_META = {
  nginx: {
    controlMode: 'always_on',
    description: 'Single public gateway for the dashboard and companion services.',
    group: 'platform',
    label: 'nginx',
    surface: 'home',
  },
  ttyd: {
    controlMode: 'always_on',
    description: 'Browser terminal access inside the dashboard.',
    group: 'platform',
    label: 'ttyd',
    route: '/term/',
    surface: 'terminal',
  },
  sshd: {
    controlMode: 'optional',
    description: 'Shell access for maintenance and recovery.',
    group: 'access',
    label: 'sshd',
    surface: 'home',
  },
  ftp: {
    controlMode: 'optional',
    description: 'Legacy remote access and PS4-compatible transfer path.',
    group: 'access',
    label: 'FTP',
    surface: 'ftp',
  },
  copyparty: {
    controlMode: 'optional',
    description: 'High-throughput uploads, drop folders, and browser-based transfer.',
    group: 'access',
    label: 'copyparty',
    route: '/copyparty/',
    surface: 'home',
  },
  syncthing: {
    controlMode: 'optional',
    description: 'Device sync and backup across phones, laptops, and shares.',
    group: 'access',
    label: 'Syncthing',
    surface: 'home',
  },
  samba: {
    controlMode: 'optional',
    description: 'LAN file sharing for desktop and TV clients.',
    group: 'access',
    label: 'Samba',
    surface: 'home',
  },
  redis: {
    controlMode: 'always_on',
    description: 'Cache and worker coordination for IPTV and background jobs.',
    group: 'data',
    label: 'Redis',
    surface: 'media',
  },
  postgres: {
    controlMode: 'always_on',
    description: 'Persistent database for IPTV services and future media metadata.',
    group: 'data',
    label: 'PostgreSQL',
    surface: 'media',
  },
  jellyfin: {
    controlMode: 'always_on',
    description: 'Streams your movie and series library to local clients.',
    group: 'media',
    label: 'Jellyfin',
    route: '/jellyfin/',
    surface: 'media',
  },
  qbittorrent: {
    controlMode: 'always_on',
    description: 'Handles automated and manual torrent downloads inside the dedicated downloads workspace.',
    group: 'downloads',
    label: 'qBittorrent',
    route: '/qb/',
    surface: 'downloads',
  },
  sonarr: {
    controlMode: 'always_on',
    description: 'Automates series discovery, tracking, and download handoff.',
    group: 'arr',
    label: 'Sonarr',
    route: '/sonarr/',
    surface: 'arr',
  },
  radarr: {
    controlMode: 'always_on',
    description: 'Automates movie discovery, tracking, and download handoff.',
    group: 'arr',
    label: 'Radarr',
    route: '/radarr/',
    surface: 'arr',
  },
  prowlarr: {
    controlMode: 'always_on',
    description: 'Central indexer manager for Sonarr and Radarr.',
    group: 'arr',
    label: 'Prowlarr',
    route: '/prowlarr/',
    surface: 'arr',
  },
  bazarr: {
    controlMode: 'always_on',
    description: 'Subtitle automation for imported media libraries.',
    group: 'arr',
    label: 'Bazarr',
    surface: 'arr',
  },
  jellyseerr: {
    controlMode: 'always_on',
    description: 'Request portal for adding movies and shows into the automation flow.',
    group: 'media',
    label: 'Jellyseerr',
    route: '/requests/',
    surface: 'media',
  },
};

/* ---------------- HELPERS ---------------- */

const debugEvents = [];
const recentConnections = new Map();
const activeSessions = new Map();
const unlockedServiceControllers = new Map();
const loginAttempts = new Map();
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
const MAX_DEBUG_EVENTS = 300;
let cpuSnapshot = null;
let verboseLoggingEnabled = appDb.getBooleanSetting('logging.verboseEnabled', false);
const serviceStateCache = {};
const serviceHealthHistory = {};
let ftpProviderCache = {
  checkedAt: 0,
  provider: null,
};
let networkSnapshotCache = null;
const localProbeCache = {
  jellyfinLiveTv: { expiresAt: 0, value: null },
  qbittorrentConfig: { expiresAt: 0, value: null },
};
const timedCache = {
  monitor: { expiresAt: 0, value: null, promise: null },
  services: { expiresAt: 0, value: null, promise: null },
  storage: { expiresAt: 0, value: null, promise: null },
};

const ADMIN_ROLES = new Set(['admin']);
const RECYCLE_BIN_NAME = '.recycle-bin';
const OPTIONAL_SERVICE_NAMES = [
  'ftp',
  'copyparty',
  'syncthing',
  'samba',
  'sshd',
];
const OPTIONAL_SERVICE_SET = new Set(OPTIONAL_SERVICE_NAMES);
const PLACEHOLDER_SERVICE_SET = new Set(['bazarr', 'jellyseerr']);
const SERVICE_GROUP_ORDER = ['platform', 'media', 'arr', 'data', 'downloads', 'filesystem', 'access'];
const SERVICE_UNLOCK_TTL_MS = parseDurationMs(process.env.SERVICE_UNLOCK_TTL || '8h', 8 * 60 * 60 * 1000);
const SERVICE_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_HISTORY_LIMIT = 400;

eventLoopDelay.enable();

const pushDebugEvent = (level, message, meta = undefined, force = false) => {
  if (!verboseLoggingEnabled && !force && level !== 'error') {
    return;
  }

  debugEvents.push({
    timestamp: new Date().toISOString(),
    level,
    message,
    meta: meta || null,
  });

  if (debugEvents.length > MAX_DEBUG_EVENTS) {
    debugEvents.splice(0, debugEvents.length - MAX_DEBUG_EVENTS);
  }
};

const getRequestActor = (req) => ({
  ip: normalizeIp(req?.ip || req?.socket?.remoteAddress || ''),
  role: String(req?.user?.role || req?.session?.role || 'guest'),
  sessionId: String(req?.session?.id || ''),
  userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 200),
  username: String(req?.user?.sub || req?.session?.username || 'anonymous'),
});

const mergeAuditMeta = (req, meta = undefined) => {
  const actor = getRequestActor(req);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { actor };
  }

  return {
    actor,
    ...meta,
  };
};

const pushAuditEvent = (req, level, message, meta = undefined, force = true) => {
  pushDebugEvent(level, message, mergeAuditMeta(req, meta), force);
};

const buildMarkdownLog = (limit = 60) => {
  const recent = debugEvents.slice(-limit);
  const lines = recent.map((entry) => {
    const metaText = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
    return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}${metaText}`;
  });
  const counts = recent.reduce((acc, entry) => {
    acc[entry.level] = (acc[entry.level] || 0) + 1;
    return acc;
  }, {});
  const summary = `info=${counts.info || 0}, warn=${counts.warn || 0}, error=${counts.error || 0}`;

  return `### Debug Summary\n- entries: ${recent.length}\n- ${summary}\n\n\`\`\`log\n${lines.join('\n')}\n\`\`\``;
};

const readCpuSnapshot = () => {
  const cpus = os.cpus();
  if (!Array.isArray(cpus) || cpus.length === 0) {
    return null;
  }

  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }

  return { idle, total };
};

const readTopCpuUsage = async () => {
  const output = await runCommand('top -b -n 1');
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const cpuLine = lines.find((line) => /%cpu/i.test(line));
  const headerIndex = lines.findIndex((line) => /%CPU/i.test(line));

  if (headerIndex === -1) {
    return 0;
  }

  const totalCapacity = Number(cpuLine?.match(/(\d+(?:\.\d+)?)%cpu/i)?.[1] || 0);
  const processLoad = lines
    .slice(headerIndex + 1)
    .reduce((sum, line) => {
      const parts = line.split(/\s+/);
      const cpuValue = Number(parts[8]);
      return Number.isFinite(cpuValue) ? sum + cpuValue : sum;
    }, 0);

  if (totalCapacity > 0) {
    return Math.max(0, Math.min(100, (processLoad / totalCapacity) * 100));
  }

  return Math.max(0, Math.min(100, processLoad));
};

const readCpuUsage = async () => {
  const current = readCpuSnapshot();

  if (!current) {
    return readTopCpuUsage();
  }

  if (!cpuSnapshot) {
    cpuSnapshot = current;
    return 0;
  }

  const idleDiff = current.idle - cpuSnapshot.idle;
  const totalDiff = current.total - cpuSnapshot.total;
  cpuSnapshot = current;

  if (totalDiff <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (1 - idleDiff / totalDiff) * 100));
};

const runCommand = (cmd) =>
  new Promise((resolve, reject) => {
    exec(cmd, { timeout: 15000, maxBuffer: 1024 * 1024, shell: EXEC_SHELL }, (err, stdout, stderr) => {
      if (err) {
        return reject(stderr?.trim() || stdout?.trim() || err.message);
      }

      resolve(stdout?.trim() || '');
    });
  });

const commandExists = async (cmd) => {
  try {
    await runCommand(`command -v "${cmd}"`);
    return true;
  } catch {
    return false;
  }
};

const fileIsExecutable = (filePath) => {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const firstExistingFile = (directoryPath, extensions) => {
  try {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    const match = entries.find((entry) =>
      entry.isFile() && extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))
    );
    return match ? path.join(directoryPath, match.name) : null;
  } catch {
    return null;
  }
};

const resolveMediaSource = (explicitUrl, explicitPath, directoryPath, extensions) => {
  if (String(explicitUrl || '').trim()) {
    return String(explicitUrl).trim();
  }

  if (String(explicitPath || '').trim() && fs.existsSync(explicitPath)) {
    return explicitPath;
  }

  return firstExistingFile(directoryPath, extensions);
};

const withLocalProbeCache = (cacheKey, ttlMs, loader) => {
  const cache = localProbeCache[cacheKey];
  const now = Date.now();
  if (cache.value && cache.expiresAt > now) {
    return cache.value;
  }

  const value = loader();
  cache.value = value;
  cache.expiresAt = now + ttlMs;
  return value;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const countVisibleDescendants = (directoryPath, maxDepth = 4) => {
  if (maxDepth < 0) {
    return 0;
  }

  try {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    return entries.reduce((count, entry) => {
      if (entry.name.startsWith('.')) {
        return count;
      }

      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return count + 1 + countVisibleDescendants(entryPath, maxDepth - 1);
      }

      return count + 1;
    }, 0);
  } catch {
    return 0;
  }
};

const readIniValue = (content, key) => {
  const match = content.match(new RegExp(`^${escapeRegExp(key)}=(.*)$`, 'm'));
  return match ? match[1].trim() : null;
};

const probeQbittorrentConfig = () => withLocalProbeCache('qbittorrentConfig', 5000, () => {
  const fallbackPath = fs.existsSync(MEDIA_DOWNLOADS_MANUAL_DIR) ? MEDIA_DOWNLOADS_MANUAL_DIR : MEDIA_DOWNLOADS_DIR;
  if (!fs.existsSync(QBITTORRENT_CONFIG_PATH)) {
    return { defaultSavePath: fallbackPath };
  }

  try {
    const configText = fs.readFileSync(QBITTORRENT_CONFIG_PATH, 'utf8');
    return {
      defaultSavePath: readIniValue(configText, 'Session\\DefaultSavePath') || fallbackPath,
    };
  } catch {
    return { defaultSavePath: fallbackPath };
  }
});

const probeJellyfinLiveTvState = () => withLocalProbeCache('jellyfinLiveTv', 5000, () => {
  let channelCount = 0;
  let inspected = false;

  if (fs.existsSync(JELLYFIN_DB_PATH)) {
    try {
      const raw = execFileSync('python3', [
        '-c',
        [
          'import json, sqlite3, sys',
          'conn = sqlite3.connect(sys.argv[1])',
          'cur = conn.cursor()',
          'cur.execute("""',
          'SELECT COUNT(*)',
          'FROM BaseItems',
          "WHERE lower(COALESCE(Type, '')) LIKE '%channel%'",
          "   OR lower(COALESCE(Type, '')) LIKE '%program%'",
          "   OR (lower(COALESCE(Path, '')) LIKE '%views/livetv/%' AND lower(COALESCE(Type, '')) != 'mediabrowser.controller.entities.userview')",
          '""")',
          'count = cur.fetchone()[0] or 0',
          "print(json.dumps({'channelCount': int(count)}))",
        ].join('\n'),
        JELLYFIN_DB_PATH,
      ], {
        encoding: 'utf8',
        timeout: 1500,
      });
      const parsed = JSON.parse(raw);
      channelCount = Number(parsed?.channelCount) || 0;
      inspected = true;
    } catch {
      inspected = false;
    }
  }

  if (!inspected) {
    channelCount = countVisibleDescendants(JELLYFIN_LIVETV_METADATA_DIR, 4);
    inspected = fs.existsSync(JELLYFIN_LIVETV_METADATA_DIR);
  }

  return { channelCount, inspected };
});

const detectFtpProvider = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && now - ftpProviderCache.checkedAt < 10000) {
    return ftpProviderCache.provider;
  }

  let provider = null;

  if (await commandExists('python3')) {
    try {
      await runCommand('python3 -c "import pyftpdlib"');
      provider = 'pyftpdlib';
    } catch {
      provider = null;
    }
  }

  if (!provider && await commandExists('busybox')) {
    provider = 'busybox';
  }

  ftpProviderCache = {
    checkedAt: now,
    provider,
  };

  return provider;
};

const getControlledServiceNames = async () => {
  const names = await getManageableServiceNames();
  return names.filter((name) => OPTIONAL_SERVICE_SET.has(name));
};

const getManageableServiceNames = async () => {
  const names = [];

  for (const name of Object.keys(SERVICES)) {
    if (name === 'nginx') {
      continue;
    }

    if (name === 'sshd' && !ENABLE_SSHD) {
      continue;
    }

    if (name === 'ftp' && !(await detectFtpProvider())) {
      continue;
    }

    const install = await resolveServiceInstall(name, SERVICES[name]);
    if (install.available) {
      names.push(name);
    }
  }

  return names;
};

const resolveServiceInstall = async (serviceName, svc) => {
  if (Array.isArray(svc.installCheckPaths) && svc.installCheckPaths.length > 0) {
    const missing = svc.installCheckPaths.filter((candidate) => !fs.existsSync(candidate));

    if (missing.length > 0) {
      return {
        available: false,
        label: missing[0],
      };
    }
  }

  if (svc.installCheckCommand) {
    try {
      await runCommand(svc.installCheckCommand);
    } catch {
      return {
        available: false,
        label: svc.installCheckCommand,
      };
    }
  }

  if (Array.isArray(svc.installCheckPaths) && svc.installCheckPaths.length > 0) {
    return {
      available: true,
      label: svc.installCheckPaths.join(', '),
    };
  }

  if (serviceName !== 'ftp') {
    return {
      available: await commandExists(svc.binary),
      label: svc.binary,
    };
  }

  const provider = await detectFtpProvider(true);
  if (provider === 'pyftpdlib') {
    return { available: true, label: 'python3 -m pyftpdlib' };
  }

  if (provider === 'busybox') {
    return { available: true, label: 'busybox ftpd' };
  }

  return {
    available: false,
    label: 'python3 (pyftpdlib) or busybox',
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const probePort = (port, host = '127.0.0.1', timeoutMs = 1200) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const startedAt = Date.now();

    const finish = (open) => {
      if (done) {
        return;
      }

      done = true;
      socket.destroy();
      resolve({
        latencyMs: Date.now() - startedAt,
        open,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });

const checkService = async (svc) => {
  try {
    await runCommand(svc.check);
  } catch {
    return false;
  }

  if (!svc.port) {
    return true;
  }

  const result = await probePort(svc.port, svc.host || '127.0.0.1');
  return result.open;
};

const trimServiceHistory = (history = []) => {
  const cutoff = Date.now() - SERVICE_STATS_WINDOW_MS;
  const next = history.filter((entry) => entry.checkedAtMs >= cutoff);
  return next.slice(-SERVICE_HISTORY_LIMIT);
};

const getServiceStats = (serviceName) => {
  const history = trimServiceHistory(serviceHealthHistory[serviceName] || []);
  serviceHealthHistory[serviceName] = history;

  if (history.length === 0) {
    return {
      avgLatencyMs: null,
      lastCheckedAt: null,
      lastTransitionAt: null,
      latencyMs: null,
      samples: 0,
      uptimePct: null,
    };
  }

  let latencyTotal = 0;
  let latencyCount = 0;
  let upCount = 0;

  for (const sample of history) {
    if (sample.status === 'working') {
      upCount += 1;
    }

    if (Number.isFinite(sample.latencyMs)) {
      latencyTotal += sample.latencyMs;
      latencyCount += 1;
    }
  }

  const last = history[history.length - 1];

  return {
    avgLatencyMs: latencyCount > 0 ? Number((latencyTotal / latencyCount).toFixed(0)) : null,
    lastCheckedAt: last.checkedAt,
    lastTransitionAt: last.transitionAt || last.checkedAt,
    latencyMs: Number.isFinite(last.latencyMs) ? last.latencyMs : null,
    samples: history.length,
    uptimePct: history.length > 0 ? Number(((upCount / history.length) * 100).toFixed(1)) : null,
  };
};

const recordServiceObservation = (serviceName, status, latencyMs) => {
  const now = new Date();
  const checkedAt = now.toISOString();
  const history = trimServiceHistory(serviceHealthHistory[serviceName] || []);
  const previous = history[history.length - 1] || null;
  const transitionAt = previous?.status === status ? previous.transitionAt || previous.checkedAt : checkedAt;

  history.push({
    checkedAt,
    checkedAtMs: now.getTime(),
    latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    status,
    transitionAt,
  });

  serviceHealthHistory[serviceName] = trimServiceHistory(history);
  return getServiceStats(serviceName);
};

const statusReasonForService = (entry) => {
  if (!entry.available) {
    return entry.blocker || 'Not installed on this host.';
  }

  if (entry.status === 'working') {
    if (Number.isFinite(entry.latencyMs) && entry.latencyMs > 800) {
      return 'Healthy, but response time is elevated.';
    }
    return 'Healthy.';
  }

  if (entry.controlMode === 'optional') {
    return 'Stopped by operator.';
  }

  return 'Expected to be running, but the health check failed.';
};

const checkServiceHealth = async (serviceName, svc) => {
  const startedAt = Date.now();

  try {
    await runCommand(svc.check);
  } catch {
    return {
      latencyMs: null,
      running: false,
    };
  }

  if (!svc.port) {
    return {
      latencyMs: Date.now() - startedAt,
      running: true,
    };
  }

  const probe = await probePort(svc.port, svc.host || '127.0.0.1');
  return {
    latencyMs: probe.open ? probe.latencyMs : null,
    running: probe.open,
  };
};

const inspectServiceCatalogEntry = async (name, meta) => {
  const svc = SERVICES[name];
  let available = true;
  let blocker = '';
  let running = false;
  let latencyMs = null;

  if (name === 'sshd' && !ENABLE_SSHD) {
    available = false;
    blocker = 'Disabled in single-port mode.';
  } else if (name === 'ftp' && !(await detectFtpProvider())) {
    available = false;
    blocker = 'Requires python3 + pyftpdlib or busybox ftpd.';
  } else {
    const install = await resolveServiceInstall(name, svc);
    available = install.available;
    if (!install.available) {
      blocker = PLACEHOLDER_SERVICE_SET.has(name)
        ? `Currently blocked on ${install.label}.`
        : `Requires ${install.label}.`;
    } else {
      const health = await checkServiceHealth(name, svc);
      running = health.running;
      latencyMs = health.latencyMs;
    }
  }

  const status = !available
    ? 'unavailable'
    : (running ? 'working' : meta.controlMode === 'optional' ? 'stopped' : 'stalled');
  const stats = recordServiceObservation(name, status, latencyMs);

  const entry = {
    available,
    avgLatencyMs: stats.avgLatencyMs,
    blocker: blocker || undefined,
    controlMode: meta.controlMode,
    description: meta.description,
    group: meta.group,
    key: name,
    label: meta.label,
    lastCheckedAt: stats.lastCheckedAt,
    lastTransitionAt: stats.lastTransitionAt,
    latencyMs: stats.latencyMs,
    placeholder: !available && PLACEHOLDER_SERVICE_SET.has(name),
    route: meta.route || undefined,
    status,
    statusReason: null,
    surface: meta.surface,
    uptimePct: stats.uptimePct,
  };

  entry.statusReason = statusReasonForService(entry);
  return entry;
};

const buildServiceCatalog = async () => {
  const entries = [];

  for (const [name, meta] of Object.entries(SERVICE_CATALOG_META)) {
    entries.push(await inspectServiceCatalogEntry(name, meta));
  }

  return entries;
};

const buildServiceGroups = (catalog) =>
  SERVICE_GROUP_ORDER.reduce((acc, group) => {
    const members = catalog.filter((entry) => entry.group === group).map((entry) => entry.key);
    if (members.length > 0) {
      acc[group] = members;
    }
    return acc;
  }, {});

const aggregateCatalogStatus = (entries) => {
  if (!entries.length) {
    return 'unavailable';
  }
  if (entries.every((entry) => entry.status === 'working')) {
    return 'working';
  }
  if (entries.some((entry) => entry.status === 'working' || entry.status === 'stalled')) {
    return 'stalled';
  }
  if (entries.some((entry) => entry.status === 'stopped')) {
    return 'stopped';
  }
  return 'unavailable';
};

const buildMediaWorkflowSnapshot = (catalog) => {
  const catalogByKey = new Map(catalog.map((entry) => [entry.key, entry]));
  const watchEntry = catalogByKey.get('jellyfin') || null;
  const requestEntry = catalogByKey.get('jellyseerr') || null;
  const automationEntries = ['prowlarr', 'sonarr', 'radarr']
    .map((key) => catalogByKey.get(key))
    .filter(Boolean);
  const subtitleEntry = catalogByKey.get('bazarr') || null;
  const supportEntries = ['redis', 'postgres']
    .map((key) => catalogByKey.get(key))
    .filter(Boolean);
  const downloadEntries = catalog.filter((entry) => entry.surface === 'downloads');
  const primaryDownloadEntry = downloadEntries[0] || null;
  const libraryRoots = [MEDIA_MOVIES_DIR, MEDIA_SERIES_DIR];
  const downloadRoots = [MEDIA_DOWNLOADS_DIR, MEDIA_DOWNLOADS_MANUAL_DIR];
  const qbittorrentConfig = probeQbittorrentConfig();
  const liveTvProbe = probeJellyfinLiveTvState();
  const libraryRootReady = libraryRoots.every((candidate) => fs.existsSync(candidate));
  const playlistSource = resolveMediaSource(JELLYFIN_LIVE_TV_M3U_URL, JELLYFIN_LIVE_TV_M3U_PATH, MEDIA_IPTV_CACHE_DIR, ['.m3u', '.m3u8']);
  const guideSource = resolveMediaSource(JELLYFIN_LIVE_TV_XMLTV_URL, JELLYFIN_LIVE_TV_XMLTV_PATH, MEDIA_IPTV_EPG_DIR, ['.xml', '.xmltv']);
  const playlistConfigured = Boolean(playlistSource);
  const guideConfigured = Boolean(guideSource);
  const channelCount = liveTvProbe.channelCount || 0;
  const channelsMapped = channelCount > 0
    ? true
    : playlistConfigured || guideConfigured
      ? false
      : null;
  const requestsBlocked = !requestEntry || !requestEntry.available;
  const downloadsStatus = downloadEntries.length > 0
    ? aggregateCatalogStatus(downloadEntries)
    : 'blocked';
  const liveTvStatus = !watchEntry
    ? 'unavailable'
    : watchEntry.status !== 'working'
      ? watchEntry.status
      : playlistConfigured && guideConfigured && channelsMapped === true
        ? 'working'
        : playlistConfigured || guideConfigured
          ? 'stalled'
          : 'setup';

  return {
    watch: {
      libraryRootReady,
      libraryRoots,
      serviceKeys: watchEntry ? [watchEntry.key] : [],
      status: watchEntry?.status || 'unavailable',
      summary: libraryRootReady
        ? `Library roots ready at ${libraryRoots.join(' and ')}`
        : `Library roots missing under ${MEDIA_ROOT}`,
    },
    requests: {
      blocker: requestsBlocked ? requestEntry?.blocker || 'Request portal is not installed on this host yet.' : null,
      serviceKeys: requestEntry ? [requestEntry.key] : [],
      status: requestsBlocked ? 'blocked' : requestEntry.status,
      summary: requestsBlocked
        ? requestEntry?.blocker || 'Requests are unavailable until Jellyseerr is installed.'
        : 'Requests flow into Sonarr and Radarr with saved defaults.',
    },
    automation: {
      healthy: automationEntries.filter((entry) => entry.status === 'working').length,
      serviceKeys: automationEntries.map((entry) => entry.key),
      status: aggregateCatalogStatus(automationEntries),
      summary: 'Prowlarr syncs indexers into Sonarr and Radarr, which then monitor imports from download clients.',
      total: automationEntries.length,
    },
    downloads: {
      clientCount: downloadEntries.length,
      defaultSavePath: qbittorrentConfig.defaultSavePath,
      downloadRoots,
      primaryServiceKey: primaryDownloadEntry?.key || null,
      serviceKeys: downloadEntries.map((entry) => entry.key),
      status: downloadsStatus,
      summary: downloadEntries.length > 0
        ? `${primaryDownloadEntry?.label || 'Download clients'} run in the Downloads tab. Save path: ${qbittorrentConfig.defaultSavePath || downloadRoots.join(' and ')}`
        : 'No download clients are configured yet.',
      workspaceTab: 'downloads',
    },
    subtitles: {
      blocker: !subtitleEntry || !subtitleEntry.available ? subtitleEntry?.blocker || 'Subtitle automation is not installed on this host.' : null,
      serviceKeys: subtitleEntry ? [subtitleEntry.key] : [],
      status: !subtitleEntry || !subtitleEntry.available ? 'blocked' : subtitleEntry.status,
      summary: !subtitleEntry || !subtitleEntry.available
        ? subtitleEntry?.blocker || 'Subtitle automation is unavailable.'
        : 'Subtitle automation runs after Sonarr and Radarr import media into the library.',
    },
    liveTv: {
      channelCount,
      channelsMapped,
      guideConfigured,
      guideSource,
      playlistConfigured,
      playlistSource,
      status: liveTvStatus,
      summary: !watchEntry || watchEntry.status !== 'working'
        ? 'Start Jellyfin before configuring Live TV.'
        : playlistConfigured && guideConfigured && channelsMapped === true
          ? `${channelCount} Live TV channel${channelCount === 1 ? '' : 's'} detected in Jellyfin. Guide and tuner sources are ready.`
          : playlistConfigured && guideConfigured
            ? 'Playlist and guide sources are present. Finish channel mapping inside Jellyfin.'
          : playlistConfigured || guideConfigured
            ? 'Live TV is partially configured. Add both M3U and XMLTV sources in Jellyfin.'
            : 'No Live TV sources detected yet. Add an M3U tuner and XMLTV guide for Jellyfin.',
      tunerType: 'm3u',
    },
    support: {
      serviceKeys: supportEntries.map((entry) => entry.key),
      status: aggregateCatalogStatus(supportEntries),
      summary: supportEntries.length > 0
        ? 'Redis and PostgreSQL support Live TV metadata and background media jobs.'
        : 'No media support services are configured.',
    },
  };
};

const waitForServiceState = async (svc, shouldBeRunning, attempts = 10, delayMs = 300) => {
  for (let i = 0; i < attempts; i += 1) {
    const running = await checkService(svc);
    if (running === shouldBeRunning) {
      return running;
    }
    await sleep(delayMs);
  }

  return checkService(svc);
};

const classifyServiceState = (running) => (running ? 'working' : 'stalled');

const pollServiceStateTransitions = async () => {
  if (!verboseLoggingEnabled) {
    return;
  }

  const controlledServiceNames = await getControlledServiceNames();

  for (const name of controlledServiceNames) {
    const svc = SERVICES[name];

    const running = await checkService(svc);
    const state = classifyServiceState(running);

    if (!serviceStateCache[name]) {
      serviceStateCache[name] = state;
      pushDebugEvent('info', `Service loaded: ${name}`, { state });
      continue;
    }

    if (serviceStateCache[name] !== state) {
      const prev = serviceStateCache[name];
      serviceStateCache[name] = state;

      if (state === 'working') {
        pushDebugEvent('info', `Service recovered: ${name}`, { from: prev, to: state });
      } else {
        pushDebugEvent('warn', `Service stalled: ${name}`, { from: prev, to: state });
      }
    }
  }
};

if (JWT_SECRET === 'change-this-in-production' || JWT_SECRET.length < 32) {
  console.warn('[security] JWT_SECRET is using an insecure default or is too short; set a long random secret in server/.env');
}

if (!String(process.env.APP_AUTH_SECRET || '').trim()) {
  console.warn('[security] APP_AUTH_SECRET is not set; FTP favourite secrets will fall back to JWT_SECRET-derived encryption');
}

if (adminBootstrap.seeded && BOOTSTRAP_DASHBOARD_PASS === 'admin123') {
  console.warn('[security] DASHBOARD_PASS is using the default bootstrap credential; change it in server/.env before first run');
}

const pruneLoginAttempts = () => {
  const now = Date.now();

  for (const [key, attempt] of loginAttempts.entries()) {
    const expiredWindow = now - attempt.windowStartedAtMs > LOGIN_WINDOW_MS;
    const expiredBlock = !attempt.blockedUntilMs || attempt.blockedUntilMs <= now;

    if (expiredWindow && expiredBlock) {
      loginAttempts.delete(key);
    }
  }
};

const getLoginAttemptKey = (req) => normalizeIp(req.ip || req.socket?.remoteAddress || 'unknown');

const getLoginAttemptState = (req) => {
  pruneLoginAttempts();
  return loginAttempts.get(getLoginAttemptKey(req)) || null;
};

const registerLoginFailure = (req) => {
  const key = getLoginAttemptKey(req);
  const now = Date.now();
  const existing = loginAttempts.get(key);
  const withinWindow = existing && now - existing.windowStartedAtMs <= LOGIN_WINDOW_MS;
  const nextCount = withinWindow ? existing.count + 1 : 1;
  const attempt = {
    count: nextCount,
    windowStartedAtMs: withinWindow ? existing.windowStartedAtMs : now,
    blockedUntilMs: nextCount >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0,
  };

  loginAttempts.set(key, attempt);
  return attempt;
};

const clearLoginFailures = (req) => {
  loginAttempts.delete(getLoginAttemptKey(req));
};

const pruneSessions = () => {
  const now = Date.now();

  for (const [sessionId, session] of activeSessions.entries()) {
    const idleExpired = session.lastSeenAtMs + SESSION_IDLE_TIMEOUT_MS <= now;
    const absoluteExpired = session.createdAtMs + SESSION_ABSOLUTE_TIMEOUT_MS <= now;

    if (idleExpired || absoluteExpired) {
      activeSessions.delete(sessionId);
    }
  }
};

const invalidateSession = (sessionId) => {
  if (!sessionId) {
    return;
  }

  activeSessions.delete(sessionId);
  unlockedServiceControllers.delete(sessionId);
};

const invalidateSessionFromToken = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === 'object' && decoded.jti) {
      invalidateSession(decoded.jti);
    }
  } catch {
    // Ignore invalid logout tokens.
  }
};

const createSession = (req, user) => {
  pruneSessions();

  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const session = {
    id: sessionId,
    role: user.role,
    userId: user.id,
    username: user.username,
    createdAtMs: now,
    lastSeenAtMs: now,
    ip: normalizeIp(req.ip || req.socket?.remoteAddress || ''),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
  };

  activeSessions.set(sessionId, session);

  const sessionsForUser = [...activeSessions.values()]
    .filter((entry) => entry.userId === user.id)
    .sort((a, b) => a.lastSeenAtMs - b.lastSeenAtMs);

  while (sessionsForUser.length > MAX_ACTIVE_SESSIONS) {
    const oldest = sessionsForUser.shift();
    invalidateSession(oldest?.id);
  }

  return session;
};

const touchSession = (session) => {
  if (!session) {
    return;
  }

  session.lastSeenAtMs = Date.now();
  activeSessions.set(session.id, session);
};

const validateSessionToken = (token, { touch = false } = {}) => {
  pruneSessions();

  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  if (!decoded || typeof decoded !== 'object' || !decoded.jti) {
    throw new Error('Session token missing jti');
  }

  const session = activeSessions.get(decoded.jti);
  if (!session) {
    throw new Error('Session not found');
  }

  if (touch) {
    touchSession(session);
  }

  return { decoded, session };
};

const secureCompare = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

const parseCookieHeader = (cookieHeader = '') => {
  const out = {};

  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) {
      continue;
    }

    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) {
      continue;
    }

    out[key] = decodeURIComponent(value || '');
  }

  return out;
};

const readBearerToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length).trim();
};

const readCookieToken = (req) => {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  return cookies[AUTH_COOKIE_NAME] || null;
};

const readToken = (req) => readBearerToken(req) || readCookieToken(req);

const normalizeIp = (ip = '') => String(ip).replace(/^::ffff:/, '');

const protocolFromRequest = (req) => {
  const originalUri = String(req.headers['x-original-uri'] || '');

  if (originalUri.startsWith('/term/')) {
    return 'Terminal';
  }

  const routePath = req.path || '';
  if (routePath.startsWith('/api/') || routePath.startsWith('/auth/')) {
    return 'API';
  }

  return 'Gateway';
};

const pruneRecentConnections = () => {
  const cutoff = Date.now() - CONNECTION_TTL_MS;

  for (const [key, entry] of recentConnections.entries()) {
    if (entry.lastSeenMs < cutoff) {
      recentConnections.delete(key);
    }
  }
};

const rememberConnection = (req) => {
  const ip = normalizeIp(req.ip || req.socket?.remoteAddress || '');
  if (!ip) {
    return;
  }

  pruneRecentConnections();

  const protocol = protocolFromRequest(req);
  let username = ip === '127.0.0.1' || ip === '::1' ? 'local-user' : 'remote-user';
  let sessionId = '';

  const token = readToken(req);
  if (token) {
    try {
      const { decoded } = validateSessionToken(token);
      username = decoded?.sub || username;
      sessionId = String(decoded?.jti || '');
    } catch {
      // Ignore invalid tokens for telemetry purposes.
    }
  }

  const port = String(req.socket?.remotePort || '');
  const key = `${ip}:${protocol}`;

  recentConnections.set(key, {
    username,
    ip,
    port,
    protocol,
    sessionId,
    status: 'connected',
    lastSeen: new Date().toISOString(),
    lastSeenMs: Date.now(),
  });
};

const classifyStorageMount = (mountPoint) => {
  if (mountPoint === '/data' || mountPoint.startsWith('/data/')) {
    return 'internal';
  }

  if (mountPoint === '/storage/emulated' || mountPoint.startsWith('/mnt/user/') || mountPoint.startsWith('/mnt/pass_through/')) {
    return 'shared';
  }

  if ((mountPoint.startsWith('/storage/') && !mountPoint.startsWith('/storage/emulated')) || mountPoint.startsWith('/mnt/media_rw/')) {
    return 'external';
  }

  return 'system';
};

const preferredMountScore = (mountPoint) => {
  if (mountPoint === '/storage/emulated') {
    return 4;
  }

  if (mountPoint.startsWith('/storage/') && !mountPoint.startsWith('/storage/emulated')) {
    return 3;
  }

  if (mountPoint === '/data') {
    return 2;
  }

  return 1;
};

const parseMountTypes = async () => {
  const mountOutput = await runCommand('mount');
  const mountTypes = new Map();

  for (const line of mountOutput.split('\n')) {
    const match = line.match(/^.+ on (\S+) type (\S+) \(.+\)$/);
    if (!match) {
      continue;
    }

    mountTypes.set(match[1], match[2]);
  }

  return mountTypes;
};

const parseStorageInventory = async () => {
  const [dfOutput, mountTypes] = await Promise.all([
    runCommand('df -kP'),
    parseMountTypes(),
  ]);

  const mounts = [];
  const dedupeByPool = new Map();

  for (const line of dfOutput.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) {
      continue;
    }

    const filesystem = parts[0];
    const mountPoint = parts[5];
    const category = classifyStorageMount(mountPoint);

    if (category === 'system') {
      continue;
    }

    const fsType = mountTypes.get(mountPoint) || '';
    if (fsType && !STORAGE_FS_TYPES.has(fsType)) {
      continue;
    }

    const size = (Number(parts[1]) || 0) * 1024;
    const used = (Number(parts[2]) || 0) * 1024;
    const available = (Number(parts[3]) || 0) * 1024;
    const usePercent = Number(String(parts[4]).replace('%', '')) || 0;
    const entry = {
      filesystem,
      fsType,
      size,
      used,
      available,
      usePercent,
      mount: mountPoint,
      category,
    };

    const duplicateKey =
      mountPoint === '/data' || mountPoint === '/storage/emulated'
        ? `${size}:${used}:${available}:primary`
        : `${filesystem}:${mountPoint}`;
    const existing = dedupeByPool.get(duplicateKey);

    if (!existing || preferredMountScore(mountPoint) > preferredMountScore(existing.mount)) {
      dedupeByPool.set(duplicateKey, entry);
    }
  }

  mounts.push(...dedupeByPool.values());
  mounts.sort((a, b) => {
    const categoryOrder = ['shared', 'external', 'internal', 'system'];
    const aIndex = categoryOrder.indexOf(a.category);
    const bIndex = categoryOrder.indexOf(b.category);
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return a.mount.localeCompare(b.mount);
  });

  const summary = mounts.reduce(
    (acc, mount) => {
      acc.totalSize += mount.size;
      acc.totalUsed += mount.used;
      return acc;
    },
    { totalSize: 0, totalUsed: 0 }
  );

  return { mounts, summary };
};

const withTimedCache = async (bucket, ttlMs, loader) => {
  const cache = timedCache[bucket];
  const now = Date.now();

  if (cache.value && cache.expiresAt > now) {
    return cache.value;
  }

  if (cache.promise) {
    return cache.promise;
  }

  cache.promise = loader()
    .then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + ttlMs;
      cache.promise = null;
      return value;
    })
    .catch((error) => {
      cache.promise = null;
      throw error;
    });

  return cache.promise;
};

const readNetworkStats = () => {
  try {
    let raw = '';

    try {
      raw = fs.readFileSync('/proc/net/dev', 'utf8');
    } catch {
      if (typeof process.getuid === 'function' && process.getuid() !== 0) {
        try {
          raw = execFileSync('su', ['-c', 'cat /proc/net/dev'], {
            encoding: 'utf8',
            timeout: 1500,
          });
        } catch {
          raw = '';
        }
      }
    }

    if (!raw) {
      return { rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 };
    }

    let rxBytes = 0;
    let txBytes = 0;

    for (const line of raw.split('\n').slice(2)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const [namePart, dataPart] = trimmed.split(':');
      const iface = String(namePart || '').trim();
      if (!iface || iface === 'lo') {
        continue;
      }

      if (/^(dummy|ifb|tunl|gre|gretap|erspan|ip_vti|ip6_vti|sit|ip6tnl)/.test(iface)) {
        continue;
      }

      const parts = String(dataPart || '').trim().split(/\s+/);
      rxBytes += Number(parts[0] || 0);
      txBytes += Number(parts[8] || 0);
    }

    const now = Date.now();
    let rxRate = 0;
    let txRate = 0;

    if (networkSnapshotCache && now > networkSnapshotCache.atMs) {
      const seconds = (now - networkSnapshotCache.atMs) / 1000;
      if (seconds > 0) {
        rxRate = Math.max(0, (rxBytes - networkSnapshotCache.rxBytes) / seconds);
        txRate = Math.max(0, (txBytes - networkSnapshotCache.txBytes) / seconds);
      }
    }

    networkSnapshotCache = { atMs: now, rxBytes, txBytes };

    return { rxBytes, txBytes, rxRate, txRate };
  } catch {
    return { rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 };
  }
};

const readLanDevices = () => {
  try {
    const raw = fs.readFileSync('/proc/net/arp', 'utf8');
    const lines = raw.split('\n').slice(1).map((line) => line.trim()).filter(Boolean);

    return lines
      .map((line) => {
        const parts = line.split(/\s+/);
        const ip = String(parts[0] || '');
        const hwType = String(parts[1] || '');
        const flags = String(parts[2] || '');
        const mac = String(parts[3] || '').toLowerCase();
        const device = String(parts[5] || '');
        if (!ip || !mac || mac === '00:00:00:00:00:00') {
          return null;
        }

        return {
          device,
          ip,
          lastSeen: new Date().toISOString(),
          mac,
          source: 'lan',
          state: flags === '0x2' ? 'reachable' : 'stale',
          type: hwType === '0x1' ? 'ethernet' : 'network',
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  } catch {
    return [];
  }
};

const readCommandJson = async (command) => {
  try {
    const output = await runCommand(command);
    return JSON.parse(output);
  } catch {
    return null;
  }
};

const readDeviceTelemetry = async () => {
  const result = {
    androidVersion: os.release ? os.release() : null,
    batteryPct: null,
    charging: null,
    wifiDbm: null,
  };

  if (await commandExists('termux-battery-status')) {
    const battery = await readCommandJson('termux-battery-status');
    if (battery && typeof battery === 'object') {
      const percentage = Number(battery.percentage);
      result.batteryPct = Number.isFinite(percentage) ? percentage : null;
      result.charging = typeof battery.status === 'string'
        ? ['charging', 'full'].includes(battery.status.toLowerCase())
        : null;
    }
  }

  if (await commandExists('termux-wifi-connectioninfo')) {
    const wifi = await readCommandJson('termux-wifi-connectioninfo');
    if (wifi && typeof wifi === 'object') {
      const rssi = Number(wifi.rssi);
      result.wifiDbm = Number.isFinite(rssi) ? rssi : null;
    }
  }

  return result;
};

const collectMonitorSnapshot = async () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const [cpuLoad, device] = await Promise.all([
    readCpuUsage(),
    readDeviceTelemetry(),
  ]);
  const processMemory = process.memoryUsage();
  const [load1m, load5m, load15m] = os.loadavg();
  const loopMeanMs = Number((eventLoopDelay.mean / 1e6).toFixed(2));
  const loopP95Ms = Number((eventLoopDelay.percentile(95) / 1e6).toFixed(2));
  const cpuCores = (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) || 1;
  eventLoopDelay.reset();

  return {
    cpuCores,
    cpuLoad,
    device,
    freeMem,
    loadAvg1m: Number(load1m.toFixed(2)),
    loadAvg5m: Number(load5m.toFixed(2)),
    loadAvg15m: Number(load15m.toFixed(2)),
    network: readNetworkStats(),
    processExternal: processMemory.external,
    processHeapTotal: processMemory.heapTotal,
    processHeapUsed: processMemory.heapUsed,
    processRss: processMemory.rss,
    totalMem,
    uptime: os.uptime(),
    usedMem: totalMem - freeMem,
    eventLoopLagMs: Number.isFinite(loopMeanMs) ? loopMeanMs : 0,
    eventLoopP95Ms: Number.isFinite(loopP95Ms) ? loopP95Ms : 0,
  };
};

const getMonitorSnapshot = () => withTimedCache('monitor', 1500, collectMonitorSnapshot);

const collectServicesSnapshot = async () => {
  const result = {};

  for (const name of Object.keys(SERVICE_CATALOG_META)) {
    if (name === 'sshd' && !ENABLE_SSHD) {
      continue;
    }

    if (name === 'ftp' && !(await detectFtpProvider())) {
      continue;
    }

    const svc = SERVICES[name];
    const install = await resolveServiceInstall(name, svc);
    if (install.available) {
      result[name] = await checkService(svc);
    }
  }

  return result;
};

const getServicesSnapshot = () => withTimedCache('services', 2000, collectServicesSnapshot);

const getStorageSnapshot = () => withTimedCache('storage', 15000, parseStorageInventory);

const getConnectionsSnapshot = () => {
  pruneRecentConnections();

  return {
    users: [...recentConnections.values()]
      .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
      .slice(0, MAX_CONNECTIONS)
      .map(({ lastSeenMs, ...entry }) => ({
        ...entry,
        durationMs: Math.max(0, Date.now() - lastSeenMs),
      })),
  };
};

const getNetworkDevicesSnapshot = () => ({
  devices: readLanDevices(),
});

const getLogsSnapshot = () => ({
  entries: debugEvents
    .slice(-120)
    .reverse()
    .map((entry, index) => ({
      id: `${entry.timestamp}-${index}`,
      level: entry.level,
      message: entry.message,
      meta: entry.meta || null,
      timestamp: entry.timestamp,
    })),
  logs: debugEvents.slice(-120).reverse(),
  markdown: buildMarkdownLog(80),
  verboseLoggingEnabled,
});

const isServiceControllerUnlocked = (sessionId) => {
  if (!sessionId) {
    return false;
  }

  const expiresAt = unlockedServiceControllers.get(sessionId) || 0;
  if (expiresAt <= Date.now()) {
    unlockedServiceControllers.delete(sessionId);
    return false;
  }

  return true;
};

const unlockServiceController = (sessionId) => {
  if (!sessionId) {
    return 0;
  }

  const expiresAt = Date.now() + SERVICE_UNLOCK_TTL_MS;
  unlockedServiceControllers.set(sessionId, expiresAt);
  return expiresAt;
};

const readJsonFile = (filePath, fallbackValue) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallbackValue;
  }
};

const readJsonLines = (filePath, limit = 80) => {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const normalizeDriveEntry = (entry = {}) => ({
  device: String(entry.device || ''),
  dirName: String(entry.dirName || ''),
  error: String(entry.error || ''),
  filesystem: String(entry.filesystem || ''),
  letter: String(entry.letter || ''),
  mountPoint: String(entry.mountPoint || ''),
  name: String(entry.name || ''),
  rawMountPoint: String(entry.rawMountPoint || ''),
  state: String(entry.state || 'unknown'),
  uuid: String(entry.uuid || ''),
});

const getDriveSnapshot = async () => {
  const agentInstalled = fileIsExecutable(DRIVE_AGENT_CMD) || await commandExists(DRIVE_AGENT_CMD);
  const rawManifest = readJsonFile(DRIVE_STATE_PATH, {});

  return {
    agentInstalled,
    checkedAt: new Date().toISOString(),
    events: readJsonLines(DRIVE_EVENTS_PATH, 80),
    manifest: {
      generatedAt: typeof rawManifest.generatedAt === 'string' ? rawManifest.generatedAt : null,
      intervalMs: Math.max(60000, Number(rawManifest.intervalMs || DRIVE_REFRESH_INTERVAL_MS) || DRIVE_REFRESH_INTERVAL_MS),
      drives: Array.isArray(rawManifest.drives) ? rawManifest.drives.map(normalizeDriveEntry) : [],
    },
    refreshIntervalMs: DRIVE_REFRESH_INTERVAL_MS,
  };
};

const getDashboardSnapshot = async (sessionId) => {
  const [services, monitor, storage, controlledServiceNames, serviceCatalog] = await Promise.all([
    getServicesSnapshot(),
    getMonitorSnapshot(),
    getStorageSnapshot(),
    getControlledServiceNames(),
    buildServiceCatalog(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    services,
    serviceCatalog,
    serviceGroups: buildServiceGroups(serviceCatalog),
    mediaWorkflow: buildMediaWorkflowSnapshot(serviceCatalog),
    monitor,
    connections: getConnectionsSnapshot(),
    networkDevices: getNetworkDevicesSnapshot(),
    storage,
    serviceController: {
      locked: !isServiceControllerUnlocked(sessionId),
      optionalServices: controlledServiceNames,
    },
    logs: getLogsSnapshot(),
  };
};

const getTelemetrySnapshot = async (sessionId) => {
  const [monitor, serviceCatalog] = await Promise.all([
    getMonitorSnapshot(),
    buildServiceCatalog(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    logs: getLogsSnapshot(),
    monitor,
    serviceCatalog,
    serviceGroups: buildServiceGroups(serviceCatalog),
    mediaWorkflow: buildMediaWorkflowSnapshot(serviceCatalog),
    serviceController: {
      locked: !isServiceControllerUnlocked(sessionId),
      optionalServices: serviceCatalog
        .filter((entry) => entry.controlMode === 'optional' && entry.available)
        .map((entry) => entry.key),
    },
    services: serviceCatalog.reduce((acc, entry) => {
      if (entry.available) {
        acc[entry.key] = entry.status === 'working';
      }
      return acc;
    }, {}),
  };
};

const normalizeRemotePath = (remotePath = '/') => {
  const parts = String(remotePath)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');

  return `/${parts.join('/')}`;
};

const normalizeLocalRelativePath = (inputPath = '') =>
  String(inputPath)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join(path.sep);

const FS_HIDDEN_NAMES = new Set(['.state', 'filebrowser.db', RECYCLE_BIN_NAME]);

const ensureWithinRoot = (rootDir, candidatePath) => {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);

  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Resolved path escapes the allowed root');
  }

  return resolvedCandidate;
};

const resolveFsPath = (inputPath = '') => {
  const relativePath = normalizeLocalRelativePath(inputPath);
  const absolutePath = ensureWithinRoot(FILEBROWSER_ROOT, path.join(FILEBROWSER_ROOT, relativePath));
  return {
    absolutePath,
    relativePath,
  };
};

const relativeSegments = (relativePath = '') => normalizeLocalRelativePath(relativePath).split(path.sep).filter(Boolean);

const buildHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const accessLevelRank = {
  deny: 0,
  read: 1,
  write: 2,
};

const normalizeAccessLevel = (value = '', fallbackValue = 'deny') => {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(accessLevelRank, normalized) ? normalized : fallbackValue;
};

const syncManagedShares = async () => {
  const driveNames = await getDriveNames();
  const ftpMountNames = new Set(appDb.listFtpFavourites().map((entry) => getFtpFavouriteRuntime(entry).mountName).filter(Boolean));
  const topLevelEntries = fs.readdirSync(FILEBROWSER_ROOT, { encoding: 'utf8' }).filter((name) => !FS_HIDDEN_NAMES.has(name));
  return appDb.syncShares(topLevelEntries.map((name) => ({
    description: '',
    isHidden: false,
    isReadOnly: false,
    name,
    pathKey: name,
    sourceType: ftpMountNames.has(name) ? 'remote' : driveNames.has(name) ? 'drive' : 'folder',
  })));
};

const resolveShareAccessLevel = (share, req) => {
  if (!share) {
    return 'deny';
  }

  const role = getRequestRole(req);
  if (share.isHidden && !ADMIN_ROLES.has(role)) {
    return 'deny';
  }

  const username = String(req?.user?.sub || req?.session?.username || '').trim().toLowerCase();
  const permissions = Array.isArray(share.permissions) ? share.permissions : [];
  const userPermissions = permissions.filter((entry) => entry.subjectType === 'user' && String(entry.subjectKey || '').toLowerCase() === username);
  if (userPermissions.length > 0) {
    return normalizeAccessLevel(userPermissions[0].accessLevel);
  }

  const rolePermissions = permissions.filter((entry) => entry.subjectType === 'role' && String(entry.subjectKey || '').toLowerCase() === role);
  if (rolePermissions.length > 0) {
    return normalizeAccessLevel(rolePermissions[0].accessLevel);
  }

  return ADMIN_ROLES.has(role) ? 'write' : 'deny';
};

const getShareContext = async (relativePath = '', req) => {
  const pathSegments = relativeSegments(relativePath);
  if (pathSegments.length === 0) {
    const shares = await syncManagedShares();
    return {
      accessLevel: 'read',
      share: null,
      shares,
      topLevelPath: '',
    };
  }

  const topLevelPath = pathSegments[0];
  const shares = await syncManagedShares();
  const share = shares.find((entry) => entry.pathKey === topLevelPath) || null;
  if (!share) {
    throw buildHttpError(404, 'Share not found');
  }

  const accessLevel = resolveShareAccessLevel(share, req);
  if (accessLevel === 'deny') {
    throw buildHttpError(403, 'You do not have access to this share');
  }

  return {
    accessLevel,
    share,
    shares,
    topLevelPath,
  };
};

const ensureShareAccess = async (relativePath = '', req, requiredLevel = 'read') => {
  const context = await getShareContext(relativePath, req);
  if (relativeSegments(relativePath).length === 0) {
    return context;
  }

  const normalizedRequiredLevel = normalizeAccessLevel(requiredLevel, 'read');
  if ((accessLevelRank[context.accessLevel] || 0) < (accessLevelRank[normalizedRequiredLevel] || 0)) {
    throw buildHttpError(403, normalizedRequiredLevel === 'write' ? 'This share is read-only for your account' : 'You do not have access to this share');
  }

  if (normalizedRequiredLevel === 'write' && context.share?.isReadOnly) {
    throw buildHttpError(403, 'This share is read-only');
  }

  return context;
};

const getManagedFsRootNames = async () => {
  const shares = await syncManagedShares();
  return new Set(shares.map((entry) => entry.pathKey).filter(Boolean));
};

const isRecycleBinPath = (segments = []) => segments[0] === RECYCLE_BIN_NAME || segments[1] === RECYCLE_BIN_NAME;

const shouldHideFsEntry = (relativePath = '') => {
  const segments = relativeSegments(relativePath);
  return segments[0] === RECYCLE_BIN_NAME || segments[1] === RECYCLE_BIN_NAME || (segments.length === 1 && FS_HIDDEN_NAMES.has(segments[0]));
};

const isProtectedFsPath = async (relativePath = '') => {
  const segments = relativeSegments(relativePath);
  if (segments.length === 0) {
    return true;
  }

  if (segments.length === 1 && FS_HIDDEN_NAMES.has(segments[0])) {
    return true;
  }

  if (isRecycleBinPath(segments)) {
    return true;
  }

  const managedRoots = await getManagedFsRootNames();
  return segments.length === 1 && managedRoots.has(segments[0]);
};

const getDriveNames = async () => {
  const snapshot = await getDriveSnapshot();
  return new Set(['C', ...snapshot.manifest.drives.map((drive) => drive.dirName).filter(Boolean)]);
};

const buildFsBreadcrumbs = (relativePath = '', share = null) => {
  const segments = relativeSegments(relativePath);
  const crumbs = [{ label: 'Drives', path: '' }];
  let currentPath = '';

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    currentPath = currentPath ? path.join(currentPath, segment) : segment;
    crumbs.push({
      label: index === 0 && share ? share.name : segment,
      path: currentPath,
    });
  }

  return crumbs;
};

const withDeletedSuffix = (name, deletedAt) => {
  const parsed = path.parse(name);
  const suffix = `__deleted-${deletedAt}`;
  return parsed.ext ? `${parsed.name}${suffix}${parsed.ext}` : `${name}${suffix}`;
};

const getUniqueRecycleTargetRelative = (relativePath = '') => {
  const normalized = normalizeLocalRelativePath(relativePath);
  const parsed = path.parse(normalized);
  const parentRelative = parsed.dir || '';
  const baseName = parsed.base || 'item';

  let attempt = 0;
  while (attempt < 1000) {
    const candidateName = attempt === 0 ? baseName : `${path.parse(baseName).name}__${attempt}${path.parse(baseName).ext}`;
    const candidateRelative = normalizeLocalRelativePath(path.join(parentRelative, candidateName));
    if (!fs.existsSync(resolveFsPath(candidateRelative).absolutePath)) {
      return candidateRelative;
    }
    attempt += 1;
  }

  throw new Error('Unable to reserve recycle-bin target');
};

const moveFsEntryToRecycleBin = (relativePath = '') => {
  const source = resolveFsPath(relativePath);
  const segments = relativeSegments(relativePath);
  const deletedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const recycleRelativeBase = normalizeLocalRelativePath(path.join(
    RECYCLE_BIN_NAME,
    ...segments.slice(0, -1),
    withDeletedSuffix(path.basename(relativePath), deletedAt)
  ));
  const recycleRelative = getUniqueRecycleTargetRelative(recycleRelativeBase);
  const recycleAbsolute = resolveFsPath(recycleRelative).absolutePath;
  fs.mkdirSync(path.dirname(recycleAbsolute), { recursive: true });
  moveFsEntry(source.absolutePath, recycleAbsolute);
  return {
    path: recycleRelative,
    recycledAt: new Date().toISOString(),
  };
};

const describeFsType = (dirent, stat) => {
  if (dirent?.isSymbolicLink?.()) {
    return 'symlink';
  }

  if (stat.isDirectory()) {
    return 'directory';
  }

  if (stat.isFile()) {
    return 'file';
  }

  return 'other';
};

const listFilesystemDirectory = async (inputPath = '', req) => {
  const { absolutePath, relativePath } = resolveFsPath(inputPath);
  const shareContext = await getShareContext(relativePath, req);

  if (!relativePath) {
    const entries = shareContext.shares
      .filter((share) => !share.isHidden || ADMIN_ROLES.has(getRequestRole(req)))
      .map((share) => ({
        accessLevel: resolveShareAccessLevel(share, req),
        editable: false,
        modifiedAt: share.updatedAt || new Date().toISOString(),
        name: share.name,
        path: share.pathKey,
        shareId: share.id,
        shareSourceType: share.sourceType,
        size: 0,
        type: 'directory',
      }))
      .filter((entry) => entry.accessLevel !== 'deny')
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    return {
      breadcrumbs: buildFsBreadcrumbs(relativePath),
      entries,
      path: relativePath,
      root: FILEBROWSER_ROOT,
      share: null,
    };
  }

  if (!fs.existsSync(absolutePath)) {
    throw new Error('Directory not found');
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  const managedRoots = await getManagedFsRootNames();
  const names = fs.readdirSync(absolutePath, { encoding: 'utf8' });
  const entries = names
    .filter((name) => !shouldHideFsEntry(relativePath ? path.join(relativePath, name) : name))
    .map((name) => {
      const childAbsolute = path.join(absolutePath, name);
      const childRelative = relativePath ? path.join(relativePath, name) : name;
      const dirent = fs.lstatSync(childAbsolute);
      const resolvedStat = dirent.isSymbolicLink() ? fs.statSync(childAbsolute) : dirent;
      const type = describeFsType(dirent, resolvedStat);
      const childSegments = relativeSegments(childRelative);
      const protectedEntry = (childSegments.length === 1 && managedRoots.has(childSegments[0])) || shouldHideFsEntry(childRelative);

      return {
        accessLevel: shareContext.accessLevel,
        editable: shareContext.accessLevel === 'write' && !protectedEntry,
        modifiedAt: resolvedStat.mtime.toISOString(),
        name,
        path: childRelative,
        size: resolvedStat.isFile() ? resolvedStat.size : 0,
        type,
      };
    })
    .sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') {
        return -1;
      }
      if (a.type !== 'directory' && b.type === 'directory') {
        return 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

  return {
    breadcrumbs: buildFsBreadcrumbs(relativePath, shareContext.share),
    entries,
    path: relativePath,
    root: FILEBROWSER_ROOT,
    share: shareContext.share ? {
      accessLevel: shareContext.accessLevel,
      id: shareContext.share.id,
      isReadOnly: shareContext.share.isReadOnly,
      name: shareContext.share.name,
      pathKey: shareContext.share.pathKey,
      sourceType: shareContext.share.sourceType,
    } : null,
  };
};

const ensureFsTargetAllowed = (relativePath = '') => {
  const segments = relativeSegments(relativePath);
  if (segments.length === 0) {
    throw new Error('Destination folder is required');
  }
};

const copyFsEntry = (sourcePath, targetPath) => {
  fs.cpSync(sourcePath, targetPath, {
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    recursive: true,
  });
};

const moveFsEntry = (sourcePath, targetPath) => {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }

    copyFsEntry(sourcePath, targetPath);
    fs.rmSync(sourcePath, { recursive: true, force: true });
  }
};

const sanitizeHostLabel = (host = '') => String(host).trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'remote';

const sanitizeFtpFavouriteName = (value = '', fallback = 'Remote FTP') => {
  const normalized = String(value || '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);

  if (normalized) {
    return normalized;
  }

  return String(fallback || 'Remote FTP')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32) || 'Remote FTP';
};

const sanitizeRcloneRemoteName = (value = '', fallback = 'ftp_remote') => {
  const normalized = String(value || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  if (normalized) {
    return normalized;
  }

  return String(fallback || 'ftp_remote')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 48) || 'ftp_remote';
};

const getFtpFavouriteRuntime = (favourite) => {
  const mountName = sanitizeFtpFavouriteName(
    favourite.mountName || favourite.name || favourite.host || `FTP ${favourite.id}`,
    favourite.name || favourite.host || `FTP ${favourite.id}`
  );
  const remoteName = sanitizeRcloneRemoteName(`ftp_favourite_${favourite.id}`);

  return {
    helperRequestPath: path.join(FTP_MOUNT_RUNTIME_DIR, `${favourite.id}.request.json`),
    mountName,
    mountPoint: path.join(FILEBROWSER_ROOT, mountName),
    remoteName,
    symlinkPath: path.join(FILEBROWSER_ROOT, mountName),
  };
};

const readJsonOutput = (raw, fallbackValue = null) => {
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return fallbackValue;
  }
};

const writeCloudMountRequest = (favourite, { includeSecrets = false } = {}) => {
  const runtime = getFtpFavouriteRuntime(favourite);
  const payload = {
    drivesRoot: FILEBROWSER_ROOT,
    id: Number(favourite.id),
    host: favourite.host,
    mountName: runtime.mountName,
    name: favourite.name,
    password: includeSecrets ? String(favourite.auth?.password || '') : '',
    port: favourite.port,
    remoteName: runtime.remoteName,
    remotePath: normalizeRemotePath(favourite.remotePath || '/'),
    secure: favourite.secure === true,
    username: favourite.username || 'anonymous',
  };

  fs.writeFileSync(runtime.helperRequestPath, `${JSON.stringify(payload, null, 2)}\n`);
  try {
    fs.chmodSync(runtime.helperRequestPath, 0o600);
  } catch {
    // Android/Termux may not honor chmod consistently across all mount contexts.
  }
  return runtime.helperRequestPath;
};

const runCloudMountHelper = (args = []) => {
  if (!fileIsExecutable(TERMUX_CLOUD_MOUNT_CMD)) {
    return {
      ok: false,
      payload: {
        available: false,
        error: `Root mount helper is not installed at ${TERMUX_CLOUD_MOUNT_CMD}`,
        errorCode: 'helper_missing',
        mode: 'fallback',
        reason: 'Browse-only fallback',
        state: 'fallback_only',
      },
    };
  }

  try {
    const raw = execFileSync(TERMUX_CLOUD_MOUNT_CMD, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
    return {
      ok: true,
      payload: readJsonOutput(raw, {}),
    };
  } catch (error) {
    const stderr = String(error?.stderr || error?.stdout || error?.message || '').trim();
    return {
      ok: false,
      payload: readJsonOutput(stderr, {
        available: false,
        error: stderr || 'Root mount helper failed',
        errorCode: 'helper_failed',
        mode: 'fallback',
        reason: 'Browse-only fallback',
        state: 'fallback_only',
      }),
    };
  }
};

const getCloudMountCapability = () => {
  const result = runCloudMountHelper(['capability']);
  return {
    available: Boolean(result.payload?.available),
    mode: String(result.payload?.mode || (result.payload?.available ? 'root_helper' : 'fallback')),
    reason: String(result.payload?.reason || (result.payload?.available ? 'Root mount helper is available' : 'Browse-only fallback')),
  };
};

const getFtpMountState = (favourite) => {
  const runtime = getFtpFavouriteRuntime(favourite);
  const capability = getCloudMountCapability();
  if (!capability.available) {
    return {
      available: false,
      error: capability.reason,
      errorCode: 'helper_unavailable',
      linkPath: runtime.symlinkPath,
      logTail: [],
      mode: 'fallback',
      mountInfo: null,
      mountName: runtime.mountName,
      mountPoint: runtime.mountPoint,
      mounted: false,
      pid: null,
      reason: capability.reason,
      remoteName: runtime.remoteName,
      running: false,
      state: 'fallback_only',
    };
  }

  const result = runCloudMountHelper(['status', '--request', writeCloudMountRequest(favourite, { includeSecrets: false })]);
  const payload = result.payload || {};
  const state = String(payload.state || (payload.mounted ? 'mounted' : payload.running ? 'starting' : payload.error ? 'error' : 'unmounted'));

  return {
    available: payload.available !== false,
    error: String(payload.error || ''),
    errorCode: String(payload.errorCode || ''),
    linkPath: String(payload.linkPath || runtime.symlinkPath),
    logTail: Array.isArray(payload.logTail) ? payload.logTail : [],
    mode: String(payload.mode || 'root_helper'),
    mountInfo: payload.mountInfo || null,
    mountName: runtime.mountName,
    mountPoint: runtime.mountPoint,
    mounted: Boolean(payload.mounted),
    pid: payload.pid ? Number(payload.pid) : null,
    reason: String(payload.reason || (payload.mounted ? 'Mounted via root helper' : payload.error || 'Not mounted')),
    remoteName: runtime.remoteName,
    running: Boolean(payload.running),
    state,
  };
};

const serializeFtpFavourite = (favourite) => ({
  ...favourite,
  mount: getFtpMountState(favourite),
});

const ensureUniqueFtpMountName = (mountName, excludeFavouriteId = 0) => {
  const normalized = sanitizeFtpFavouriteName(mountName, mountName);
  const reserved = new Set('CDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));

  if (reserved.has(normalized.toUpperCase())) {
    throw new Error(`Mount name '${normalized}' is reserved`);
  }

  const favourites = appDb.listFtpFavourites();
  const collision = favourites.find((entry) =>
    Number(entry.id) !== Number(excludeFavouriteId || 0) &&
    sanitizeFtpFavouriteName(entry.mountName || entry.name).toLowerCase() === normalized.toLowerCase()
  );

  if (collision) {
    throw new Error(`Mount name '${normalized}' is already used by '${collision.name}'`);
  }

  return normalized;
};

const validateFtpFavouriteInput = (payload = {}, existingFavourite = null) => {
  const host = String(payload.host || existingFavourite?.host || '').trim();
  if (!host) {
    throw new Error('FTP host is required');
  }

  const name = sanitizeFtpFavouriteName(payload.name || existingFavourite?.name || host, host);
  const port = Number(payload.port ?? existingFavourite?.port ?? 21);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('FTP port must be between 1 and 65535');
  }

  const username = String(payload.username ?? existingFavourite?.username ?? 'anonymous').trim() || 'anonymous';
  const previousAuth = existingFavourite?.auth || {};
  const nextPassword = Object.prototype.hasOwnProperty.call(payload, 'password')
    ? String(payload.password || '')
    : String(previousAuth.password || '');
  const secure = payload.secure === true || payload.secure === 'true' || (payload.secure == null && existingFavourite?.secure === true);
  const remotePath = normalizeRemotePath(payload.remotePath || existingFavourite?.remotePath || '/');
  const mountName = ensureUniqueFtpMountName(
    payload.mountName || existingFavourite?.mountName || name,
    existingFavourite?.id || 0
  );

  return {
    auth: {
      password: nextPassword || (username === 'anonymous' ? DEFAULT_PS4_PASSWORD : ''),
    },
    host,
    mountName,
    name,
    port,
    protocol: 'ftp',
    remotePath,
    secure,
    username,
  };
};

const getFtpFavouriteOrThrow = (id, { includeSecrets = false } = {}) => {
  const favourite = appDb.getFtpFavouriteById(id, { includeSecrets });
  if (!favourite) {
    throw new Error('FTP favourite not found');
  }
  return favourite;
};

const mountFtpFavourite = async (favourite) => {
  const requestPath = writeCloudMountRequest(favourite, { includeSecrets: true });
  try {
    runCloudMountHelper(['mount', '--request', requestPath]);
  } finally {
    writeCloudMountRequest(favourite, { includeSecrets: false });
  }
  return getFtpMountState(favourite);
};

const unmountFtpFavourite = async (favourite) => {
  writeCloudMountRequest(favourite, { includeSecrets: false });
  runCloudMountHelper(['unmount', '--request', getFtpFavouriteRuntime(favourite).helperRequestPath]);
  return getFtpMountState(favourite);
};

const resolveFtpFavouritePayload = (payload = {}) => {
  if (!payload.favouriteId) {
    return payload;
  }

  const favourite = getFtpFavouriteOrThrow(payload.favouriteId, { includeSecrets: true });
  return {
    host: favourite.host,
    password: favourite.auth?.password || '',
    path: payload.path || favourite.remotePath || '/',
    port: favourite.port,
    secure: favourite.secure,
    user: favourite.username,
  };
};

const buildFtpConnectionOptions = (payload = {}) => {
  const resolvedPayload = resolveFtpFavouritePayload(payload);
  const host = String(resolvedPayload.host || '').trim();
  if (!host) {
    throw new Error('FTP host is required');
  }

  return {
    host,
    port: Number(resolvedPayload.port || 21),
    user: String(resolvedPayload.user || 'anonymous'),
    password: String(resolvedPayload.password || 'anonymous@'),
    secure: resolvedPayload.secure === true || resolvedPayload.secure === 'true',
  };
};

const withFtpClient = async (payload, action) => {
  const access = buildFtpConnectionOptions(payload);
  const client = new ftp.Client(FTP_CLIENT_TIMEOUT_MS);
  client.ftp.verbose = false;

  try {
    await client.access(access);
    return await action(client, access);
  } finally {
    client.close();
  }
};

const listFtpDirectory = async (payload = {}) => {
  const resolvedPayload = resolveFtpFavouritePayload(payload);
  const remotePath = normalizeRemotePath(resolvedPayload.path || '/');

  return withFtpClient(resolvedPayload, async (client, access) => {
    const entries = await client.list(remotePath);

    return {
      connection: {
        host: access.host,
        port: access.port,
        user: access.user,
        secure: access.secure,
      },
      path: remotePath,
      parentPath: remotePath === '/' ? null : normalizeRemotePath(path.posix.dirname(remotePath)),
      entries: entries.map((entry) => ({
        name: entry.name,
        type: entry.type === 2 ? 'directory' : 'file',
        size: Number(entry.size || 0),
        modifiedAt: entry.modifiedAt ? entry.modifiedAt.toISOString() : '',
        rawModifiedAt: entry.rawModifiedAt || '',
        permissions: entry.permissions || '',
      })),
    };
  });
};

const downloadFtpDirectoryTree = async (client, remotePath, localPath) => {
  fs.mkdirSync(localPath, { recursive: true });
  const entries = await client.list(remotePath);
  let fileCount = 0;

  for (const entry of entries) {
    const childRemotePath = normalizeRemotePath(path.posix.join(remotePath, entry.name));
    const childLocalPath = path.join(localPath, entry.name);

    if (entry.type === 2) {
      fileCount += await downloadFtpDirectoryTree(client, childRemotePath, childLocalPath);
      continue;
    }

    fs.mkdirSync(path.dirname(childLocalPath), { recursive: true });
    await client.downloadTo(childLocalPath, childRemotePath);
    fileCount += 1;
  }

  return fileCount;
};

const requireAuth = (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    clearAuthCookie(res, req);
    return res.status(401).json(authError);
  }

  try {
    const { decoded, session } = validateSessionToken(token, { touch: true });
    req.user = decoded;
    req.session = session;
    return next();
  } catch {
    clearAuthCookie(res, req);
    return res.status(401).json(authError);
  }
};

const getRequestRole = (req) => String(req?.user?.role || req?.session?.role || 'user').toLowerCase();

const buildPermissions = (req) => {
  const role = getRequestRole(req);
  const admin = ADMIN_ROLES.has(role);
  return {
    admin,
    dashboard: admin,
    drives: admin,
    filesystemRead: true,
    filesystemWrite: admin,
    ftp: admin,
    serviceControl: admin,
  };
};

const requireRole = (...roles) => (req, res, next) => {
  const role = getRequestRole(req);
  if (roles.map((value) => String(value).toLowerCase()).includes(role)) {
    return next();
  }

  pushAuditEvent(req, 'warn', 'Access denied', { requiredRoles: roles });
  return res.status(403).json({ error: 'Forbidden' });
};

const requireAdmin = requireRole('admin');

app.use((req, res, next) => {
  rememberConnection(req);
  next();
});

const issueToken = (session) => jwt.sign(
  { sub: session.username, role: session.role, uid: session.userId, jti: session.id },
  JWT_SECRET,
  { algorithm: 'HS256', expiresIn: TOKEN_TTL }
);

const buildCookieOptions = (req) => {
  const options = {
    httpOnly: true,
    secure: COOKIE_SECURE || req?.secure || req?.headers['x-forwarded-proto'] === 'https',
    sameSite: COOKIE_SAME_SITE,
    path: '/',
    priority: 'high',
  };

  if (COOKIE_DOMAIN) {
    options.domain = COOKIE_DOMAIN;
  }

  return options;
};

const tokenMaxAgeMs = (token) => {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== 'object' || !decoded.exp) {
    return undefined;
  }

  const ms = Number(decoded.exp) * 1000 - Date.now();
  return ms > 0 ? ms : undefined;
};

const setAuthCookie = (res, token, req) => {
  const options = buildCookieOptions(req);
  const maxAge = tokenMaxAgeMs(token);
  if (maxAge) {
    options.maxAge = maxAge;
  }
  res.cookie(AUTH_COOKIE_NAME, token, options);
};

const clearAuthCookie = (res, req) => {
  res.clearCookie(AUTH_COOKIE_NAME, buildCookieOptions(req));
};

/* ---------------- ROUTES ---------------- */

const loginHandler = (req, res) => {
  const { username, password } = req.body || {};
  const existingAttempt = getLoginAttemptState(req);
  if (existingAttempt?.blockedUntilMs && existingAttempt.blockedUntilMs > Date.now()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existingAttempt.blockedUntilMs - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    pushDebugEvent('warn', 'Dashboard login rate limited', { ip: normalizeIp(req.ip || req.socket?.remoteAddress || '') }, true);
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const authUser = appDb.findUserByUsername(username);
  const validPass = Boolean(
    authUser &&
    !authUser.isDisabled &&
    verifyPassword(password || '', authUser.passwordHash)
  );

  if (!validPass) {
    const usernameHint = (username || '(empty)').slice(0, 2);
    const attempt = registerLoginFailure(req);
    pushDebugEvent('warn', 'Dashboard login failed', { usernameHint: `${usernameHint}***` }, true);
    return res.status(401).json({
      error: 'Invalid credentials',
      attemptsRemaining: Math.max(0, LOGIN_MAX_ATTEMPTS - attempt.count),
    });
  }

  clearLoginFailures(req);
  invalidateSessionFromToken(readToken(req));

  const session = createSession(req, authUser);
  const token = issueToken(session);
  setAuthCookie(res, token, req);

  pushDebugEvent('info', 'Dashboard login success', { username: authUser.username, role: authUser.role }, true);
  return res.json({
    success: true,
    expiresIn: TOKEN_TTL,
    cookieName: AUTH_COOKIE_NAME,
    session: {
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      absoluteTimeoutMs: SESSION_ABSOLUTE_TIMEOUT_MS,
    },
    permissions: buildPermissions({ user: { role: authUser.role } }),
    user: { username: authUser.username, role: authUser.role },
  });
};

const meHandler = (req, res) => {
  return res.json({
    session: {
      idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
      absoluteTimeoutMs: SESSION_ABSOLUTE_TIMEOUT_MS,
      createdAt: req.session ? new Date(req.session.createdAtMs).toISOString() : null,
      lastSeenAt: req.session ? new Date(req.session.lastSeenAtMs).toISOString() : null,
    },
    permissions: buildPermissions(req),
    user: {
      username: req.user?.sub || req.session?.username || BOOTSTRAP_DASHBOARD_USER,
      role: req.user?.role || req.session?.role || 'admin',
    },
  });
};

const verifyHandler = (req, res) => res.status(204).end();
const verifyAdminHandler = (req, res) => res.status(204).end();

const logoutHandler = (req, res) => {
  invalidateSessionFromToken(readToken(req));
  clearAuthCookie(res, req);
  pushDebugEvent('info', 'Dashboard logout', null, true);
  return res.json({ success: true });
};

app.post('/auth/login', loginHandler);
app.post('/api/auth/login', loginHandler);
app.get('/auth/me', requireAuth, meHandler);
app.get('/api/auth/me', requireAuth, meHandler);
app.get('/auth/verify', requireAuth, verifyHandler);
app.get('/api/auth/verify', requireAuth, verifyHandler);
app.get('/auth/verify-admin', requireAuth, requireAdmin, verifyAdminHandler);
app.get('/api/auth/verify-admin', requireAuth, requireAdmin, verifyAdminHandler);
app.post('/auth/logout', logoutHandler);
app.post('/api/auth/logout', logoutHandler);

const statusHandler = (req, res) => {
  res.json({
    uptime: `${(os.uptime() / 3600).toFixed(1)} hrs`,
  });
};

const servicesHandler = async (req, res) => {
  const [result, controlledServiceNames, serviceCatalog] = await Promise.all([
    getServicesSnapshot(),
    getControlledServiceNames(),
    buildServiceCatalog(),
  ]);

  pushDebugEvent('info', 'Services snapshot served', { count: Object.keys(result).length });
  res.json({
    controller: {
      locked: !isServiceControllerUnlocked(req.session?.id),
      optionalServices: controlledServiceNames,
    },
    services: result,
    serviceCatalog,
    serviceGroups: buildServiceGroups(serviceCatalog),
    mediaWorkflow: buildMediaWorkflowSnapshot(serviceCatalog),
  });
};

const controlUnlockHandler = (req, res) => {
  const password = String(req.body?.adminPassword || '');
  if (!password) {
    return res.status(400).json({ error: 'Admin password is required' });
  }

  if (!secureCompare(password, ADMIN_ACTION_PASSWORD)) {
    pushAuditEvent(req, 'warn', 'Service controller unlock rejected (bad admin password)');
    return res.status(403).json({ error: 'Invalid admin password' });
  }

  const expiresAt = unlockServiceController(req.session?.id);
  pushAuditEvent(req, 'info', 'Service controller unlocked', { expiresAt: new Date(expiresAt).toISOString() });
  return res.json({
    success: true,
    locked: false,
    expiresAt: new Date(expiresAt).toISOString(),
  });
};

const controlLockHandler = (req, res) => {
  if (req.session?.id) {
    unlockedServiceControllers.delete(req.session.id);
  }

  pushAuditEvent(req, 'info', 'Service controller locked');
  return res.json({ success: true, locked: true });
};

const controlHandler = async (req, res) => {
  const { service, action, adminPassword } = req.body || {};
  const controlledServiceNames = await getManageableServiceNames();

  if (!controlledServiceNames.includes(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  if (!SERVICES[service][action]) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const providedPassword = String(adminPassword || '').trim();
  const unlocked = isServiceControllerUnlocked(req.session?.id);

  if (!unlocked) {
    if (!providedPassword) {
      return res.status(423).json({ error: 'Service controller is locked' });
    }
    if (!secureCompare(providedPassword, ADMIN_ACTION_PASSWORD)) {
      pushAuditEvent(req, 'warn', 'Service control rejected (bad admin password)', { service, action });
      return res.status(403).json({ error: 'Invalid admin password' });
    }
    unlockServiceController(req.session?.id);
  } else if (providedPassword && !secureCompare(providedPassword, ADMIN_ACTION_PASSWORD)) {
    pushAuditEvent(req, 'warn', 'Service control rejected (bad admin password)', { service, action });
    return res.status(403).json({ error: 'Invalid admin password' });
  }

  try {
    const svc = SERVICES[service];

    if (['start', 'restart'].includes(action)) {
        const install = await resolveServiceInstall(service, svc);
        if (!install.available) {
          const error = `Command '${install.label}' is not installed`;
          pushAuditEvent(req, 'error', `${service} ${action} failed`, { error, service, action });
          return res.status(500).json({ error });
        }
    }

    const output = await runCommand(svc[action]);
    const expectedRunning = action !== 'stop';
    const running = await waitForServiceState(svc, expectedRunning);
    serviceStateCache[service] = classifyServiceState(running);

    pushAuditEvent(
      req,
      running === expectedRunning ? 'info' : 'warn',
      `${service} ${action} requested`,
      { running, expectedRunning, output: output || '(no output)', service, action }
    );
    res.json({
      success: running === expectedRunning,
      running,
      expectedRunning,
      output,
    });
  } catch (err) {
    const errorText = String(err || 'Unknown error');
    const hint = errorText.includes('Operation not permitted')
      ? 'Permission denied while controlling service. Stop root-owned process first or run service as the same user.'
      : null;
    pushAuditEvent(req, 'error', `${service} ${action} failed`, { error: errorText, hint, service, action });
    res.status(500).json({ error: errorText, hint });
  }
};

const monitorHandler = async (req, res) => {
  const payload = await getMonitorSnapshot();

  res.json(payload);
  pushDebugEvent('info', 'Monitor snapshot served', { cpuLoad: Number(payload.cpuLoad.toFixed(2)) });
};

const telemetryHandler = async (req, res) => {
  try {
    const payload = await getTelemetrySnapshot(req.session?.id);
    res.json(payload);
  } catch (err) {
    pushDebugEvent('error', 'Telemetry snapshot failed', { error: String(err) }, true);
    res.status(500).json({ error: 'Unable to build telemetry snapshot' });
  }
};

const connectionsHandler = (req, res) => {
  const payload = getConnectionsSnapshot();

  pushDebugEvent('info', 'Connections snapshot served', { count: payload.users.length });
  res.json(payload);
};

const disconnectConnectionHandler = (req, res) => {
  const sessionId = String(req.params.id || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: 'Connection id is required' });
  }

  if (sessionId === String(req.session?.id || '')) {
    return res.status(400).json({ error: 'You cannot disconnect your current session' });
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  invalidateSession(sessionId);

  for (const [key, entry] of recentConnections.entries()) {
    if (entry.sessionId === sessionId) {
      recentConnections.delete(key);
    }
  }

  pushAuditEvent(req, 'warn', 'Dashboard session disconnected', {
    sessionId,
    username: session.username,
  });

  return res.json({
    sessionId,
    success: true,
    username: session.username,
  });
};

const storageHandler = async (req, res) => {
  try {
    const payload = await getStorageSnapshot();
    pushDebugEvent('info', 'Storage snapshot served', { count: payload.mounts.length });
    res.json(payload);
  } catch (err) {
    pushDebugEvent('error', 'Storage snapshot failed', { error: String(err) }, true);
    res.status(500).json({ error: String(err), mounts: [], summary: { totalSize: 0, totalUsed: 0 } });
  }
};

const logsHandler = (req, res) => {
  res.json(getLogsSnapshot());
};

const loggingGetHandler = (req, res) => {
  res.json({
    verboseLoggingEnabled,
    markdown: buildMarkdownLog(80),
  });
};

const loggingPostHandler = (req, res) => {
  verboseLoggingEnabled = Boolean(req.body?.enabled);
  appDb.setSetting('logging.verboseEnabled', verboseLoggingEnabled ? 'true' : 'false');
  pushAuditEvent(req, 'info', verboseLoggingEnabled ? 'Verbose logging enabled' : 'Verbose logging disabled');
  res.json({
    success: true,
    verboseLoggingEnabled,
    markdown: buildMarkdownLog(80),
  });
};

const dashboardHandler = async (req, res) => {
  try {
    const payload = await getDashboardSnapshot(req.session?.id);
    res.json(payload);
  } catch (err) {
    pushDebugEvent('error', 'Dashboard snapshot failed', { error: String(err) }, true);
    res.status(500).json({ error: 'Unable to build dashboard snapshot' });
  }
};

const drivesHandler = async (req, res) => {
  res.json(await getDriveSnapshot());
};

const drivesCheckHandler = async (req, res) => {
  const agentInstalled = fileIsExecutable(DRIVE_AGENT_CMD) || await commandExists(DRIVE_AGENT_CMD);
  if (!agentInstalled) {
    return res.status(503).json({ error: 'termux-drive-agent is not installed', agentInstalled: false });
  }

  try {
    await runCommand(`${DRIVE_AGENT_CMD} scan`);
    const payload = await getDriveSnapshot();
    pushAuditEvent(req, 'info', 'Drive agent scan requested', { count: payload.manifest.drives.length });
    return res.json({ success: true, ...payload });
  } catch (err) {
    const error = String(err || 'Drive scan failed');
    pushAuditEvent(req, 'error', 'Drive agent scan failed', { error });
    return res.status(500).json({ error, ...(await getDriveSnapshot()) });
  }
};

const sanitizeShareName = (value = '') => String(value || '').replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

const sharesHandler = async (req, res) => {
  const shares = await syncManagedShares();
  res.json({ shares });
};

const usersHandler = (req, res) => {
  res.json({ users: appDb.listUsers() });
};

const createUserHandler = (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username || '');
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || 'user').trim().toLowerCase();
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or user' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (appDb.findUserByUsername(username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const user = appDb.createUser({ username, password, role, isDisabled: false });
    pushAuditEvent(req, 'info', 'User created', { userId: user.id, username: user.username, role: user.role });
    return res.status(201).json({ user });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to create user');
    pushAuditEvent(req, 'error', 'User creation failed', { error: message });
    return res.status(400).json({ error: message });
  }
};

const updateUserHandler = (req, res) => {
  try {
    const user = appDb.getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const nextRole = req.body?.role == null ? user.role : String(req.body.role || '').trim().toLowerCase();
    if (!['admin', 'user'].includes(nextRole)) {
      return res.status(400).json({ error: 'Role must be admin or user' });
    }

    const disableRequested = req.body?.isDisabled === true;
    const password = req.body?.password == null ? '' : String(req.body.password || '');

    if (user.username === String(req.user?.sub || req.session?.username || '').trim() && disableRequested) {
      return res.status(400).json({ error: 'You cannot disable your own account' });
    }
    if (user.username === String(req.user?.sub || req.session?.username || '').trim() && nextRole !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }

    const updatedUser = appDb.updateUser(user.id, {
      isDisabled: disableRequested,
      role: nextRole,
    });
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      appDb.setUserPassword(user.id, password);
    }

    pushAuditEvent(req, 'info', 'User updated', {
      userId: updatedUser.id,
      username: updatedUser.username,
      role: updatedUser.role,
      isDisabled: updatedUser.isDisabled,
      passwordChanged: Boolean(password),
    });
    return res.json({ user: appDb.getUserById(user.id) });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to update user');
    pushAuditEvent(req, 'error', 'User update failed', { error: message, userId: req.params.id });
    return res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
  }
};

const updateShareHandler = async (req, res) => {
  try {
    const existing = appDb.getShareById(req.params.id, { includePermissions: true });
    if (!existing) {
      return res.status(404).json({ error: 'Share not found' });
    }

    const requestedName = sanitizeShareName(req.body?.name || existing.name);
    if (!requestedName) {
      return res.status(400).json({ error: 'Share name is required' });
    }

    const defaultRoleAccess = normalizeAccessLevel(req.body?.defaultRoleAccess || 'deny', 'deny');
    const userPermissions = Array.isArray(req.body?.userPermissions)
      ? req.body.userPermissions
          .map((entry) => ({
            accessLevel: String(entry?.accessLevel || '').trim().toLowerCase(),
            subjectKey: normalizeUsername(entry?.username).toLowerCase(),
          }))
          .filter((entry) => entry.subjectKey && ['deny', 'read', 'write'].includes(entry.accessLevel) && appDb.findUserByUsername(entry.subjectKey))
      : [];
    const existingPermissions = Array.isArray(existing.permissions) ? existing.permissions : [];
    const preservedPermissions = existingPermissions.filter((entry) => {
      if (entry.subjectType === 'user') {
        return false;
      }
      if (entry.subjectType !== 'role') {
        return true;
      }
      const subjectKey = String(entry.subjectKey || '').toLowerCase();
      return subjectKey !== 'admin' && subjectKey !== 'user';
    });

    const permissions = [
      ...preservedPermissions,
      { subjectType: 'role', subjectKey: 'admin', accessLevel: 'write' },
      { subjectType: 'role', subjectKey: 'user', accessLevel: defaultRoleAccess },
      ...userPermissions.map((entry) => ({ subjectType: 'user', subjectKey: entry.subjectKey, accessLevel: entry.accessLevel })),
    ];

    const share = appDb.updateShare(existing.id, {
      description: String(req.body?.description || '').trim(),
      isHidden: req.body?.isHidden === true,
      isReadOnly: req.body?.isReadOnly === true,
      name: requestedName,
      permissions,
      sourceType: existing.sourceType,
    });

    pushAuditEvent(req, 'info', 'Share updated', {
      shareId: share.id,
      shareName: share.name,
      defaultRoleAccess,
      isHidden: share.isHidden,
      isReadOnly: share.isReadOnly,
    });
    res.json({ share });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to update share');
    pushAuditEvent(req, 'error', 'Share update failed', { error: message, shareId: req.params.id });
    res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
  }
};

const createShareHandler = async (req, res) => {
  let createdPath = '';
  try {
    const name = sanitizeShareName(req.body?.name || '');
    if (!name) {
      return res.status(400).json({ error: 'Share name is required' });
    }

    const description = String(req.body?.description || '').trim();
    const defaultRoleAccess = normalizeAccessLevel(req.body?.defaultRoleAccess || 'deny', 'deny');
    const rawPathKey = normalizeLocalRelativePath(req.body?.pathKey || name);
    const pathSegments = relativeSegments(rawPathKey);
    if (pathSegments.length !== 1) {
      return res.status(400).json({ error: 'Share paths must be a single top-level folder name' });
    }
    const pathKey = pathSegments[0];
    if (!pathKey) {
      return res.status(400).json({ error: 'Share path is required' });
    }
    if (FS_HIDDEN_NAMES.has(pathKey)) {
      return res.status(400).json({ error: 'This share path is reserved' });
    }

    const targetPath = resolveFsPath(pathKey).absolutePath;
    if (fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'A share or folder with that path already exists' });
    }

    fs.mkdirSync(targetPath, { recursive: true });
    createdPath = targetPath;
    const share = appDb.createShare({
      description,
      name,
      pathKey,
      permissions: [
        { subjectType: 'role', subjectKey: 'admin', accessLevel: 'write' },
        { subjectType: 'role', subjectKey: 'user', accessLevel: defaultRoleAccess },
      ],
      sourceType: 'folder',
    });
    pushAuditEvent(req, 'info', 'Share created', { shareId: share.id, shareName: share.name, pathKey: share.pathKey });
    res.status(201).json({ share });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to create share');
    if (createdPath) {
      fs.rmSync(createdPath, { recursive: true, force: true });
    }
    pushAuditEvent(req, 'error', 'Share creation failed', { error: message });
    res.status(400).json({ error: message });
  }
};

const filesystemListHandler = async (req, res) => {
  try {
    res.json(await listFilesystemDirectory(req.query.path || '', req));
  } catch (err) {
    const message = String(err?.message || err || 'Unable to list files');
    const status = Number(err?.statusCode) || (/not found/i.test(message) ? 404 : 400);
    pushDebugEvent('error', 'Filesystem list failed', { error: message, path: String(req.query.path || '') }, true);
    res.status(status).json({ error: message });
  }
};

const filesystemMkdirHandler = async (req, res) => {
  try {
    const parentPath = normalizeLocalRelativePath(req.body?.path || '');
    if (!parentPath) {
      return res.status(400).json({ error: 'Create shares from the root instead of raw folders' });
    }
    await ensureShareAccess(parentPath, req, 'write');
    const folderName = path.basename(String(req.body?.name || '').replace(/[\\/]+/g, ' ').trim());
    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const targetRelative = normalizeLocalRelativePath(path.join(parentPath, folderName));
    if (await isProtectedFsPath(targetRelative)) {
      return res.status(403).json({ error: 'This destination is protected' });
    }
    const { absolutePath } = resolveFsPath(targetRelative);
    if (fs.existsSync(absolutePath)) {
      return res.status(400).json({ error: 'Target already exists' });
    }

    fs.mkdirSync(absolutePath, { recursive: true });
    pushAuditEvent(req, 'info', 'Filesystem directory created', { path: targetRelative });
    res.json({ success: true, path: targetRelative });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to create folder');
    pushAuditEvent(req, 'error', 'Filesystem mkdir failed', { error: message });
    res.status(400).json({ error: message });
  }
};

const filesystemRenameHandler = async (req, res) => {
  try {
    const sourceRelative = normalizeLocalRelativePath(req.body?.path || '');
    const nextName = path.basename(String(req.body?.name || '').replace(/[\\/]+/g, ' ').trim());
    if (!sourceRelative || !nextName) {
      return res.status(400).json({ error: 'Path and next name are required' });
    }
    await ensureShareAccess(sourceRelative, req, 'write');
    if (await isProtectedFsPath(sourceRelative)) {
      return res.status(403).json({ error: 'This path cannot be renamed' });
    }

    const parentRelative = path.dirname(sourceRelative) === '.' ? '' : path.dirname(sourceRelative);
    const targetRelative = normalizeLocalRelativePath(path.join(parentRelative, nextName));
    if (await isProtectedFsPath(targetRelative)) {
      return res.status(403).json({ error: 'This destination is protected' });
    }
    const sourcePath = resolveFsPath(sourceRelative).absolutePath;
    const targetPath = resolveFsPath(targetRelative).absolutePath;
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Source path not found' });
    }
    if (fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'Target already exists' });
    }

    fs.renameSync(sourcePath, targetPath);
    pushAuditEvent(req, 'info', 'Filesystem entry renamed', { from: sourceRelative, to: targetRelative });
    res.json({ success: true, path: targetRelative });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to rename entry');
    pushAuditEvent(req, 'error', 'Filesystem rename failed', { error: message });
    res.status(400).json({ error: message });
  }
};

const filesystemDeleteHandler = async (req, res) => {
  try {
    const sourceRelatives = Array.isArray(req.body?.paths)
      ? req.body.paths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
      : [];
    const singleRelative = normalizeLocalRelativePath(req.body?.path || '');
    const targets = sourceRelatives.length > 0
      ? [...new Set(sourceRelatives)]
      : singleRelative
        ? [singleRelative]
        : [];

    if (targets.length === 0) {
      return res.status(400).json({ error: 'At least one path is required' });
    }

    const recycledItems = [];
    const failures = [];

    for (const sourceRelative of targets) {
      try {
        await ensureShareAccess(sourceRelative, req, 'write');
        if (await isProtectedFsPath(sourceRelative)) {
          throw new Error('This path cannot be deleted');
        }

        const { absolutePath } = resolveFsPath(sourceRelative);
        if (!fs.existsSync(absolutePath)) {
          throw new Error('Path not found');
        }

        const recycled = moveFsEntryToRecycleBin(sourceRelative);
        recycledItems.push({
          path: sourceRelative,
          recyclePath: recycled.path,
          recycledAt: recycled.recycledAt,
        });
        pushAuditEvent(req, 'info', 'Filesystem entry recycled', { from: sourceRelative, to: recycled.path, recycledAt: recycled.recycledAt });
      } catch (error) {
        failures.push({
          error: String(error instanceof Error ? error.message : error || 'Unable to delete entry'),
          path: sourceRelative,
        });
      }
    }

    if (recycledItems.length === 0) {
      return res.status(400).json({
        error: failures[0]?.error || 'Unable to delete entries',
        failureCount: failures.length,
        failures,
        successCount: 0,
      });
    }

    res.json({
      success: failures.length === 0,
      recycled: true,
      recyclePath: recycledItems[0]?.recyclePath || '',
      recycledItems,
      failureCount: failures.length,
      failures,
      successCount: recycledItems.length,
    });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to delete entry');
    pushAuditEvent(req, 'error', 'Filesystem delete failed', { error: message });
    res.status(400).json({ error: message });
  }
};

const filesystemDownloadHandler = async (req, res) => {
  try {
    const relativePath = normalizeLocalRelativePath(req.query.path || '');
    if (!relativePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    await ensureShareAccess(relativePath, req, 'read');

    const { absolutePath } = resolveFsPath(relativePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'Only file downloads are supported right now' });
    }

    pushAuditEvent(req, 'info', 'Filesystem file download requested', { path: relativePath });
    res.download(absolutePath, path.basename(absolutePath));
  } catch (err) {
    const message = String(err?.message || err || 'Unable to download file');
    pushAuditEvent(req, 'error', 'Filesystem download failed', { error: message });
    res.status(400).json({ error: message });
  }
};

const filesystemUploadHandler = async (req, res) => {
  try {
    const parentRelative = normalizeLocalRelativePath(req.query.path || '');
    if (!parentRelative) {
      return res.status(400).json({ error: 'Upload into a share folder, not the root' });
    }
    await ensureShareAccess(parentRelative, req, 'write');
    const fileName = path.basename(String(req.query.name || req.headers['x-file-name'] || '').replace(/[\\/]+/g, ' ').trim());
    if (!fileName) {
      return res.status(400).json({ error: 'A file name is required' });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Upload body is missing' });
    }

    const targetRelative = normalizeLocalRelativePath(path.join(parentRelative, fileName));
    if (await isProtectedFsPath(targetRelative)) {
      return res.status(403).json({ error: 'This destination is protected' });
    }
    const { absolutePath } = resolveFsPath(targetRelative);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, req.body);
    pushAuditEvent(req, 'info', 'Filesystem file uploaded', { path: targetRelative, size: req.body.length });
    res.json({ success: true, path: targetRelative });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to upload file');
    pushAuditEvent(req, 'error', 'Filesystem upload failed', { error: message });
    res.status(400).json({ error: message });
  }
};

const filesystemPasteHandler = async (req, res) => {
  try {
    const sourceRelatives = Array.isArray(req.body?.sourcePaths)
      ? req.body.sourcePaths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
      : [];
    const sourceRelative = normalizeLocalRelativePath(req.body?.sourcePath || '');
    const destinationRelative = normalizeLocalRelativePath(req.body?.destinationPath || '');
    const mode = String(req.body?.mode || 'copy').toLowerCase();
    const sources = sourceRelatives.length > 0
      ? [...new Set(sourceRelatives)]
      : sourceRelative
        ? [sourceRelative]
        : [];

    if (sources.length === 0 || !destinationRelative) {
      return res.status(400).json({ error: 'Source paths and destination path are required' });
    }
    if (mode !== 'copy' && mode !== 'move') {
      return res.status(400).json({ error: 'Mode must be copy or move' });
    }
    await ensureShareAccess(destinationRelative, req, 'write');

    ensureFsTargetAllowed(destinationRelative);

    const destination = resolveFsPath(destinationRelative);
    if (!fs.existsSync(destination.absolutePath) || !fs.statSync(destination.absolutePath).isDirectory()) {
      return res.status(400).json({ error: 'Destination must be an existing folder' });
    }

    const pastedItems = [];
    const failures = [];

    for (const sourceItemRelative of sources) {
      try {
        await ensureShareAccess(sourceItemRelative, req, mode === 'move' ? 'write' : 'read');
        if (await isProtectedFsPath(sourceItemRelative)) {
          throw new Error(`This path cannot be ${mode === 'move' ? 'moved' : 'copied'}`);
        }

        const source = resolveFsPath(sourceItemRelative);
        if (!fs.existsSync(source.absolutePath)) {
          throw new Error('Source path not found');
        }

        const targetRelative = normalizeLocalRelativePath(path.join(destination.relativePath, path.basename(source.relativePath)));
        if (await isProtectedFsPath(targetRelative)) {
          throw new Error('This destination is protected');
        }

        const target = resolveFsPath(targetRelative);
        if (fs.existsSync(target.absolutePath)) {
          throw new Error('A file or folder with that name already exists in the destination');
        }
        if (target.absolutePath.startsWith(`${source.absolutePath}${path.sep}`)) {
          throw new Error('Cannot paste a folder into itself');
        }

        if (mode === 'move') {
          moveFsEntry(source.absolutePath, target.absolutePath);
        } else {
          copyFsEntry(source.absolutePath, target.absolutePath);
        }

        pastedItems.push({
          from: sourceItemRelative,
          path: targetRelative,
        });
      } catch (error) {
        failures.push({
          error: String(error instanceof Error ? error.message : error || 'Unable to paste entry'),
          path: sourceItemRelative,
        });
      }
    }

    if (pastedItems.length === 0) {
      return res.status(400).json({
        error: failures[0]?.error || 'Unable to paste entries',
        failureCount: failures.length,
        failures,
        successCount: 0,
      });
    }

    pushAuditEvent(req, 'info', `Filesystem entr${pastedItems.length === 1 ? 'y' : 'ies'} ${mode}d`, {
      destination: destinationRelative,
      failureCount: failures.length,
      items: pastedItems,
    });
    res.json({
      success: failures.length === 0,
      path: pastedItems[0]?.path || '',
      pastedItems,
      failureCount: failures.length,
      failures,
      successCount: pastedItems.length,
    });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to paste entry');
    pushAuditEvent(req, 'error', 'Filesystem paste failed', { error: message });
    res.status(400).json({ error: message });
  }
};

const ftpDefaultsHandler = (req, res) => {
  const ftpMounting = getCloudMountCapability();
  res.json({
    defaultName: DEFAULT_PS4_FTP_NAME,
    host: process.env.FTP_CLIENT_HOST || DEFAULT_PS4_HOST,
    password: process.env.FTP_CLIENT_PASSWORD || DEFAULT_PS4_PASSWORD,
    port: Number(process.env.FTP_CLIENT_PORT || DEFAULT_PS4_PORT),
    user: process.env.FTP_CLIENT_USER || DEFAULT_PS4_USER,
    secure: process.env.FTP_CLIENT_SECURE === 'true',
    downloadRoot: FTP_CLIENT_DOWNLOAD_ROOT,
    ftpMounting,
  });
};

const ftpFavouritesHandler = (req, res) => {
  res.json({
    favourites: appDb.listFtpFavourites().map(serializeFtpFavourite),
  });
};

const createFtpFavouriteHandler = (req, res) => {
  try {
    const favourite = appDb.createFtpFavourite(validateFtpFavouriteInput(req.body || {}));
    pushAuditEvent(req, 'info', 'FTP favourite created', { id: favourite.id, name: favourite.name });
    res.status(201).json({ favourite: serializeFtpFavourite(favourite) });
  } catch (err) {
    const error = String(err?.message || err || 'Unable to create FTP favourite');
    pushAuditEvent(req, 'error', 'FTP favourite creation failed', { error });
    res.status(400).json({ error });
  }
};

const updateFtpFavouriteHandler = async (req, res) => {
  try {
    const existing = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });
    const currentMount = getFtpMountState(existing);
    if (currentMount.mounted || currentMount.running) {
      await unmountFtpFavourite(existing).catch(() => {});
    }

    const favourite = appDb.updateFtpFavourite(existing.id, validateFtpFavouriteInput(req.body || {}, existing));
    pushAuditEvent(req, 'info', 'FTP favourite updated', { id: favourite.id, name: favourite.name });
    res.json({ favourite: serializeFtpFavourite(favourite) });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to update FTP favourite');
    const status = /not found/i.test(message) ? 404 : 400;
    pushAuditEvent(req, 'error', 'FTP favourite update failed', { error: message });
    res.status(status).json({ error: message });
  }
};

const deleteFtpFavouriteHandler = async (req, res) => {
  try {
    const favourite = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });

    await unmountFtpFavourite(favourite).catch(() => {});
    appDb.deleteFtpFavourite(favourite.id);
    fs.rmSync(getFtpFavouriteRuntime(favourite).helperRequestPath, { force: true });

    pushAuditEvent(req, 'info', 'FTP favourite deleted', { id: favourite.id, name: favourite.name });
    res.json({ success: true });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to delete FTP favourite');
    const status = /not found/i.test(message) ? 404 : 400;
    pushAuditEvent(req, 'error', 'FTP favourite deletion failed', { error: message });
    res.status(status).json({ error: message });
  }
};

const mountFtpFavouriteHandler = async (req, res) => {
  try {
    const favourite = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });
    const mount = await mountFtpFavourite(favourite);
    const payload = serializeFtpFavourite(getFtpFavouriteOrThrow(favourite.id, { includeSecrets: false }));

    if (!mount.mounted) {
      const error = mount.error || mount.reason || 'Mount failed on this host';
      pushAuditEvent(req, 'error', 'FTP favourite mount failed', { id: favourite.id, name: favourite.name, error });
      return res.status(500).json({ error, favourite: payload });
    }

    pushAuditEvent(req, 'info', 'FTP favourite mounted', { id: favourite.id, name: favourite.name, mountPoint: mount.mountPoint });
    return res.json({ success: true, favourite: payload });
  } catch (err) {
    const error = String(err?.message || err || 'Unable to mount FTP favourite');
    pushAuditEvent(req, 'error', 'FTP favourite mount failed', { error, id: req.params.id });
    return res.status(500).json({ error });
  }
};

const unmountFtpFavouriteHandler = async (req, res) => {
  try {
    const favourite = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });
    await unmountFtpFavourite(favourite);
    pushAuditEvent(req, 'info', 'FTP favourite unmounted', { id: favourite.id, name: favourite.name });
    res.json({
      success: true,
      favourite: serializeFtpFavourite(getFtpFavouriteOrThrow(favourite.id, { includeSecrets: false })),
    });
  } catch (err) {
    const error = String(err?.message || err || 'Unable to unmount FTP favourite');
    pushAuditEvent(req, 'error', 'FTP favourite unmount failed', { error, id: req.params.id });
    res.status(500).json({ error });
  }
};

const ftpListHandler = async (req, res) => {
  try {
    const payload = await listFtpDirectory(req.body || {});
    pushAuditEvent(req, 'info', 'FTP directory listed', { host: payload.connection.host, path: payload.path, count: payload.entries.length }, false);
    res.json(payload);
  } catch (err) {
    const error = String(err?.message || err || 'FTP list failed');
    pushAuditEvent(req, 'error', 'FTP list failed', { error });
    res.status(500).json({ error });
  }
};

const ftpDownloadHandler = async (req, res) => {
  try {
    const resolvedPayload = resolveFtpFavouritePayload(req.body || {});
    const remotePath = normalizeRemotePath(req.body?.remotePath || '/');
    const remoteName = path.posix.basename(remotePath);
    const recursive = req.body?.recursive === true || req.body?.recursive === 'true';
    const entryType = String(req.body?.entryType || (recursive ? 'directory' : 'file'));

    if (!remoteName || remoteName === '/' || remoteName === '.') {
      return res.status(400).json({ error: 'A remote path is required for download' });
    }

    const favourite = req.body?.favouriteId ? getFtpFavouriteOrThrow(req.body.favouriteId, { includeSecrets: false }) : null;
    const targetLabel = favourite
      ? sanitizeFtpFavouriteName(favourite.mountName || favourite.name, favourite.name)
      : sanitizeHostLabel(resolvedPayload.host);
    const targetRelative = normalizeLocalRelativePath(
      req.body?.targetPath || path.join(targetLabel, remoteName)
    );
    if (!targetRelative) {
      return res.status(400).json({ error: 'A valid local target path is required' });
    }

    const localPath = ensureWithinRoot(FTP_CLIENT_DOWNLOAD_ROOT, path.join(FTP_CLIENT_DOWNLOAD_ROOT, targetRelative));
    fs.mkdirSync(path.dirname(localPath), { recursive: true });

    await withFtpClient(resolvedPayload, async (client, access) => {
      if (recursive || entryType === 'directory') {
        const fileCount = await downloadFtpDirectoryTree(client, remotePath, localPath);
        pushAuditEvent(req, 'info', 'FTP directory downloaded', { host: access.host, remotePath, localPath, fileCount });
        return;
      }

      await client.downloadTo(localPath, remotePath);
      pushAuditEvent(req, 'info', 'FTP file downloaded', { host: access.host, remotePath, localPath });
    });

    res.json({
      success: true,
      entryType: recursive || entryType === 'directory' ? 'directory' : 'file',
      remotePath,
      localPath,
    });
  } catch (err) {
    const error = String(err?.message || err || 'FTP download failed');
    pushAuditEvent(req, 'error', 'FTP download failed', { error });
    res.status(500).json({ error });
  }
};

const ftpUploadHandler = async (req, res) => {
  try {
    const resolvedPayload = resolveFtpFavouritePayload(req.body || {});
    const localPath = String(req.body?.localPath || '').trim();
    const remotePath = normalizeRemotePath(req.body?.remotePath || '/');

    if (!localPath) {
      return res.status(400).json({ error: 'A local file path is required for upload' });
    }

    const localResolved = path.resolve(localPath);
    if (!fs.existsSync(localResolved)) {
      return res.status(400).json({ error: 'Local file does not exist' });
    }

    if (!fs.statSync(localResolved).isFile()) {
      return res.status(400).json({ error: 'Local path must be a file' });
    }

    await withFtpClient(resolvedPayload, async (client, access) => {
      await client.ensureDir(path.posix.dirname(remotePath));
      await client.uploadFrom(localResolved, remotePath);
      pushAuditEvent(req, 'info', 'FTP file uploaded', { host: access.host, remotePath, localPath: localResolved });
    });

    res.json({
      success: true,
      localPath: localResolved,
      remotePath,
    });
  } catch (err) {
    const error = String(err?.message || err || 'FTP upload failed');
    pushAuditEvent(req, 'error', 'FTP upload failed', { error });
    res.status(500).json({ error });
  }
};

const ftpMkdirHandler = async (req, res) => {
  try {
    const resolvedPayload = resolveFtpFavouritePayload(req.body || {});
    const remotePath = normalizeRemotePath(req.body?.remotePath || '/');

    await withFtpClient(resolvedPayload, async (client, access) => {
      await client.ensureDir(remotePath);
      pushAuditEvent(req, 'info', 'FTP directory created', { host: access.host, remotePath });
    });

    res.json({ success: true, remotePath });
  } catch (err) {
    const error = String(err?.message || err || 'FTP mkdir failed');
    pushAuditEvent(req, 'error', 'FTP mkdir failed', { error });
    res.status(500).json({ error });
  }
};

const registerDualRoute = (method, routePath, ...handlers) => {
  app[method](routePath, ...handlers);
  app[method](`/api${routePath}`, ...handlers);
};

registerDualRoute('get', '/status', requireAuth, statusHandler);
registerDualRoute('get', '/services', requireAuth, requireAdmin, servicesHandler);
registerDualRoute('post', '/control/unlock', requireAuth, requireAdmin, controlUnlockHandler);
registerDualRoute('post', '/control/lock', requireAuth, requireAdmin, controlLockHandler);
registerDualRoute('post', '/control', requireAuth, requireAdmin, controlHandler);
registerDualRoute('get', '/monitor', requireAuth, requireAdmin, monitorHandler);
registerDualRoute('get', '/dashboard', requireAuth, requireAdmin, dashboardHandler);
registerDualRoute('get', '/connections', requireAuth, requireAdmin, connectionsHandler);
registerDualRoute('post', '/connections/:id/disconnect', requireAuth, requireAdmin, disconnectConnectionHandler);
registerDualRoute('get', '/storage', requireAuth, requireAdmin, storageHandler);
registerDualRoute('get', '/logs', requireAuth, requireAdmin, logsHandler);
registerDualRoute('get', '/logging', requireAuth, requireAdmin, loggingGetHandler);
registerDualRoute('post', '/logging', requireAuth, requireAdmin, loggingPostHandler);
registerDualRoute('get', '/drives', requireAuth, requireAdmin, drivesHandler);
registerDualRoute('post', '/drives/check', requireAuth, requireAdmin, drivesCheckHandler);
registerDualRoute('get', '/shares', requireAuth, requireAdmin, sharesHandler);
registerDualRoute('post', '/shares', requireAuth, requireAdmin, createShareHandler);
registerDualRoute('put', '/shares/:id', requireAuth, requireAdmin, updateShareHandler);
registerDualRoute('get', '/users', requireAuth, requireAdmin, usersHandler);
registerDualRoute('post', '/users', requireAuth, requireAdmin, createUserHandler);
registerDualRoute('put', '/users/:id', requireAuth, requireAdmin, updateUserHandler);
registerDualRoute('get', '/telemetry', requireAuth, requireAdmin, telemetryHandler);
registerDualRoute('get', '/fs/list', requireAuth, filesystemListHandler);
registerDualRoute('post', '/fs/mkdir', requireAuth, filesystemMkdirHandler);
registerDualRoute('post', '/fs/rename', requireAuth, filesystemRenameHandler);
registerDualRoute('post', '/fs/delete', requireAuth, filesystemDeleteHandler);
registerDualRoute('get', '/fs/download', requireAuth, filesystemDownloadHandler);
registerDualRoute('post', '/fs/upload', requireAuth, express.raw({ type: '*/*', limit: '128mb' }), filesystemUploadHandler);
registerDualRoute('post', '/fs/paste', requireAuth, filesystemPasteHandler);
registerDualRoute('get', '/ftp/defaults', requireAuth, requireAdmin, ftpDefaultsHandler);
registerDualRoute('get', '/ftp/favourites', requireAuth, requireAdmin, ftpFavouritesHandler);
registerDualRoute('post', '/ftp/favourites', requireAuth, requireAdmin, createFtpFavouriteHandler);
registerDualRoute('put', '/ftp/favourites/:id', requireAuth, requireAdmin, updateFtpFavouriteHandler);
registerDualRoute('delete', '/ftp/favourites/:id', requireAuth, requireAdmin, deleteFtpFavouriteHandler);
registerDualRoute('post', '/ftp/favourites/:id/mount', requireAuth, requireAdmin, mountFtpFavouriteHandler);
registerDualRoute('post', '/ftp/favourites/:id/unmount', requireAuth, requireAdmin, unmountFtpFavouriteHandler);
registerDualRoute('post', '/ftp/list', requireAuth, requireAdmin, ftpListHandler);
registerDualRoute('post', '/ftp/download', requireAuth, requireAdmin, ftpDownloadHandler);
registerDualRoute('post', '/ftp/upload', requireAuth, requireAdmin, ftpUploadHandler);
registerDualRoute('post', '/ftp/mkdir', requireAuth, requireAdmin, ftpMkdirHandler);

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request body' });
  }

  if (err) {
    pushDebugEvent('error', 'Unexpected server error', { error: err.message || String(err) }, true);
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }

  return next();
});

/* ---------------- START ---------------- */

app.listen(PORT, BACKEND_BIND_HOST, () => {
  console.log(`🚀 Backend running on ${BACKEND_BIND_HOST}:${PORT}`);
  pushDebugEvent('info', 'Backend loaded', { host: BACKEND_BIND_HOST, port: PORT }, true);
});

setInterval(() => {
  pollServiceStateTransitions().catch((err) => {
    pushDebugEvent('error', 'Service state polling failed', { error: String(err) }, true);
  });
}, 10000);
