const fs = require('fs');
const path = require('path');
const { loadEnvFile } = require('node:process');
const express = require('express');
const cors = require('cors');
const os = require('os');
const crypto = require('crypto');
const { exec, execFileSync, spawn } = require('child_process');
const net = require('net');
const { Readable } = require('stream');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const jwt = require('jsonwebtoken');
const ftp = require('basic-ftp');
const { createAppContext } = require('../app-context');
const { createRouteRegistry } = require('../routes/registry');
const { registerAuthRoutes } = require('../routes/auth-routes');
const { createDualRouteRegistrar } = require('../routes/dual-route');
const { registerApiRoutes } = require('../routes/register-api-routes');
const {
  createAuthRouteHandlers,
  createControlPlaneRouteHandlers,
  createDashboardRouteHandlers,
  createFilesRouteHandlers,
  createFtpRouteHandlers,
  createLlmRouteHandlers,
  createServiceRouteHandlers,
  createSystemRouteHandlers,
} = require('../routes/route-handlers');
const { createControlPlane } = require('../infra/control-plane');
const { createAppDb, normalizeUsername, verifyPassword } = require('../../app-db');
const { parseDurationMs } = require('../../lib/time');
const {
  buildStorageBlockReasonForService,
  getStorageBlockForService,
  normalizeStorageRoleState,
  normalizeStringArray,
} = require('../../lib/storage-protection');
const { buildQbittorrentWebUiUrl, extractQbittorrentSidCookie } = require('../../lib/qb-webui');
const { isValidTorrentSource } = require('../../lib/torrent');
const { extractUpstreamErrorText, toClientFacingUpstreamError } = require('../../lib/upstream-errors');

const ENV_FILE = path.resolve(__dirname, '../../.env');
if (typeof loadEnvFile === 'function' && fs.existsSync(ENV_FILE)) {
  loadEnvFile(ENV_FILE);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
const ROOT_DIR = path.resolve(__dirname, '../..');
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(ROOT_DIR, '..');
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.join(PROJECT_ROOT, 'scripts');
const HOME_DIR = process.env.HOME || '/data/data/com.termux/files/home';
const MEDIA_SERVICES_HOME = process.env.MEDIA_SERVICES_HOME || path.join(HOME_DIR, 'services');
const PROOT_DISTRO_ALIAS = process.env.PROOT_DISTRO_ALIAS || 'debian-hs';
const CHROOT_ROOTFS = process.env.CHROOT_ROOTFS || path.join('/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs', PROOT_DISTRO_ALIAS);
const FILEBROWSER_ROOT = process.env.FILEBROWSER_ROOT || path.join(HOME_DIR, 'Drives');
const FTP_ROOT = process.env.FTP_ROOT || FILEBROWSER_ROOT;
const FTP_CLIENT_DOWNLOAD_ROOT = process.env.FTP_CLIENT_DOWNLOAD_ROOT || FILEBROWSER_ROOT;
const MEDIA_SHARE_NAME = process.env.MEDIA_SHARE_NAME || 'Media';
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(FILEBROWSER_ROOT, MEDIA_SHARE_NAME);
const VAULT_FALLBACK_LABEL = process.env.VAULT_FALLBACK_LABEL || 'VAULT_fallback';
const SCRATCH_FALLBACK_LABEL = process.env.SCRATCH_FALLBACK_LABEL || 'SCRATCH_fallback';
const MEDIA_VAULT_ROOT = process.env.MEDIA_VAULT_ROOT || path.join(FILEBROWSER_ROOT, `D (${VAULT_FALLBACK_LABEL})`, 'VAULT', 'Media');
const MEDIA_SCRATCH_ROOT = process.env.MEDIA_SCRATCH_ROOT || path.join(FILEBROWSER_ROOT, `E (${SCRATCH_FALLBACK_LABEL})`, 'SCRATCH', 'HmSTxScratch');
const MEDIA_VAULT_ROOTS = String(process.env.MEDIA_VAULT_ROOTS || MEDIA_VAULT_ROOT)
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const MEDIA_SCRATCH_ROOTS = String(process.env.MEDIA_SCRATCH_ROOTS || MEDIA_SCRATCH_ROOT)
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const MEDIA_MOVIES_DIR = process.env.MEDIA_MOVIES_DIR || path.join(MEDIA_VAULT_ROOT, 'movies');
const MEDIA_SERIES_DIR = process.env.MEDIA_SERIES_DIR || path.join(MEDIA_VAULT_ROOT, 'series');
const MEDIA_MUSIC_DIR = process.env.MEDIA_MUSIC_DIR || path.join(MEDIA_VAULT_ROOT, 'music');
const MEDIA_AUDIOBOOKS_DIR = process.env.MEDIA_AUDIOBOOKS_DIR || path.join(MEDIA_VAULT_ROOT, 'audiobooks');
const MEDIA_SCRATCH_LIBRARY_ROOT = process.env.MEDIA_SCRATCH_LIBRARY_ROOT || path.join(MEDIA_SCRATCH_ROOT, 'media');
const MEDIA_SCRATCH_MOVIES_DIR = process.env.MEDIA_SCRATCH_MOVIES_DIR || path.join(MEDIA_SCRATCH_LIBRARY_ROOT, 'movies');
const MEDIA_SCRATCH_SERIES_DIR = process.env.MEDIA_SCRATCH_SERIES_DIR || path.join(MEDIA_SCRATCH_LIBRARY_ROOT, 'series');
const MEDIA_SCRATCH_MUSIC_DIR = process.env.MEDIA_SCRATCH_MUSIC_DIR || path.join(MEDIA_SCRATCH_LIBRARY_ROOT, 'music');
const MEDIA_SCRATCH_AUDIOBOOKS_DIR = process.env.MEDIA_SCRATCH_AUDIOBOOKS_DIR || path.join(MEDIA_SCRATCH_LIBRARY_ROOT, 'audiobooks');
const MEDIA_DOWNLOADS_DIR = process.env.MEDIA_DOWNLOADS_DIR || path.join(MEDIA_SCRATCH_ROOT, 'downloads');
const MEDIA_DOWNLOADS_MOVIES_DIR = process.env.MEDIA_DOWNLOADS_MOVIES_DIR || path.join(MEDIA_DOWNLOADS_DIR, 'movies');
const MEDIA_DOWNLOADS_SERIES_DIR = process.env.MEDIA_DOWNLOADS_SERIES_DIR || path.join(MEDIA_DOWNLOADS_DIR, 'series');
const MEDIA_DOWNLOADS_MANUAL_DIR = process.env.MEDIA_DOWNLOADS_MANUAL_DIR || path.join(MEDIA_DOWNLOADS_DIR, 'manual');
const MEDIA_DOWNLOADS_TORRENT_DIR = process.env.MEDIA_DOWNLOADS_TORRENT_DIR || path.join(MEDIA_DOWNLOADS_DIR, 'torrent');
const MEDIA_DOWNLOADS_TORRENT_QBIT_DIR = process.env.MEDIA_DOWNLOADS_TORRENT_QBIT_DIR || path.join(MEDIA_DOWNLOADS_TORRENT_DIR, 'qbit');
const MEDIA_SMALL_DOWNLOADS_DIR = process.env.MEDIA_SMALL_DOWNLOADS_DIR || path.join(FILEBROWSER_ROOT, 'C', 'Download', 'Home-Server', 'small');
const MEDIA_SMALL_DOWNLOADS_MAX_MB = Math.max(1, Number(process.env.MEDIA_SMALL_DOWNLOADS_MAX_MB || 256) || 256);
const MEDIA_IMPORT_REVIEW_DIR = process.env.MEDIA_IMPORT_REVIEW_DIR || path.join(MEDIA_SCRATCH_ROOT, 'review');
const MEDIA_IMPORT_LOG_DIR = process.env.MEDIA_IMPORT_LOG_DIR || path.join(MEDIA_SCRATCH_ROOT, 'logs');
const MEDIA_IMPORT_STATUS_FILE = process.env.MEDIA_IMPORT_STATUS_FILE || path.join(MEDIA_IMPORT_LOG_DIR, 'import-status.json');
const MEDIA_CLEANUP_STATUS_FILE = process.env.MEDIA_CLEANUP_STATUS_FILE || path.join(MEDIA_IMPORT_LOG_DIR, 'cleanup-status.json');
const MEDIA_IMPORTED_INDEX_FILE = process.env.MEDIA_IMPORTED_INDEX_FILE || path.join(MEDIA_IMPORT_LOG_DIR, 'imported-items.tsv');
const MEDIA_IMPORT_EVENTS_FILE = process.env.MEDIA_IMPORT_EVENTS_FILE || path.join(MEDIA_IMPORT_LOG_DIR, 'import-events.tsv');
const MEDIA_TRANSCODE_DIR = process.env.MEDIA_TRANSCODE_DIR || path.join(MEDIA_SCRATCH_ROOT, 'cache', 'jellyfin');
const MEDIA_MISC_CACHE_DIR = process.env.MEDIA_MISC_CACHE_DIR || path.join(MEDIA_SCRATCH_ROOT, 'cache', 'misc');
const MEDIA_IPTV_CACHE_DIR = process.env.MEDIA_IPTV_CACHE_DIR || path.join(MEDIA_SCRATCH_ROOT, 'iptv-cache');
const MEDIA_IPTV_EPG_DIR = process.env.MEDIA_IPTV_EPG_DIR || path.join(MEDIA_SCRATCH_ROOT, 'iptv-epg');
const MEDIA_QBIT_TMP_DIR = process.env.MEDIA_QBIT_TMP_DIR || path.join(MEDIA_SCRATCH_ROOT, 'tmp', 'qbittorrent');
const parseDriveAvailableGiB = (target) => {
  if (!target) {
    return null;
  }
  try {
    const output = execFileSync('df', ['-Pk', target], { encoding: 'utf8', maxBuffer: 32 * 1024 });
    const lines = output.trim().split('\n');
    if (lines.length < 2) {
      return null;
    }
    const columns = lines[1].trim().split(/\s+/);
    const availableKb = Number(columns[3]);
    if (!Number.isFinite(availableKb)) {
      return null;
    }
    return Number((availableKb / 1024 / 1024).toFixed(2));
  } catch {
    return null;
  }
};
const buildDriveStats = (roots) => (
  roots.filter(Boolean).map((root) => ({
    path: root,
    availableGiB: parseDriveAvailableGiB(root),
  }))
);
const MEDIA_IMPORT_ABORT_FREE_GB = Math.max(1, Number(process.env.MEDIA_IMPORT_ABORT_FREE_GB || 200) || 200);
const MEDIA_VAULT_WARN_FREE_GB = Math.max(1, Number(process.env.MEDIA_VAULT_WARN_FREE_GB || 250) || 250);
const MEDIA_SCRATCH_WARN_FREE_GB = Math.max(1, Number(process.env.MEDIA_SCRATCH_WARN_FREE_GB || 150) || 150);
const MEDIA_SCRATCH_WARN_USED_PERCENT = Math.max(1, Number(process.env.MEDIA_SCRATCH_WARN_USED_PERCENT || 85) || 85);
const MEDIA_SCRATCH_RETENTION_DAYS = Math.max(1, Number(process.env.MEDIA_SCRATCH_RETENTION_DAYS || 30) || 30);
const MEDIA_SCRATCH_MIN_FREE_GB = Math.max(1, Number(process.env.MEDIA_SCRATCH_MIN_FREE_GB || 200) || 200);
const MEDIA_SCRATCH_CLEANUP_ENABLED = String(process.env.MEDIA_SCRATCH_CLEANUP_ENABLED || 'true').toLowerCase() === 'true';
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
const FS_OPERATIONS_STATE_DIR = process.env.FS_OPERATIONS_STATE_DIR || path.join(RUNTIME_DIR, 'fs-operations');
const FS_OPERATIONS_STAGING_DIR = process.env.FS_OPERATIONS_STAGING_DIR || path.join(FS_OPERATIONS_STATE_DIR, 'staging');
const TERMUX_CLOUD_MOUNT_CMD = process.env.TERMUX_CLOUD_MOUNT_CMD || '/data/data/com.termux/files/usr/bin/termux-cloud-mount';
const TERMUX_CLOUD_MOUNT_ROOT = process.env.TERMUX_CLOUD_MOUNT_ROOT || '/mnt/cloud/home-server';
const TERMUX_DRIVES_MIRROR_ROOT = process.env.TERMUX_DRIVES_MIRROR_ROOT || '/mnt/termux-drives';
const DRIVE_COMMON_SCRIPT = process.env.DRIVE_COMMON_SCRIPT || path.join(SCRIPTS_DIR, 'drive-common.sh');
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
const FLAREARR_PID = process.env.FLAREARR_PID_PATH || path.join(RUNTIME_DIR, 'flarearr.pid');
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
const FLAREARR_BIND_HOST = process.env.FLAREARR_BIND_HOST || '127.0.0.1';
const JELLYSEERR_BIND_HOST = process.env.JELLYSEERR_BIND_HOST || '127.0.0.1';
const NEXTJS_DASHBOARD_BIND_HOST = process.env.NEXTJS_DASHBOARD_BIND_HOST || '127.0.0.1';
const FTP_SERVER_PORT = Number(process.env.FTP_SERVER_PORT || 2121);
const COPYPARTY_PORT = Number(process.env.COPYPARTY_PORT || 3923);
const SYNCTHING_GUI_PORT = Number(process.env.SYNCTHING_GUI_PORT || 8384);
const SAMBA_PORT = Number(process.env.SAMBA_PORT || 445);
const JELLYFIN_PORT = Number(process.env.JELLYFIN_PORT || 8096);
const QBITTORRENT_PORT = Number(process.env.QBITTORRENT_PORT || 8081);
const QBITTORRENT_WEBUI_BASE_URL = String(process.env.QBITTORRENT_WEBUI_BASE_URL || `http://127.0.0.1:${QBITTORRENT_PORT}`).trim().replace(/\/+$/, '');
const QBITTORRENT_WEBUI_USERNAME = String(process.env.QBITTORRENT_WEBUI_USERNAME || '').trim();
const QBITTORRENT_WEBUI_PASSWORD = String(process.env.QBITTORRENT_WEBUI_PASSWORD || '').trim();
const QBITTORRENT_WEBUI_TIMEOUT_MS = Math.max(1000, Number(process.env.QBITTORRENT_WEBUI_TIMEOUT_MS || 5000) || 5000);
const QBITTORRENT_WEBUI_RETRY_COUNT = Math.max(0, Number(process.env.QBITTORRENT_WEBUI_RETRY_COUNT || 1) || 1);
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT || 5432);
const SONARR_PORT = Number(process.env.SONARR_PORT || 8989);
const RADARR_PORT = Number(process.env.RADARR_PORT || 7878);
const PROWLARR_PORT = Number(process.env.PROWLARR_PORT || 9696);
const BAZARR_PORT = Number(process.env.BAZARR_PORT || 6767);
const FLAREARR_PORT = Number(process.env.FLAREARR_PORT || 8191);
const JELLYSEERR_PORT = Number(process.env.JELLYSEERR_PORT || 5055);
const NEXTJS_DASHBOARD_PORT = Number(process.env.NEXTJS_DASHBOARD_PORT || 3000);
const JELLYFIN_BASE_URL = process.env.JELLYFIN_BASE_URL || `http://${JELLYFIN_BIND_HOST}:${JELLYFIN_PORT}`;
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY || '';
const JELLYFIN_API_TIMEOUT_MS = Math.max(800, Number(process.env.JELLYFIN_API_TIMEOUT_MS || 2500) || 2500);
const DEFAULT_PS4_FTP_NAME = process.env.DEFAULT_PS4_FTP_NAME || 'PS4';
const DEFAULT_PS4_HOST = process.env.DEFAULT_PS4_HOST || '192.168.1.8';
const DEFAULT_PS4_PORT = Number(process.env.DEFAULT_PS4_PORT || 2121);
const DEFAULT_PS4_USER = process.env.DEFAULT_PS4_USER || 'anonymous';
const DEFAULT_PS4_PASSWORD = process.env.DEFAULT_PS4_PASSWORD || 'anonymous@';
const USB_MOUNT_SERVICE_CMD = process.env.USB_MOUNT_SERVICE_CMD || process.env.DRIVE_AGENT_CMD || path.join(SCRIPTS_DIR, 'usb-mount-service.sh');
const DRIVE_STATE_PATH = process.env.DRIVE_STATE_PATH || path.join(FILEBROWSER_ROOT, '.state', 'drives.json');
const DRIVE_EVENTS_PATH = process.env.DRIVE_EVENTS_PATH || path.join(FILEBROWSER_ROOT, '.state', 'drive-events.jsonl');
const DRIVE_REFRESH_INTERVAL_MS = Math.max(60000, Number(process.env.DRIVE_REFRESH_INTERVAL_MS || 60000) || 60000);
const SSHD_BIND_HOST = process.env.SSHD_BIND_HOST || '127.0.0.1';
const SSHD_PORT = Number(process.env.SSHD_PORT || 8022);
const ENABLE_SSHD = process.env.ENABLE_SSHD === 'true';
const SSHD_AUTH_MODE = String(process.env.SSHD_AUTH_MODE || 'password_and_key').trim().toLowerCase();
const COPYPARTY_BASE_PATH = process.env.COPYPARTY_BASE_PATH || '/copyparty';
const SYNCTHING_BASE_PATH = process.env.SYNCTHING_BASE_PATH || '/syncthing';
const SYNCTHING_HOME = process.env.SYNCTHING_HOME || path.join(RUNTIME_DIR, 'syncthing');
const SAMBA_SERVICE_CMD = process.env.SAMBA_SERVICE_CMD || path.join(SCRIPTS_DIR, 'samba-service.sh');
const COPYPARTY_SERVICE_CMD = process.env.COPYPARTY_SERVICE_CMD || path.join(SCRIPTS_DIR, 'copyparty-service.sh');
const SYNCTHING_SERVICE_CMD = process.env.SYNCTHING_SERVICE_CMD || path.join(SCRIPTS_DIR, 'syncthing-service.sh');
const JELLYFIN_SERVICE_CMD = process.env.JELLYFIN_SERVICE_CMD || path.join(SCRIPTS_DIR, 'jellyfin-service.sh');
const QBITTORRENT_SERVICE_CMD = process.env.QBITTORRENT_SERVICE_CMD || path.join(SCRIPTS_DIR, 'qbittorrent-service.sh');
const REDIS_SERVICE_CMD = process.env.REDIS_SERVICE_CMD || path.join(SCRIPTS_DIR, 'redis-service.sh');
const POSTGRES_SERVICE_CMD = process.env.POSTGRES_SERVICE_CMD || path.join(SCRIPTS_DIR, 'postgres-service.sh');
const SONARR_SERVICE_CMD = process.env.SONARR_SERVICE_CMD || path.join(SCRIPTS_DIR, 'sonarr-service.sh');
const RADARR_SERVICE_CMD = process.env.RADARR_SERVICE_CMD || path.join(SCRIPTS_DIR, 'radarr-service.sh');
const PROWLARR_SERVICE_CMD = process.env.PROWLARR_SERVICE_CMD || path.join(SCRIPTS_DIR, 'prowlarr-service.sh');
const BAZARR_SERVICE_CMD = process.env.BAZARR_SERVICE_CMD || path.join(SCRIPTS_DIR, 'bazarr-service.sh');
const FLAREARR_SERVICE_CMD = process.env.FLAREARR_SERVICE_CMD || path.join(SCRIPTS_DIR, 'flarearr-service.sh');
const JELLYSEERR_SERVICE_CMD = process.env.JELLYSEERR_SERVICE_CMD || path.join(SCRIPTS_DIR, 'jellyseerr-service.sh');
const MOUNT_SERVICE_CMD = process.env.MOUNT_SERVICE_CMD || path.join(SCRIPTS_DIR, 'mount-service.sh');
const FS_WORKER_SERVICE_CMD = process.env.FS_WORKER_SERVICE_CMD || path.join(SCRIPTS_DIR, 'fs-worker.sh');
const METRICS_SERVICE_CMD = process.env.METRICS_SERVICE_CMD || path.join(SCRIPTS_DIR, 'metrics-service.sh');
const LOGGING_SERVICE_CMD = process.env.LOGGING_SERVICE_CMD || path.join(SCRIPTS_DIR, 'logging-service.sh');
const LLAMA_CPP_SERVICE_CMD = process.env.LLAMA_CPP_SERVICE_CMD || path.join(SCRIPTS_DIR, 'llama-cpp-service.sh');
const NEXTJS_DASHBOARD_SERVICE_CMD = process.env.NEXTJS_DASHBOARD_SERVICE_CMD || path.join(SCRIPTS_DIR, 'nextjs-dashboard-service.sh');
const MEDIA_WORKFLOW_SERVICE_CMD = process.env.MEDIA_WORKFLOW_SERVICE_CMD || path.join(SCRIPTS_DIR, 'media-workflow-service.sh');
const MEDIA_IMPORTER_CMD = process.env.MEDIA_IMPORTER_CMD || path.join(SCRIPTS_DIR, 'media-importer.sh');
const JELLYFIN_LIBRARY_SYNC_CMD = process.env.JELLYFIN_LIBRARY_SYNC_CMD || path.join(SCRIPTS_DIR, 'jellyfin-library-sync.sh');
const STORAGE_WATCHDOG_SERVICE_CMD = process.env.STORAGE_WATCHDOG_SERVICE_CMD || path.join(SCRIPTS_DIR, 'storage-watchdog-service.sh');
const STORAGE_WATCHDOG_STATE_FILE = process.env.STORAGE_WATCHDOG_STATE_FILE || path.join(RUNTIME_DIR, 'storage-watchdog-state.json');
const STORAGE_WATCHDOG_EVENTS_FILE = process.env.STORAGE_WATCHDOG_EVENTS_FILE || path.join(RUNTIME_DIR, 'storage-watchdog-events.jsonl');
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
const FLAREARR_HOME = process.env.FLAREARR_HOME || path.join(MEDIA_SERVICES_HOME, 'flarearr');
const FLAREARR_PYTHON_PATH = process.env.FLAREARR_PYTHON_PATH || path.join(FLAREARR_HOME, 'venv', 'bin', 'python');
const FLAREARR_APP_PATH = process.env.FLAREARR_APP_PATH || path.join(FLAREARR_HOME, 'app');
const JELLYSEERR_HOME = process.env.JELLYSEERR_HOME || path.join(MEDIA_SERVICES_HOME, 'jellyseerr');
const JELLYSEERR_DIST_PATH = path.join(JELLYSEERR_HOME, 'app', 'dist', 'index.js');
const LLM_HOME = process.env.LLM_HOME || path.join(MEDIA_SERVICES_HOME, 'llm');
const LLM_MODELS_DIR = process.env.LLM_MODELS_DIR || path.join(LLM_HOME, 'models');
const LLM_BIND_HOST = process.env.LLM_BIND_HOST || '127.0.0.1';
const LLM_PORT = Number(process.env.LLM_PORT || 11435);
const LLM_CTX_SIZE = Math.max(512, Number(process.env.LLM_CTX_SIZE || 4096) || 4096);
const LLM_THREADS = Math.max(1, Number(process.env.LLM_THREADS || 4) || 4);
const LLM_BATCH_SIZE = Math.max(32, Number(process.env.LLM_BATCH_SIZE || 512) || 512);
const LLM_GPU_LAYERS = Number(process.env.LLM_GPU_LAYERS || 0) || 0;
const LLM_MAX_TOKENS = Math.max(16, Number(process.env.LLM_MAX_TOKENS || 1024) || 1024);
const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE || 0.2);
const LLM_DEFAULT_MODEL_ID = process.env.LLM_DEFAULT_MODEL_ID || 'qwen2.5-coder-1.5b-q4_k_m';
const LLM_DEFAULT_MODEL_PATH = process.env.LLM_DEFAULT_MODEL_PATH || '';
const LLM_API_KEY = String(process.env.LLM_API_KEY || '').trim();
const ONLINE_LLM_BASE_URL = String(process.env.ONLINE_LLM_BASE_URL || '').trim().replace(/\/+$/, '');
const ONLINE_LLM_API_KEY = String(process.env.ONLINE_LLM_API_KEY || '').trim();
const ONLINE_LLM_DEFAULT_MODEL = String(process.env.ONLINE_LLM_DEFAULT_MODEL || '').trim();
const ONLINE_LLM_TIMEOUT_MS = Math.max(2000, Number(process.env.ONLINE_LLM_TIMEOUT_MS || 15000) || 15000);
const LLM_REQUEST_TIMEOUT_MS = Math.max(2000, Number(process.env.LLM_REQUEST_TIMEOUT_MS || 120000) || 120000);
const LLM_SERVICE_CMD = process.env.LLM_SERVICE_CMD || path.join(SCRIPTS_DIR, 'llm-service.sh');
const LLM_MODEL_PULL_CMD = process.env.LLM_MODEL_PULL_CMD || path.join(SCRIPTS_DIR, 'llm-model-pull.sh');
const LLM_ACTIVE_MODEL_FILE = process.env.LLM_ACTIVE_MODEL_FILE || path.join(RUNTIME_DIR, 'llm-active-model.txt');
const LLM_PULL_STATE_DIR = process.env.LLM_PULL_STATE_DIR || path.join(RUNTIME_DIR, 'llm-pulls');
const TAILSCALE_MODE = String(process.env.TAILSCALE_MODE || 'disabled').trim().toLowerCase();
const TAILSCALE_DNS_NAME = String(process.env.TAILSCALE_DNS_NAME || '').trim();
const TAILSCALE_IP = String(process.env.TAILSCALE_IP || '').trim();
const TAILSCALE_GATEWAY_PORT = Math.max(1, Number(process.env.TAILSCALE_GATEWAY_PORT || 8088) || 8088);
const TAILSCALE_SSH_PORT = Math.max(1, Number(process.env.TAILSCALE_SSH_PORT || 8022) || 8022);
const TAILSCALE_EXPOSE_GATEWAY = String(process.env.TAILSCALE_EXPOSE_GATEWAY || 'true').toLowerCase() === 'true';
const TAILSCALE_EXPOSE_SSH = String(process.env.TAILSCALE_EXPOSE_SSH || 'true').toLowerCase() === 'true';
const TAILSCALE_BIN = process.env.TAILSCALE_BIN || 'tailscale';
const TAILSCALED_BIN = process.env.TAILSCALED_BIN || 'tailscaled';
const TAILSCALE_STATE_DIR = process.env.TAILSCALE_STATE_DIR || path.join(RUNTIME_DIR, 'tailscale');
const TAILSCALE_SOCKET = process.env.TAILSCALE_SOCKET || path.join(TAILSCALE_STATE_DIR, 'tailscaled.sock');
const TAILSCALE_STATE_PATH = process.env.TAILSCALE_STATE_PATH || path.join(TAILSCALE_STATE_DIR, 'tailscaled.state');
const TAILSCALE_AUTH_KEY = String(process.env.TAILSCALE_AUTH_KEY || '').trim();
const TAILSCALE_HOSTNAME = String(process.env.TAILSCALE_HOSTNAME || '').trim();
const TAILSCALE_PID = process.env.TAILSCALE_PID_PATH || path.join(RUNTIME_DIR, 'tailscaled.pid');
const TAILSCALE_SERVICE_CMD = process.env.TAILSCALE_SERVICE_CMD || path.join(SCRIPTS_DIR, 'tailscale-service.sh');
const TAILSCALE_ROOT_CMD = process.env.TAILSCALE_ROOT_CMD || 'su -c tailscale';
const HMSTX_CONTROL_CMD = process.env.HMSTX_CONTROL_CMD || path.join(SCRIPTS_DIR, 'hmstx-control.sh');
const TAILSCALE_HELPER_MODE = TAILSCALE_MODE === 'managed_daemon' || TAILSCALE_MODE === 'root_daemon';
const LLM_CHAT_SYSTEM_PROMPT = process.env.LLM_CHAT_SYSTEM_PROMPT || 'You are a precise assistant running inside a private home server dashboard.';
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
const UI_INITIAL_PARTIAL_SUCCESS = String(process.env.UI_INITIAL_PARTIAL_SUCCESS || 'true').toLowerCase() !== 'false';
const UI_DEFER_HEAVY_DIAGNOSTICS = String(process.env.UI_DEFER_HEAVY_DIAGNOSTICS || 'true').toLowerCase() !== 'false';
const UI_INITIAL_RETRY_AFTER_MS = Math.max(1000, Number(process.env.UI_INITIAL_RETRY_AFTER_MS || 5000) || 5000);
const UI_DIAGNOSTIC_TIMEOUT_MS = Math.max(1000, Number(process.env.UI_DIAGNOSTIC_TIMEOUT_MS || 2500) || 2500);
const UI_DIAGNOSTIC_BREAKER_FAILURE_THRESHOLD = Math.max(1, Number(process.env.UI_DIAGNOSTIC_BREAKER_FAILURE_THRESHOLD || 5) || 5);
const UI_DIAGNOSTIC_BREAKER_WINDOW_MS = Math.max(1000, Number(process.env.UI_DIAGNOSTIC_BREAKER_WINDOW_MS || 30000) || 30000);
const UI_DIAGNOSTIC_BREAKER_RESET_MS = Math.max(1000, Number(process.env.UI_DIAGNOSTIC_BREAKER_RESET_MS || 20000) || 20000);
const UI_DIAGNOSTIC_BREAKER_HALF_OPEN_SUCCESS = Math.max(1, Number(process.env.UI_DIAGNOSTIC_BREAKER_HALF_OPEN_SUCCESS || 3) || 3);
const UI_SNAPSHOT_ENGINE = String(process.env.UI_SNAPSHOT_ENGINE || 'off').trim().toLowerCase();
const UI_SNAPSHOT_DIFF_LOG = String(process.env.UI_SNAPSHOT_DIFF_LOG || 'false').toLowerCase() === 'true';
const UI_SNAPSHOT_BOOTSTRAP_TTL_MS = Math.max(1000, Number(process.env.UI_SNAPSHOT_BOOTSTRAP_TTL_MS || 3000) || 3000);
const UI_SNAPSHOT_INITIAL_TTL_MS = Math.max(1000, Number(process.env.UI_SNAPSHOT_INITIAL_TTL_MS || 2000) || 2000);
const UI_SNAPSHOT_WORKSPACE_OVERVIEW_TTL_MS = Math.max(1000, Number(process.env.UI_SNAPSHOT_WORKSPACE_OVERVIEW_TTL_MS || 2000) || 2000);
const UI_SNAPSHOT_WORKSPACE_DEFAULT_TTL_MS = Math.max(1000, Number(process.env.UI_SNAPSHOT_WORKSPACE_DEFAULT_TTL_MS || 3000) || 3000);
const UI_SNAPSHOT_BOOTSTRAP_MAX_STALE_MS = Math.max(UI_SNAPSHOT_BOOTSTRAP_TTL_MS, Number(process.env.UI_SNAPSHOT_BOOTSTRAP_MAX_STALE_MS || 45000) || 45000);
const UI_SNAPSHOT_INITIAL_MAX_STALE_MS = Math.max(UI_SNAPSHOT_INITIAL_TTL_MS, Number(process.env.UI_SNAPSHOT_INITIAL_MAX_STALE_MS || 15000) || 15000);
const UI_SNAPSHOT_WORKSPACE_MAX_STALE_MS = Math.max(UI_SNAPSHOT_WORKSPACE_DEFAULT_TTL_MS, Number(process.env.UI_SNAPSHOT_WORKSPACE_MAX_STALE_MS || 15000) || 15000);
const UI_SNAPSHOT_BUILD_TIMEOUT_MS = Math.max(800, Number(process.env.UI_SNAPSHOT_BUILD_TIMEOUT_MS || 2200) || 2200);
const UI_SNAPSHOT_MAX_CONCURRENT_BUILDERS = Math.max(1, Number(process.env.UI_SNAPSHOT_MAX_CONCURRENT_BUILDERS || 8) || 8);
const UI_SNAPSHOT_CACHE_MAX_ENTRIES = Math.max(32, Number(process.env.UI_SNAPSHOT_CACHE_MAX_ENTRIES || 1024) || 1024);
const UI_SNAPSHOT_CACHE_PRUNE_INTERVAL_MS = Math.max(1000, Number(process.env.UI_SNAPSHOT_CACHE_PRUNE_INTERVAL_MS || 30000) || 30000);
const UI_ENDPOINT_METRICS_WINDOW_MS = Math.max(60000, Number(process.env.UI_ENDPOINT_METRICS_WINDOW_MS || 15 * 60 * 1000) || (15 * 60 * 1000));
const UI_ENDPOINT_METRICS_MAX_SAMPLES = Math.max(100, Number(process.env.UI_ENDPOINT_METRICS_MAX_SAMPLES || 2000) || 2000);
const UI_SERVICE_CATALOG_TTL_MS = Math.max(1000, Number(process.env.UI_SERVICE_CATALOG_TTL_MS || 15000) || 15000);
const UI_SERVICE_CATALOG_MAX_STALE_MS = Math.max(UI_SERVICE_CATALOG_TTL_MS, Number(process.env.UI_SERVICE_CATALOG_MAX_STALE_MS || 120000) || 120000);
const UI_NETWORK_EXPOSURE_TTL_MS = Math.max(1000, Number(process.env.UI_NETWORK_EXPOSURE_TTL_MS || 45000) || 45000);
const UI_NETWORK_EXPOSURE_MAX_STALE_MS = Math.max(UI_NETWORK_EXPOSURE_TTL_MS, Number(process.env.UI_NETWORK_EXPOSURE_MAX_STALE_MS || 300000) || 300000);
const NGINX_CMD = `nginx -p "${ROOT_DIR}" -c "${ROOT_DIR}/nginx.conf"`;
const NGINX_MATCH = `nginx -p ${ROOT_DIR} -c ${ROOT_DIR}/nginx.conf`;
const stopPidfileProcess = (pidPath, fallback = '') =>
  `if [ -f "${pidPath}" ]; then pid="$(cat "${pidPath}" 2>/dev/null || true)"; if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill "$pid" >/dev/null 2>&1 || true; sleep 1; if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" >/dev/null 2>&1 || true; fi; fi; rm -f "${pidPath}"; fi${fallback ? `; ${fallback}` : ''}`;
const checkPidfileProcess = (pidPath, fallback = '') =>
  `test -f "${pidPath}" && kill -0 "$(cat "${pidPath}")" >/dev/null 2>&1${fallback ? ` || ${fallback}` : ''}`;
const detachCommand = (pidPath, command) => `nohup sh -c '${command}' >/dev/null 2>&1 & echo $! > "${pidPath}"`;
const appDb = createAppDb({ dbPath: APP_DB_PATH });
const STRICT_BOOTSTRAP = process.env.STRICT_BOOTSTRAP === 'true';
const INSECURE_SECRET_VALUES = new Set([
  '',
  'change-this-in-production',
  'replace-with-a-long-random-secret',
  'replace-with-a-stable-long-random-secret',
]);
const INSECURE_PASSWORD_VALUES = new Set([
  '',
  'admin123',
  'change-me',
  'change-me-too',
]);
const assertSecureStartupConfig = ({ userCount }) => {
  const failures = [];

  if (INSECURE_SECRET_VALUES.has(String(JWT_SECRET || '').trim())) {
    failures.push('Set JWT_SECRET in server/.env to a long random value before starting the server.');
  }

  if (INSECURE_SECRET_VALUES.has(String(process.env.APP_AUTH_SECRET || '').trim())) {
    failures.push('Set APP_AUTH_SECRET in server/.env to a stable long random value before starting the server.');
  }

  if (userCount <= 0) {
    if (INSECURE_PASSWORD_VALUES.has(String(BOOTSTRAP_DASHBOARD_PASS || '').trim())) {
      failures.push('Set DASHBOARD_PASS in server/.env before first boot so the initial admin account is not created with a default password.');
    }
    if (INSECURE_PASSWORD_VALUES.has(String(ADMIN_ACTION_PASSWORD || '').trim())) {
      failures.push('Set ADMIN_ACTION_PASSWORD in server/.env before first boot.');
    }
  }

  if (failures.length > 0) {
    const message = `Insecure bootstrap configuration detected:\n- ${failures.join('\n- ')}`;
    console.warn(`[auth] ${message}`);
    if (STRICT_BOOTSTRAP) {
      throw new Error(`Refusing to start with insecure bootstrap configuration.\n- ${failures.join('\n- ')}`);
    }
  }
};
assertSecureStartupConfig({ userCount: appDb.countUsers() });
const adminBootstrap = appDb.bootstrapAdmin({
  username: BOOTSTRAP_DASHBOARD_USER,
  password: BOOTSTRAP_DASHBOARD_PASS,
  role: 'admin',
});

if (adminBootstrap.seeded) {
  console.info(`[auth] Seeded initial admin user '${adminBootstrap.username}' in ${APP_DB_PATH}`);
}

fs.mkdirSync(FTP_MOUNT_RUNTIME_DIR, { recursive: true });
fs.mkdirSync(FS_OPERATIONS_STATE_DIR, { recursive: true });
fs.mkdirSync(FS_OPERATIONS_STAGING_DIR, { recursive: true });
fs.mkdirSync(LLM_MODELS_DIR, { recursive: true });
fs.mkdirSync(LLM_PULL_STATE_DIR, { recursive: true });

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
  flarearr: {
    start: `"${FLAREARR_SERVICE_CMD}" start`,
    stop: `"${FLAREARR_SERVICE_CMD}" stop`,
    restart: `"${FLAREARR_SERVICE_CMD}" restart`,
    check: `"${FLAREARR_SERVICE_CMD}" status`,
    host: FLAREARR_BIND_HOST,
    port: FLAREARR_PORT,
    binary: 'python3',
    installCheckPaths: [FLAREARR_SERVICE_CMD, FLAREARR_PYTHON_PATH, FLAREARR_APP_PATH],
    installCheckCommand: `"${FLAREARR_PYTHON_PATH}" -c "import requests"`,
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
  llm: {
    start: `"${LLM_SERVICE_CMD}" start`,
    stop: `"${LLM_SERVICE_CMD}" stop`,
    restart: `"${LLM_SERVICE_CMD}" restart`,
    check: `"${LLM_SERVICE_CMD}" status`,
    host: LLM_BIND_HOST,
    port: LLM_PORT,
    binary: 'llama-server',
    installCheckPaths: [LLM_SERVICE_CMD],
  },
  'mount-service': {
    start: `"${MOUNT_SERVICE_CMD}" start`,
    stop: `"${MOUNT_SERVICE_CMD}" stop`,
    restart: `"${MOUNT_SERVICE_CMD}" restart`,
    check: `"${MOUNT_SERVICE_CMD}" status`,
    host: '127.0.0.1',
    port: 0,
    binary: 'bash',
    installCheckPaths: [MOUNT_SERVICE_CMD],
  },
  'fs-worker': {
    start: `"${FS_WORKER_SERVICE_CMD}" start`,
    stop: `"${FS_WORKER_SERVICE_CMD}" stop`,
    restart: `"${FS_WORKER_SERVICE_CMD}" restart`,
    check: `"${FS_WORKER_SERVICE_CMD}" status`,
    host: '127.0.0.1',
    port: 0,
    binary: 'bash',
    installCheckPaths: [FS_WORKER_SERVICE_CMD],
  },
  'metrics-service': {
    start: `"${METRICS_SERVICE_CMD}" start`,
    stop: `"${METRICS_SERVICE_CMD}" stop`,
    restart: `"${METRICS_SERVICE_CMD}" restart`,
    check: `"${METRICS_SERVICE_CMD}" status`,
    host: '127.0.0.1',
    port: 0,
    binary: 'bash',
    installCheckPaths: [METRICS_SERVICE_CMD],
  },
  'logging-service': {
    start: `"${LOGGING_SERVICE_CMD}" start`,
    stop: `"${LOGGING_SERVICE_CMD}" stop`,
    restart: `"${LOGGING_SERVICE_CMD}" restart`,
    check: `"${LOGGING_SERVICE_CMD}" status`,
    host: '127.0.0.1',
    port: 0,
    binary: 'bash',
    installCheckPaths: [LOGGING_SERVICE_CMD],
  },
  'llama.cpp': {
    start: `"${LLAMA_CPP_SERVICE_CMD}" start`,
    stop: `"${LLAMA_CPP_SERVICE_CMD}" stop`,
    restart: `"${LLAMA_CPP_SERVICE_CMD}" restart`,
    check: `"${LLAMA_CPP_SERVICE_CMD}" status`,
    host: LLM_BIND_HOST,
    port: LLM_PORT,
    binary: 'bash',
    installCheckPaths: [LLAMA_CPP_SERVICE_CMD],
  },
  'nextjs-dashboard': {
    start: `"${NEXTJS_DASHBOARD_SERVICE_CMD}" start`,
    stop: `"${NEXTJS_DASHBOARD_SERVICE_CMD}" stop`,
    restart: `"${NEXTJS_DASHBOARD_SERVICE_CMD}" restart`,
    check: `"${NEXTJS_DASHBOARD_SERVICE_CMD}" status`,
    host: NEXTJS_DASHBOARD_BIND_HOST,
    port: NEXTJS_DASHBOARD_PORT,
    binary: 'bash',
    installCheckPaths: [NEXTJS_DASHBOARD_SERVICE_CMD],
  },
  tailscale: {
    start: `"${TAILSCALE_SERVICE_CMD}" start`,
    stop: `"${TAILSCALE_SERVICE_CMD}" stop`,
    restart: `"${TAILSCALE_SERVICE_CMD}" restart`,
    check: `"${TAILSCALE_SERVICE_CMD}" status`,
    host: '127.0.0.1',
    port: 0,
    binary: TAILSCALE_BIN,
    installCheckPaths: [TAILSCALE_SERVICE_CMD],
  },
};

const WORKER_COMMANDS = {
  'jellyfin-library-sync': {
    restart: `"${JELLYFIN_LIBRARY_SYNC_CMD}" restart`,
    start: `"${JELLYFIN_LIBRARY_SYNC_CMD}" start`,
    status: `"${JELLYFIN_LIBRARY_SYNC_CMD}" status --json`,
    stop: `"${JELLYFIN_LIBRARY_SYNC_CMD}" stop`,
  },
  'media-importer': {
    restart: `"${MEDIA_IMPORTER_CMD}" run --trigger dashboard-manual`,
    start: `"${MEDIA_IMPORTER_CMD}" run --trigger dashboard-manual`,
    status: `"${MEDIA_IMPORTER_CMD}" status --json`,
    stop: 'echo \"media-importer is run-to-completion\"',
  },
  'media-workflow': {
    restart: `"${MEDIA_WORKFLOW_SERVICE_CMD}" restart`,
    start: `"${MEDIA_WORKFLOW_SERVICE_CMD}" start`,
    status: `"${MEDIA_WORKFLOW_SERVICE_CMD}" status --json`,
    stop: `"${MEDIA_WORKFLOW_SERVICE_CMD}" stop`,
  },
  'storage-watchdog': {
    restart: `"${STORAGE_WATCHDOG_SERVICE_CMD}" restart`,
    start: `"${STORAGE_WATCHDOG_SERVICE_CMD}" start`,
    status: `"${STORAGE_WATCHDOG_SERVICE_CMD}" status --json`,
    stop: `"${STORAGE_WATCHDOG_SERVICE_CMD}" stop`,
  },
  'usb-mount-service': {
    restart: `"${USB_MOUNT_SERVICE_CMD}" restart`,
    start: `"${USB_MOUNT_SERVICE_CMD}" start`,
    status: `"${USB_MOUNT_SERVICE_CMD}" status --json`,
    stop: `"${USB_MOUNT_SERVICE_CMD}" stop`,
  },
};

// The dashboard renders service tabs from this catalog instead of inferring
// labels, grouping, or control rules in the client.
const BASE_SERVICE_CATALOG_META = {
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
    description: SSHD_AUTH_MODE === 'key_only'
      ? 'Shell access for maintenance and recovery with public-key auth only.'
      : 'Shell access for maintenance and recovery.',
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
    route: '/syncthing/',
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
    route: '/bazarr/',
    surface: 'arr',
  },
  flarearr: {
    controlMode: 'optional',
    description: 'Cloudflare challenge bypass helper for ARR/Prowlarr indexer requests.',
    group: 'arr',
    label: 'FlareArr',
    route: '/flarearr/',
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
  llm: {
    controlMode: 'optional',
    description: 'Local on-device inference using llama.cpp with selectable GGUF models.',
    group: 'ai',
    label: 'Local LLM',
    route: '/llm/',
    surface: 'ai',
  },
};

const getServiceCatalogMeta = () => {
  if (TAILSCALE_MODE === 'disabled') {
    return BASE_SERVICE_CATALOG_META;
  }

  return {
    ...BASE_SERVICE_CATALOG_META,
    tailscale: {
      controlMode: TAILSCALE_HELPER_MODE ? 'optional' : 'external',
      description: TAILSCALE_MODE === 'managed_daemon'
        ? 'Private tailnet access to the gateway and SSH through a managed tailscaled instance.'
        : TAILSCALE_MODE === 'root_daemon'
        ? 'Private tailnet access to the gateway and SSH through the root-managed Tailscale daemon.'
        : 'Private tailnet access provided by the Tailscale Android app.',
      group: 'access',
      label: 'Tailscale',
      surface: 'home',
    },
  };
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
  jellyfinMediaHealth: { expiresAt: 0, value: null },
  jellyfinLiveTv: { expiresAt: 0, value: null },
  qbittorrentConfig: { expiresAt: 0, value: null },
};
const timedCache = {
  mediaHealth: { expiresAt: 0, value: null, promise: null },
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
  'llm',
  'flarearr',
  'tailscale',
];
const OPTIONAL_SERVICE_SET = new Set(OPTIONAL_SERVICE_NAMES);
const PLACEHOLDER_SERVICE_SET = new Set(['jellyseerr']);
const SERVICE_GROUP_ORDER = ['platform', 'media', 'arr', 'data', 'downloads', 'filesystem', 'access', 'ai'];
const SERVICE_UNLOCK_TTL_MS = parseDurationMs(process.env.SERVICE_UNLOCK_TTL || '8h', 8 * 60 * 60 * 1000);
const SERVICE_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_HISTORY_LIMIT = 400;
const TORRENT_LANE_SET = new Set(['arr', 'standalone']);
const TORRENT_ARR_MEDIA_TYPE_SET = new Set(['movies', 'series']);
const SCRATCH_FALLBACK_ROOT = path.join(FILEBROWSER_ROOT, `E (${SCRATCH_FALLBACK_LABEL})`, 'SCRATCH', 'HmSTxScratch');
const isWritableDirectory = (directoryPath) => {
  try {
    fs.mkdirSync(directoryPath, { recursive: true });
    fs.accessSync(directoryPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
const resolveActiveScratchRoot = (storageProtection) => {
  const candidates = [
    ...normalizeStringArray(storageProtection?.scratch?.roots),
    MEDIA_SCRATCH_ROOT,
    SCRATCH_FALLBACK_ROOT,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized) {
      continue;
    }
    if (isWritableDirectory(normalized)) {
      return normalized;
    }
  }
  return MEDIA_SCRATCH_ROOT;
};
const buildTorrentLaneMapping = (scratchRoot) => {
  const downloadsRoot = path.join(scratchRoot, 'downloads');
  return {
    arr: {
      movies: { category: 'movies', savePath: path.join(downloadsRoot, 'movies') },
      series: { category: 'series', savePath: path.join(downloadsRoot, 'series') },
    },
    standalone: {
      category: 'standalone',
      savePath: path.join(downloadsRoot, 'torrent', 'qbit'),
    },
  };
};

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

const runCommand = (cmd, options = {}) =>
  new Promise((resolve, reject) => {
    const timeout = Math.max(1000, Number(options.timeoutMs || 15000) || 15000);
    const maxBuffer = Math.max(1024, Number(options.maxBuffer || 1024 * 1024) || 1024 * 1024);
    exec(cmd, { timeout, maxBuffer, shell: EXEC_SHELL }, (err, stdout, stderr) => {
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

const pathExists = (targetPath) => {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
};

const readFirstLine = (value = '') => String(value || '').split(/\r?\n/, 1)[0]?.trim() || '';

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

const withPromiseTimeout = (promise, timeoutMs, label = 'operation') =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const createConcurrencyLimiter = (maxConcurrency) => {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= maxConcurrency || queue.length === 0) {
      return;
    }
    const job = queue.shift();
    active += 1;
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        active = Math.max(0, active - 1);
        runNext();
      });
  };

  return (run) => new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });
    runNext();
  });
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

const readPathUsage = (targetPath) => {
  try {
    const stats = fs.statfsSync(targetPath);
    const bytesTotal = Number(stats.blocks) * Number(stats.bsize);
    const bytesFree = Number(stats.bavail) * Number(stats.bsize);
    const bytesUsed = Math.max(bytesTotal - bytesFree, 0);
    const usedPercent = bytesTotal > 0 ? (bytesUsed / bytesTotal) * 100 : 0;
    return {
      bytesFree,
      bytesTotal,
      bytesUsed,
      freeGb: bytesFree / (1024 ** 3),
      usedPercent,
    };
  } catch {
    return null;
  }
};

const probeQbittorrentConfig = () => withLocalProbeCache('qbittorrentConfig', 5000, () => {
  const fallbackPath = fs.existsSync(MEDIA_DOWNLOADS_MANUAL_DIR) ? MEDIA_DOWNLOADS_MANUAL_DIR : MEDIA_DOWNLOADS_DIR;
  const fallbackTempPath = fs.existsSync(MEDIA_QBIT_TMP_DIR) ? MEDIA_QBIT_TMP_DIR : MEDIA_DOWNLOADS_DIR;
  if (!fs.existsSync(QBITTORRENT_CONFIG_PATH)) {
    return {
      defaultSavePath: fallbackPath,
      tempPath: fallbackTempPath,
      moviesCategoryPath: MEDIA_DOWNLOADS_MOVIES_DIR,
      seriesCategoryPath: MEDIA_DOWNLOADS_SERIES_DIR,
      manualCategoryPath: MEDIA_DOWNLOADS_MANUAL_DIR,
      standaloneCategoryPath: MEDIA_DOWNLOADS_TORRENT_QBIT_DIR,
    };
  }

  try {
    const configText = fs.readFileSync(QBITTORRENT_CONFIG_PATH, 'utf8');
    return {
      defaultSavePath: readIniValue(configText, 'Session\\DefaultSavePath') || fallbackPath,
      tempPath: readIniValue(configText, 'Session\\TempPath') || fallbackTempPath,
      moviesCategoryPath: readIniValue(configText, 'Categories\\movies\\SavePath') || MEDIA_DOWNLOADS_MOVIES_DIR,
      seriesCategoryPath: readIniValue(configText, 'Categories\\series\\SavePath') || MEDIA_DOWNLOADS_SERIES_DIR,
      manualCategoryPath: readIniValue(configText, 'Categories\\manual\\SavePath') || MEDIA_DOWNLOADS_MANUAL_DIR,
      standaloneCategoryPath: readIniValue(configText, 'Categories\\standalone\\SavePath') || MEDIA_DOWNLOADS_TORRENT_QBIT_DIR,
    };
  } catch {
    return {
      defaultSavePath: fallbackPath,
      tempPath: fallbackTempPath,
      moviesCategoryPath: MEDIA_DOWNLOADS_MOVIES_DIR,
      seriesCategoryPath: MEDIA_DOWNLOADS_SERIES_DIR,
      manualCategoryPath: MEDIA_DOWNLOADS_MANUAL_DIR,
      standaloneCategoryPath: MEDIA_DOWNLOADS_TORRENT_QBIT_DIR,
    };
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

const buildJellyfinApiUrl = (pathname) => {
  const base = String(JELLYFIN_BASE_URL || '').trim().replace(/\/+$/, '');
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${cleanPath}`;
};

const fetchJellyfinJson = async (pathname) => {
  const timeout = withTimeoutSignal(JELLYFIN_API_TIMEOUT_MS);
  try {
    const response = await fetch(buildJellyfinApiUrl(pathname), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Token': JELLYFIN_API_KEY,
      },
      signal: timeout.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(body?.Message || body?.error || `Jellyfin returned ${response.status}`));
    }
    return body;
  } finally {
    timeout.clear();
  }
};

const buildUnavailableMediaHealth = (error) => ({
  activeSessions: [],
  available: false,
  error: error || 'Jellyfin API key is not configured',
  lastUpdated: new Date().toISOString(),
  libraries: [],
  status: 'unavailable',
  totals: {
    episodeCount: 0,
    movieCount: 0,
    songCount: 0,
    seriesCount: 0,
  },
});

const buildJellyfinMediaHealthSnapshot = async () => {
  if (!JELLYFIN_API_KEY) {
    return buildUnavailableMediaHealth('Configure JELLYFIN_API_KEY to enable live media health.');
  }

  const [librariesResult, countsResult, sessionsResult] = await Promise.allSettled([
    fetchJellyfinJson('/Library/VirtualFolders'),
    fetchJellyfinJson('/Items/Counts'),
    fetchJellyfinJson('/Sessions'),
  ]);

  const errors = [];
  if (librariesResult.status === 'rejected') {
    errors.push(String(librariesResult.reason || 'Library fetch failed'));
  }
  if (countsResult.status === 'rejected') {
    errors.push(String(countsResult.reason || 'Counts fetch failed'));
  }
  if (sessionsResult.status === 'rejected') {
    errors.push(String(sessionsResult.reason || 'Session fetch failed'));
  }

  const librariesPayload = librariesResult.status === 'fulfilled' && Array.isArray(librariesResult.value)
    ? librariesResult.value
    : [];
  const countsPayload = countsResult.status === 'fulfilled' && countsResult.value && typeof countsResult.value === 'object'
    ? countsResult.value
    : {};
  const sessionsPayload = sessionsResult.status === 'fulfilled' && Array.isArray(sessionsResult.value)
    ? sessionsResult.value
    : [];

  const libraries = librariesPayload.map((entry, index) => {
    const locations = Array.isArray(entry?.Locations) ? entry.Locations : [];
    const pathHint = String(locations[0] || '');
    return {
      id: String(entry?.ItemId || entry?.Id || `library-${index}`),
      itemCount: Number(entry?.ItemCount || 0),
      name: String(entry?.Name || `Library ${index + 1}`),
      path: pathHint,
      type: String(entry?.CollectionType || 'mixed'),
    };
  });

  const activeSessions = sessionsPayload
    .filter((entry) => Boolean(entry?.NowPlayingItem))
    .map((entry, index) => ({
      client: String(entry?.Client || entry?.DeviceName || 'client'),
      id: String(entry?.Id || `session-${index}`),
      itemName: String(entry?.NowPlayingItem?.Name || entry?.NowPlayingItem?.SeriesName || 'Unknown item'),
      userName: String(entry?.UserName || 'unknown'),
    }));

  const hasAnyData = libraries.length > 0 || Object.keys(countsPayload).length > 0 || activeSessions.length > 0;
  if (!hasAnyData && errors.length > 0) {
    return buildUnavailableMediaHealth(errors[0]);
  }

  return {
    activeSessions,
    available: true,
    error: errors[0] || '',
    lastUpdated: new Date().toISOString(),
    libraries,
    status: errors.length > 0 ? 'degraded' : 'working',
    totals: {
      episodeCount: Number(countsPayload.EpisodeCount || 0),
      movieCount: Number(countsPayload.MovieCount || 0),
      seriesCount: Number(countsPayload.SeriesCount || 0),
      songCount: Number(countsPayload.SongCount || 0),
    },
  };
};

const getJellyfinMediaHealthSnapshot = async ({ force = false } = {}) => {
  const cache = timedCache.mediaHealth;
  const now = Date.now();
  if (!force && cache.value && cache.expiresAt > now) {
    return cache.value;
  }
  if (cache.promise) {
    return cache.promise;
  }

  cache.promise = buildJellyfinMediaHealthSnapshot()
    .catch((error) => buildUnavailableMediaHealth(String(error || 'Unable to fetch Jellyfin media health')))
    .then((payload) => {
      cache.value = payload;
      cache.expiresAt = Date.now() + 15000;
      cache.promise = null;
      return payload;
    });

  return cache.promise;
};

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

    if (name === 'tailscale' && !TAILSCALE_HELPER_MODE) {
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
  if (serviceName === 'tailscale') {
    if (TAILSCALE_MODE === 'android_app') {
      return {
        available: true,
        label: 'Tailscale Android app',
      };
    }

    if (!TAILSCALE_HELPER_MODE) {
      return {
        available: false,
        label: 'TAILSCALE_MODE',
      };
    }
  }
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

const isServiceFailureStatus = (status) => ['blocked', 'stalled'].includes(status);

const getServiceStats = (serviceName) => {
  const history = trimServiceHistory(serviceHealthHistory[serviceName] || []);
  serviceHealthHistory[serviceName] = history;

  if (history.length === 0) {
    return {
      avgLatencyMs: null,
      lastCheckedAt: null,
      lastFailureAt: null,
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
  let lastFailureAt = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (isServiceFailureStatus(history[index].status)) {
      lastFailureAt = history[index].checkedAt;
      break;
    }
  }

  return {
    avgLatencyMs: latencyCount > 0 ? Number((latencyTotal / latencyCount).toFixed(0)) : null,
    lastCheckedAt: last.checkedAt,
    lastFailureAt,
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

const toServiceLifecycleState = (entry) => {
  if (entry.status === 'blocked') {
    return 'blocked';
  }

  if (entry.status === 'unavailable') {
    return 'degraded';
  }

  if (entry.status === 'stalled') {
    return entry.controlMode === 'always_on' ? 'crashed' : 'degraded';
  }

  if (entry.status === 'stopped') {
    return 'stopped';
  }

  if (entry.status === 'working') {
    if (Number.isFinite(entry.latencyMs) && entry.latencyMs > 800) {
      return 'degraded';
    }
    return 'healthy';
  }

  return 'degraded';
};

const defaultLifecycleReasonForState = (state) => {
  if (state === 'healthy') {
    return 'Healthy.';
  }
  if (state === 'degraded') {
    return 'Service health is degraded.';
  }
  if (state === 'blocked') {
    return 'Service is blocked.';
  }
  if (state === 'crashed') {
    return 'Service health check failed.';
  }
  if (state === 'stopped') {
    return 'Stopped by operator.';
  }
  return 'Service health is unknown.';
};

const buildServiceLifecycleEntry = (entry) => {
  const state = toServiceLifecycleState(entry);
  const checkedAt = entry.lastCheckedAt || new Date().toISOString();
  const reason = String(entry.statusReason || entry.blocker || defaultLifecycleReasonForState(state));
  const inferredFailureAt = isServiceFailureStatus(entry.status) ? checkedAt : null;
  const restartRecommended = state === 'crashed'
    || Boolean(entry.resumeRequired)
    || (state === 'blocked' && entry.available);

  return {
    checkedAt,
    lastFailureAt: entry.lastFailureAt || inferredFailureAt,
    reason,
    restartRecommended,
    state,
  };
};

const parseTimestampMs = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const buildStackLifecycleSummary = (serviceCatalog = []) => {
  const counts = {
    healthy: 0,
    degraded: 0,
    blocked: 0,
    crashed: 0,
    stopped: 0,
  };
  let checkedAt = null;
  let checkedAtMs = -1;
  let lastFailureAt = null;
  let lastFailureAtMs = -1;
  let restartRecommended = false;

  for (const entry of serviceCatalog) {
    const state = ['healthy', 'degraded', 'blocked', 'crashed', 'stopped'].includes(entry.state)
      ? entry.state
      : toServiceLifecycleState(entry);
    counts[state] = (counts[state] || 0) + 1;

    const entryCheckedAtMs = parseTimestampMs(entry.checkedAt || entry.lastCheckedAt);
    if (entryCheckedAtMs !== null && entryCheckedAtMs >= checkedAtMs) {
      checkedAtMs = entryCheckedAtMs;
      checkedAt = new Date(entryCheckedAtMs).toISOString();
    }

    const entryLastFailureAtMs = parseTimestampMs(entry.lastFailureAt);
    if (entryLastFailureAtMs !== null && entryLastFailureAtMs >= lastFailureAtMs) {
      lastFailureAtMs = entryLastFailureAtMs;
      lastFailureAt = new Date(entryLastFailureAtMs).toISOString();
    }

    restartRecommended = restartRecommended || Boolean(entry.restartRecommended);
  }

  const total = serviceCatalog.length;
  const resolvedCheckedAt = checkedAt || new Date().toISOString();
  if (total === 0) {
    return {
      state: 'stopped',
      reason: 'No services are registered in the catalog.',
      checkedAt: resolvedCheckedAt,
      lastFailureAt: null,
      restartRecommended: false,
      counts,
    };
  }

  if (counts.crashed > 0) {
    return {
      state: 'crashed',
      reason: `${counts.crashed} service${counts.crashed === 1 ? '' : 's'} failed health checks.`,
      checkedAt: resolvedCheckedAt,
      lastFailureAt: lastFailureAt || resolvedCheckedAt,
      restartRecommended: true,
      counts,
    };
  }

  if (counts.blocked > 0) {
    const blockedVerb = counts.blocked === 1 ? 'is' : 'are';
    return {
      state: 'blocked',
      reason: `${counts.blocked} service${counts.blocked === 1 ? '' : 's'} ${blockedVerb} blocked.`,
      checkedAt: resolvedCheckedAt,
      lastFailureAt,
      restartRecommended,
      counts,
    };
  }

  if (counts.degraded > 0) {
    const degradedVerb = counts.degraded === 1 ? 'is' : 'are';
    return {
      state: 'degraded',
      reason: `${counts.degraded} service${counts.degraded === 1 ? '' : 's'} ${degradedVerb} degraded.`,
      checkedAt: resolvedCheckedAt,
      lastFailureAt,
      restartRecommended,
      counts,
    };
  }

  if (counts.healthy === 0 && counts.stopped > 0) {
    return {
      state: 'stopped',
      reason: 'All services are currently stopped.',
      checkedAt: resolvedCheckedAt,
      lastFailureAt,
      restartRecommended,
      counts,
    };
  }

  return {
    state: 'healthy',
    reason: counts.stopped > 0
      ? 'Running services are healthy; some services are stopped by operator.'
      : 'All services are healthy.',
    checkedAt: resolvedCheckedAt,
    lastFailureAt,
    restartRecommended,
    counts,
  };
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

const inspectServiceCatalogEntry = async (name, meta, storageProtection) => {
  const svc = SERVICES[name];
  let available = true;
  let blocker = '';
  let running = false;
  let latencyMs = null;

  if (name === 'sshd' && !ENABLE_SSHD) {
    available = false;
    blocker = 'Disabled in single-port mode.';
  } else if (name === 'tailscale' && TAILSCALE_MODE === 'android_app') {
    available = true;
    running = Boolean(TAILSCALE_DNS_NAME || TAILSCALE_IP);
    blocker = running ? '' : 'Set TAILSCALE_DNS_NAME or TAILSCALE_IP for stable tailnet links.';
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

  let status = !available
    ? 'unavailable'
    : (running ? 'working' : meta.controlMode === 'optional' ? 'stopped' : 'stalled');
  if (name === 'jellyseerr' && !running) {
    status = 'deferred';
    blocker = blocker || 'Deferred on this host until Jellyseerr runtime compatibility is restored.';
  }
  if (name === 'tailscale' && TAILSCALE_MODE === 'android_app') {
    status = running ? 'external' : 'degraded';
  }
  const storageBlock = getStorageBlockForService(name, storageProtection);
  if (storageBlock.blocked) {
    status = 'blocked';
  }
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
    lastFailureAt: stats.lastFailureAt,
    lastTransitionAt: stats.lastTransitionAt,
    latencyMs: stats.latencyMs,
    placeholder: !available && PLACEHOLDER_SERVICE_SET.has(name),
    route: meta.route || undefined,
    status,
    statusReason: null,
    surface: meta.surface,
    uptimePct: stats.uptimePct,
  };

  if (storageBlock.blocked) {
    entry.blockedBy = 'storage_watchdog';
    entry.blockedReason = storageBlock.reason;
    entry.resumeRequired = Boolean(storageBlock.resumeRequired);
    entry.statusReason = storageBlock.reason;
    entry.blocker = storageBlock.reason;
  } else {
    entry.statusReason = statusReasonForService(entry);
  }

  const lifecycle = buildServiceLifecycleEntry(entry);
  entry.state = lifecycle.state;
  entry.reason = lifecycle.reason;
  entry.checkedAt = lifecycle.checkedAt;
  entry.lastFailureAt = lifecycle.lastFailureAt;
  entry.restartRecommended = lifecycle.restartRecommended;
  return entry;
};

const buildServiceCatalog = async () => {
  const storageProtection = readStorageProtectionState();
  const entries = await Promise.all(
    Object.entries(getServiceCatalogMeta()).map(([name, meta]) => inspectServiceCatalogEntry(name, meta, storageProtection))
  );
  return entries;
};

const createUiSnapshotCacheEntry = () => ({
  expiresAt: 0,
  staleUntil: 0,
  promise: null,
  value: null,
  touchedAt: 0,
});

const uiSnapshotCache = {
  bootstrap: new Map(),
  initial: new Map(),
  workspace: new Map(),
};
const uiSnapshotCachePruneAt = {
  bootstrap: 0,
  initial: 0,
  workspace: 0,
};

const uiSnapshotBuildLimiter = createConcurrencyLimiter(UI_SNAPSHOT_MAX_CONCURRENT_BUILDERS);

const touchUiSnapshotCacheEntry = (entry, now = Date.now()) => {
  entry.touchedAt = now;
};

const pruneUiSnapshotBucket = (bucket, now = Date.now()) => {
  const map = uiSnapshotCache[bucket];
  if (!map) {
    return;
  }
  if (now - uiSnapshotCachePruneAt[bucket] < UI_SNAPSHOT_CACHE_PRUNE_INTERVAL_MS) {
    return;
  }
  uiSnapshotCachePruneAt[bucket] = now;

  for (const [key, entry] of map.entries()) {
    if (!entry.promise && entry.staleUntil > 0 && entry.staleUntil <= now) {
      map.delete(key);
    }
  }

  if (map.size <= UI_SNAPSHOT_CACHE_MAX_ENTRIES) {
    return;
  }

  const overflow = map.size - UI_SNAPSHOT_CACHE_MAX_ENTRIES;
  const candidates = [...map.entries()]
    .filter(([, entry]) => !entry.promise)
    .sort((a, b) => {
      const aTouch = a[1].touchedAt || a[1].staleUntil || 0;
      const bTouch = b[1].touchedAt || b[1].staleUntil || 0;
      return aTouch - bTouch;
    });

  for (let idx = 0; idx < overflow && idx < candidates.length; idx += 1) {
    map.delete(candidates[idx][0]);
  }
};

const getUiSnapshotCacheEntry = (bucket, key) => {
  pruneUiSnapshotBucket(bucket);
  const map = uiSnapshotCache[bucket];
  if (!map) {
    throw new Error(`Unknown UI snapshot bucket: ${bucket}`);
  }
  if (!map.has(key)) {
    map.set(key, createUiSnapshotCacheEntry());
  }
  return map.get(key);
};

const withUiSnapshotTimeout = (label, builder) =>
  withPromiseTimeout(builder(), UI_SNAPSHOT_BUILD_TIMEOUT_MS, `UI snapshot ${label}`);

const getUiSnapshotFromCache = async ({
  bucket,
  key,
  ttlMs,
  maxStaleMs,
  force = false,
  allowStale = true,
  builder,
}) => {
  const now = Date.now();

  if (UI_SNAPSHOT_ENGINE === 'off') {
    return withUiSnapshotTimeout(`${bucket}:${key}`, builder);
  }

  const entry = getUiSnapshotCacheEntry(bucket, key);
  touchUiSnapshotCacheEntry(entry, now);

  if (UI_SNAPSHOT_ENGINE === 'shadow') {
    const previousValue = entry.value;
    const freshValue = await uiSnapshotBuildLimiter(() => withUiSnapshotTimeout(`${bucket}:${key}`, builder));
    entry.value = freshValue;
    entry.expiresAt = now + ttlMs;
    entry.staleUntil = now + maxStaleMs;
    touchUiSnapshotCacheEntry(entry, now);
    if (UI_SNAPSHOT_DIFF_LOG && previousValue && JSON.stringify(previousValue) !== JSON.stringify(freshValue)) {
      console.info(`[ui-snapshot] shadow-diff bucket=${bucket} key=${key}`);
    }
    return freshValue;
  }

  if (!force && entry.value && entry.expiresAt > now) {
    return entry.value;
  }

  if (!force && entry.promise) {
    if (allowStale && entry.value && entry.staleUntil > now) {
      entry.promise.catch(() => null);
      return entry.value;
    }
    return entry.promise;
  }

  entry.promise = uiSnapshotBuildLimiter(() => withUiSnapshotTimeout(`${bucket}:${key}`, builder))
    .then((nextValue) => {
      const previousValue = entry.value;
      const refreshAt = Date.now();
      entry.value = nextValue;
      entry.expiresAt = refreshAt + ttlMs;
      entry.staleUntil = refreshAt + maxStaleMs;
      entry.promise = null;
      touchUiSnapshotCacheEntry(entry, refreshAt);
      if (UI_SNAPSHOT_DIFF_LOG && previousValue && JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
        console.info(`[ui-snapshot] cache-refresh bucket=${bucket} key=${key}`);
      }
      return nextValue;
    })
    .catch((error) => {
      entry.promise = null;
      if (!force && allowStale && entry.value && entry.staleUntil > Date.now()) {
        return entry.value;
      }
      throw error;
    });

  if (!force && allowStale && entry.value && entry.staleUntil > now) {
    entry.promise.catch(() => null);
    return entry.value;
  }

  return entry.promise;
};

const invalidateUiSnapshotCache = ({
  bootstrap = false,
  initialWorkspace = null,
  workspace = null,
  initialWorkspaces = null,
  workspaces = null,
} = {}) => {
  if (bootstrap) {
    uiSnapshotCache.bootstrap.clear();
  }

  const invalidateWorkspaceBucket = (map, workspaceKey) => {
    if (!workspaceKey) {
      map.clear();
      return;
    }
    for (const key of map.keys()) {
      if (key.endsWith(`:${workspaceKey}`)) {
        map.delete(key);
      }
    }
  };

  const normalizeTargets = (explicitTargets, singleTarget) => {
    if (Array.isArray(explicitTargets)) {
      return explicitTargets;
    }
    if (singleTarget === null) {
      return [];
    }
    return [singleTarget];
  };

  const initialTargets = normalizeTargets(initialWorkspaces, initialWorkspace);
  const workspaceTargets = normalizeTargets(workspaces, workspace);

  if (Array.isArray(initialWorkspaces) || initialWorkspace !== null) {
    if (initialTargets.length === 0) {
      invalidateWorkspaceBucket(uiSnapshotCache.initial, null);
    } else {
      for (const target of initialTargets) {
        invalidateWorkspaceBucket(uiSnapshotCache.initial, target);
      }
    }
  }

  if (Array.isArray(workspaces) || workspace !== null) {
    if (workspaceTargets.length === 0) {
      invalidateWorkspaceBucket(uiSnapshotCache.workspace, null);
    } else {
      for (const target of workspaceTargets) {
        invalidateWorkspaceBucket(uiSnapshotCache.workspace, target);
      }
    }
  }
};

const workspaceSnapshotTtlMs = (workspaceKey) =>
  workspaceKey === 'overview'
    ? UI_SNAPSHOT_WORKSPACE_OVERVIEW_TTL_MS
    : UI_SNAPSHOT_WORKSPACE_DEFAULT_TTL_MS;

const uiServiceCatalogCache = {
  expiresAt: 0,
  staleUntil: 0,
  promise: null,
  value: null,
};

const getUiServiceCatalog = async ({ force = false, allowStale = true } = {}) => {
  const now = Date.now();
  if (!force && uiServiceCatalogCache.value && uiServiceCatalogCache.expiresAt > now) {
    return uiServiceCatalogCache.value;
  }
  if (!force && uiServiceCatalogCache.promise) {
    if (allowStale && uiServiceCatalogCache.value && uiServiceCatalogCache.staleUntil > now) {
      uiServiceCatalogCache.promise.catch(() => null);
      return uiServiceCatalogCache.value;
    }
    return uiServiceCatalogCache.promise;
  }
  uiServiceCatalogCache.promise = buildServiceCatalog()
    .then((value) => {
      uiServiceCatalogCache.value = value;
      uiServiceCatalogCache.expiresAt = Date.now() + UI_SERVICE_CATALOG_TTL_MS;
      uiServiceCatalogCache.staleUntil = Date.now() + UI_SERVICE_CATALOG_MAX_STALE_MS;
      uiServiceCatalogCache.promise = null;
      return value;
    })
    .catch((error) => {
      uiServiceCatalogCache.promise = null;
      if (!force && allowStale && uiServiceCatalogCache.value && uiServiceCatalogCache.staleUntil > Date.now()) {
        return uiServiceCatalogCache.value;
      }
      throw error;
    });
  if (!force && allowStale && uiServiceCatalogCache.value && uiServiceCatalogCache.staleUntil > now) {
    uiServiceCatalogCache.promise.catch(() => null);
    return uiServiceCatalogCache.value;
  }
  return uiServiceCatalogCache.promise;
};

const uiNetworkExposureCache = { expiresAt: 0, staleUntil: 0, promise: null, value: null };
const uiDiagnosticBreaker = {
  state: 'closed',
  failures: [],
  openedAt: 0,
  halfOpenSuccesses: 0,
};
const EMPTY_NETWORK_EXPOSURE_SNAPSHOT = Object.freeze({
  generatedAt: new Date(0).toISOString(),
  remoteAccess: null,
  tailscale: null,
});

const pruneDiagnosticFailures = (now = Date.now()) => {
  uiDiagnosticBreaker.failures = uiDiagnosticBreaker.failures.filter((timestamp) => now - timestamp <= UI_DIAGNOSTIC_BREAKER_WINDOW_MS);
};

const shouldRunUiDiagnostics = () => {
  const now = Date.now();
  pruneDiagnosticFailures(now);
  if (uiDiagnosticBreaker.state !== 'open') {
    return true;
  }
  if (now - uiDiagnosticBreaker.openedAt >= UI_DIAGNOSTIC_BREAKER_RESET_MS) {
    uiDiagnosticBreaker.state = 'half-open';
    uiDiagnosticBreaker.halfOpenSuccesses = 0;
    return true;
  }
  return false;
};

const recordUiDiagnosticSuccess = () => {
  pruneDiagnosticFailures();
  if (uiDiagnosticBreaker.state === 'half-open') {
    uiDiagnosticBreaker.halfOpenSuccesses += 1;
    if (uiDiagnosticBreaker.halfOpenSuccesses >= UI_DIAGNOSTIC_BREAKER_HALF_OPEN_SUCCESS) {
      uiDiagnosticBreaker.state = 'closed';
      uiDiagnosticBreaker.failures = [];
      uiDiagnosticBreaker.openedAt = 0;
      uiDiagnosticBreaker.halfOpenSuccesses = 0;
    }
    return;
  }
  uiDiagnosticBreaker.state = 'closed';
};

const recordUiDiagnosticFailure = () => {
  const now = Date.now();
  pruneDiagnosticFailures(now);
  uiDiagnosticBreaker.failures.push(now);
  if (uiDiagnosticBreaker.failures.length >= UI_DIAGNOSTIC_BREAKER_FAILURE_THRESHOLD) {
    uiDiagnosticBreaker.state = 'open';
    uiDiagnosticBreaker.openedAt = now;
    uiDiagnosticBreaker.halfOpenSuccesses = 0;
  }
};

const getNetworkExposureSnapshot = async ({ force = false, allowStale = true } = {}) => {
  const now = Date.now();
  if (!force && uiNetworkExposureCache.value && uiNetworkExposureCache.expiresAt > now) {
    return uiNetworkExposureCache.value;
  }
  if (!force && uiNetworkExposureCache.promise) {
    if (allowStale && uiNetworkExposureCache.value && uiNetworkExposureCache.staleUntil > now) {
      uiNetworkExposureCache.promise.catch(() => null);
      return uiNetworkExposureCache.value;
    }
    return uiNetworkExposureCache.promise;
  }

  const refreshExposure = () =>
    runCommand(`"${HMSTX_CONTROL_CMD}" audit --json`, { timeoutMs: UI_DIAGNOSTIC_TIMEOUT_MS, maxBuffer: 512 * 1024 })
      .then((output) => {
        recordUiDiagnosticSuccess();
        const parsed = JSON.parse(output || '{}');
        uiNetworkExposureCache.value = parsed;
        uiNetworkExposureCache.expiresAt = Date.now() + UI_NETWORK_EXPOSURE_TTL_MS;
        uiNetworkExposureCache.staleUntil = Date.now() + UI_NETWORK_EXPOSURE_MAX_STALE_MS;
        uiNetworkExposureCache.promise = null;
        return parsed;
      })
      .catch((error) => {
        recordUiDiagnosticFailure();
        uiNetworkExposureCache.promise = null;
        if (!force && allowStale && uiNetworkExposureCache.value && uiNetworkExposureCache.staleUntil > Date.now()) {
          return uiNetworkExposureCache.value;
        }
        throw error;
      });

  if (!force && !shouldRunUiDiagnostics()) {
    if (allowStale && uiNetworkExposureCache.value && uiNetworkExposureCache.staleUntil > now) {
      return uiNetworkExposureCache.value;
    }
    return {
      ...EMPTY_NETWORK_EXPOSURE_SNAPSHOT,
      generatedAt: new Date().toISOString(),
      stale: true,
      breaker: 'open',
    };
  }

  uiNetworkExposureCache.promise = refreshExposure();

  if (!force && UI_DEFER_HEAVY_DIAGNOSTICS) {
    if (allowStale && uiNetworkExposureCache.value && uiNetworkExposureCache.staleUntil > now) {
      uiNetworkExposureCache.promise.catch(() => null);
      return uiNetworkExposureCache.value;
    }
    uiNetworkExposureCache.promise.catch(() => null);
    return {
      ...EMPTY_NETWORK_EXPOSURE_SNAPSHOT,
      generatedAt: new Date().toISOString(),
      stale: true,
    };
  }

  return uiNetworkExposureCache.promise;
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
  if (entries.some((entry) => entry.status === 'blocked')) {
    return 'blocked';
  }
  if (entries.some((entry) => entry.status === 'stopped')) {
    return 'stopped';
  }
  return 'unavailable';
};

const mediaRootLabel = (rootPath) => {
  const value = String(rootPath || '').toLowerCase();
  if (value.includes('/movies')) {
    return 'movies';
  }
  if (value.includes('/series')) {
    return 'series';
  }
  if (value.includes('/music')) {
    return 'music';
  }
  if (value.includes('/audiobooks')) {
    return 'audiobooks';
  }
  const parts = String(rootPath || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || 'library';
};

const compactLibraryRootsSummary = (roots) => {
  const labels = Array.from(new Set((roots || []).map((entry) => mediaRootLabel(entry)).filter(Boolean)));
  const vaultPresent = (roots || []).some((entry) => String(entry || '').toLowerCase().includes('/vault/'));
  const scratchPresent = (roots || []).some((entry) => String(entry || '').toLowerCase().includes('/scratch/'));
  const laneLabel = vaultPresent && scratchPresent
    ? 'vault + scratch'
    : vaultPresent
      ? 'vault'
      : scratchPresent
        ? 'scratch'
        : 'mixed';
  return `Library roots ready (${roots.length}): ${labels.join(', ')} [${laneLabel}]`;
};

const buildMediaWorkflowSnapshot = (catalog) => {
  const storageProtection = readStorageProtectionState();
  const catalogByKey = new Map(catalog.map((entry) => [entry.key, entry]));
  const watchEntry = catalogByKey.get('jellyfin') || null;
  const requestEntry = catalogByKey.get('jellyseerr') || null;
  const automationEntries = ['prowlarr', 'sonarr', 'radarr']
    .map((key) => catalogByKey.get(key))
    .filter(Boolean);
  const subtitleEntry = catalogByKey.get('bazarr') || null;
  const supportEntries = ['redis', 'postgres', 'flarearr']
    .map((key) => catalogByKey.get(key))
    .filter(Boolean);
  const downloadEntries = catalog.filter((entry) => entry.surface === 'downloads');
  const primaryDownloadEntry = downloadEntries[0] || null;
  const libraryRoots = [
    MEDIA_MOVIES_DIR,
    MEDIA_SERIES_DIR,
    MEDIA_MUSIC_DIR,
    MEDIA_AUDIOBOOKS_DIR,
    MEDIA_SCRATCH_MOVIES_DIR,
    MEDIA_SCRATCH_SERIES_DIR,
    MEDIA_SCRATCH_MUSIC_DIR,
    MEDIA_SCRATCH_AUDIOBOOKS_DIR,
  ];
  const downloadRoots = [
    MEDIA_DOWNLOADS_DIR,
    MEDIA_DOWNLOADS_MOVIES_DIR,
    MEDIA_DOWNLOADS_SERIES_DIR,
    MEDIA_DOWNLOADS_MANUAL_DIR,
    MEDIA_DOWNLOADS_TORRENT_DIR,
    MEDIA_DOWNLOADS_TORRENT_QBIT_DIR,
  ];
  const qbittorrentConfig = probeQbittorrentConfig();
  const importStatusRaw = readJsonFile(MEDIA_IMPORT_STATUS_FILE, null);
  const cleanupStatusRaw = readJsonFile(MEDIA_CLEANUP_STATUS_FILE, null);
  const importStatus = importStatusRaw && typeof importStatusRaw === 'object'
    ? {
      aborted: Boolean(importStatusRaw.aborted),
      abortReason: typeof importStatusRaw.abortReason === 'string' ? importStatusRaw.abortReason : '',
      ambiguousReview: Number(importStatusRaw.ambiguousReview || 0),
      collisionCount: Number(importStatusRaw.collisionCount || 0),
      failed: Number(importStatusRaw.failed || 0),
      imported: Number(importStatusRaw.imported || 0),
      lastRunAt: typeof importStatusRaw.lastRunAt === 'string' ? importStatusRaw.lastRunAt : null,
      scannedItems: Number(importStatusRaw.scannedItems || 0),
      skippedExisting: Number(importStatusRaw.skippedExisting || 0),
      status: typeof importStatusRaw.status === 'string' ? importStatusRaw.status : 'unknown',
      trigger: typeof importStatusRaw.trigger === 'string' ? importStatusRaw.trigger : 'unknown',
    }
    : null;
  const cleanupStatus = cleanupStatusRaw && typeof cleanupStatusRaw === 'object'
    ? {
      cleanupMode: typeof cleanupStatusRaw.cleanupMode === 'string' ? cleanupStatusRaw.cleanupMode : 'hybrid_age_and_size',
      deletedBytes: Number(cleanupStatusRaw.deletedBytes || 0),
      deletedCacheItems: Number(cleanupStatusRaw.deletedCacheItems || 0),
      deletedImportedItems: Number(cleanupStatusRaw.deletedImportedItems || 0),
      deletedItems: Number(cleanupStatusRaw.deletedItems || 0),
      lastRunAt: typeof cleanupStatusRaw.lastRunAt === 'string' ? cleanupStatusRaw.lastRunAt : null,
      scratchPressureAfter: Boolean(cleanupStatusRaw.scratchPressureAfter),
      scratchPressureBefore: Boolean(cleanupStatusRaw.scratchPressureBefore),
      status: typeof cleanupStatusRaw.status === 'string' ? cleanupStatusRaw.status : 'unknown',
      trigger: typeof cleanupStatusRaw.trigger === 'string' ? cleanupStatusRaw.trigger : 'unknown',
    }
    : null;
  const reviewQueueCount = (() => {
    try {
      if (!fs.existsSync(MEDIA_IMPORT_REVIEW_DIR)) {
        return 0;
      }
      return fs.readdirSync(MEDIA_IMPORT_REVIEW_DIR, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.'))
        .length;
    } catch {
      return 0;
    }
  })();
  const vaultUsage = readPathUsage(MEDIA_VAULT_ROOT);
  const scratchUsage = readPathUsage(MEDIA_SCRATCH_ROOT);
  const vaultWarning = Boolean(vaultUsage && vaultUsage.freeGb <= MEDIA_VAULT_WARN_FREE_GB);
  const scratchWarning = Boolean(
    scratchUsage
    && (scratchUsage.freeGb <= MEDIA_SCRATCH_WARN_FREE_GB || scratchUsage.usedPercent >= MEDIA_SCRATCH_WARN_USED_PERCENT)
  );
  const vaultRootsStats = buildDriveStats(MEDIA_VAULT_ROOTS);
  const scratchRootsStats = buildDriveStats(MEDIA_SCRATCH_ROOTS);
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
  const watchSummary = watchEntry?.status === 'blocked'
    ? watchEntry.statusReason || 'Watch stack is blocked by storage protection.'
    : libraryRootReady
      ? compactLibraryRootsSummary(libraryRoots)
      : `Library roots missing under ${MEDIA_VAULT_ROOT}`;
  const downloadsSummary = primaryDownloadEntry?.status === 'blocked'
    ? primaryDownloadEntry.statusReason || 'Downloads are blocked by storage protection.'
    : downloadEntries.length > 0
      ? `${primaryDownloadEntry?.label || 'Download clients'} run in Downloads. Save path: ${qbittorrentConfig.defaultSavePath || MEDIA_DOWNLOADS_MANUAL_DIR}`
      : 'No download clients are configured yet.';

  return {
    watch: {
      libraryRootReady,
      libraryRoots,
      serviceKeys: watchEntry ? [watchEntry.key] : [],
      status: watchEntry?.status || 'unavailable',
      summary: watchSummary,
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
      smallDownloadsDir: MEDIA_SMALL_DOWNLOADS_DIR,
      smallDownloadsMaxMb: MEDIA_SMALL_DOWNLOADS_MAX_MB,
      tempPath: qbittorrentConfig.tempPath,
      categoryPaths: {
        manual: qbittorrentConfig.manualCategoryPath,
        movies: qbittorrentConfig.moviesCategoryPath,
        series: qbittorrentConfig.seriesCategoryPath,
        standalone: qbittorrentConfig.standaloneCategoryPath,
      },
      downloadRoots,
      primaryServiceKey: primaryDownloadEntry?.key || null,
      serviceKeys: downloadEntries.map((entry) => entry.key),
      status: downloadsStatus,
      summary: downloadsSummary,
      workspaceTab: 'downloads',
    },
    storage: {
      compatibilityRoot: MEDIA_ROOT,
      vaultRoot: MEDIA_VAULT_ROOT,
      vaultRoots: MEDIA_VAULT_ROOTS,
      scratchRoot: MEDIA_SCRATCH_ROOT,
      scratchRoots: MEDIA_SCRATCH_ROOTS,
      scratchLibraryRoot: MEDIA_SCRATCH_LIBRARY_ROOT,
      smallDownloadsDir: MEDIA_SMALL_DOWNLOADS_DIR,
      smallDownloadsMaxMb: MEDIA_SMALL_DOWNLOADS_MAX_MB,
      vaultRootsStats,
      scratchRootsStats,
      importAbortFreeGb: MEDIA_IMPORT_ABORT_FREE_GB,
      vaultWarnFreeGb: MEDIA_VAULT_WARN_FREE_GB,
      scratchWarnFreeGb: MEDIA_SCRATCH_WARN_FREE_GB,
      scratchWarnUsedPercent: MEDIA_SCRATCH_WARN_USED_PERCENT,
      scratchRetentionDays: MEDIA_SCRATCH_RETENTION_DAYS,
      scratchMinFreeGb: MEDIA_SCRATCH_MIN_FREE_GB,
      scratchCleanupEnabled: MEDIA_SCRATCH_CLEANUP_ENABLED,
      cleanupMode: 'hybrid_age_and_size',
      importReviewDir: MEDIA_IMPORT_REVIEW_DIR,
      importLogDir: MEDIA_IMPORT_LOG_DIR,
      importStatusFile: MEDIA_IMPORT_STATUS_FILE,
      cleanupStatusFile: MEDIA_CLEANUP_STATUS_FILE,
      importIndexFile: MEDIA_IMPORTED_INDEX_FILE,
      importEventsFile: MEDIA_IMPORT_EVENTS_FILE,
      importStatus,
      cleanupStatus,
      reviewQueueCount,
      lastImportRunAt: importStatus?.lastRunAt || null,
      lastCleanupRunAt: cleanupStatus?.lastRunAt || null,
      importStatusSummary: importStatus
        ? `status=${importStatus.status}, imported=${importStatus.imported}, skipped=${importStatus.skippedExisting}, failed=${importStatus.failed}, review=${importStatus.ambiguousReview}`
        : 'Importer has not produced status yet.',
      cleanupStatusSummary: cleanupStatus
        ? `status=${cleanupStatus.status}, deletedItems=${cleanupStatus.deletedItems}, deletedBytes=${cleanupStatus.deletedBytes}`
        : 'Cleanup has not produced status yet.',
      transcodeDir: MEDIA_TRANSCODE_DIR,
      miscCacheDir: MEDIA_MISC_CACHE_DIR,
      qbitTempDir: MEDIA_QBIT_TMP_DIR,
      qbitDefaultSavePath: qbittorrentConfig.defaultSavePath,
      qbitCategoryPaths: {
        manual: qbittorrentConfig.manualCategoryPath,
        movies: qbittorrentConfig.moviesCategoryPath,
        series: qbittorrentConfig.seriesCategoryPath,
        standalone: qbittorrentConfig.standaloneCategoryPath,
      },
      vault: vaultUsage ? {
        freeGb: Number(vaultUsage.freeGb.toFixed(2)),
        usedPercent: Number(vaultUsage.usedPercent.toFixed(2)),
        warning: vaultWarning,
      } : null,
      scratch: scratchUsage ? {
        freeGb: Number(scratchUsage.freeGb.toFixed(2)),
        usedPercent: Number(scratchUsage.usedPercent.toFixed(2)),
        warning: scratchWarning,
      } : null,
      protection: {
        available: storageProtection.available,
        blockedServices: storageProtection.blockedServices,
        enabled: storageProtection.enabled,
        generatedAt: storageProtection.generatedAt,
        healthyStreak: storageProtection.healthyStreak,
        lastDegradedAt: storageProtection.lastDegradedAt,
        lastHealthyAt: storageProtection.lastHealthyAt,
        lastTransitionAt: storageProtection.lastTransitionAt,
        manualResume: storageProtection.manualResume,
        overallHealthy: storageProtection.overallHealthy,
        reason: storageProtection.reason,
        reasonCompact: storageProtection.reasonCompact,
        resumeRequired: storageProtection.resumeRequired,
        state: storageProtection.state,
        stoppedByWatchdog: storageProtection.stoppedByWatchdog,
        vault: storageProtection.vault,
        scratch: storageProtection.scratch,
      },
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
        ? 'Redis/PostgreSQL handle media state while FlareArr supports Cloudflare-protected indexer access.'
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
  if (!token) {
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
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
  const storageProtection = readStorageProtectionState();

  for (const name of Object.keys(getServiceCatalogMeta())) {
    if (name === 'sshd' && !ENABLE_SSHD) {
      continue;
    }

    if (name === 'ftp' && !(await detectFtpProvider())) {
      continue;
    }

    const svc = SERVICES[name];
    const install = await resolveServiceInstall(name, svc);
    if (install.available) {
      const storageBlock = getStorageBlockForService(name, storageProtection);
      if (storageBlock.blocked) {
        result[name] = false;
      } else {
        result[name] = await checkService(svc);
      }
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

const writeJsonFileAtomic = (filePath, payload) => {
  const directoryPath = path.dirname(filePath);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, filePath);
};

const compactText = (value, maxLength = 180) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const buildStorageProtectionReasonCompact = (state = {}) => {
  const vaultHealthy = state?.vault?.healthy !== false;
  const scratchHealthy = state?.scratch?.healthy !== false;
  const blockedServices = Array.isArray(state?.blockedServices) ? state.blockedServices : [];
  const blockedCount = blockedServices.length;
  const qbBlocked = blockedServices.includes('qbittorrent');
  const workflowBlocked = blockedServices.includes('media-workflow');
  const jellyfinBlocked = blockedServices.includes('jellyfin');
  const bazarrBlocked = blockedServices.includes('bazarr');
  const resumeCount = Array.isArray(state?.stoppedByWatchdog) ? state.stoppedByWatchdog.length : 0;

  if (state?.state === 'degraded' || !state?.overallHealthy || blockedCount > 0) {
    if (!vaultHealthy && !scratchHealthy) {
      if (blockedCount === 0) {
        return 'Vault and scratch degraded. Fallback roots active; downloads and import workflow remain online.';
      }
      return 'Vault and scratch degraded. External mounts missing; fallback paths active and storage-critical services blocked.';
    }
    if (!vaultHealthy) {
      if (!jellyfinBlocked && !bazarrBlocked && !workflowBlocked) {
        return 'Vault degraded. External vault mount missing; fallback vault root active.';
      }
      return 'Vault degraded. External vault mount missing; Jellyfin/Bazarr/media workflow are blocked.';
    }
    if (!scratchHealthy) {
      if (!qbBlocked && !workflowBlocked) {
        return 'Scratch degraded. External scratch mount missing; fallback download path active.';
      }
      return 'Scratch degraded. External scratch mount missing; qBittorrent/media workflow are blocked.';
    }
    return compactText(state?.reason || 'Storage degraded.', 180);
  }

  if (resumeCount > 0) {
    return `${resumeCount} service${resumeCount === 1 ? '' : 's'} await manual resume.`;
  }

  if (state?.state === 'healthy' || state?.overallHealthy) {
    return 'Storage watchdog healthy.';
  }

  return compactText(state?.reason || 'Storage watchdog state unknown.', 180);
};

const readStorageProtectionState = () => {
  const raw = readJsonFile(STORAGE_WATCHDOG_STATE_FILE, null);
  const fallbackRole = {
    drives: [],
    healthy: true,
    reason: '',
    roots: [],
  };
  const fallbackState = {
    available: fileIsExecutable(STORAGE_WATCHDOG_SERVICE_CMD),
    blockedServices: [],
    enabled: fs.existsSync(STORAGE_WATCHDOG_STATE_FILE),
    generatedAt: null,
    healthyStreak: 0,
    lastDegradedAt: null,
    lastHealthyAt: null,
    lastTransitionAt: null,
    manualResume: true,
    overallHealthy: true,
    reason: '',
    reasonCompact: 'Storage watchdog state unknown.',
    resumeRequired: false,
    schema: 1,
    state: 'unknown',
    stoppedByWatchdog: [],
    vault: fallbackRole,
    scratch: fallbackRole,
  };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fallbackState;
  }

  const blockedServices = normalizeStringArray(raw.blockedServices);
  const stoppedByWatchdog = normalizeStringArray(raw.stoppedByWatchdog);

  const nextState = {
    available: fileIsExecutable(STORAGE_WATCHDOG_SERVICE_CMD),
    blockedServices,
    enabled: true,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
    healthyStreak: Math.max(0, Number(raw.healthyStreak || 0) || 0),
    lastDegradedAt: typeof raw.lastDegradedAt === 'string' ? raw.lastDegradedAt : null,
    lastHealthyAt: typeof raw.lastHealthyAt === 'string' ? raw.lastHealthyAt : null,
    lastTransitionAt: typeof raw.lastTransitionAt === 'string' ? raw.lastTransitionAt : null,
    manualResume: raw.manualResume !== false,
    overallHealthy: Boolean(raw.overallHealthy),
    reason: String(raw.reason || ''),
    reasonCompact: '',
    resumeRequired: Boolean(raw.resumeRequired) && stoppedByWatchdog.length > 0,
    schema: Math.max(1, Number(raw.schema || 1) || 1),
    state: String(raw.state || (blockedServices.length > 0 ? 'degraded' : 'healthy')),
    stoppedByWatchdog,
    vault: normalizeStorageRoleState(raw.vault || {}),
    scratch: normalizeStorageRoleState(raw.scratch || {}),
  };
  nextState.reasonCompact = buildStorageProtectionReasonCompact(nextState);
  return nextState;
};

const clearStorageResumeRequirementForService = (serviceName) => {
  try {
    if (!fs.existsSync(STORAGE_WATCHDOG_STATE_FILE)) {
      return false;
    }

    const raw = readJsonFile(STORAGE_WATCHDOG_STATE_FILE, null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return false;
    }

    const stoppedByWatchdog = normalizeStringArray(raw.stoppedByWatchdog)
      .filter((entry) => entry !== serviceName);
    const nextState = {
      ...raw,
      generatedAt: new Date().toISOString(),
      stoppedByWatchdog,
    };

    if (stoppedByWatchdog.length === 0 && Boolean(raw.overallHealthy)) {
      nextState.resumeRequired = false;
      if (String(nextState.state || '') === 'recovered') {
        nextState.state = 'healthy';
      }
    } else if (stoppedByWatchdog.length > 0) {
      nextState.resumeRequired = true;
    }

    writeJsonFileAtomic(STORAGE_WATCHDOG_STATE_FILE, nextState);
    return true;
  } catch {
    return false;
  }
};

const normalizeDriveEntry = (entry = {}) => ({
  device: String(entry.device || ''),
  dirName: String(entry.dirName || ''),
  error: String(entry.error || ''),
  filesystem: String(entry.filesystem || ''),
  letter: String(entry.letter || ''),
  mountPoint: String(entry.mountPoint || ''),
  mountRole: String(entry.mountRole || entry.role || ''),
  name: String(entry.name || ''),
  rawMountPoint: String(entry.rawMountPoint || ''),
  role: String(entry.role || ''),
  state: String(entry.state || 'unknown'),
  uuid: String(entry.uuid || ''),
});

const isHiddenDriveEntry = () => false;

const isHiddenDriveDirName = () => false;

const getDriveSnapshot = async () => {
  const agentInstalled = fileIsExecutable(USB_MOUNT_SERVICE_CMD) || await commandExists(USB_MOUNT_SERVICE_CMD);
  const rawManifest = readJsonFile(DRIVE_STATE_PATH, {});
  const drives = Array.isArray(rawManifest.drives) ? rawManifest.drives.map(normalizeDriveEntry) : [];
  const filteredDrives = drives.filter((entry) => !isHiddenDriveEntry(entry));
  const filteredEvents = readJsonLines(DRIVE_EVENTS_PATH, 80).filter((event) => !isHiddenDriveEntry(event || {}));

  return {
    agentInstalled,
    checkedAt: new Date().toISOString(),
    events: filteredEvents,
    manifest: {
      generatedAt: typeof rawManifest.generatedAt === 'string' ? rawManifest.generatedAt : null,
      intervalMs: Math.max(60000, Number(rawManifest.intervalMs || DRIVE_REFRESH_INTERVAL_MS) || DRIVE_REFRESH_INTERVAL_MS),
      drives: filteredDrives,
    },
    refreshIntervalMs: DRIVE_REFRESH_INTERVAL_MS,
  };
};

const getDashboardSnapshot = async (sessionId) => {
  const [monitor, storage, serviceCatalog, networkExposure] = await Promise.all([
    getMonitorSnapshot(),
    getStorageSnapshot(),
    getUiServiceCatalog({ allowStale: true }).catch(() => []),
    getNetworkExposureSnapshot({ allowStale: true }).catch(() => EMPTY_NETWORK_EXPOSURE_SNAPSHOT),
  ]);
  const services = serviceCatalog.reduce((acc, entry) => {
    if (entry.available) {
      acc[entry.key] = entry.status === 'working';
    }
    return acc;
  }, {});
  const controlledServiceNames = serviceCatalog
    .filter((entry) => entry.controlMode === 'optional' && entry.available)
    .map((entry) => entry.key);
  const lifecycle = buildStackLifecycleSummary(serviceCatalog);

  return {
    generatedAt: new Date().toISOString(),
    services,
    serviceCatalog,
    lifecycle,
    serviceGroups: buildServiceGroups(serviceCatalog),
    mediaWorkflow: buildMediaWorkflowSnapshot(serviceCatalog),
    monitor,
    connections: getConnectionsSnapshot(),
    networkDevices: getNetworkDevicesSnapshot(),
    endpointMetrics: getUiEndpointMetricsSnapshot(),
    storage,
    networkExposure,
    remoteAccess: networkExposure.remoteAccess || null,
    tailscale: networkExposure.tailscale || null,
    serviceController: {
      locked: !isServiceControllerUnlocked(sessionId),
      optionalServices: controlledServiceNames,
    },
    logs: getLogsSnapshot(),
  };
};

const getTelemetrySnapshot = async (sessionId) => {
  const [monitor, serviceCatalog, networkExposure] = await Promise.all([
    getMonitorSnapshot(),
    getUiServiceCatalog({ allowStale: true }).catch(() => []),
    getNetworkExposureSnapshot({ allowStale: true }).catch(() => EMPTY_NETWORK_EXPOSURE_SNAPSHOT),
  ]);
  const lifecycle = buildStackLifecycleSummary(serviceCatalog);

  return {
    generatedAt: new Date().toISOString(),
    logs: getLogsSnapshot(),
    monitor,
    endpointMetrics: getUiEndpointMetricsSnapshot(),
    serviceCatalog,
    lifecycle,
    serviceGroups: buildServiceGroups(serviceCatalog),
    mediaWorkflow: buildMediaWorkflowSnapshot(serviceCatalog),
    networkExposure,
    remoteAccess: networkExposure.remoteAccess || null,
    tailscale: networkExposure.tailscale || null,
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
  const topLevelEntries = fs.readdirSync(FILEBROWSER_ROOT, { encoding: 'utf8' })
    .filter((name) => !FS_HIDDEN_NAMES.has(name) && !isHiddenDriveDirName(name));
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
  return new Set(['C', ...snapshot.manifest.drives.map((drive) => drive.dirName).filter((name) => name && !isHiddenDriveDirName(name))]);
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
      let resolvedStat = dirent;
      if (dirent.isSymbolicLink()) {
        try {
          resolvedStat = fs.statSync(childAbsolute);
        } catch {
          // keep broken symlinks visible rather than failing the listing
          resolvedStat = dirent;
        }
      }
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

const findNearestExistingPath = (candidatePath) => {
  let probe = path.resolve(candidatePath);
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) {
      break;
    }
    probe = parent;
  }
  return probe;
};

const assertFsTransferPathSafe = (candidatePath, label, options = {}) => {
  const { allowMissing = false } = options;
  const probePath = allowMissing ? findNearestExistingPath(candidatePath) : candidatePath;
  if (!fs.existsSync(probePath)) {
    return;
  }

  const stat = fs.lstatSync(probePath);
  if (stat.isBlockDevice?.() || stat.isCharacterDevice?.()) {
    throw new Error(`Refusing ${label}: raw device paths are not allowed`);
  }

  let resolved = path.resolve(probePath);
  try {
    resolved = fs.realpathSync.native(probePath);
  } catch {
    // Use the lexical path when a symlink target is currently unavailable.
  }
  if (resolved === '/dev' || resolved.startsWith('/dev/')) {
    throw new Error(`Refusing ${label}: device filesystem paths are not allowed`);
  }
};

const copyFsEntry = (sourcePath, targetPath) => {
  assertFsTransferPathSafe(sourcePath, 'copy source');
  assertFsTransferPathSafe(targetPath, 'copy destination', { allowMissing: true });
  fs.cpSync(sourcePath, targetPath, {
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    recursive: true,
  });
};

const moveFsEntry = (sourcePath, targetPath) => {
  assertFsTransferPathSafe(sourcePath, 'move source');
  assertFsTransferPathSafe(targetPath, 'move destination', { allowMissing: true });
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

const FS_OPERATION_ACTIVE_STATUSES = new Set(['queued', 'receiving', 'running', 'cancelling']);
const FS_OPERATION_TERMINAL_STATUSES = new Set(['success', 'partial', 'failed', 'cancelled']);
const FS_OPERATION_CANCELLATION_STATUSES = new Set(['cancelling', 'cancelled']);
const FS_OPERATION_CANCELLED_ERROR_CODE = 'FS_OPERATION_CANCELLED';
const FS_CONFLICT_RESOLVE_ACTIONS = new Set(['replace', 'skip', 'replace_all_diff_size', 'skip_all_same_size']);

const normalizeFsConflictPayload = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const sizeRelationRaw = String(entry.sizeRelation || '').toLowerCase();
  const sizeRelation = sizeRelationRaw === 'same' || sizeRelationRaw === 'different' ? sizeRelationRaw : 'unknown';
  return {
    reason: String(entry.reason || 'exists'),
    sourcePath: normalizeLocalRelativePath(entry.sourcePath || ''),
    sourceSize: Number.isFinite(Number(entry.sourceSize)) ? Number(entry.sourceSize) : null,
    sourceType: String(entry.sourceType || ''),
    targetPath: normalizeLocalRelativePath(entry.targetPath || ''),
    targetSize: Number.isFinite(Number(entry.targetSize)) ? Number(entry.targetSize) : null,
    targetType: String(entry.targetType || ''),
    sizeRelation,
  };
};

const sanitizeFsOperationId = (value = '', fallback = '') => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return normalized || fallback;
};

const normalizeFsUploadRelativePath = (value = '') =>
  String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');

const getFsOperationStatePath = (operationId = '') => path.join(FS_OPERATIONS_STATE_DIR, `${operationId}.json`);
const getFsOperationStagingRoot = (operationId = '') => path.join(FS_OPERATIONS_STAGING_DIR, operationId);

const createFsOperationCancelledError = (message = 'Operation cancelled') => {
  const error = new Error(String(message || 'Operation cancelled'));
  error.code = FS_OPERATION_CANCELLED_ERROR_CODE;
  return error;
};

const isFsOperationCancelledError = (error) => Boolean(error && typeof error === 'object' && error.code === FS_OPERATION_CANCELLED_ERROR_CODE);

const normalizeFsOperationFailure = (entry) => ({
  error: String(entry?.error || 'Operation failed'),
  path: String(entry?.path || ''),
});

const normalizeFsOperationManifestEntry = (entry) => {
  const relativePath = normalizeFsUploadRelativePath(entry?.relativePath || entry?.path || '');
  const size = Math.max(0, Number(entry?.size || 0) || 0);
  const lastModified = Math.max(0, Number(entry?.lastModified || 0) || 0);
  if (!relativePath) {
    return null;
  }
  return {
    lastModified,
    relativePath,
    size,
  };
};

const normalizeFsOperationState = (operationId, raw) => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const uploadedFiles = Array.isArray(raw.uploadedFiles)
    ? raw.uploadedFiles
      .map((entry) => normalizeFsUploadRelativePath(entry))
      .filter(Boolean)
    : [];
  const manifest = Array.isArray(raw.manifest)
    ? raw.manifest.map((entry) => normalizeFsOperationManifestEntry(entry)).filter(Boolean)
    : [];

  return {
    id: operationId,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    destinationPath: normalizeLocalRelativePath(raw.destinationPath || ''),
    failureCount: Math.max(0, Number(raw.failureCount || 0) || 0),
    failures: Array.isArray(raw.failures) ? raw.failures.map((entry) => normalizeFsOperationFailure(entry)) : [],
    kind: String(raw.kind || ''),
    manifest,
    message: String(raw.message || ''),
    processedBytes: Math.max(0, Number(raw.processedBytes || 0) || 0),
    processedItems: Math.max(0, Number(raw.processedItems || 0) || 0),
    cursor: Math.max(0, Number(raw.cursor || 0) || 0),
    sourcePaths: Array.isArray(raw.sourcePaths)
      ? raw.sourcePaths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
      : [],
    stagingPath: String(raw.stagingPath || getFsOperationStagingRoot(operationId)),
    status: String(raw.status || 'failed'),
    totalBytes: Math.max(0, Number(raw.totalBytes || 0) || 0),
    totalItems: Math.max(0, Number(raw.totalItems || 0) || 0),
    updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
    uploadedFiles: [...new Set(uploadedFiles)],
    conflict: normalizeFsConflictPayload(raw.conflict),
    conflictPolicy: {
      replaceAllDifferentSize: Boolean(raw.conflictPolicy?.replaceAllDifferentSize),
      skipAllSameSize: Boolean(raw.conflictPolicy?.skipAllSameSize),
    },
    conflictResolution: FS_CONFLICT_RESOLVE_ACTIONS.has(String(raw.conflictResolution || '').toLowerCase())
      ? String(raw.conflictResolution || '').toLowerCase()
      : '',
  };
};

const readFsOperation = (operationId = '') => {
  const normalizedId = sanitizeFsOperationId(operationId);
  if (!normalizedId) {
    return null;
  }
  return normalizeFsOperationState(
    normalizedId,
    readJsonFileSafe(getFsOperationStatePath(normalizedId), null),
  );
};

const writeFsOperation = (job) => {
  const normalizedJob = normalizeFsOperationState(
    sanitizeFsOperationId(job?.id || '', `fs-op-${Date.now()}`),
    job,
  );
  if (!normalizedJob) {
    throw new Error('Invalid filesystem operation');
  }
  writeJsonFileAtomic(getFsOperationStatePath(normalizedJob.id), normalizedJob);
  return normalizedJob;
};

const updateFsOperation = (operationId, updater) => {
  const current = readFsOperation(operationId);
  if (!current) {
    throw new Error('Filesystem operation not found');
  }
  const next = typeof updater === 'function' ? updater({ ...current }) : { ...current, ...(updater || {}) };
  return writeFsOperation({
    ...current,
    ...(next || {}),
    id: current.id,
    updatedAt: new Date().toISOString(),
  });
};

const removeFsOperationState = (operationId = '') => {
  const normalizedId = sanitizeFsOperationId(operationId);
  if (!normalizedId) {
    return false;
  }
  try {
    fs.rmSync(getFsOperationStatePath(normalizedId), { force: true });
    return true;
  } catch {
    return false;
  }
};

const cleanupFsOperationArtifacts = (job) => {
  if (!job || job.kind !== 'upload') {
    return;
  }

  const stagingPath = String(job.stagingPath || '');
  if (!stagingPath) {
    return;
  }

  try {
    const stagingAbsolute = path.resolve(stagingPath);
    const rootAbsolute = path.resolve(FS_OPERATIONS_STAGING_DIR);
    if (stagingAbsolute === rootAbsolute || stagingAbsolute.startsWith(`${rootAbsolute}${path.sep}`)) {
      fs.rmSync(stagingAbsolute, { force: true, recursive: true });
    }
  } catch {
    // best effort cleanup
  }
};

const isFsOperationCancellationRequested = (operationId = '') => {
  const job = readFsOperation(operationId);
  if (!job) {
    return true;
  }
  return FS_OPERATION_CANCELLATION_STATUSES.has(job.status);
};

const throwIfFsOperationCancelled = (operationId, message = 'Operation cancelled') => {
  if (isFsOperationCancellationRequested(operationId)) {
    throw createFsOperationCancelledError(message);
  }
};

const markFsOperationCancelled = (operationId, message = 'Operation cancelled') => {
  const nextJob = updateFsOperation(operationId, (job) => ({
    ...job,
    message: String(message || 'Operation cancelled'),
    status: 'cancelled',
  }));
  cleanupFsOperationArtifacts(nextJob);
  return nextJob;
};

const serializeFsOperation = (job, detail = false) => {
  if (!job) {
    return null;
  }
  return {
    createdAt: job.createdAt,
    destinationPath: job.destinationPath,
    failureCount: job.failureCount,
    failures: detail ? job.failures : job.failures.slice(0, 5),
    id: job.id,
    kind: job.kind,
    manifest: detail ? job.manifest : undefined,
    message: job.message,
    processedBytes: job.processedBytes,
    processedItems: job.processedItems,
    sourcePaths: job.sourcePaths,
    status: job.status,
    totalBytes: job.totalBytes,
    totalItems: job.totalItems,
    updatedAt: job.updatedAt,
    uploadedFiles: detail ? job.uploadedFiles : undefined,
    conflict: job.conflict || null,
    conflictPolicy: job.conflictPolicy || { replaceAllDifferentSize: false, skipAllSameSize: false },
  };
};

const listFsOperations = (limit = 25) => {
  let files = [];
  try {
    files = fs.readdirSync(FS_OPERATIONS_STATE_DIR).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }

  return files
    .map((name) => readFsOperation(name.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit);
};

const createFsOperationTracker = (job) => {
  let current = { ...job };
  let lastWriteAt = 0;

  const persist = (force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteAt < 200) {
      return current;
    }
    const diskJob = readFsOperation(current.id);
    if (diskJob && FS_OPERATION_CANCELLATION_STATUSES.has(diskJob.status)) {
      current.status = diskJob.status;
      if (diskJob.message) {
        current.message = diskJob.message;
      }
    }
    lastWriteAt = now;
    current.updatedAt = new Date(now).toISOString();
    current = writeFsOperation(current);
    return current;
  };

  return {
    get job() {
      return current;
    },
    fail(pathValue, error) {
      current.failures = [...current.failures, {
        error: String(error instanceof Error ? error.message : error || 'Operation failed'),
        path: String(pathValue || ''),
      }];
      current.failureCount = current.failures.length;
      persist(false);
    },
    mark(status, message = current.message || '') {
      current.status = status;
      current.message = String(message || current.message || '');
      return persist(true);
    },
    refresh() {
      current = readFsOperation(current.id) || current;
      return current;
    },
    set(values = {}, force = false) {
      current = {
        ...current,
        ...values,
      };
      current.processedBytes = Math.min(current.totalBytes, Math.max(0, Number(current.processedBytes || 0) || 0));
      current.processedItems = Math.min(current.totalItems, Math.max(0, Number(current.processedItems || 0) || 0));
      return persist(force);
    },
    tick(delta = {}, force = false) {
      current.processedBytes = Math.min(current.totalBytes, current.processedBytes + Math.max(0, Number(delta.bytes || 0) || 0));
      current.processedItems = Math.min(current.totalItems, current.processedItems + Math.max(0, Number(delta.items || 0) || 0));
      if (delta.message) {
        current.message = String(delta.message);
      }
      return persist(force);
    },
  };
};

const collectFsEntryStats = (absolutePath) => {
  const lstat = fs.lstatSync(absolutePath);
  if (lstat.isSymbolicLink()) {
    return { totalBytes: 0, totalItems: 1 };
  }
  if (lstat.isFile()) {
    return { totalBytes: lstat.size, totalItems: 1 };
  }
  if (!lstat.isDirectory()) {
    return { totalBytes: 0, totalItems: 1 };
  }

  let totalBytes = 0;
  let totalItems = 1;
  const children = fs.readdirSync(absolutePath, { withFileTypes: true });
  for (const child of children) {
    const childStats = collectFsEntryStats(path.join(absolutePath, child.name));
    totalBytes += childStats.totalBytes;
    totalItems += childStats.totalItems;
  }
  return { totalBytes, totalItems };
};

const sumFsStats = (statsList = []) => statsList.reduce((acc, entry) => ({
  totalBytes: acc.totalBytes + Math.max(0, Number(entry?.totalBytes || 0) || 0),
  totalItems: acc.totalItems + Math.max(0, Number(entry?.totalItems || 0) || 0),
}), { totalBytes: 0, totalItems: 0 });

const getFsEntryConflictMeta = (sourcePath, targetPath) => {
  const sourceLstat = fs.lstatSync(sourcePath);
  const targetLstat = fs.lstatSync(targetPath);
  const sourceType = sourceLstat.isDirectory() ? 'directory' : sourceLstat.isFile() ? 'file' : sourceLstat.isSymbolicLink() ? 'symlink' : 'other';
  const targetType = targetLstat.isDirectory() ? 'directory' : targetLstat.isFile() ? 'file' : targetLstat.isSymbolicLink() ? 'symlink' : 'other';
  const sourceSize = sourceLstat.isFile() ? sourceLstat.size : null;
  const targetSize = targetLstat.isFile() ? targetLstat.size : null;
  const sizeRelation = sourceSize != null && targetSize != null
    ? sourceSize === targetSize
      ? 'same'
      : 'different'
    : 'unknown';

  return {
    sourceSize,
    sourceType,
    targetSize,
    targetType,
    sizeRelation,
  };
};

const copyFileWithProgress = async (sourcePath, targetPath, onProgress, shouldAbort = null) => {
  if (shouldAbort?.()) {
    throw createFsOperationCancelledError();
  }
  const sourceStat = fs.statSync(sourcePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  await new Promise((resolve, reject) => {
    let settled = false;
    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(targetPath, { flags: 'wx' });

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      readStream.destroy();
      writeStream.destroy();
      try {
        fs.rmSync(targetPath, { force: true });
      } catch {
        // best effort cleanup
      }
      reject(error);
    };

    readStream.on('data', (chunk) => {
      if (shouldAbort?.()) {
        fail(createFsOperationCancelledError());
        return;
      }
      onProgress?.({
        bytes: Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk),
        items: 0,
      });
    });
    readStream.on('error', fail);
    writeStream.on('error', fail);
    writeStream.on('close', () => {
      if (settled) {
        return;
      }
      if (shouldAbort?.()) {
        fail(createFsOperationCancelledError());
        return;
      }
      settled = true;
      try {
        fs.utimesSync(targetPath, sourceStat.atime, sourceStat.mtime);
      } catch {
        // preserve timestamps on best effort
      }
      resolve();
    });

    readStream.pipe(writeStream);
  });
};

const copyFsEntryWithProgress = async (sourcePath, targetPath, tracker, mode, knownStats = null, shouldAbort = null) => {
  if (shouldAbort?.()) {
    throw createFsOperationCancelledError();
  }
  const sourceLstat = fs.lstatSync(sourcePath);
  const sourceStats = knownStats || collectFsEntryStats(sourcePath);

  if (mode === 'move') {
    try {
      fs.renameSync(sourcePath, targetPath);
      tracker.tick({
        bytes: sourceStats.totalBytes,
        items: sourceStats.totalItems,
      }, true);
      return;
    } catch (error) {
      if (error?.code !== 'EXDEV') {
        throw error;
      }
    }
  }

  if (sourceLstat.isSymbolicLink()) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
    if (mode === 'move') {
      fs.unlinkSync(sourcePath);
    }
    tracker.tick({ items: 1 }, true);
    return;
  }

  if (sourceLstat.isFile()) {
    await copyFileWithProgress(sourcePath, targetPath, (delta) => tracker.tick(delta, false), shouldAbort);
    tracker.tick({ items: 1 }, true);
    if (mode === 'move') {
      fs.unlinkSync(sourcePath);
    }
    return;
  }

  if (!sourceLstat.isDirectory()) {
    tracker.tick({ items: 1 }, true);
    return;
  }

  fs.mkdirSync(targetPath, { recursive: true });
  tracker.tick({ items: 1 }, false);
  const children = fs.readdirSync(sourcePath, { withFileTypes: true });
  for (const child of children) {
    if (shouldAbort?.()) {
      throw createFsOperationCancelledError();
    }
    const sourceChildPath = path.join(sourcePath, child.name);
    const targetChildPath = path.join(targetPath, child.name);
    await copyFsEntryWithProgress(sourceChildPath, targetChildPath, tracker, mode, null, shouldAbort);
  }
  try {
    const sourceStat = fs.statSync(sourcePath);
    fs.utimesSync(targetPath, sourceStat.atime, sourceStat.mtime);
  } catch {
    // best effort preserve timestamps for directories
  }
  if (mode === 'move') {
    fs.rmdirSync(sourcePath);
  }
};

let fsOperationQueue = Promise.resolve();

const enqueueFsOperation = (operationId, worker) => {
  fsOperationQueue = fsOperationQueue
    .catch(() => null)
    .then(async () => {
      const current = readFsOperation(operationId);
      if (!current || FS_OPERATION_TERMINAL_STATUSES.has(current.status)) {
        return;
      }
      try {
        await worker();
      } catch (error) {
        const latest = readFsOperation(operationId);
        if (isFsOperationCancelledError(error) || (latest && FS_OPERATION_CANCELLATION_STATUSES.has(latest.status))) {
          try {
            markFsOperationCancelled(operationId, latest?.message || 'Operation cancelled');
          } catch {
            // operation may already be removed
          }
          return;
        }
        updateFsOperation(operationId, (job) => ({
          ...job,
          failureCount: Math.max(1, job.failureCount || 0),
          failures: job.failures.length > 0 ? job.failures : [{ error: String(error instanceof Error ? error.message : error || 'Operation failed'), path: '' }],
          message: String(error instanceof Error ? error.message : error || 'Operation failed'),
          status: 'failed',
        }));
      }
    });
  return fsOperationQueue;
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
    mirrorMountPoint: path.join(TERMUX_DRIVES_MIRROR_ROOT, mountName),
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
    mirrorMountPoint: runtime.mirrorMountPoint,
    mirrorRoot: TERMUX_DRIVES_MIRROR_ROOT,
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

const refreshTermuxDriveMirror = () => {
  if (!fs.existsSync(DRIVE_COMMON_SCRIPT)) {
    return { ok: false, error: `Missing drive mirror helper at ${DRIVE_COMMON_SCRIPT}` };
  }

  try {
    execFileSync('bash', ['-lc', `
set -euo pipefail
source ${JSON.stringify(DRIVE_COMMON_SCRIPT)}
prepare_drives_root
DRIVE_MIRROR_MODE=""
DRIVE_MIRROR_ENTRIES_JSON="[]"
DRIVE_MIRROR_ALIASES_JSON="[]"
DRIVE_MIRROR_REASON=""
ensure_termux_drive_mirror DRIVE_MIRROR_MODE DRIVE_MIRROR_ENTRIES_JSON DRIVE_MIRROR_ALIASES_JSON DRIVE_MIRROR_REASON
`], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.stderr || error?.stdout || error?.message || 'Drive mirror refresh failed').trim(),
    };
  }
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
      mirrorMountPoint: runtime.mirrorMountPoint,
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
    mirrorMountPoint: String(payload.mirrorMountPoint || runtime.mirrorMountPoint),
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
  refreshTermuxDriveMirror();
  return getFtpMountState(favourite);
};

const unmountFtpFavourite = async (favourite) => {
  writeCloudMountRequest(favourite, { includeSecrets: false });
  runCloudMountHelper(['unmount', '--request', getFtpFavouriteRuntime(favourite).helperRequestPath]);
  refreshTermuxDriveMirror();
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

const uiEndpointMetrics = new Map();

const trackedEndpointMetricKey = (requestPath) => {
  const normalizedPath = String(requestPath || '').replace(/^\/api/, '');
  if (normalizedPath === '/ui/bootstrap') {
    return 'ui.bootstrap';
  }
  if (normalizedPath === '/ui/initial') {
    return 'ui.initial';
  }
  if (normalizedPath.startsWith('/ui/workspaces/')) {
    return 'ui.workspaces';
  }
  if (normalizedPath === '/fs/operations') {
    return 'fs.operations';
  }
  return null;
};

const percentile = (values, targetPct) => {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(sorted.length - 1, Math.ceil((targetPct / 100) * sorted.length) - 1));
  return sorted[position];
};

const pruneMetricSamples = (samples, now = Date.now()) => {
  const minTs = now - UI_ENDPOINT_METRICS_WINDOW_MS;
  while (samples.length > 0 && samples[0].ts < minTs) {
    samples.shift();
  }
  while (samples.length > UI_ENDPOINT_METRICS_MAX_SAMPLES) {
    samples.shift();
  }
};

const recordEndpointMetricSample = (metricKey, durationMs, statusCode) => {
  const now = Date.now();
  const metric = uiEndpointMetrics.get(metricKey) || { samples: [] };
  metric.samples.push({
    ts: now,
    durationMs: Math.max(0, Number(durationMs || 0)),
    statusCode: Number(statusCode || 0),
  });
  pruneMetricSamples(metric.samples, now);
  uiEndpointMetrics.set(metricKey, metric);
};

const getUiEndpointMetricsSnapshot = () => {
  const now = Date.now();
  const result = {};
  for (const [metricKey, metric] of uiEndpointMetrics.entries()) {
    pruneMetricSamples(metric.samples, now);
    const latency = metric.samples.map((entry) => entry.durationMs);
    const errors = metric.samples.filter((entry) => entry.statusCode >= 500).length;
    const total = metric.samples.length;
    result[metricKey] = {
      sampleCount: total,
      p95Ms: percentile(latency, 95),
      p50Ms: percentile(latency, 50),
      errorRatePct: total > 0 ? Number(((errors / total) * 100).toFixed(2)) : 0,
      windowMs: UI_ENDPOINT_METRICS_WINDOW_MS,
    };
  }
  return result;
};

app.use((req, res, next) => {
  const metricKey = trackedEndpointMetricKey(req.path);
  if (!metricKey) {
    return next();
  }
  const startedAt = Date.now();
  res.on('finish', () => {
    recordEndpointMetricSample(metricKey, Date.now() - startedAt, res.statusCode);
  });
  next();
});

const snapshotInvalidationForRequest = (req) => {
  const method = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return null;
  }

  const normalizedPath = String(req.path || '').replace(/^\/api/, '');
  if (normalizedPath.startsWith('/fs/')) {
    return { initialWorkspaces: ['files'], workspaces: ['files'] };
  }
  if (normalizedPath.startsWith('/ftp/') || normalizedPath.startsWith('/media/torrents/')) {
    return { initialWorkspaces: ['transfers'], workspaces: ['transfers'] };
  }
  if (normalizedPath.startsWith('/shares') || normalizedPath.startsWith('/users')) {
    return { initialWorkspaces: ['files'], workspaces: ['files'] };
  }
  if (normalizedPath.startsWith('/llm/')) {
    return { initialWorkspaces: ['ai'], workspaces: ['ai'] };
  }
  if (normalizedPath.startsWith('/drives')) {
    return { bootstrap: true, initialWorkspaces: ['files', 'overview'], workspaces: ['files', 'overview'] };
  }
  if (
    normalizedPath.startsWith('/control')
    || normalizedPath.startsWith('/storage/protection')
    || normalizedPath.startsWith('/services')
  ) {
    return { bootstrap: true, initialWorkspaces: ['overview'], workspaces: ['overview'] };
  }
  return null;
};

app.use((req, res, next) => {
  const invalidation = snapshotInvalidationForRequest(req);
  if (!invalidation) {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode < 400) {
      invalidateUiSnapshotCache(invalidation);
    }
  });
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

const LLM_MODEL_PRESETS = [
  {
    id: 'qwen2.5-coder-1.5b-q4_k_m',
    label: 'Qwen2.5-Coder 1.5B Q4_K_M',
    repo: 'Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF',
    file: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'qwen2.5-coder-3b-q4_k_m',
    label: 'Qwen2.5-Coder 3B Q4_K_M',
    repo: 'Qwen/Qwen2.5-Coder-3B-Instruct-GGUF',
    file: 'qwen2.5-coder-3b-instruct-q4_k_m.gguf',
  },
  {
    id: 'qwen2.5-coder-7b-q4_k_m',
    label: 'Qwen2.5-Coder 7B Q4_K_M',
    repo: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
    file: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
  },
  {
    id: 'mistral-7b-instruct-v0.3-q4_k_m',
    label: 'Mistral 7B Instruct v0.3 Q4_K_M',
    repo: 'bartowski/Mistral-7B-Instruct-v0.3-GGUF',
    file: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
  },
  {
    id: 'llama-3.2-3b-instruct-q4_k_m',
    label: 'Llama 3.2 3B Instruct Q4_K_M',
    repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
  },
];

const sanitizeModelId = (value, fallback = '') => {
  const next = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return next || fallback;
};

const listLocalGgufFiles = (rootDir) => {
  const found = [];
  const visit = (dirPath, depth) => {
    if (depth > 3) {
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        found.push(fullPath);
      }
    }
  };
  visit(rootDir, 0);
  return found;
};

const readJsonFileSafe = (filePath, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const resolvePresetModelPath = (preset) => path.join(LLM_MODELS_DIR, preset.id, preset.file);

const getCustomLlmModels = () => {
  const raw = appDb.getSetting('llm.customModels', '[]');
  try {
    const value = JSON.parse(String(raw || '[]'));
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => ({
        id: sanitizeModelId(entry?.id),
        label: String(entry?.label || '').trim(),
        path: String(entry?.path || '').trim(),
      }))
      .filter((entry) => entry.id && entry.path);
  } catch {
    return [];
  }
};

const saveCustomLlmModels = (models) => {
  appDb.setSetting('llm.customModels', JSON.stringify(models));
};

const resolveActiveModelId = () => sanitizeModelId(appDb.getSetting('llm.activeModelId', LLM_DEFAULT_MODEL_ID), LLM_DEFAULT_MODEL_ID);

const setActiveModel = ({ modelId, modelPath }) => {
  appDb.setSetting('llm.activeModelId', modelId);
  fs.mkdirSync(path.dirname(LLM_ACTIVE_MODEL_FILE), { recursive: true });
  fs.writeFileSync(LLM_ACTIVE_MODEL_FILE, `${modelPath}\n`, 'utf8');
};

const resolveOnlineModelPreference = () => sanitizeModelId(
  appDb.getSetting('llm.onlineModelId', ONLINE_LLM_DEFAULT_MODEL),
  sanitizeModelId(ONLINE_LLM_DEFAULT_MODEL),
);

const setOnlineModelPreference = (modelId) => {
  appDb.setSetting('llm.onlineModelId', sanitizeModelId(modelId));
};

const buildLlmModelCatalog = () => {
  const customModels = getCustomLlmModels();
  const presetModels = LLM_MODEL_PRESETS.map((preset) => {
    const modelPath = resolvePresetModelPath(preset);
    return {
      id: preset.id,
      label: preset.label,
      source: 'preset',
      repo: preset.repo,
      file: preset.file,
      path: modelPath,
      url: `https://huggingface.co/${preset.repo}/resolve/main/${preset.file}`,
      installed: fs.existsSync(modelPath),
    };
  });
  const customCatalog = customModels.map((entry) => ({
    id: entry.id,
    label: entry.label || entry.id,
    source: 'custom',
    path: entry.path,
    installed: fs.existsSync(entry.path),
  }));
  const byId = new Map([...presetModels, ...customCatalog].map((entry) => [entry.id, entry]));
  const localFiles = listLocalGgufFiles(LLM_MODELS_DIR);
  for (const filePath of localFiles) {
    if ([...byId.values()].some((entry) => entry.path === filePath)) {
      continue;
    }
    const id = sanitizeModelId(`auto-${path.basename(filePath, '.gguf')}`, `auto-${crypto.randomUUID().slice(0, 8)}`);
    byId.set(id, {
      id,
      label: path.basename(filePath),
      source: 'auto',
      path: filePath,
      installed: true,
    });
  }
  return [...byId.values()];
};

const readLlmPullJob = (jobId) => {
  const normalizedId = sanitizeModelId(jobId);
  if (!normalizedId) {
    return null;
  }
  const jobPath = path.join(LLM_PULL_STATE_DIR, `${normalizedId}.json`);
  const state = readJsonFileSafe(jobPath, null);
  if (!state || typeof state !== 'object') {
    return null;
  }
  return {
    id: normalizedId,
    ...state,
  };
};

const listLlmPullJobs = () => {
  let files = [];
  try {
    files = fs.readdirSync(LLM_PULL_STATE_DIR).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .map((name) => readLlmPullJob(name.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
};

const startLlmPullJob = (presetModel) => {
  if (!fs.existsSync(LLM_MODEL_PULL_CMD)) {
    throw new Error(`Model pull helper not found at ${LLM_MODEL_PULL_CMD}`);
  }

  const jobId = sanitizeModelId(`pull-${presetModel.id}-${Date.now()}`, `pull-${Date.now()}`);
  const jobPath = path.join(LLM_PULL_STATE_DIR, `${jobId}.json`);
  fs.mkdirSync(path.dirname(jobPath), { recursive: true });
  fs.writeFileSync(jobPath, JSON.stringify({
    status: 'queued',
    message: 'Queued',
    modelId: presetModel.id,
    targetPath: presetModel.path,
    updatedAt: new Date().toISOString(),
    url: presetModel.url,
  }), 'utf8');
  fs.mkdirSync(path.dirname(presetModel.path), { recursive: true });

  const child = spawn(EXEC_SHELL, [
    LLM_MODEL_PULL_CMD,
    jobPath,
    presetModel.url,
    presetModel.path,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return { id: jobId };
};

const findModelById = (modelId) => buildLlmModelCatalog().find((entry) => entry.id === sanitizeModelId(modelId));

const ONLINE_MODEL_CACHE_TTL_MS = 60 * 1000;
let onlineModelCache = {
  expiresAt: 0,
  payload: {
    activeModelId: '',
    available: false,
    configured: false,
    error: '',
    models: [],
  },
};

const buildOnlineLlmUrl = (pathname) => {
  if (!ONLINE_LLM_BASE_URL) {
    return '';
  }
  const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (ONLINE_LLM_BASE_URL.toLowerCase().endsWith('/v1')) {
    return `${ONLINE_LLM_BASE_URL}${suffix}`;
  }
  return `${ONLINE_LLM_BASE_URL}/v1${suffix}`;
};

const withTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
};

const createQbWebUiError = (code, message, { transient = false } = {}) => {
  const err = new Error(message);
  err.code = code;
  err.transient = transient;
  return err;
};

const isTransientQbWebUiError = (error) => {
  if (error?.transient === true) {
    return true;
  }
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('timeout')
    || message.includes('timed out')
    || message.includes('aborted')
    || message.includes('econnrefused')
    || message.includes('econnreset')
    || message.includes('ehostunreach')
    || message.includes('enetunreach')
    || message.includes('fetch failed')
  );
};

const fetchQbittorrentWebUi = async (pathname, options = {}) => {
  const timeout = withTimeoutSignal(QBITTORRENT_WEBUI_TIMEOUT_MS);
  try {
    return await fetch(buildQbittorrentWebUiUrl(QBITTORRENT_WEBUI_BASE_URL, pathname), {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: timeout.signal,
    });
  } catch (error) {
    throw createQbWebUiError(
      'qb_service_unavailable',
      `Unable to reach qBittorrent WebUI at ${QBITTORRENT_WEBUI_BASE_URL}`,
      { transient: isTransientQbWebUiError(error) }
    );
  } finally {
    timeout.clear();
  }
};

const loginQbittorrentWebUi = async () => {
  if (!QBITTORRENT_WEBUI_USERNAME || !QBITTORRENT_WEBUI_PASSWORD) {
    return '';
  }

  const response = await fetchQbittorrentWebUi('/api/v2/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      username: QBITTORRENT_WEBUI_USERNAME,
      password: QBITTORRENT_WEBUI_PASSWORD,
    }).toString(),
  });
  const bodyText = (await response.text().catch(() => '')).trim();
  if (response.status === 401 || response.status === 403 || /fails?/i.test(bodyText)) {
    throw createQbWebUiError('qb_auth_required', 'qBittorrent WebUI authentication failed.');
  }
  if (!response.ok) {
    throw createQbWebUiError('qb_service_unavailable', `qBittorrent WebUI login returned ${response.status}.`);
  }

  const sidCookie = extractQbittorrentSidCookie(response.headers);
  if (!sidCookie) {
    throw createQbWebUiError('qb_auth_required', 'qBittorrent WebUI did not return a valid session cookie.');
  }

  return sidCookie;
};

const addTorrentToQbittorrentWebUi = async ({ source, category, savePath }) => {
  const credentialsConfigured = Boolean(QBITTORRENT_WEBUI_USERNAME && QBITTORRENT_WEBUI_PASSWORD);
  const totalAttempts = Math.max(1, QBITTORRENT_WEBUI_RETRY_COUNT + 1);
  let lastError = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const sidCookie = credentialsConfigured ? await loginQbittorrentWebUi() : '';
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      if (sidCookie) {
        headers.Cookie = sidCookie;
      }

      const response = await fetchQbittorrentWebUi('/api/v2/torrents/add', {
        method: 'POST',
        headers,
        body: new URLSearchParams({
          urls: source,
          category,
          savepath: savePath,
          autoTMM: 'false',
        }).toString(),
      });
      const bodyText = (await response.text().catch(() => '')).trim();
      if (response.status === 401 || response.status === 403) {
        throw createQbWebUiError(
          'qb_auth_required',
          credentialsConfigured
            ? 'qBittorrent WebUI rejected configured credentials.'
            : 'qBittorrent WebUI authentication is required but credentials are missing.'
        );
      }
      if (!response.ok || /fails?/i.test(bodyText)) {
        throw createQbWebUiError('qb_upstream_error', `qBittorrent WebUI add call failed (status ${response.status}).`);
      }
      return {
        category,
        savePath,
      };
    } catch (error) {
      lastError = error;
      if (!isTransientQbWebUiError(error) || attempt >= totalAttempts) {
        throw error;
      }
    }
  }

  throw lastError || createQbWebUiError('qb_service_unavailable', 'qBittorrent WebUI request failed.');
};

const fetchOnlineModels = async ({ force = false } = {}) => {
  const configured = Boolean(ONLINE_LLM_BASE_URL && ONLINE_LLM_API_KEY);
  if (!configured) {
    return {
      activeModelId: '',
      available: false,
      configured: false,
      error: 'Online provider is not configured in server/.env',
      models: [],
    };
  }

  if (!force && Date.now() < onlineModelCache.expiresAt) {
    return onlineModelCache.payload;
  }

  const timeout = withTimeoutSignal(ONLINE_LLM_TIMEOUT_MS);
  try {
    const response = await fetch(buildOnlineLlmUrl('/models'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${ONLINE_LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: timeout.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failedPayload = {
        activeModelId: '',
        available: false,
        configured: true,
        error: toClientFacingUpstreamError({
          status: response.status,
          rawMessage: body?.error?.message || body?.error,
          fallbackMessage: 'Online provider is unavailable.',
        }),
        models: [],
      };
      onlineModelCache = {
        expiresAt: Date.now() + 15000,
        payload: failedPayload,
      };
      return failedPayload;
    }

    const models = Array.isArray(body?.data)
      ? body.data
        .map((entry) => ({
          id: String(entry?.id || '').trim(),
          label: String(entry?.id || '').trim(),
        }))
        .filter((entry) => entry.id)
      : [];
    const preferredModelId = resolveOnlineModelPreference();
    const activeModelId = preferredModelId && models.some((entry) => entry.id === preferredModelId)
      ? preferredModelId
      : (models[0]?.id || preferredModelId || '');

    const successPayload = {
      activeModelId,
      available: true,
      configured: true,
      error: '',
      models,
    };
    onlineModelCache = {
      expiresAt: Date.now() + ONLINE_MODEL_CACHE_TTL_MS,
      payload: successPayload,
    };
    return successPayload;
  } catch (err) {
    const failedPayload = {
      activeModelId: '',
      available: false,
      configured: true,
      error: String(err?.message || err || 'Online provider request failed'),
      models: [],
    };
    onlineModelCache = {
      expiresAt: Date.now() + 15000,
      payload: failedPayload,
    };
    return failedPayload;
  } finally {
    timeout.clear();
  }
};

const callOnlineChatCompletion = async (payload, { stream = false } = {}) => {
  const timeout = withTimeoutSignal(ONLINE_LLM_TIMEOUT_MS);
  try {
    const response = await fetch(buildOnlineLlmUrl('/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ONLINE_LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: timeout.signal,
    });
    if (stream) {
      return response;
    }
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    timeout.clear();
  }
};

const buildLlmState = async () => {
  const service = SERVICES.llm;
  const install = await resolveServiceInstall('llm', service);
  const running = install.available ? await checkService(service) : false;
  const catalog = buildLlmModelCatalog();
  const activeModelId = resolveActiveModelId();
  const activeModel = catalog.find((entry) => entry.id === activeModelId) || null;
  const online = await fetchOnlineModels();
  return {
    activeModel,
    activeModelId,
    apiKeyConfigured: Boolean(LLM_API_KEY),
    available: install.available,
    blocker: install.available ? null : `Requires ${install.label}.`,
    models: catalog,
    online,
    pullJobs: listLlmPullJobs().slice(0, 20),
    running,
  };
};

const requireAdminOrLlmKey = (req, res, next) => {
  const authorization = String(req.headers.authorization || '');
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (LLM_API_KEY && bearerMatch && secureCompare(String(bearerMatch[1] || '').trim(), LLM_API_KEY)) {
    req.llmApiKeyAuth = true;
    return next();
  }
  return requireAuth(req, res, () => requireAdmin(req, res, next));
};

const buildLlmServerUrl = (pathname) => `http://${LLM_BIND_HOST}:${LLM_PORT}${pathname}`;

const callLlmChatCompletion = async (payload, { stream = false } = {}) => {
  const timeout = withTimeoutSignal(LLM_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildLlmServerUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: timeout.signal,
    });

    if (stream) {
      return response;
    }

    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    timeout.clear();
  }
};

/* ---------------- ROUTES ---------------- */

const {
  loginHandler,
  meHandler,
  verifyHandler,
  verifyAdminHandler,
  logoutHandler,
} = createAuthRouteHandlers({
  appDb,
  verifyPassword,
  getLoginAttemptState,
  normalizeIp,
  pushDebugEvent,
  registerLoginFailure,
  LOGIN_MAX_ATTEMPTS,
  clearLoginFailures,
  invalidateSessionFromToken,
  readToken,
  createSession,
  issueToken,
  setAuthCookie,
  TOKEN_TTL,
  AUTH_COOKIE_NAME,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  buildPermissions,
  BOOTSTRAP_DASHBOARD_USER,
  clearAuthCookie,
});

const {
  statusHandler,
  networkExposureHandler,
} = createSystemRouteHandlers({
  os,
  getNetworkExposureSnapshot,
  pushAuditEvent,
});

const POLL_INTERVAL_MS = 10000;
const FS_UPLOAD_RAW_PARSER = express.raw({ type: '*/*', limit: '128mb' });
const routeRegistry = createRouteRegistry({
  app,
  rawBodyParser: FS_UPLOAD_RAW_PARSER,
  envLoadGuardEnabled: typeof loadEnvFile === 'function',
  jsonBodyLimit: '256kb',
  getTrustProxy: () => app.get('trust proxy') || '',
  pollIntervalMs: POLL_INTERVAL_MS,
});

registerAuthRoutes({
  registerAuthRoute: routeRegistry.registerAuthRoute,
  handlers: {
    loginHandler,
    meHandler,
    verifyHandler,
    verifyAdminHandler,
    logoutHandler,
  },
  middleware: {
    requireAuth,
    requireAdmin,
  },
});

const controlPlane = createControlPlane({
  clearStorageResumeRequirementForService,
  classifyServiceState,
  fs,
  getSystemMetricsSnapshot: async () => getMonitorSnapshot(),
  getLegacyServicesSnapshot: getServicesSnapshot,
  getManageableServiceNames,
  getStorageBlockForService,
  optionalServiceNames: OPTIONAL_SERVICE_NAMES,
  projectRoot: PROJECT_ROOT,
  readStorageProtectionState,
  resolveServiceInstall,
  runCommand,
  runtimeDir: RUNTIME_DIR,
  serviceStateCache,
  services: SERVICES,
  buildLegacyServiceCatalog: buildServiceCatalog,
  waitForServiceState,
  workerCommands: WORKER_COMMANDS,
});

const {
  catalogServicesHandler,
  catalogWorkersHandler,
  clustersHandler,
  clusterDetailHandler,
  clusterActionHandler,
  serviceDetailHandler,
  serviceActionHandler,
  workflowStateServicesHandler,
  workflowDefinitionsHandler,
  workflowRunsHandler,
  workflowRunDetailHandler,
  workflowRunHandler,
  workflowStartHandler,
  workflowDetailHandler,
  workflowResumeHandler,
  workflowEventsHandler,
  metricsHandler,
  healthHandler,
  stateHandler,
} = createControlPlaneRouteHandlers({
  controlPlane,
  pushDebugEvent,
});

const {
  llmStateHandler,
  llmModelSelectHandler,
  llmModelAddLocalHandler,
  llmModelPullHandler,
  llmModelPullStatusHandler,
  llmOnlineModelsRefreshHandler,
  llmOnlineModelSelectHandler,
  llmConversationsHandler,
  llmConversationMessagesHandler,
  llmConversationDeleteHandler,
  llmChatStreamHandler,
  llmChatHandler,
  openAiModelsHandler,
  openAiChatCompletionsHandler,
} = createLlmRouteHandlers({
  appDb,
  fs,
  path,
  crypto,
  services: SERVICES,
  checkService,
  buildLlmState,
  sanitizeModelId,
  findModelById,
  setActiveModel,
  getCustomLlmModels,
  saveCustomLlmModels,
  startLlmPullJob,
  readLlmPullJob,
  fetchOnlineModels,
  setOnlineModelPreference,
  onlineModelCacheTtlMs: ONLINE_MODEL_CACHE_TTL_MS,
  setOnlineModelCache: (value) => {
    onlineModelCache = value;
  },
  extractUpstreamErrorText,
  toClientFacingUpstreamError,
  llmChatSystemPrompt: LLM_CHAT_SYSTEM_PROMPT,
  llmMaxTokens: LLM_MAX_TOKENS,
  llmTemperature: LLM_TEMPERATURE,
  callOnlineChatCompletion,
  callLlmChatCompletion,
  Readable,
  controlPlane,
});

const {
  servicesHandler,
  controlUnlockHandler,
  controlLockHandler,
  controlHandler,
  monitorHandler,
  telemetryHandler,
  connectionsHandler,
  disconnectConnectionHandler,
  storageHandler,
} = createServiceRouteHandlers({
  getServicesSnapshot,
  getControlledServiceNames,
  buildServiceCatalog,
  pushDebugEvent,
  isServiceControllerUnlocked,
  buildStackLifecycleSummary,
  buildServiceGroups,
  buildMediaWorkflowSnapshot,
  secureCompare,
  ADMIN_ACTION_PASSWORD,
  pushAuditEvent,
  unlockServiceController,
  unlockedServiceControllers,
  getManageableServiceNames,
  SERVICES,
  readStorageProtectionState,
  getStorageBlockForService,
  resolveServiceInstall,
  runCommand,
  waitForServiceState,
  serviceStateCache,
  classifyServiceState,
  clearStorageResumeRequirementForService,
  getMonitorSnapshot,
  getTelemetrySnapshot,
  getConnectionsSnapshot,
  activeSessions,
  invalidateSession,
  recentConnections,
  getStorageSnapshot,
  controlPlane,
});

const {
  logsHandler,
  loggingGetHandler,
  loggingPostHandler,
  dashboardHandler,
} = createDashboardRouteHandlers({
  getLogsSnapshot,
  getVerboseLoggingEnabled: () => verboseLoggingEnabled,
  setVerboseLoggingEnabled: (nextValue) => {
    verboseLoggingEnabled = nextValue;
  },
  buildMarkdownLog,
  appDb,
  pushAuditEvent,
  getDashboardSnapshot,
  pushDebugEvent,
  controlPlane,
});

const UI_WORKSPACES = ['overview', 'media', 'files', 'transfers', 'ai', 'terminal', 'admin'];
const LEGACY_TAB_TO_WORKSPACE = {
  home: 'overview',
  overview: 'overview',
  media: 'media',
  downloads: 'media',
  arr: 'media',
  files: 'files',
  terminal: 'terminal',
  transfers: 'transfers',
  filesystem: 'files',
  ftp: 'transfers',
  ai: 'ai',
  admin: 'admin',
  analytics: 'admin',
  settings: 'admin',
};

const uiNavBlueprint = [
  { key: 'overview', label: 'Overview', legacyTabs: ['home'], summary: 'System health, telemetry, and lifecycle status' },
  { key: 'media', label: 'Media', legacyTabs: ['media', 'downloads', 'arr'], summary: 'Jellyfin and automation workflow surfaces' },
  { key: 'files', label: 'Storage', legacyTabs: ['filesystem'], summary: 'Drive, share, filesystem management, and compatibility links' },
  { key: 'transfers', label: 'Transfers', legacyTabs: ['ftp'], summary: 'FTP favourites and remote transfer tools' },
  { key: 'ai', label: 'AI Chat', legacyTabs: ['ai'], summary: 'Local and online LLM runtime workspace' },
  { key: 'terminal', label: 'Terminal', legacyTabs: ['terminal'], summary: 'Terminal and command access surface' },
  { key: 'admin', label: 'Settings', legacyTabs: ['settings'], summary: 'Service controls, access policy, and operations' },
];

const normalizeUiWorkspaceKey = (value = '') => {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'settings' || key === 'analytics') {
    return 'admin';
  }
  return UI_WORKSPACES.includes(key) ? key : '';
};

const buildQbittorrentUiDiagnostics = async (serviceCatalog) => {
  const qbService = serviceCatalog.find((entry) => entry.key === 'qbittorrent') || null;
  const config = probeQbittorrentConfig();
  let webUiReachable = false;
  let authRequired = false;
  let version = '';
  let error = '';

  try {
    const response = await fetchQbittorrentWebUi('/api/v2/app/version');
    webUiReachable = response.ok || response.status === 401 || response.status === 403;
    authRequired = response.status === 401 || response.status === 403;
    if (response.ok) {
      version = (await response.text().catch(() => '')).trim();
    }
  } catch (diagnosticError) {
    error = String(diagnosticError?.message || diagnosticError || 'Unable to reach qBittorrent WebUI');
  }

  return {
    authConfigured: Boolean(QBITTORRENT_WEBUI_USERNAME && QBITTORRENT_WEBUI_PASSWORD),
    authRequired,
    baseUrl: QBITTORRENT_WEBUI_BASE_URL,
    categories: {
      manual: config.manualCategoryPath,
      movies: config.moviesCategoryPath,
      series: config.seriesCategoryPath,
      standalone: config.standaloneCategoryPath,
    },
    defaultSavePath: config.defaultSavePath,
    error,
    serviceStatus: qbService ? qbService.status : 'unknown',
    tempPath: config.tempPath,
    version,
    webUiReachable,
  };
};

const buildArrDiagnostics = (serviceCatalog) => {
  const serviceKeys = ['sonarr', 'radarr', 'prowlarr', 'bazarr', 'flarearr'];
  const services = serviceKeys
    .map((key) => serviceCatalog.find((entry) => entry.key === key))
    .filter(Boolean);
  return {
    healthy: services.filter((entry) => entry.status === 'working').length,
    serviceKeys,
    services,
    total: services.length,
  };
};

const buildArrEvidence = (serviceCatalog) => {
  const generatedAt = new Date().toISOString();
  const qbConfig = probeQbittorrentConfig();
  const serviceByKey = new Map(serviceCatalog.map((entry) => [entry.key, entry]));
  const mismatches = [];
  const expectedPaths = {
    movies: MEDIA_DOWNLOADS_MOVIES_DIR,
    series: MEDIA_DOWNLOADS_SERIES_DIR,
    standalone: MEDIA_DOWNLOADS_TORRENT_QBIT_DIR,
  };
  const actualPaths = {
    movies: qbConfig.moviesCategoryPath || '',
    series: qbConfig.seriesCategoryPath || '',
    standalone: qbConfig.standaloneCategoryPath || '',
  };

  if (actualPaths.movies && path.resolve(actualPaths.movies) !== path.resolve(expectedPaths.movies)) {
    mismatches.push('QBIT_MOVIES_PATH_MISMATCH');
  }
  if (actualPaths.series && path.resolve(actualPaths.series) !== path.resolve(expectedPaths.series)) {
    mismatches.push('QBIT_SERIES_PATH_MISMATCH');
  }
  if (actualPaths.standalone && path.resolve(actualPaths.standalone) !== path.resolve(expectedPaths.standalone)) {
    mismatches.push('QBIT_STANDALONE_PATH_MISMATCH');
  }

  const sonarr = serviceByKey.get('sonarr') || null;
  const radarr = serviceByKey.get('radarr') || null;
  const qbittorrent = serviceByKey.get('qbittorrent') || null;

  if (!sonarr) {
    mismatches.push('SONARR_CLIENT_MISSING');
  }
  if (!radarr) {
    mismatches.push('RADARR_CLIENT_MISSING');
  }
  if (sonarr && !String(sonarr.route || '').trim()) {
    mismatches.push('OPEN_TARGET_UNRESOLVED');
  }
  if (radarr && !String(radarr.route || '').trim()) {
    mismatches.push('OPEN_TARGET_UNRESOLVED');
  }
  if (qbittorrent && !String(qbittorrent.route || '').trim()) {
    mismatches.push('OPEN_TARGET_UNRESOLVED');
  }

  return {
    generatedAt,
    lastVerifiedAt: generatedAt,
    staleAfterMs: 300000,
    verificationMode: 'background',
    qbittorrent: {
      route: String(qbittorrent?.route || ''),
      expected: expectedPaths,
      actual: actualPaths,
    },
    serverMapping: {
      movies: expectedPaths.movies,
      series: expectedPaths.series,
      standalone: expectedPaths.standalone,
    },
    sonarr: {
      route: String(sonarr?.route || ''),
      status: String(sonarr?.status || 'unknown'),
      category: 'series',
      remotePath: expectedPaths.series,
    },
    radarr: {
      route: String(radarr?.route || ''),
      status: String(radarr?.status || 'unknown'),
      category: 'movies',
      remotePath: expectedPaths.movies,
    },
    mismatches,
    openChecks: {
      qbittorrent: Boolean(qbittorrent?.route),
      sonarr: Boolean(sonarr?.route),
      radarr: Boolean(radarr?.route),
    },
  };
};

const buildUiInitialSectionMeta = (ok, payload, fallbackMessage) => ({
  generatedAt: payload?.generatedAt || new Date().toISOString(),
  ok,
  retryable: !ok,
  stale: Boolean(payload?.stale),
  ...(ok ? {} : { error: { code: 'UNKNOWN', message: String(fallbackMessage || 'Unavailable') } }),
});

const buildMinimalUiBootstrapPayload = async (sessionUser) => {
  const [hasFilesAccess, monitor] = await Promise.all([
    syncManagedShares().then((shares) => shares.length > 0).catch(() => false),
    getMonitorSnapshot().catch(() => null),
  ]);
  const lifecycle = {
    state: 'degraded',
    summary: 'Shared diagnostics are unavailable; showing the shell with minimal navigation metadata.',
  };

  return {
    generatedAt: new Date().toISOString(),
    user: sessionUser ? { role: sessionUser.role, username: sessionUser.username } : null,
    device: {
      batteryPct: Number.isFinite(Number(monitor?.device?.batteryPct)) ? Number(monitor.device.batteryPct) : null,
      charging: typeof monitor?.device?.charging === 'boolean' ? monitor.device.charging : null,
    },
    lifecycle,
    nav: uiNavBlueprint.map((entry) => ({
      ...entry,
      available: entry.key === 'files' ? hasFilesAccess || sessionUser?.role === 'admin' : true,
      status: entry.key === 'files' ? (hasFilesAccess || sessionUser?.role === 'admin' ? 'working' : 'blocked') : 'degraded',
    })),
    legacyTabMap: LEGACY_TAB_TO_WORKSPACE,
    capabilities: {
      canAdmin: sessionUser?.role === 'admin',
      canControlServices: sessionUser?.role === 'admin',
      canManageUsers: sessionUser?.role === 'admin',
      canManageShares: sessionUser?.role === 'admin',
      canUseFilesWorkspace: hasFilesAccess || sessionUser?.role === 'admin',
      canUseTransfersWorkspace: true,
      canUseAiWorkspace: true,
      canUseTerminalWorkspace: true,
    },
    serviceCounts: {
      total: 0,
      available: 0,
      working: 0,
      blocked: 0,
      unavailable: 0,
    },
  };
};

const buildUiBootstrapPayload = async (sessionUser, serviceCatalogOverride = null) => {
  const serviceCatalog = Array.isArray(serviceCatalogOverride)
    ? serviceCatalogOverride
    : await getUiServiceCatalog({ allowStale: true }).catch(() => null);
  if (!serviceCatalog) {
    return buildMinimalUiBootstrapPayload(sessionUser);
  }
  const lifecycle = buildStackLifecycleSummary(serviceCatalog);
  const serviceByKey = new Map(serviceCatalog.map((entry) => [entry.key, entry]));
  const [hasFilesAccess, monitor] = await Promise.all([
    syncManagedShares().then((shares) => shares.length > 0).catch(() => false),
    getMonitorSnapshot().catch(() => null),
  ]);
  const transferService = serviceByKey.get('ftp');
  const torrentTransferService = serviceByKey.get('qbittorrent');
  const aiService = serviceByKey.get('llm');
  const terminalService = serviceByKey.get('ttyd');
  const transferWorkspaceServices = [transferService, torrentTransferService].filter(Boolean);
  const transferWorkspaceAvailable = transferWorkspaceServices.some((entry) => Boolean(entry?.available));
  const transferWorkspaceStatus = transferWorkspaceServices.length > 0
    ? aggregateCatalogStatus(transferWorkspaceServices)
    : (transferWorkspaceAvailable ? 'working' : 'unavailable');

  const nav = uiNavBlueprint.map((entry) => {
    let available = true;
    let status = 'working';

    if (entry.key === 'transfers') {
      available = transferWorkspaceAvailable;
      status = String(transferWorkspaceStatus || (available ? 'working' : 'unavailable'));
    } else if (entry.key === 'ai') {
      available = Boolean(aiService?.available);
      status = String(aiService?.status || (available ? 'working' : 'unavailable'));
    } else if (entry.key === 'terminal') {
      available = Boolean(terminalService?.available);
      status = String(terminalService?.status || (available ? 'working' : 'unavailable'));
    } else if (entry.key === 'files') {
      available = hasFilesAccess;
      status = available ? 'working' : 'blocked';
    }

    return {
      ...entry,
      available,
      status,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    user: sessionUser ? { role: sessionUser.role, username: sessionUser.username } : null,
    device: {
      batteryPct: Number.isFinite(Number(monitor?.device?.batteryPct)) ? Number(monitor.device.batteryPct) : null,
      charging: typeof monitor?.device?.charging === 'boolean' ? monitor.device.charging : null,
    },
    lifecycle,
    nav,
    legacyTabMap: LEGACY_TAB_TO_WORKSPACE,
    capabilities: {
      canAdmin: sessionUser?.role === 'admin',
      canControlServices: sessionUser?.role === 'admin',
      canManageUsers: sessionUser?.role === 'admin',
      canManageShares: sessionUser?.role === 'admin',
      canUseFilesWorkspace: hasFilesAccess || sessionUser?.role === 'admin',
      canUseTransfersWorkspace: transferWorkspaceAvailable,
      canUseAiWorkspace: Boolean(aiService?.available),
      canUseTerminalWorkspace: Boolean(terminalService?.available),
    },
    serviceCounts: {
      total: serviceCatalog.length,
      available: serviceCatalog.filter((entry) => entry.available).length,
      working: serviceCatalog.filter((entry) => entry.status === 'working').length,
      blocked: serviceCatalog.filter((entry) => entry.status === 'blocked').length,
      unavailable: serviceCatalog.filter((entry) => entry.status === 'unavailable').length,
    },
  };
};

const buildOverviewDesignTelemetry = ({ telemetry, connections, storage, drives }) => {
  const monitor = telemetry?.monitor || {};
  const logs = Array.isArray(telemetry?.logs?.entries) ? telemetry.logs.entries : [];
  const mounts = Array.isArray(storage?.mounts) ? storage.mounts : [];
  const driveList = Array.isArray(drives?.manifest?.drives) ? drives.manifest.drives : [];
  const memoryUsedPct = Number(monitor.totalMem || 0) > 0
    ? Math.round((Number(monitor.usedMem || 0) / Number(monitor.totalMem || 1)) * 100)
    : 0;
  return {
    workspace: 'overview',
    integrityIndexPct: Math.max(0, Math.min(100, 100 - Number(monitor.eventLoopP95Ms || 0))),
    subsystemBars: [
      { label: 'CPU', value: Number(monitor.cpuLoad || 0), status: Number(monitor.cpuLoad || 0) >= 80 ? 'warn' : 'ok' },
      { label: 'Memory', value: memoryUsedPct, status: memoryUsedPct >= 85 ? 'warn' : 'ok' },
      { label: 'Storage', value: mounts.length > 0 ? Number(mounts[0].usePercent || 0) : 0, status: mounts.some((entry) => Number(entry.usePercent || 0) >= 85) ? 'warn' : 'ok' },
    ],
    nodeCluster: (Array.isArray(connections?.users) ? connections.users : []).slice(0, 5).map((entry, index) => ({
      label: String(entry.username || `node-${index + 1}`),
      status: String(entry.status || 'active'),
    })),
    recentEvents: logs.slice(0, 12),
    mountedDriveCount: driveList.filter((entry) => String(entry.state || '').toLowerCase() === 'mounted').length,
  };
};

const buildMediaDesignTelemetry = ({ mediaHealth, services, mediaWorkflow }) => {
  const sessions = Array.isArray(mediaHealth?.activeSessions) ? mediaHealth.activeSessions : [];
  const libraries = Array.isArray(mediaHealth?.libraries) ? mediaHealth.libraries : [];
  return {
    workspace: 'media',
    activeSessions: sessions.slice(0, 8),
    libraryTotals: mediaHealth?.totals || {},
    libraries: libraries.slice(0, 8),
    infrastructure: (Array.isArray(services) ? services : []).slice(0, 10).map((entry) => ({
      key: String(entry.key || ''),
      label: String(entry.label || entry.key || ''),
      status: String(entry.status || 'unknown'),
      available: Boolean(entry.available),
    })),
    workflowState: {
      watch: mediaWorkflow?.watch || null,
      requests: mediaWorkflow?.requests || null,
      automation: mediaWorkflow?.automation || null,
      subtitles: mediaWorkflow?.subtitles || null,
    },
  };
};

const buildFilesDesignTelemetry = ({ drives, storageProtection, storage }) => {
  const mounts = Array.isArray(storage?.mounts) ? storage.mounts : [];
  const total = mounts.reduce((sum, entry) => sum + Number(entry.size || 0), 0);
  const used = mounts.reduce((sum, entry) => sum + Number(entry.used || 0), 0);
  const manifestDrives = Array.isArray(drives?.manifest?.drives) ? drives.manifest.drives : [];
  return {
    workspace: 'files',
    clusterCapacity: {
      totalBytes: total,
      usedBytes: used,
      availableBytes: Math.max(0, total - used),
      usePercent: total > 0 ? Math.round((used / total) * 100) : 0,
    },
    parity: {
      state: String(storageProtection?.state || 'unknown'),
      reason: String(storageProtection?.reason || ''),
    },
    mountMatrix: manifestDrives.slice(0, 8),
    mountLog: Array.isArray(drives?.events) ? drives.events.slice(0, 20) : [],
  };
};

const buildTransfersDesignTelemetry = ({ favourites, services, qbDiagnostics }) => {
  const mountedCount = (Array.isArray(favourites) ? favourites : []).filter((entry) => Boolean(entry?.mount?.mounted)).length;
  const transferServices = Array.isArray(services) ? services : [];
  const ingress = Number(qbDiagnostics?.webUiReachable ? 840_000_000 : 210_000_000);
  const egress = Number(qbDiagnostics?.webUiReachable ? 124_000_000 : 40_000_000);
  return {
    workspace: 'transfers',
    globalThroughput: {
      ingressBps: ingress,
      egressBps: egress,
      totalGbps: Number(((ingress + egress) / 1_000_000_000).toFixed(2)),
    },
    activePipelines: mountedCount + (transferServices.some((entry) => entry.key === 'qbittorrent') ? 1 : 0),
    mountParity: (Array.isArray(favourites) ? favourites : []).slice(0, 8).map((entry) => ({
      name: String(entry.name || entry.mountName || 'mount'),
      state: String(entry.mount?.state || 'unknown'),
      mounted: Boolean(entry.mount?.mounted),
    })),
    geoNodes: [
      { id: 'in-home', label: 'HOME', activeMbps: Number((ingress / 1_000_000).toFixed(1)) },
      { id: 'seed', label: 'SEED', activeMbps: Number((egress / 1_000_000).toFixed(1)) },
    ],
  };
};

const buildAiDesignTelemetry = ({ llmState, monitor }) => {
  const models = Array.isArray(llmState?.models) ? llmState.models : [];
  return {
    workspace: 'ai',
    nodeId: String(llmState?.activeModelId || 'local-node'),
    models: models.slice(0, 6).map((entry) => ({
      id: String(entry.id || ''),
      label: String(entry.label || entry.id || ''),
      loaded: Boolean(entry.id === llmState?.activeModelId),
      status: String(entry.id === llmState?.activeModelId ? 'active' : 'standby'),
    })),
    neuralMap: [
      { id: 'core', x: 50, y: 50, status: 'active' },
      { id: 'vision', x: 23, y: 44, status: 'standby' },
      { id: 'speech', x: 76, y: 42, status: 'standby' },
    ],
    parameters: {
      temperature: 0.7,
      topP: 0.9,
      repeatPenalty: 1.1,
      cpuLoad: Number(monitor?.cpuLoad || 0),
    },
  };
};

const buildTerminalDesignTelemetry = ({ terminal }) => ({
  workspace: 'terminal',
  accessMode: 'shell',
  status: String(terminal?.status || 'unknown'),
  route: String(terminal?.route || ''),
});

const buildAdminDesignTelemetry = ({ dashboard }) => {
  const monitor = dashboard?.monitor || {};
  const logs = Array.isArray(dashboard?.logs?.entries) ? dashboard.logs.entries : [];
  return {
    workspace: 'admin',
    computeCoreAnalysisPct: Number(monitor.cpuLoad || 0),
    clusterTemperatureC: 42,
    memoryRss: {
      usedBytes: Number(monitor.processRss || 0),
      totalBytes: Number(monitor.totalMem || 0),
    },
    traffic: {
      ingressBps: Number(monitor?.network?.rxRate || 0),
      egressBps: Number(monitor?.network?.txRate || 0),
    },
    hardwareInventory: [
      'NVMe RAID Controller',
      `${Number(monitor.cpuCores || 0)} Core CPU`,
      `Node RSS ${Number(monitor.processRss || 0)}`,
    ],
    kernelLogTail: logs.slice(0, 20),
  };
};

const buildUiWorkspacePayload = async (req, workspaceKey, serviceCatalogOverride = null) => {
  const serviceCatalog = serviceCatalogOverride || await getUiServiceCatalog();
  const now = new Date().toISOString();
  const mediaEntries = serviceCatalog.filter((entry) => ['media', 'arr', 'downloads', 'data'].includes(entry.group));
  const transferEntries = serviceCatalog.filter((entry) => ['access', 'downloads'].includes(entry.group));

  if (workspaceKey === 'overview') {
    const [telemetry, connections, storage, drives, storageProtection] = await Promise.all([
      getTelemetrySnapshot(req.session?.id),
      Promise.resolve(getConnectionsSnapshot()),
      getStorageSnapshot(),
      getDriveSnapshot(),
      Promise.resolve(readStorageProtectionState()),
    ]);
    return {
      generatedAt: now,
      workspaceKey,
      telemetry,
      connections,
      storage,
      drives,
      storageProtection,
      designTelemetry: buildOverviewDesignTelemetry({ telemetry, connections, storage, drives }),
    };
  }

  if (workspaceKey === 'media') {
    const mediaWorkflow = buildMediaWorkflowSnapshot(serviceCatalog);
    const [mediaHealth, qbDiagnostics] = await Promise.all([
      getJellyfinMediaHealthSnapshot(),
      buildQbittorrentUiDiagnostics(serviceCatalog),
    ]);
    return {
      generatedAt: now,
      workspaceKey,
      arrDiagnostics: buildArrDiagnostics(serviceCatalog),
      lifecycle: buildStackLifecycleSummary(serviceCatalog),
      mediaWorkflow,
      mediaHealth,
      qbDiagnostics,
      services: mediaEntries,
      designTelemetry: buildMediaDesignTelemetry({
        mediaHealth,
        services: mediaEntries,
        mediaWorkflow,
      }),
    };
  }

  if (workspaceKey === 'files') {
    const [drives, shares, users, storage] = await Promise.all([
      getDriveSnapshot(),
      syncManagedShares(),
      Promise.resolve(appDb.listUsers()),
      getStorageSnapshot(),
    ]);
    const storageProtection = readStorageProtectionState();
    return {
      generatedAt: now,
      workspaceKey,
      drives,
      storageProtection,
      shares,
      users,
      storage,
      designTelemetry: buildFilesDesignTelemetry({
        drives,
        storageProtection,
        storage,
      }),
    };
  }

  if (workspaceKey === 'transfers') {
    const qbittorrentConfig = probeQbittorrentConfig();
    const qbittorrentService = serviceCatalog.find((entry) => entry.key === 'qbittorrent') || null;
    const qbDiagnostics = await buildQbittorrentUiDiagnostics(serviceCatalog);
    const favourites = appDb.listFtpFavourites().map(serializeFtpFavourite);
    return {
      generatedAt: now,
      workspaceKey,
      arrDiagnostics: buildArrDiagnostics(serviceCatalog),
      ftpDefaults: {
        defaultName: DEFAULT_PS4_FTP_NAME,
        host: process.env.FTP_CLIENT_HOST || DEFAULT_PS4_HOST,
        port: Number(process.env.FTP_CLIENT_PORT || DEFAULT_PS4_PORT),
        user: process.env.FTP_CLIENT_USER || DEFAULT_PS4_USER,
        secure: process.env.FTP_CLIENT_SECURE === 'true',
        downloadRoot: FTP_CLIENT_DOWNLOAD_ROOT,
        ftpMounting: getCloudMountCapability(),
      },
      qbDiagnostics,
      torrent: {
        service: qbittorrentService,
        standaloneDestination: MEDIA_DOWNLOADS_TORRENT_QBIT_DIR,
        laneSummary: {
          arr: {
            movies: {
              category: 'movies',
              savePath: qbittorrentConfig.moviesCategoryPath || MEDIA_DOWNLOADS_MOVIES_DIR,
            },
            series: {
              category: 'series',
              savePath: qbittorrentConfig.seriesCategoryPath || MEDIA_DOWNLOADS_SERIES_DIR,
            },
          },
          standalone: {
            category: 'standalone',
            savePath: qbittorrentConfig.standaloneCategoryPath || MEDIA_DOWNLOADS_TORRENT_QBIT_DIR,
          },
        },
      },
      favourites,
      services: transferEntries,
      designTelemetry: buildTransfersDesignTelemetry({
        favourites,
        services: transferEntries,
        qbDiagnostics,
      }),
    };
  }

  if (workspaceKey === 'ai') {
    const [llmState, monitor] = await Promise.all([
      buildLlmState(),
      getMonitorSnapshot(),
    ]);
    return {
      generatedAt: now,
      workspaceKey,
      llmState,
      monitor: {
        cpuLoad: Number(monitor.cpuLoad || 0),
        timestamp: now,
      },
      designTelemetry: buildAiDesignTelemetry({ llmState, monitor }),
    };
  }

  if (workspaceKey === 'terminal') {
    const terminal = serviceCatalog.find((entry) => entry.key === 'ttyd') || null;
    return {
      generatedAt: now,
      workspaceKey,
      terminal,
      designTelemetry: buildTerminalDesignTelemetry({ terminal }),
    };
  }

  const [dashboard, services] = await Promise.all([
    getDashboardSnapshot(req.session?.id),
    getServicesSnapshot(),
  ]);
  return {
    generatedAt: now,
    arrEvidence: buildArrEvidence(serviceCatalog),
    workspaceKey,
    dashboard,
    services,
    designTelemetry: buildAdminDesignTelemetry({ dashboard }),
  };
};

const buildUiSnapshotSessionKey = (session) => {
  if (!session || typeof session !== 'object') {
    return 'anon';
  }
  const userId = String(session.userId || session.username || 'unknown');
  const sessionId = String(session.id || 'unknown');
  return `${userId}:${sessionId}`;
};

const shouldForceUiSnapshotRefresh = (req) => String(req.query.force || '').toLowerCase() === 'true';

const getCachedUiBootstrapPayload = async (req, { force = false, serviceCatalogOverride = null } = {}) => {
  const sessionKey = buildUiSnapshotSessionKey(req.session);
  return getUiSnapshotFromCache({
    bucket: 'bootstrap',
    key: sessionKey,
    ttlMs: UI_SNAPSHOT_BOOTSTRAP_TTL_MS,
    maxStaleMs: UI_SNAPSHOT_BOOTSTRAP_MAX_STALE_MS,
    force,
    allowStale: true,
    builder: () => buildUiBootstrapPayload(req.session, serviceCatalogOverride),
  });
};

const getCachedUiWorkspacePayload = async (req, workspaceKey, { force = false, serviceCatalogOverride = null } = {}) => {
  const sessionKey = buildUiSnapshotSessionKey(req.session);
  return getUiSnapshotFromCache({
    bucket: 'workspace',
    key: `${sessionKey}:${workspaceKey}`,
    ttlMs: workspaceSnapshotTtlMs(workspaceKey),
    maxStaleMs: UI_SNAPSHOT_WORKSPACE_MAX_STALE_MS,
    force,
    allowStale: true,
    builder: () => buildUiWorkspacePayload(req, workspaceKey, serviceCatalogOverride),
  });
};

const buildUiInitialPartialPayload = async (req, workspaceKey, serviceCatalog, force) => {
  const [bootstrapResult, workspaceResult] = await Promise.allSettled([
    getCachedUiBootstrapPayload(req, { force, serviceCatalogOverride: serviceCatalog }),
    getCachedUiWorkspacePayload(req, workspaceKey, { force, serviceCatalogOverride: serviceCatalog }),
  ]);

  const bootstrap = bootstrapResult.status === 'fulfilled' ? bootstrapResult.value : null;
  const workspace = workspaceResult.status === 'fulfilled' ? workspaceResult.value : null;
  const bootstrapError = bootstrapResult.status === 'rejected' ? String(bootstrapResult.reason || 'Unable to build bootstrap payload') : '';
  const workspaceError = workspaceResult.status === 'rejected' ? String(workspaceResult.reason || `Unable to build '${workspaceKey}' workspace payload`) : '';
  const status = bootstrap && workspace ? 'ok' : bootstrap || workspace ? 'partial' : 'error';

  return {
    status,
    responseStatus: status === 'error' ? 503 : 200,
    retryAfterMs: status === 'ok' ? 0 : UI_INITIAL_RETRY_AFTER_MS,
    bootstrap,
    workspace,
    sections: {
      bootstrap: buildUiInitialSectionMeta(Boolean(bootstrap), bootstrap, bootstrapError),
      workspace: buildUiInitialSectionMeta(Boolean(workspace), workspace, workspaceError),
    },
  };
};

const getCachedUiInitialPartialPayload = async (req, workspaceKey, { force = false, serviceCatalogOverride = null } = {}) => {
  const sessionKey = buildUiSnapshotSessionKey(req.session);
  return getUiSnapshotFromCache({
    bucket: 'initial',
    key: `${sessionKey}:${workspaceKey}`,
    ttlMs: UI_SNAPSHOT_INITIAL_TTL_MS,
    maxStaleMs: UI_SNAPSHOT_INITIAL_MAX_STALE_MS,
    force,
    allowStale: true,
    builder: async () => {
      const serviceCatalog = serviceCatalogOverride || await getUiServiceCatalog({ allowStale: true, force }).catch(() => null);
      return buildUiInitialPartialPayload(req, workspaceKey, serviceCatalog, force);
    },
  });
};

const uiBootstrapHandler = async (req, res) => {
  const force = shouldForceUiSnapshotRefresh(req);
  try {
    const payload = await getCachedUiBootstrapPayload(req, { force });
    res.json(payload);
  } catch (err) {
    pushDebugEvent('error', 'UI bootstrap snapshot failed', { error: String(err) }, true);
    res.status(500).json({ error: 'Unable to build UI bootstrap payload' });
  }
};

const uiInitialHandler = async (req, res) => {
  const workspaceKey = normalizeUiWorkspaceKey(req.query.workspace || req.query.workspaceKey || '') || 'overview';
  const requestId = crypto.randomUUID();
  const force = shouldForceUiSnapshotRefresh(req);
  try {
    const serviceCatalog = await getUiServiceCatalog({ allowStale: true, force }).catch(() => null);
    if (!UI_INITIAL_PARTIAL_SUCCESS) {
      const [bootstrap, workspace] = await Promise.all([
        getCachedUiBootstrapPayload(req, { force, serviceCatalogOverride: serviceCatalog }),
        getCachedUiWorkspacePayload(req, workspaceKey, { force, serviceCatalogOverride: serviceCatalog }),
      ]);
      return res.json({ bootstrap, workspace });
    }

    const payload = await getCachedUiInitialPartialPayload(req, workspaceKey, {
      force,
      serviceCatalogOverride: serviceCatalog,
    });

    return res.status(payload.responseStatus).json({
      schemaVersion: 2,
      status: payload.status,
      requestId,
      requestedWorkspace: workspaceKey,
      retryAfterMs: payload.retryAfterMs,
      bootstrap: payload.bootstrap,
      workspace: payload.workspace,
      sections: payload.sections,
    });
  } catch (err) {
    pushDebugEvent('error', 'UI initial snapshot failed', { error: String(err), workspaceKey }, true);
    res.status(500).json({ error: 'Unable to build initial UI payload' });
  }
};

const uiWorkspacePayloadHandler = async (req, res) => {
  const workspaceKey = normalizeUiWorkspaceKey(req.params.workspaceKey || '');
  if (!workspaceKey) {
    return res.status(404).json({ error: 'Unknown workspace key' });
  }
  const force = shouldForceUiSnapshotRefresh(req);

  try {
    const payload = await getCachedUiWorkspacePayload(req, workspaceKey, { force });
    return res.json(payload);
  } catch (err) {
    pushDebugEvent('error', 'UI workspace payload failed', { error: String(err), workspaceKey }, true);
    return res.status(500).json({ error: `Unable to build '${workspaceKey}' workspace payload` });
  }
};

const drivesHandler = async (req, res) => {
  res.json(await getDriveSnapshot());
};

const ensureMediaCompatibilityLayout = () => {
  const requiredDirs = [
    MEDIA_ROOT,
    MEDIA_MOVIES_DIR,
    MEDIA_SERIES_DIR,
    MEDIA_MUSIC_DIR,
    MEDIA_AUDIOBOOKS_DIR,
    MEDIA_DOWNLOADS_DIR,
    MEDIA_IPTV_CACHE_DIR,
    MEDIA_IPTV_EPG_DIR,
  ];
  for (const directory of requiredDirs) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const links = [
    ['movies', MEDIA_MOVIES_DIR],
    ['series', MEDIA_SERIES_DIR],
    ['music', MEDIA_MUSIC_DIR],
    ['audiobooks', MEDIA_AUDIOBOOKS_DIR],
    ['downloads', MEDIA_DOWNLOADS_DIR],
    ['iptv-cache', MEDIA_IPTV_CACHE_DIR],
    ['iptv-epg', MEDIA_IPTV_EPG_DIR],
  ];

  for (const [name, target] of links) {
    const linkPath = path.join(MEDIA_ROOT, name);
    const expectedTarget = fs.realpathSync.native(target);

    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        let currentTarget = '';
        try {
          currentTarget = fs.realpathSync.native(linkPath);
        } catch {
          currentTarget = '';
        }
        if (currentTarget === expectedTarget) {
          continue;
        }
        fs.unlinkSync(linkPath);
      } else {
        // Preserve user-managed paths; only manage symlinks.
        continue;
      }
    } catch {
      // Path does not exist; create managed symlink below.
    }

    try {
      fs.symlinkSync(target, linkPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      let existing = null;
      try {
        existing = fs.lstatSync(linkPath);
      } catch {
        throw error;
      }
      if (!existing.isSymbolicLink()) {
        continue;
      }
      let currentTarget = '';
      try {
        currentTarget = fs.realpathSync.native(linkPath);
      } catch {
        currentTarget = '';
      }
      if (currentTarget === expectedTarget) {
        continue;
      }
      fs.unlinkSync(linkPath);
      fs.symlinkSync(target, linkPath);
    }
  }
};

const resumeStorageBlockedServices = async () => {
  const currentState = readStorageProtectionState();

  const pending = normalizeStringArray(currentState.stoppedByWatchdog);
  if (pending.length === 0) {
    return {
      success: true,
      blocked: false,
      resumed: [],
      failed: [],
      storageProtection: currentState,
    };
  }

  const resumed = [];
  const failed = [];
  let blockedByStorage = false;
  let blockedError = '';

  for (const service of pending) {
    const latestState = readStorageProtectionState();
    const storageBlock = getStorageBlockForService(service, latestState);
    if (storageBlock.blocked) {
      blockedByStorage = true;
      const error = storageBlock.reason || 'Still blocked by storage watchdog';
      if (!blockedError) {
        blockedError = error;
      }
      failed.push({ service, error });
      continue;
    }

    try {
      if (service === 'media-workflow') {
        if (!fileIsExecutable(MEDIA_WORKFLOW_SERVICE_CMD)) {
          failed.push({ service, error: `Missing helper ${MEDIA_WORKFLOW_SERVICE_CMD}` });
          continue;
        }
        await runCommand(`"${MEDIA_WORKFLOW_SERVICE_CMD}" start`);
        try {
          await runCommand(`"${MEDIA_WORKFLOW_SERVICE_CMD}" status`);
        } catch {
          failed.push({ service, error: 'media-workflow did not report healthy state after start' });
          continue;
        }
      } else {
        const svc = SERVICES[service];
        if (!svc) {
          failed.push({ service, error: 'Service is not managed by this controller' });
          continue;
        }

        const install = await resolveServiceInstall(service, svc);
        if (!install.available) {
          failed.push({ service, error: `Command '${install.label}' is not installed` });
          continue;
        }

        await runCommand(svc.start);
        const running = await waitForServiceState(svc, true);
        if (!running) {
          failed.push({ service, error: 'Service failed to become healthy after start' });
          continue;
        }
      }

      resumed.push(service);
      clearStorageResumeRequirementForService(service);
    } catch (err) {
      failed.push({ service, error: String(err || 'Unable to start service') });
    }
  }

  const nextState = readStorageProtectionState();
  return {
    success: failed.length === 0,
    blocked: blockedByStorage,
    error: blockedError || (blockedByStorage ? (nextState.reason || 'Storage is still degraded') : ''),
    resumed,
    failed,
    storageProtection: nextState,
  };
};

const buildStorageHelperManualCommand = () =>
  `chmod +x "${USB_MOUNT_SERVICE_CMD}" "${STORAGE_WATCHDOG_SERVICE_CMD}" && "${USB_MOUNT_SERVICE_CMD}" start && "${STORAGE_WATCHDOG_SERVICE_CMD}" start`;

const getStorageHelperStatus = () => {
  const usbExists = fs.existsSync(USB_MOUNT_SERVICE_CMD);
  const watchdogExists = fs.existsSync(STORAGE_WATCHDOG_SERVICE_CMD);
  return {
    usbMount: {
      path: USB_MOUNT_SERVICE_CMD,
      exists: usbExists,
      installed: fileIsExecutable(USB_MOUNT_SERVICE_CMD),
    },
    watchdog: {
      path: STORAGE_WATCHDOG_SERVICE_CMD,
      exists: watchdogExists,
      installed: fileIsExecutable(STORAGE_WATCHDOG_SERVICE_CMD),
    },
  };
};

const repairStorageHelpers = async () => {
  const helpers = [
    { key: 'usb-mount', path: USB_MOUNT_SERVICE_CMD },
    { key: 'storage-watchdog', path: STORAGE_WATCHDOG_SERVICE_CMD },
  ];
  const repaired = [];
  const started = [];
  const failed = [];
  const missing = [];

  for (const helper of helpers) {
    if (!fs.existsSync(helper.path)) {
      missing.push({ helper: helper.key, path: helper.path });
      continue;
    }

    try {
      if (!fileIsExecutable(helper.path)) {
        fs.chmodSync(helper.path, 0o755);
        repaired.push({ helper: helper.key, path: helper.path, action: 'chmod +x' });
      }
    } catch (error) {
      failed.push({ helper: helper.key, path: helper.path, error: String(error || 'chmod failed') });
      continue;
    }

    if (!fileIsExecutable(helper.path)) {
      failed.push({ helper: helper.key, path: helper.path, error: 'Helper exists but is not executable' });
      continue;
    }

    try {
      await runCommand(`"${helper.path}" start`);
      started.push({ helper: helper.key, path: helper.path });
    } catch (error) {
      failed.push({ helper: helper.key, path: helper.path, error: String(error || 'start failed') });
    }
  }

  return {
    success: failed.length === 0 && missing.length === 0,
    repaired,
    started,
    failed,
    missing,
    helpers: getStorageHelperStatus(),
    manualCommand: buildStorageHelperManualCommand(),
  };
};

const drivesCheckHandler = async (req, res) => {
  const helperStatus = getStorageHelperStatus();
  if (!helperStatus.usbMount.installed) {
    const payload = await getDriveSnapshot();
    const storageProtection = readStorageProtectionState();
    return res.json({
      success: false,
      code: 'usb_mount_helper_missing',
      error: `USB mount service is not installed at ${USB_MOUNT_SERVICE_CMD}`,
      storageProtection,
      installHint: 'Run helper repair or restore the helper scripts to re-enable mount scanning.',
      manualCommand: buildStorageHelperManualCommand(),
      helpers: helperStatus,
      ...payload,
    });
  }

  try {
    await runCommand(`"${USB_MOUNT_SERVICE_CMD}" --scan-now`);
    ensureMediaCompatibilityLayout();
    const watchdogHelperAvailable = helperStatus.watchdog.installed;
    if (watchdogHelperAvailable) {
      await runCommand(`"${STORAGE_WATCHDOG_SERVICE_CMD}" check-now`);
      const firstWatchdogState = readStorageProtectionState();
      if (firstWatchdogState.overallHealthy && firstWatchdogState.state === 'degraded') {
        await runCommand(`"${STORAGE_WATCHDOG_SERVICE_CMD}" check-now`);
      }
    }
    const resumeResult = watchdogHelperAvailable
      ? await resumeStorageBlockedServices()
      : {
          success: false,
          blocked: false,
          resumed: [],
          failed: [],
          storageProtection: readStorageProtectionState(),
        };
    const payload = await getDriveSnapshot();
    pushAuditEvent(req, 'info', 'Drive scan requested', {
      count: payload.manifest.drives.length,
      resumed: resumeResult.resumed.length,
      failedResume: resumeResult.failed.length,
      storageState: resumeResult.storageProtection.state,
    });
    return res.json({
      success: true,
      resumed: resumeResult.resumed,
      failedResume: resumeResult.failed,
      storageProtection: resumeResult.storageProtection,
      helpers: helperStatus,
      ...(watchdogHelperAvailable ? {} : {
        warning: `Storage watchdog helper is not installed at ${STORAGE_WATCHDOG_SERVICE_CMD}`,
        code: 'watchdog_helper_missing',
      }),
      ...payload,
    });
  } catch (err) {
    const error = String(err || 'Drive scan failed');
    pushAuditEvent(req, 'error', 'Drive scan failed', { error });
    return res.status(500).json({ error, storageProtection: readStorageProtectionState(), ...(await getDriveSnapshot()) });
  }
};

const storageProtectionHandler = (req, res) => {
  res.json({
    events: readJsonLines(STORAGE_WATCHDOG_EVENTS_FILE, 80),
    storageProtection: readStorageProtectionState(),
  });
};

const storageProtectionRecheckHandler = async (req, res) => {
  const helperStatus = getStorageHelperStatus();
  const helperAvailable = helperStatus.watchdog.installed;
  if (!helperAvailable) {
    return res.json({
      success: false,
      code: 'watchdog_helper_missing',
      error: `Storage watchdog helper is not installed at ${STORAGE_WATCHDOG_SERVICE_CMD}`,
      installHint: 'Run helper repair or restore the storage watchdog helper script to re-enable health checks.',
      manualCommand: buildStorageHelperManualCommand(),
      helpers: helperStatus,
      storageProtection: readStorageProtectionState(),
    });
  }

  try {
    await runCommand(`"${STORAGE_WATCHDOG_SERVICE_CMD}" check-now`);
    const payload = readStorageProtectionState();
    pushAuditEvent(req, 'info', 'Storage watchdog recheck requested', {
      blockedServices: payload.blockedServices.length,
      state: payload.state,
    });
    return res.json({
      success: true,
      storageProtection: payload,
      helpers: helperStatus,
    });
  } catch (err) {
    const error = String(err || 'Storage watchdog recheck failed');
    pushAuditEvent(req, 'error', 'Storage watchdog recheck failed', { error });
    return res.status(500).json({
      error,
      storageProtection: readStorageProtectionState(),
    });
  }
};

const storageHelpersRepairHandler = async (req, res) => {
  try {
    const result = await repairStorageHelpers();
    pushAuditEvent(req, result.success ? 'info' : 'warn', 'Storage helper repair requested', {
      failed: result.failed.length,
      missing: result.missing.length,
      started: result.started.length,
    });
    return res.status(result.success ? 200 : 207).json({
      ...result,
      storageProtection: readStorageProtectionState(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: String(error || 'Unable to repair storage helpers'),
      helpers: getStorageHelperStatus(),
      manualCommand: buildStorageHelperManualCommand(),
      storageProtection: readStorageProtectionState(),
    });
  }
};

const storageProtectionResumeHandler = async (req, res) => {
  const resumeResult = await resumeStorageBlockedServices();
  if (resumeResult.blocked) {
    return res.status(409).json({
      error: resumeResult.error || 'Storage is still degraded',
      storageProtection: resumeResult.storageProtection,
    });
  }
  const success = resumeResult.success;
  pushAuditEvent(req, success ? 'info' : 'warn', 'Storage resume requested', {
    failed: resumeResult.failed,
    resumed: resumeResult.resumed,
    state: resumeResult.storageProtection.state,
  });
  return res.status(success ? 200 : 207).json({
    success,
    resumed: resumeResult.resumed,
    failed: resumeResult.failed,
    storageProtection: resumeResult.storageProtection,
  });
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

const createFsOperationJob = (kind, payload = {}) => writeFsOperation({
  createdAt: new Date().toISOString(),
  destinationPath: normalizeLocalRelativePath(payload.destinationPath || ''),
  failureCount: 0,
  failures: [],
  id: sanitizeFsOperationId(`${kind}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`),
  kind,
  manifest: Array.isArray(payload.manifest) ? payload.manifest.map((entry) => normalizeFsOperationManifestEntry(entry)).filter(Boolean) : [],
  message: String(payload.message || 'Queued'),
  processedBytes: Math.max(0, Number(payload.processedBytes || 0) || 0),
  processedItems: Math.max(0, Number(payload.processedItems || 0) || 0),
  cursor: Math.max(0, Number(payload.cursor || 0) || 0),
  sourcePaths: Array.isArray(payload.sourcePaths)
    ? payload.sourcePaths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
    : [],
  stagingPath: String(payload.stagingPath || ''),
  status: String(payload.status || 'queued'),
  totalBytes: Math.max(0, Number(payload.totalBytes || 0) || 0),
  totalItems: Math.max(0, Number(payload.totalItems || 0) || 0),
  updatedAt: new Date().toISOString(),
  uploadedFiles: Array.isArray(payload.uploadedFiles)
    ? payload.uploadedFiles.map((entry) => normalizeFsUploadRelativePath(entry || '')).filter(Boolean)
    : [],
  conflict: null,
  conflictPolicy: {
    replaceAllDifferentSize: false,
    skipAllSameSize: false,
  },
  conflictResolution: '',
});

const processFsTransferJob = async (operationId, req) => {
  const isCancelled = () => isFsOperationCancellationRequested(operationId);
  const tracker = createFsOperationTracker(updateFsOperation(operationId, {
    message: 'Preparing transfer',
    status: 'running',
  }));
  const job = tracker.job;
  const sourceStatsByPath = new Map();
  let cancelled = false;
  let pausedForConflict = false;

  for (const sourceRelative of job.sourcePaths) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
    if (!fs.existsSync(sourceAbsolute)) {
      tracker.fail(sourceRelative, 'Source path not found');
      continue;
    }
    sourceStatsByPath.set(sourceRelative, collectFsEntryStats(sourceAbsolute));
  }

  let cursor = Math.max(0, Number(job.cursor || 0) || 0);
  for (let index = cursor; index < job.sourcePaths.length; index += 1) {
    const sourceRelative = job.sourcePaths[index];
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    const currentJob = tracker.refresh();
    const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
    const targetRelative = normalizeLocalRelativePath(path.join(currentJob.destinationPath, path.basename(sourceRelative)));
    const targetAbsolute = resolveFsPath(targetRelative).absolutePath;
    const knownStats = sourceStatsByPath.get(sourceRelative) || { totalBytes: 0, totalItems: 0 };
    const applyOneShotDecision = String(currentJob.conflictResolution || '').toLowerCase();
    const conflictPolicy = currentJob.conflictPolicy || { replaceAllDifferentSize: false, skipAllSameSize: false };

    try {
      if (!fs.existsSync(sourceAbsolute)) {
        throw new Error('Source path not found');
      }
      if (await isProtectedFsPath(sourceRelative)) {
        throw new Error(`This path cannot be ${currentJob.kind === 'move' ? 'moved' : 'copied'}`);
      }
      if (await isProtectedFsPath(targetRelative)) {
        throw new Error('This destination is protected');
      }
      if (targetAbsolute === sourceAbsolute || targetAbsolute.startsWith(`${sourceAbsolute}${path.sep}`)) {
        throw new Error('Cannot paste a folder into itself');
      }

      if (fs.existsSync(targetAbsolute)) {
        const conflictMeta = getFsEntryConflictMeta(sourceAbsolute, targetAbsolute);
        const sizeRelation = conflictMeta.sizeRelation;
        let resolution = '';
        if (applyOneShotDecision === 'replace' || applyOneShotDecision === 'skip') {
          resolution = applyOneShotDecision;
        } else if (conflictPolicy.replaceAllDifferentSize && sizeRelation === 'different') {
          resolution = 'replace';
        } else if (conflictPolicy.skipAllSameSize && sizeRelation === 'same') {
          resolution = 'skip';
        }

        if (!resolution) {
          tracker.set({
            conflict: {
              reason: 'exists',
              sourcePath: sourceRelative,
              sourceSize: conflictMeta.sourceSize,
              sourceType: conflictMeta.sourceType,
              targetPath: targetRelative,
              targetSize: conflictMeta.targetSize,
              targetType: conflictMeta.targetType,
              sizeRelation,
            },
            conflictResolution: '',
            cursor: index,
            message: `Conflict detected for ${path.basename(sourceRelative)}. Choose replace or skip to continue.`,
            status: 'standby',
          }, true);
          pausedForConflict = true;
          break;
        }

        if (resolution === 'skip') {
          tracker.tick({
            bytes: knownStats.totalBytes,
            items: knownStats.totalItems,
            message: `Skipped ${path.basename(sourceRelative)}`,
          }, true);
          tracker.set({
            conflict: null,
            conflictResolution: '',
            cursor: index + 1,
          }, true);
          continue;
        }

        fs.rmSync(targetAbsolute, { force: true, recursive: true });
      }

      tracker.set({
        conflict: null,
        conflictResolution: '',
        message: `${currentJob.kind === 'move' ? 'Moving' : 'Copying'} ${path.basename(sourceRelative)}`,
      }, false);
      await copyFsEntryWithProgress(sourceAbsolute, targetAbsolute, tracker, currentJob.kind, knownStats, isCancelled);
      tracker.set({ cursor: index + 1 }, true);
    } catch (error) {
      if (isFsOperationCancelledError(error)) {
        cancelled = true;
        break;
      }
      tracker.fail(sourceRelative, error);
      tracker.set({
        conflict: null,
        conflictResolution: '',
        cursor: index + 1,
      }, true);
    }
  }

  const completed = tracker.refresh();
  if (pausedForConflict && completed.status === 'standby') {
    pushAuditEvent(req, 'warn', `Filesystem ${job.kind} paused for conflict resolution`, {
      conflict: completed.conflict || null,
      destination: job.destinationPath,
      operationId,
    });
    return;
  }
  if (cancelled || FS_OPERATION_CANCELLATION_STATUSES.has(completed.status)) {
    tracker.set({
      conflict: null,
      conflictResolution: '',
      message: `${completed.kind === 'move' ? 'Move' : 'Copy'} cancelled`,
      status: 'cancelled',
    }, true);
    pushAuditEvent(req, 'warn', `Filesystem entr${completed.sourcePaths.length === 1 ? 'y' : 'ies'} ${completed.kind} cancelled`, {
      destination: completed.destinationPath,
      failureCount: completed.failureCount,
      items: completed.sourcePaths,
      operationId,
      processedItems: completed.processedItems,
    });
    return;
  }

  const status = completed.failureCount > 0
    ? completed.processedItems > 0
      ? 'partial'
      : 'failed'
    : 'success';
  const message = completed.failureCount > 0
    ? `${job.kind === 'move' ? 'Move' : 'Copy'} completed with ${completed.failureCount} failure${completed.failureCount === 1 ? '' : 's'}`
    : `${job.kind === 'move' ? 'Move' : 'Copy'} complete`;
  tracker.set({
    conflict: null,
    conflictResolution: '',
    message,
    status,
  }, true);

  pushAuditEvent(req, status === 'success' ? 'info' : 'warn', `Filesystem entr${completed.sourcePaths.length === 1 ? 'y' : 'ies'} ${completed.kind}d`, {
    destination: completed.destinationPath,
    failureCount: completed.failureCount,
    items: completed.sourcePaths,
    operationId,
  });
};

const processFsDeleteJob = async (operationId, req) => {
  const isCancelled = () => isFsOperationCancellationRequested(operationId);
  const tracker = createFsOperationTracker(updateFsOperation(operationId, {
    message: 'Recycling entries',
    status: 'running',
  }));
  const job = tracker.job;
  const sourceStatsByPath = new Map();
  let cancelled = false;

  for (const sourceRelative of job.sourcePaths) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
    if (!fs.existsSync(sourceAbsolute)) {
      tracker.fail(sourceRelative, 'Path not found');
      continue;
    }
    sourceStatsByPath.set(sourceRelative, collectFsEntryStats(sourceAbsolute));
  }

  for (const sourceRelative of job.sourcePaths) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    try {
      if (await isProtectedFsPath(sourceRelative)) {
        throw new Error('This path cannot be deleted');
      }
      const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
      if (!fs.existsSync(sourceAbsolute)) {
        throw new Error('Path not found');
      }
      const recycled = moveFsEntryToRecycleBin(sourceRelative);
      const stats = sourceStatsByPath.get(sourceRelative) || { totalBytes: 0, totalItems: 0 };
      tracker.tick({
        bytes: stats.totalBytes,
        items: stats.totalItems,
        message: `Recycled ${path.basename(sourceRelative)}`,
      }, true);
      pushAuditEvent(req, 'info', 'Filesystem entry recycled', {
        from: sourceRelative,
        operationId,
        recycledAt: recycled.recycledAt,
        to: recycled.path,
      });
    } catch (error) {
      if (isFsOperationCancelledError(error)) {
        cancelled = true;
        break;
      }
      tracker.fail(sourceRelative, error);
    }
  }

  const completed = tracker.refresh();
  if (cancelled || FS_OPERATION_CANCELLATION_STATUSES.has(completed.status)) {
    tracker.set({
      message: 'Recycle cancelled',
      status: 'cancelled',
    }, true);
    pushAuditEvent(req, 'warn', 'Filesystem recycle cancelled', {
      failureCount: completed.failureCount,
      items: job.sourcePaths,
      operationId,
      processedItems: completed.processedItems,
    });
    return;
  }

  const status = completed.failureCount > 0
    ? completed.processedItems > 0
      ? 'partial'
      : 'failed'
    : 'success';
  tracker.set({
    message: completed.failureCount > 0
      ? `Recycle completed with ${completed.failureCount} failure${completed.failureCount === 1 ? '' : 's'}`
      : 'Recycle complete',
    status,
  }, true);
};

const processFsUploadFinalizeJob = async (operationId, req) => {
  const isCancelled = () => isFsOperationCancellationRequested(operationId);
  const tracker = createFsOperationTracker(updateFsOperation(operationId, {
    message: 'Finalizing upload',
    status: 'running',
  }));
  const job = tracker.job;
  const uploadedSet = new Set(job.uploadedFiles);
  const manifest = job.manifest;
  let cancelled = false;

  for (const entry of manifest) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    if (!uploadedSet.has(entry.relativePath)) {
      tracker.fail(entry.relativePath, 'File data was not uploaded');
      continue;
    }

    const stagedAbsolute = path.join(job.stagingPath, entry.relativePath);
    const targetRelative = normalizeLocalRelativePath(path.join(job.destinationPath, entry.relativePath));
    const targetAbsolute = resolveFsPath(targetRelative).absolutePath;

    try {
      if (!fs.existsSync(stagedAbsolute)) {
        throw new Error('Staged file not found');
      }
      if (await isProtectedFsPath(targetRelative)) {
        throw new Error('This destination is protected');
      }
      if (fs.existsSync(targetAbsolute)) {
        throw new Error('A file or folder with that name already exists in the destination');
      }

      fs.mkdirSync(path.dirname(targetAbsolute), { recursive: true });
      moveFsEntry(stagedAbsolute, targetAbsolute);
      if (entry.lastModified > 0) {
        const modifiedAt = new Date(entry.lastModified);
        if (!Number.isNaN(modifiedAt.getTime())) {
          try {
            fs.utimesSync(targetAbsolute, modifiedAt, modifiedAt);
          } catch {
            // best effort preserve original modified timestamp
          }
        }
      }
    } catch (error) {
      if (isFsOperationCancelledError(error)) {
        cancelled = true;
        break;
      }
      tracker.fail(entry.relativePath, error);
    }
  }

  try {
    fs.rmSync(job.stagingPath, { force: true, recursive: true });
  } catch {
    // best effort cleanup
  }

  const completed = tracker.refresh();
  if (cancelled || FS_OPERATION_CANCELLATION_STATUSES.has(completed.status)) {
    tracker.set({
      message: 'Upload cancelled',
      status: 'cancelled',
    }, true);
    pushAuditEvent(req, 'warn', 'Filesystem upload cancelled', {
      destination: job.destinationPath,
      failureCount: completed.failureCount,
      itemCount: manifest.length,
      operationId,
      processedItems: completed.processedItems,
    });
    return;
  }

  const successfulCount = manifest.length - completed.failureCount;
  tracker.set({
    message: completed.failureCount > 0
      ? `Upload finalized with ${completed.failureCount} failure${completed.failureCount === 1 ? '' : 's'}`
      : 'Upload complete',
    processedBytes: completed.totalBytes,
    processedItems: Math.max(completed.processedItems, successfulCount),
    status: completed.failureCount > 0
      ? successfulCount > 0
        ? 'partial'
        : 'failed'
      : 'success',
  }, true);

  pushAuditEvent(req, completed.failureCount > 0 ? 'warn' : 'info', 'Filesystem upload finalized', {
    destination: job.destinationPath,
    failureCount: completed.failureCount,
    itemCount: manifest.length,
    operationId,
  });
};

const {
  filesystemListHandler,
  filesystemMkdirHandler,
  filesystemRenameHandler,
  filesystemOperationsListHandler,
  filesystemOperationDetailHandler,
  filesystemOperationControlHandler,
  filesystemOperationUploadCreateHandler,
  filesystemOperationUploadFileHandler,
  filesystemOperationUploadFinalizeHandler,
  filesystemOperationTransferHandler,
  filesystemOperationDeleteHandler,
  filesystemDeleteHandler,
  filesystemDownloadHandler,
  filesystemUploadHandler,
  filesystemPasteHandler,
} = createFilesRouteHandlers({
  listFilesystemDirectory,
  pushDebugEvent,
  normalizeLocalRelativePath,
  ensureShareAccess,
  path,
  isProtectedFsPath,
  resolveFsPath,
  fs,
  pushAuditEvent,
  listFsOperations,
  serializeFsOperation,
  readFsOperation,
  FS_OPERATION_TERMINAL_STATUSES,
  markFsOperationCancelled,
  cleanupFsOperationArtifacts,
  removeFsOperationState,
  FS_CONFLICT_RESOLVE_ACTIONS,
  updateFsOperation,
  enqueueFsOperation,
  processFsTransferJob,
  ensureFsTargetAllowed,
  collectFsEntryStats,
  sumFsStats,
  createFsOperationJob,
  processFsDeleteJob,
  normalizeFsOperationManifestEntry,
  getFsOperationStagingRoot,
  sanitizeFsOperationId,
  crypto,
  normalizeFsUploadRelativePath,
  isFsOperationCancellationRequested,
  writeFsOperation,
  throwIfFsOperationCancelled,
  createFsOperationCancelledError,
  isFsOperationCancelledError,
  processFsUploadFinalizeJob,
  moveFsEntryToRecycleBin,
  moveFsEntry,
  copyFsEntry,
  FS_OPERATION_CANCELLATION_STATUSES,
  controlPlane,
});

const {
  ftpDefaultsHandler,
  ftpFavouritesHandler,
  createFtpFavouriteHandler,
  updateFtpFavouriteHandler,
  deleteFtpFavouriteHandler,
  mountFtpFavouriteHandler,
  unmountFtpFavouriteHandler,
  ftpListHandler,
  ftpDownloadHandler,
  ftpUploadHandler,
  ftpMkdirHandler,
} = createFtpRouteHandlers({
  getCloudMountCapability,
  DEFAULT_PS4_FTP_NAME,
  DEFAULT_PS4_HOST,
  DEFAULT_PS4_PORT,
  DEFAULT_PS4_USER,
  FTP_CLIENT_DOWNLOAD_ROOT,
  processEnv: process.env,
  appDb,
  serializeFtpFavourite,
  validateFtpFavouriteInput,
  pushAuditEvent,
  getFtpFavouriteOrThrow,
  getFtpMountState,
  unmountFtpFavourite,
  fs,
  getFtpFavouriteRuntime,
  mountFtpFavourite,
  listFtpDirectory,
  resolveFtpFavouritePayload,
  normalizeRemotePath,
  path,
  sanitizeFtpFavouriteName,
  sanitizeHostLabel,
  normalizeLocalRelativePath,
  ensureWithinRoot,
  withFtpClient,
  downloadFtpDirectoryTree,
  controlPlane,
});

const mediaTorrentAddHandlerBase = async function mediaTorrentAddHandler(req, res) {
  const source = String(req.body?.source || '').trim();
  const lane = String(req.body?.lane || '').trim().toLowerCase();
  const requestedMediaType = String(req.body?.mediaType || '').trim().toLowerCase();

  if (!isValidTorrentSource(source)) {
    pushAuditEvent(req, 'warn', 'Torrent add rejected', { code: 'invalid_source', lane, source });
    return res.status(400).json({ error: 'source must be a magnet URI or http(s) URL', code: 'invalid_source' });
  }
  if (!TORRENT_LANE_SET.has(lane)) {
    pushAuditEvent(req, 'warn', 'Torrent add rejected', { code: 'invalid_lane', lane });
    return res.status(400).json({ error: 'lane must be arr or standalone', code: 'invalid_lane' });
  }
  if (lane === 'arr' && !TORRENT_ARR_MEDIA_TYPE_SET.has(requestedMediaType)) {
    pushAuditEvent(req, 'warn', 'Torrent add rejected', { code: 'invalid_media_type', lane, mediaType: requestedMediaType || '' });
    return res.status(400).json({ error: 'mediaType must be movies or series when lane=arr', code: 'invalid_media_type' });
  }

  const mediaType = lane === 'arr' ? requestedMediaType : null;

  try {
    const storageProtection = readStorageProtectionState();
    const storageBlock = getStorageBlockForService('qbittorrent', storageProtection);
    if (storageBlock.blocked) {
      const error = storageBlock.reason || 'Blocked by storage watchdog';
      pushAuditEvent(req, 'warn', 'Torrent add blocked by storage watchdog', {
        code: 'storage_blocked',
        lane,
        mediaType: mediaType || null,
        source,
      });
      return res.status(423).json({ error, code: 'storage_blocked', state: storageProtection.state });
    }

    const qbService = SERVICES.qbittorrent;
    const install = await resolveServiceInstall('qbittorrent', qbService);
    if (!install.available) {
      const error = `qBittorrent is unavailable: ${install.label}`;
      pushAuditEvent(req, 'error', 'Torrent add rejected', { code: 'qb_unavailable', error });
      return res.status(500).json({ error, code: 'qb_unavailable' });
    }

    const running = await checkService(qbService);
    if (!running) {
      pushAuditEvent(req, 'warn', 'Torrent add rejected', { code: 'qb_not_running' });
      return res.status(503).json({ error: 'qBittorrent is not running', code: 'qb_not_running' });
    }

    const laneMapping = buildTorrentLaneMapping(resolveActiveScratchRoot(storageProtection));
    const laneConfig = lane === 'arr'
      ? laneMapping.arr[mediaType]
      : laneMapping.standalone;

    if (!laneConfig) {
      return res.status(400).json({ error: 'Unable to resolve torrent destination lane', code: 'invalid_lane_mapping' });
    }

    fs.mkdirSync(laneConfig.savePath, { recursive: true });
    await ensureWithinRoot(FILEBROWSER_ROOT, laneConfig.savePath);

    const response = await qbittorrentAddTorrent({
      category: laneConfig.category,
      savePath: laneConfig.savePath,
      source,
    });

    pushAuditEvent(req, 'info', 'Torrent add requested', {
      category: laneConfig.category,
      code: response.success ? 'queued' : 'upstream_failed',
      lane,
      mediaType: mediaType || null,
      savePath: laneConfig.savePath,
    });

    if (!response.success) {
      return res.status(502).json({
        error: response.error || 'Failed to queue torrent in qBittorrent',
        code: 'qb_add_failed',
      });
    }

    return res.json({
      category: laneConfig.category,
      lane,
      mediaType: mediaType || null,
      message: `Torrent queued in ${laneConfig.category}`,
      savePath: laneConfig.savePath,
      success: true,
    });
  } catch (err) {
    const error = String(err?.message || err || 'Failed to add torrent');
    pushAuditEvent(req, 'error', 'Torrent add failed', { error, lane, mediaType: mediaType || null });
    return res.status(500).json({ error, code: 'internal_error' });
  }
};

const mediaTorrentAddHandler = (controlPlane && typeof controlPlane.wrapHandler === 'function')
  ? controlPlane.wrapHandler({ scope: 'media', action: 'media.torrent.add' }, mediaTorrentAddHandlerBase)
  : mediaTorrentAddHandlerBase;

const registerDualRoute = createDualRouteRegistrar({
  registerDualRoute: routeRegistry.registerDualRoute,
});

registerApiRoutes({
  registerDualRoute,
  middleware: {
    requireAuth,
    requireAdmin,
    requireAdminOrLlmKey,
  },
  handlers: {
    statusHandler,
    servicesHandler,
    controlUnlockHandler,
    controlLockHandler,
    controlHandler,
    monitorHandler,
    dashboardHandler,
    uiBootstrapHandler,
    uiInitialHandler,
    uiWorkspacePayloadHandler,
    catalogServicesHandler,
    catalogWorkersHandler,
    clustersHandler,
    clusterDetailHandler,
    clusterActionHandler,
    serviceDetailHandler,
    serviceActionHandler,
    workflowStateServicesHandler,
    workflowDefinitionsHandler,
    workflowRunsHandler,
    workflowRunDetailHandler,
    workflowRunHandler,
    workflowStartHandler,
    workflowDetailHandler,
    workflowResumeHandler,
    workflowEventsHandler,
    metricsHandler,
    healthHandler,
    stateHandler,
    networkExposureHandler,
    connectionsHandler,
    disconnectConnectionHandler,
    storageHandler,
    storageProtectionHandler,
    storageProtectionRecheckHandler,
    storageProtectionResumeHandler,
    storageHelpersRepairHandler,
    logsHandler,
    loggingGetHandler,
    loggingPostHandler,
    drivesHandler,
    drivesCheckHandler,
    sharesHandler,
    createShareHandler,
    updateShareHandler,
    usersHandler,
    createUserHandler,
    updateUserHandler,
    telemetryHandler,
    filesystemListHandler,
    filesystemMkdirHandler,
    filesystemRenameHandler,
    filesystemOperationsListHandler,
    filesystemOperationDetailHandler,
    filesystemOperationControlHandler,
    filesystemOperationUploadCreateHandler,
    filesystemOperationUploadFileHandler,
    filesystemOperationUploadFinalizeHandler,
    filesystemOperationTransferHandler,
    filesystemOperationDeleteHandler,
    filesystemDeleteHandler,
    filesystemDownloadHandler,
    filesystemUploadHandler,
    filesystemPasteHandler,
    ftpDefaultsHandler,
    ftpFavouritesHandler,
    createFtpFavouriteHandler,
    updateFtpFavouriteHandler,
    deleteFtpFavouriteHandler,
    mountFtpFavouriteHandler,
    unmountFtpFavouriteHandler,
    ftpListHandler,
    ftpDownloadHandler,
    ftpUploadHandler,
    ftpMkdirHandler,
    mediaTorrentAddHandler,
    llmStateHandler,
    llmModelSelectHandler,
    llmModelAddLocalHandler,
    llmModelPullHandler,
    llmModelPullStatusHandler,
    llmOnlineModelsRefreshHandler,
    llmOnlineModelSelectHandler,
    llmConversationsHandler,
    llmConversationMessagesHandler,
    llmConversationDeleteHandler,
    llmChatHandler,
    llmChatStreamHandler,
    openAiModelsHandler,
    openAiChatCompletionsHandler,
  },
  rawUploadParser: FS_UPLOAD_RAW_PARSER,
});

routeRegistry.markErrorMiddlewareRegistered();

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

const runtimeState = {
  server: null,
  pollIntervalId: null,
};

const startPolling = () => {
  if (runtimeState.pollIntervalId) {
    return;
  }
  runtimeState.pollIntervalId = setInterval(() => {
    pollServiceStateTransitions().catch((err) => {
      pushDebugEvent('error', 'Service state polling failed', { error: String(err) }, true);
    });
  }, POLL_INTERVAL_MS);
};

const stopPolling = () => {
  if (!runtimeState.pollIntervalId) {
    return;
  }
  clearInterval(runtimeState.pollIntervalId);
  runtimeState.pollIntervalId = null;
};

const buildRouteManifestSnapshot = () => routeRegistry.buildRouteManifestSnapshot();
const buildStartupInvariantsSnapshot = () => routeRegistry.buildStartupInvariantsSnapshot();

const createApp = (options = {}) => {
  const enablePolling = options.enablePolling !== false;
  return {
    app,
    context: createAppContext({
      appDb,
      rootDir: ROOT_DIR,
      runtimeDir: RUNTIME_DIR,
    }),
    startupInvariants: buildStartupInvariantsSnapshot(),
    routeManifest: buildRouteManifestSnapshot(),
    polling: {
      enabled: enablePolling,
      intervalMs: POLL_INTERVAL_MS,
      start: startPolling,
      stop: stopPolling,
    },
  };
};

const startServer = async (options = {}) => {
  if (runtimeState.server) {
    const currentAddress = runtimeState.server.address();
    return {
      server: runtimeState.server,
      appRuntime: createApp(options),
      host: typeof currentAddress === 'object' && currentAddress ? currentAddress.address : (options.host || BACKEND_BIND_HOST),
      port: typeof currentAddress === 'object' && currentAddress ? currentAddress.port : (Number(options.port) || PORT),
    };
  }

  const host = options.host || BACKEND_BIND_HOST;
  const requestedPort = Number(options.port);
  const port = Number.isFinite(requestedPort) ? requestedPort : PORT;
  const enablePolling = options.enablePolling !== false;
  const appRuntime = createApp({ ...options, enablePolling });

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.on('error', reject);
  });
  runtimeState.server = server;

  const address = server.address();
  const resolvedHost = typeof address === 'object' && address ? address.address : host;
  const resolvedPort = typeof address === 'object' && address ? address.port : port;

  if (enablePolling) {
    startPolling();
  } else {
    stopPolling();
  }

  if (!options.silent) {
    console.log(`🚀 Backend running on ${resolvedHost}:${resolvedPort}`);
  }
  pushDebugEvent('info', 'Backend loaded', { host: resolvedHost, port: resolvedPort }, true);

  return {
    server,
    appRuntime,
    host: resolvedHost,
    port: resolvedPort,
  };
};

const stopServer = async (runtime = null) => {
  stopPolling();
  const server = runtime?.server || runtimeState.server;
  if (!server) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  if (server === runtimeState.server) {
    runtimeState.server = null;
  }
};

module.exports = {
  createApp,
  startServer,
  stopServer,
  buildRouteManifestSnapshot,
  buildStartupInvariantsSnapshot,
  routeManifestRegistry: routeRegistry.routeManifestRegistry,
  __runtimeState: runtimeState,
};
