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
const { createAppDb, normalizeUsername, verifyPassword } = require('./app-db');
const { parseDurationMs } = require('./lib/time');
const {
  buildStorageBlockReasonForService,
  getStorageBlockForService,
  normalizeStorageRoleState,
  normalizeStringArray,
} = require('./lib/storage-protection');
const { buildQbittorrentWebUiUrl, extractQbittorrentSidCookie } = require('./lib/qb-webui');
const { isValidTorrentSource } = require('./lib/torrent');

const ENV_FILE = path.resolve(__dirname, '.env');
if (typeof loadEnvFile === 'function' && fs.existsSync(ENV_FILE)) {
  loadEnvFile(ENV_FILE);
}

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
const MEDIA_VAULT_ROOT = process.env.MEDIA_VAULT_ROOT || path.join(FILEBROWSER_ROOT, 'D', 'VAULT', 'Media');
const MEDIA_SCRATCH_ROOT = process.env.MEDIA_SCRATCH_ROOT || path.join(FILEBROWSER_ROOT, 'E', 'SCRATCH', 'HmSTxScratch');
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
const JELLYSEERR_PORT = Number(process.env.JELLYSEERR_PORT || 5055);
const JELLYFIN_BASE_URL = process.env.JELLYFIN_BASE_URL || `http://${JELLYFIN_BIND_HOST}:${JELLYFIN_PORT}`;
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY || '';
const JELLYFIN_API_TIMEOUT_MS = Math.max(800, Number(process.env.JELLYFIN_API_TIMEOUT_MS || 2500) || 2500);
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
const MEDIA_WORKFLOW_SERVICE_CMD = process.env.MEDIA_WORKFLOW_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'media-workflow-service.sh');
const STORAGE_WATCHDOG_SERVICE_CMD = process.env.STORAGE_WATCHDOG_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'storage-watchdog-service.sh');
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
const LLM_SERVICE_CMD = process.env.LLM_SERVICE_CMD || path.join(ROOT_DIR, 'scripts', 'llm-service.sh');
const LLM_MODEL_PULL_CMD = process.env.LLM_MODEL_PULL_CMD || path.join(ROOT_DIR, 'scripts', 'llm-model-pull.sh');
const LLM_ACTIVE_MODEL_FILE = process.env.LLM_ACTIVE_MODEL_FILE || path.join(RUNTIME_DIR, 'llm-active-model.txt');
const LLM_PULL_STATE_DIR = process.env.LLM_PULL_STATE_DIR || path.join(RUNTIME_DIR, 'llm-pulls');
const CODEX_REVAMPED_CMD = process.env.CODEX_REVAMPED_CMD || path.join(HOME_DIR, '.local', 'bin', 'codex-lb-start');
const CODEX_REVAMPED_BIND_HOST = process.env.CODEX_REVAMPED_BIND_HOST || '127.0.0.1';
const CODEX_REVAMPED_PORT = Number(process.env.CODEX_REVAMPED_PORT || 2455);
const CODEX_REVAMPED_PID = process.env.CODEX_REVAMPED_PID_PATH || path.join(RUNTIME_DIR, 'codex-revamped.pid');
const CODEX_REVAMPED_LOG = process.env.CODEX_REVAMPED_LOG_PATH || path.join(ROOT_DIR, 'logs', 'codex-revamped.log');
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
  codex_revamped: {
    start: `mkdir -p "${ROOT_DIR}/logs" "${RUNTIME_DIR}" && if curl -fsS --max-time 2 "http://${CODEX_REVAMPED_BIND_HOST}:${CODEX_REVAMPED_PORT}/" >/dev/null 2>&1; then echo "codex-lb already reachable on ${CODEX_REVAMPED_BIND_HOST}:${CODEX_REVAMPED_PORT}"; elif [ -x "${CODEX_REVAMPED_CMD}" ]; then ${detachCommand(CODEX_REVAMPED_PID, `exec "${CODEX_REVAMPED_CMD}" > "${CODEX_REVAMPED_LOG}" 2>&1`)}; else echo "codex-lb launcher missing: ${CODEX_REVAMPED_CMD}"; exit 1; fi`,
    stop: stopPidfileProcess(CODEX_REVAMPED_PID, `pkill -f '[/]codex-lb( |$)' >/dev/null 2>&1 || true`),
    restart: `${stopPidfileProcess(CODEX_REVAMPED_PID, `pkill -f '[/]codex-lb( |$)' >/dev/null 2>&1 || true`)}; mkdir -p "${ROOT_DIR}/logs" "${RUNTIME_DIR}" && if [ -x "${CODEX_REVAMPED_CMD}" ]; then ${detachCommand(CODEX_REVAMPED_PID, `exec "${CODEX_REVAMPED_CMD}" > "${CODEX_REVAMPED_LOG}" 2>&1`)}; else echo "codex-lb launcher missing: ${CODEX_REVAMPED_CMD}"; exit 1; fi`,
    check: `${checkPidfileProcess(CODEX_REVAMPED_PID)} || curl -fsS --max-time 2 "http://${CODEX_REVAMPED_BIND_HOST}:${CODEX_REVAMPED_PORT}/" >/dev/null 2>&1`,
    host: CODEX_REVAMPED_BIND_HOST,
    port: CODEX_REVAMPED_PORT,
    binary: 'codex-lb',
    installCheckPaths: [CODEX_REVAMPED_CMD],
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
  llm: {
    controlMode: 'optional',
    description: 'Local on-device inference using llama.cpp with selectable GGUF models.',
    group: 'ai',
    label: 'Local LLM',
    route: '/llm/',
    surface: 'ai',
  },
  codex_revamped: {
    controlMode: 'optional',
    description: 'Codex ReVamped dashboard and account-pool API surfaced through home-server.',
    group: 'ai',
    label: 'Codex ReVamped',
    route: '/codex-revamped/',
    surface: 'ai',
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
  'codex_revamped',
];
const OPTIONAL_SERVICE_SET = new Set(OPTIONAL_SERVICE_NAMES);
const PLACEHOLDER_SERVICE_SET = new Set(['bazarr', 'jellyseerr']);
const SERVICE_GROUP_ORDER = ['platform', 'media', 'arr', 'data', 'downloads', 'filesystem', 'access', 'ai'];
const SERVICE_UNLOCK_TTL_MS = parseDurationMs(process.env.SERVICE_UNLOCK_TTL || '8h', 8 * 60 * 60 * 1000);
const SERVICE_STATS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_HISTORY_LIMIT = 400;
const TORRENT_LANE_SET = new Set(['arr', 'standalone']);
const TORRENT_ARR_MEDIA_TYPE_SET = new Set(['movies', 'series']);
const TORRENT_LANE_MAPPING = {
  arr: {
    movies: { category: 'movies', savePath: MEDIA_DOWNLOADS_MOVIES_DIR },
    series: { category: 'series', savePath: MEDIA_DOWNLOADS_SERIES_DIR },
  },
  standalone: {
    category: 'standalone',
    savePath: MEDIA_DOWNLOADS_TORRENT_QBIT_DIR,
  },
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
  const entries = [];
  const storageProtection = readStorageProtectionState();

  for (const [name, meta] of Object.entries(SERVICE_CATALOG_META)) {
    entries.push(await inspectServiceCatalogEntry(name, meta, storageProtection));
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
  const supportEntries = ['redis', 'postgres']
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

  return {
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
    resumeRequired: Boolean(raw.resumeRequired) && stoppedByWatchdog.length > 0,
    schema: Math.max(1, Number(raw.schema || 1) || 1),
    state: String(raw.state || (blockedServices.length > 0 ? 'degraded' : 'healthy')),
    stoppedByWatchdog,
    vault: normalizeStorageRoleState(raw.vault || {}),
    scratch: normalizeStorageRoleState(raw.scratch || {}),
  };
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
  const lifecycle = buildStackLifecycleSummary(serviceCatalog);

  return {
    generatedAt: new Date().toISOString(),
    logs: getLogsSnapshot(),
    monitor,
    serviceCatalog,
    lifecycle,
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

const FS_OPERATION_ACTIVE_STATUSES = new Set(['queued', 'receiving', 'running', 'cancelling']);
const FS_OPERATION_TERMINAL_STATUSES = new Set(['success', 'partial', 'failed', 'cancelled']);
const FS_OPERATION_CANCELLATION_STATUSES = new Set(['cancelling', 'cancelled']);
const FS_OPERATION_CANCELLED_ERROR_CODE = 'FS_OPERATION_CANCELLED';

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
    sourcePaths: Array.isArray(raw.sourcePaths)
      ? raw.sourcePaths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
      : [],
    stagingPath: String(raw.stagingPath || getFsOperationStagingRoot(operationId)),
    status: String(raw.status || 'failed'),
    totalBytes: Math.max(0, Number(raw.totalBytes || 0) || 0),
    totalItems: Math.max(0, Number(raw.totalItems || 0) || 0),
    updatedAt: String(raw.updatedAt || raw.createdAt || new Date().toISOString()),
    uploadedFiles: [...new Set(uploadedFiles)],
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
        error: String(body?.error?.message || body?.error || `Online provider returned ${response.status}`),
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

const llmStateHandler = async (req, res) => {
  try {
    const payload = await buildLlmState();
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: String(err || 'Unable to load LLM state') });
  }
};

const llmModelSelectHandler = async (req, res) => {
  const modelId = sanitizeModelId(req.body?.modelId);
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }
  const model = findModelById(modelId);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }
  if (!model.installed || !fs.existsSync(model.path)) {
    return res.status(409).json({ error: 'Model is not installed locally' });
  }
  setActiveModel({ modelId: model.id, modelPath: model.path });
  const running = await checkService(SERVICES.llm).catch(() => false);
  return res.json({
    success: true,
    model,
    restartRequired: running,
  });
};

const llmModelAddLocalHandler = (req, res) => {
  const label = String(req.body?.label || '').trim();
  const modelPath = String(req.body?.path || '').trim();
  if (!modelPath) {
    return res.status(400).json({ error: 'path is required' });
  }
  if (!path.isAbsolute(modelPath)) {
    return res.status(400).json({ error: 'path must be absolute' });
  }
  if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isFile()) {
    return res.status(400).json({ error: 'path must point to an existing file' });
  }
  if (!modelPath.toLowerCase().endsWith('.gguf')) {
    return res.status(400).json({ error: 'path must point to a .gguf model file' });
  }

  const modelId = sanitizeModelId(`local-${label || path.basename(modelPath, '.gguf')}-${crypto.randomUUID().slice(0, 6)}`);
  const current = getCustomLlmModels();
  current.push({
    id: modelId,
    label: label || path.basename(modelPath, '.gguf'),
    path: modelPath,
  });
  saveCustomLlmModels(current);
  return res.json({
    success: true,
    model: findModelById(modelId),
  });
};

const llmModelPullHandler = (req, res) => {
  const modelId = sanitizeModelId(req.body?.modelId);
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }
  const model = findModelById(modelId);
  if (!model || model.source !== 'preset') {
    return res.status(404).json({ error: 'Preset model not found' });
  }
  if (model.installed && fs.existsSync(model.path)) {
    return res.json({ success: true, alreadyInstalled: true, model });
  }
  try {
    const job = startLlmPullJob(model);
    return res.json({
      success: true,
      jobId: job.id,
      modelId: model.id,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err || 'Unable to start pull job') });
  }
};

const llmModelPullStatusHandler = (req, res) => {
  const job = readLlmPullJob(req.params.jobId || '');
  if (!job) {
    return res.status(404).json({ error: 'Pull job not found' });
  }
  return res.json(job);
};

const llmOnlineModelsRefreshHandler = async (req, res) => {
  try {
    const online = await fetchOnlineModels({ force: true });
    return res.json({ success: true, online });
  } catch (err) {
    return res.status(500).json({ error: String(err || 'Unable to refresh online models') });
  }
};

const llmOnlineModelSelectHandler = async (req, res) => {
  const modelId = String(req.body?.modelId || '').trim();
  if (!modelId) {
    return res.status(400).json({ error: 'modelId is required' });
  }
  const online = await fetchOnlineModels({ force: true });
  if (!online.configured) {
    return res.status(409).json({ error: 'Online provider is not configured.' });
  }
  if (!online.available) {
    return res.status(409).json({ error: online.error || 'Online provider is unavailable.' });
  }
  const model = online.models.find((entry) => entry.id === modelId);
  if (!model) {
    return res.status(400).json({ error: 'A valid online model is required.' });
  }
  setOnlineModelPreference(model.id);
  onlineModelCache = {
    expiresAt: Date.now() + ONLINE_MODEL_CACHE_TTL_MS,
    payload: {
      ...online,
      activeModelId: model.id,
    },
  };
  return res.json({
    success: true,
    model,
  });
};

const llmConversationsHandler = (req, res) => {
  try {
    const conversations = appDb.listLlmConversations(req.session?.userId);
    return res.json({ conversations });
  } catch (err) {
    return res.status(500).json({ error: String(err || 'Unable to list conversations') });
  }
};

const llmConversationMessagesHandler = (req, res) => {
  const conversationId = Number(req.params.id || 0);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'Valid conversation id is required' });
  }
  const conversation = appDb.getLlmConversation(conversationId);
  if (!conversation || conversation.userId !== req.session?.userId) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  return res.json({
    conversation,
    messages: appDb.listLlmMessages(conversationId),
  });
};

const llmConversationDeleteHandler = (req, res) => {
  const conversationId = Number(req.params.id || 0);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'Valid conversation id is required' });
  }
  const conversation = appDb.getLlmConversation(conversationId);
  if (!conversation || conversation.userId !== req.session?.userId) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  appDb.deleteLlmConversation(conversationId);
  return res.json({ success: true, id: conversationId });
};

const readUpstreamErrorMessage = async (response, fallbackMessage) => {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    return String(payload?.error?.message || payload?.error || fallbackMessage);
  }
  const text = await response.text().catch(() => '');
  return String(text || fallbackMessage);
};

const parseSseBlocks = (buffer) => {
  const events = [];
  let remaining = buffer;
  let boundary = remaining.indexOf('\n\n');
  while (boundary >= 0) {
    const rawBlock = remaining.slice(0, boundary).replace(/\r/g, '');
    remaining = remaining.slice(boundary + 2);
    boundary = remaining.indexOf('\n\n');
    if (!rawBlock.trim()) {
      continue;
    }

    let eventName = 'message';
    const dataLines = [];
    for (const line of rawBlock.split('\n')) {
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim() || 'message';
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    events.push({
      data: dataLines.join('\n'),
      event: eventName,
    });
  }

  return { events, remaining };
};

const extractStreamDeltaText = (payload) => {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  if (choice && typeof choice === 'object') {
    const delta = choice.delta;
    if (typeof delta?.content === 'string') {
      return delta.content;
    }
    if (Array.isArray(delta?.content)) {
      return delta.content
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('');
    }
    if (typeof choice.text === 'string') {
      return choice.text;
    }
  }
  if (typeof payload?.content === 'string') {
    return payload.content;
  }
  return '';
};

const llmChatStreamHandler = async (req, res) => {
  const text = String(req.body?.message || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'message is required' });
  }

  const mode = String(req.body?.mode || 'local').trim().toLowerCase() === 'online' ? 'online' : 'local';
  const llmState = await buildLlmState();
  let selectedModelId = '';
  if (mode === 'local') {
    if (!llmState.available) {
      return res.status(409).json({ error: llmState.blocker || 'LLM service is unavailable' });
    }
    if (!llmState.running) {
      return res.status(409).json({ error: 'LLM service is stopped. Start Local LLM first.' });
    }
    if (!llmState.activeModel || !llmState.activeModel.installed) {
      return res.status(409).json({ error: 'No active model is installed. Select and install a model first.' });
    }
    selectedModelId = llmState.activeModel.id;
  } else {
    const online = llmState.online || {};
    if (!online.configured) {
      return res.status(409).json({ error: 'Online provider is not configured.' });
    }
    if (!online.available) {
      return res.status(409).json({ error: online.error || 'Online provider is unavailable.' });
    }
    const requestedOnlineModelId = String(req.body?.onlineModelId || req.body?.modelId || '').trim();
    selectedModelId = requestedOnlineModelId || String(online.activeModelId || '');
    if (!selectedModelId || !Array.isArray(online.models) || !online.models.some((entry) => entry.id === selectedModelId)) {
      return res.status(400).json({ error: 'A valid online model is required.' });
    }
  }

  let conversation = null;
  const requestedConversationId = Number(req.body?.conversationId || 0);
  if (Number.isInteger(requestedConversationId) && requestedConversationId > 0) {
    const existing = appDb.getLlmConversation(requestedConversationId);
    if (!existing || existing.userId !== req.session?.userId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    conversation = existing;
  } else {
    conversation = appDb.createLlmConversation({
      userId: req.session?.userId,
      title: text.slice(0, 80),
    });
  }

  appDb.appendLlmMessage({
    conversationId: conversation.id,
    role: 'user',
    content: text,
    modelId: selectedModelId,
  });

  const history = appDb.listLlmMessages(conversation.id);
  const messages = [
    { role: 'system', content: LLM_CHAT_SYSTEM_PROMPT },
    ...history.map((entry) => ({ role: entry.role, content: entry.content })),
  ];

  const chatPayload = {
    model: selectedModelId,
    messages,
    stream: true,
    max_tokens: LLM_MAX_TOKENS,
    temperature: LLM_TEMPERATURE,
  };

  const upstream = mode === 'online'
    ? await callOnlineChatCompletion(chatPayload, { stream: true })
    : await callLlmChatCompletion(chatPayload, { stream: true });

  if (!upstream.ok) {
    const errorMessage = await readUpstreamErrorMessage(upstream, 'LLM request failed');
    return res.status(502).json({ error: errorMessage });
  }

  if (!upstream.body) {
    return res.status(502).json({ error: 'Upstream stream is unavailable' });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const emit = (eventName, payload) => {
    if (res.writableEnded) {
      return;
    }
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let terminalSent = false;
  const sendTerminal = (kind, payload) => {
    if (terminalSent || res.writableEnded) {
      return;
    }
    terminalSent = true;
    emit(kind, payload);
    res.end();
  };

  let clientDisconnected = false;
  req.on('close', () => {
    clientDisconnected = true;
    if (typeof upstream.body.cancel === 'function') {
      upstream.body.cancel().catch(() => {});
    }
  });

  emit('meta', {
    conversationId: conversation.id,
    mode,
    modelId: selectedModelId,
    startedAt: new Date().toISOString(),
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let seq = 0;
  let assistantText = '';

  try {
    while (!clientDisconnected) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBlocks(buffer);
      buffer = parsed.remaining;

      for (const event of parsed.events) {
        if (!event.data) {
          continue;
        }
        if (event.data === '[DONE]') {
          continue;
        }

        const payload = JSON.parse(event.data);
        const delta = extractStreamDeltaText(payload);
        if (!delta) {
          continue;
        }
        seq += 1;
        assistantText += delta;
        emit('delta', {
          seq,
          text: delta,
        });
      }
    }

    if (clientDisconnected) {
      return;
    }

    const normalizedAssistantText = assistantText.trim();
    if (!normalizedAssistantText) {
      sendTerminal('error', {
        code: 'upstream_error',
        message: 'LLM returned an empty response',
      });
      return;
    }

    let assistantMessage = null;
    try {
      assistantMessage = appDb.appendLlmMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: normalizedAssistantText,
        modelId: selectedModelId,
      });
    } catch {
      sendTerminal('error', {
        code: 'persistence_error',
        message: 'Unable to persist streamed assistant message',
      });
      return;
    }

    sendTerminal('done', {
      conversationId: conversation.id,
      assistantMessage,
    });
  } catch (err) {
    if (clientDisconnected) {
      return;
    }
    sendTerminal('error', {
      code: 'upstream_error',
      message: String(err?.message || err || 'Stream failed'),
    });
  } finally {
    reader.releaseLock();
  }
};

const llmChatHandler = async (req, res) => {
  const text = String(req.body?.message || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'message is required' });
  }

  const mode = String(req.body?.mode || 'local').trim().toLowerCase() === 'online' ? 'online' : 'local';
  const llmState = await buildLlmState();
  let selectedModelId = '';
  if (mode === 'local') {
    if (!llmState.available) {
      return res.status(409).json({ error: llmState.blocker || 'LLM service is unavailable' });
    }
    if (!llmState.running) {
      return res.status(409).json({ error: 'LLM service is stopped. Start Local LLM first.' });
    }
    if (!llmState.activeModel || !llmState.activeModel.installed) {
      return res.status(409).json({ error: 'No active model is installed. Select and install a model first.' });
    }
    selectedModelId = llmState.activeModel.id;
  } else {
    const online = llmState.online || {};
    if (!online.configured) {
      return res.status(409).json({ error: 'Online provider is not configured.' });
    }
    if (!online.available) {
      return res.status(409).json({ error: online.error || 'Online provider is unavailable.' });
    }
    const requestedOnlineModelId = String(req.body?.onlineModelId || req.body?.modelId || '').trim();
    selectedModelId = requestedOnlineModelId || String(online.activeModelId || '');
    if (!selectedModelId || !Array.isArray(online.models) || !online.models.some((entry) => entry.id === selectedModelId)) {
      return res.status(400).json({ error: 'A valid online model is required.' });
    }
  }

  let conversation = null;
  const requestedConversationId = Number(req.body?.conversationId || 0);
  if (Number.isInteger(requestedConversationId) && requestedConversationId > 0) {
    const existing = appDb.getLlmConversation(requestedConversationId);
    if (!existing || existing.userId !== req.session?.userId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    conversation = existing;
  } else {
    conversation = appDb.createLlmConversation({
      userId: req.session?.userId,
      title: text.slice(0, 80),
    });
  }

  appDb.appendLlmMessage({
    conversationId: conversation.id,
    role: 'user',
    content: text,
    modelId: selectedModelId,
  });

  const history = appDb.listLlmMessages(conversation.id);
  const messages = [
    { role: 'system', content: LLM_CHAT_SYSTEM_PROMPT },
    ...history.map((entry) => ({ role: entry.role, content: entry.content })),
  ];

  const chatPayload = {
    model: selectedModelId,
    messages,
    stream: false,
    max_tokens: LLM_MAX_TOKENS,
    temperature: LLM_TEMPERATURE,
  };
  const { response, body } = mode === 'online'
    ? await callOnlineChatCompletion(chatPayload)
    : await callLlmChatCompletion(chatPayload);
  if (!response.ok) {
    return res.status(502).json({
      error: body?.error?.message || body?.error || 'LLM request failed',
    });
  }

  const assistantText = String(body?.choices?.[0]?.message?.content || '').trim();
  if (!assistantText) {
    return res.status(502).json({ error: 'LLM returned an empty response' });
  }

  const assistantMessage = appDb.appendLlmMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: assistantText,
    modelId: selectedModelId,
  });

  return res.json({
    success: true,
    conversationId: conversation.id,
    mode,
    assistantMessage,
  });
};

const openAiModelsHandler = async (req, res) => {
  const state = await buildLlmState();
  const models = state.models
    .filter((entry) => entry.installed)
    .map((entry) => ({
      id: entry.id,
      object: 'model',
      owned_by: entry.source || 'local',
      created: 0,
    }));
  return res.json({
    object: 'list',
    data: models,
    active_model: state.activeModelId,
  });
};

const openAiChatCompletionsHandler = async (req, res) => {
  const state = await buildLlmState();
  if (!state.available) {
    return res.status(409).json({ error: { message: state.blocker || 'LLM service unavailable', type: 'service_unavailable' } });
  }
  if (!state.running) {
    return res.status(409).json({ error: { message: 'LLM service is stopped', type: 'service_unavailable' } });
  }

  const requestedModelId = sanitizeModelId(req.body?.model || state.activeModelId);
  if (requestedModelId !== state.activeModelId) {
    return res.status(409).json({
      error: {
        message: `Model '${requestedModelId}' is not active. Switch active model to continue.`,
        type: 'model_mismatch',
      },
    });
  }

  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages are required', type: 'invalid_request_error' } });
  }

  const stream = Boolean(req.body?.stream);
  const payload = {
    ...req.body,
    model: state.activeModelId,
    max_tokens: req.body?.max_tokens || LLM_MAX_TOKENS,
    temperature: Number.isFinite(Number(req.body?.temperature)) ? Number(req.body.temperature) : LLM_TEMPERATURE,
    stream,
  };
  if (!Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages[0]?.role !== 'system') {
    payload.messages = [{ role: 'system', content: LLM_CHAT_SYSTEM_PROMPT }, ...messages];
  }

  if (stream) {
    const upstream = await callLlmChatCompletion(payload, { stream: true });
    if (!upstream.ok) {
      const errorBody = await upstream.json().catch(() => ({}));
      return res.status(502).json({
        error: {
          message: errorBody?.error?.message || errorBody?.error || 'Upstream LLM stream failed',
          type: 'upstream_error',
        },
      });
    }
    res.status(200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (!upstream.body) {
      return res.end();
    }
    Readable.fromWeb(upstream.body).pipe(res);
    return;
  }

  const { response, body } = await callLlmChatCompletion(payload);
  if (!response.ok) {
    return res.status(502).json({
      error: {
        message: body?.error?.message || body?.error || 'Upstream LLM request failed',
        type: 'upstream_error',
      },
    });
  }
  return res.json(body);
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
    lifecycle: buildStackLifecycleSummary(serviceCatalog),
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
    const storageProtection = readStorageProtectionState();
    const storageBlock = getStorageBlockForService(service, storageProtection);

    if (['start', 'restart'].includes(action)) {
        if (storageBlock.blocked) {
          const error = storageBlock.reason || 'Service is blocked by storage watchdog';
          pushAuditEvent(req, 'warn', `${service} ${action} blocked by storage watchdog`, { service, action, error });
          return res.status(423).json({
            error,
            blockedBy: 'storage_watchdog',
            service,
            state: storageProtection.state,
          });
        }
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
    if (running && expectedRunning && ['start', 'restart'].includes(action)) {
      clearStorageResumeRequirementForService(service);
    }
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

const UI_WORKSPACES = ['overview', 'media', 'files', 'transfers', 'ai', 'terminal', 'admin'];
const LEGACY_TAB_TO_WORKSPACE = {
  home: 'overview',
  media: 'media',
  downloads: 'media',
  arr: 'media',
  terminal: 'terminal',
  filesystem: 'files',
  ftp: 'transfers',
  ai: 'ai',
  settings: 'admin',
};

const uiNavBlueprint = [
  { key: 'overview', label: 'Overview', legacyTabs: ['home'], summary: 'System health, telemetry, and lifecycle status' },
  { key: 'media', label: 'Media', legacyTabs: ['media', 'downloads', 'arr'], summary: 'Jellyfin and automation workflow surfaces' },
  { key: 'files', label: 'Files', legacyTabs: ['filesystem'], summary: 'Drive, share, and filesystem management' },
  { key: 'transfers', label: 'Transfers', legacyTabs: ['ftp'], summary: 'FTP favourites and remote transfer tools' },
  { key: 'ai', label: 'AI', legacyTabs: ['ai'], summary: 'Local and online LLM runtime workspace' },
  { key: 'terminal', label: 'Terminal', legacyTabs: ['terminal'], summary: 'Terminal and command access surface' },
  { key: 'admin', label: 'Admin', legacyTabs: ['settings'], summary: 'Service controls, access policy, and operations' },
];

const normalizeUiWorkspaceKey = (value = '') => {
  const key = String(value || '').trim().toLowerCase();
  return UI_WORKSPACES.includes(key) ? key : '';
};

const buildUiBootstrapPayload = async (sessionUser) => {
  const serviceCatalog = await buildServiceCatalog();
  const lifecycle = buildStackLifecycleSummary(serviceCatalog);
  const serviceByKey = new Map(serviceCatalog.map((entry) => [entry.key, entry]));
  const hasFilesAccess = await syncManagedShares().then((shares) => shares.length > 0).catch(() => false);
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

const uiBootstrapHandler = async (req, res) => {
  try {
    const payload = await buildUiBootstrapPayload(req.session);
    res.json(payload);
  } catch (err) {
    pushDebugEvent('error', 'UI bootstrap snapshot failed', { error: String(err) }, true);
    res.status(500).json({ error: 'Unable to build UI bootstrap payload' });
  }
};

const uiWorkspacePayloadHandler = async (req, res) => {
  const workspaceKey = normalizeUiWorkspaceKey(req.params.workspaceKey || '');
  if (!workspaceKey) {
    return res.status(404).json({ error: 'Unknown workspace key' });
  }

  try {
    const serviceCatalog = await buildServiceCatalog();
    const now = new Date().toISOString();
    const mediaEntries = serviceCatalog.filter((entry) => ['media', 'arr', 'downloads', 'data'].includes(entry.group));
    const transferEntries = serviceCatalog.filter((entry) => ['access', 'downloads'].includes(entry.group));

    if (workspaceKey === 'overview') {
      const [telemetry, connections, storage] = await Promise.all([
        getTelemetrySnapshot(req.session?.id),
        Promise.resolve(getConnectionsSnapshot()),
        getStorageSnapshot(),
      ]);
      return res.json({
        generatedAt: now,
        workspaceKey,
        telemetry,
        connections,
        storage,
      });
    }

    if (workspaceKey === 'media') {
      const mediaHealth = await getJellyfinMediaHealthSnapshot();
      return res.json({
        generatedAt: now,
        workspaceKey,
        lifecycle: buildStackLifecycleSummary(serviceCatalog),
        mediaWorkflow: buildMediaWorkflowSnapshot(serviceCatalog),
        mediaHealth,
        services: mediaEntries,
      });
    }

    if (workspaceKey === 'files') {
      const [drives, shares, users] = await Promise.all([
        getDriveSnapshot(),
        syncManagedShares(),
        Promise.resolve(appDb.listUsers()),
      ]);
      return res.json({
        generatedAt: now,
        workspaceKey,
        drives,
        storageProtection: readStorageProtectionState(),
        shares,
        users,
      });
    }

    if (workspaceKey === 'transfers') {
      const qbittorrentConfig = probeQbittorrentConfig();
      const qbittorrentService = serviceCatalog.find((entry) => entry.key === 'qbittorrent') || null;
      return res.json({
        generatedAt: now,
        workspaceKey,
        ftpDefaults: {
          defaultName: DEFAULT_PS4_FTP_NAME,
          host: process.env.FTP_CLIENT_HOST || DEFAULT_PS4_HOST,
          port: Number(process.env.FTP_CLIENT_PORT || DEFAULT_PS4_PORT),
          user: process.env.FTP_CLIENT_USER || DEFAULT_PS4_USER,
          secure: process.env.FTP_CLIENT_SECURE === 'true',
          downloadRoot: FTP_CLIENT_DOWNLOAD_ROOT,
          ftpMounting: getCloudMountCapability(),
        },
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
        favourites: appDb.listFtpFavourites().map(serializeFtpFavourite),
        services: transferEntries,
      });
    }

    if (workspaceKey === 'ai') {
      const [llmState, monitor] = await Promise.all([
        buildLlmState(),
        getMonitorSnapshot(),
      ]);
      return res.json({
        generatedAt: now,
        workspaceKey,
        llmState,
        monitor: {
          cpuLoad: Number(monitor.cpuLoad || 0),
          timestamp: now,
        },
      });
    }

    if (workspaceKey === 'terminal') {
      return res.json({
        generatedAt: now,
        workspaceKey,
        terminal: serviceCatalog.find((entry) => entry.key === 'ttyd') || null,
      });
    }

    const [dashboard, services] = await Promise.all([
      getDashboardSnapshot(req.session?.id),
      getServicesSnapshot(),
    ]);
    return res.json({
      generatedAt: now,
      workspaceKey,
      dashboard,
      services,
    });
  } catch (err) {
    pushDebugEvent('error', 'UI workspace payload failed', { error: String(err), workspaceKey }, true);
    return res.status(500).json({ error: `Unable to build '${workspaceKey}' workspace payload` });
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

const storageProtectionHandler = (req, res) => {
  res.json({
    events: readJsonLines(STORAGE_WATCHDOG_EVENTS_FILE, 80),
    storageProtection: readStorageProtectionState(),
  });
};

const storageProtectionRecheckHandler = async (req, res) => {
  const helperAvailable = fileIsExecutable(STORAGE_WATCHDOG_SERVICE_CMD) || await commandExists(STORAGE_WATCHDOG_SERVICE_CMD);
  if (!helperAvailable) {
    return res.status(503).json({
      error: `Storage watchdog helper is not installed at ${STORAGE_WATCHDOG_SERVICE_CMD}`,
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

const storageProtectionResumeHandler = async (req, res) => {
  const currentState = readStorageProtectionState();

  if (!currentState.overallHealthy || currentState.state === 'degraded') {
    return res.status(409).json({
      error: currentState.reason || 'Storage is still degraded',
      storageProtection: currentState,
    });
  }

  const pending = normalizeStringArray(currentState.stoppedByWatchdog);
  if (pending.length === 0) {
    return res.json({ success: true, resumed: [], failed: [], storageProtection: currentState });
  }

  const resumed = [];
  const failed = [];

  for (const service of pending) {
    const latestState = readStorageProtectionState();
    const storageBlock = getStorageBlockForService(service, latestState);
    if (storageBlock.blocked) {
      failed.push({ service, error: storageBlock.reason || 'Still blocked by storage watchdog' });
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
  const success = failed.length === 0;
  pushAuditEvent(req, success ? 'info' : 'warn', 'Storage resume requested', {
    failed,
    resumed,
    state: nextState.state,
  });
  return res.status(success ? 200 : 207).json({
    success,
    resumed,
    failed,
    storageProtection: nextState,
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

  for (const sourceRelative of job.sourcePaths) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
    const targetRelative = normalizeLocalRelativePath(path.join(job.destinationPath, path.basename(sourceRelative)));
    const targetAbsolute = resolveFsPath(targetRelative).absolutePath;
    const knownStats = sourceStatsByPath.get(sourceRelative) || { totalBytes: 0, totalItems: 0 };

    try {
      if (!fs.existsSync(sourceAbsolute)) {
        throw new Error('Source path not found');
      }
      if (await isProtectedFsPath(sourceRelative)) {
        throw new Error(`This path cannot be ${job.kind === 'move' ? 'moved' : 'copied'}`);
      }
      if (await isProtectedFsPath(targetRelative)) {
        throw new Error('This destination is protected');
      }
      if (fs.existsSync(targetAbsolute)) {
        throw new Error('A file or folder with that name already exists in the destination');
      }
      if (targetAbsolute === sourceAbsolute || targetAbsolute.startsWith(`${sourceAbsolute}${path.sep}`)) {
        throw new Error('Cannot paste a folder into itself');
      }

      tracker.set({ message: `${job.kind === 'move' ? 'Moving' : 'Copying'} ${path.basename(sourceRelative)}` }, false);
      await copyFsEntryWithProgress(sourceAbsolute, targetAbsolute, tracker, job.kind, knownStats, isCancelled);
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
      message: `${job.kind === 'move' ? 'Move' : 'Copy'} cancelled`,
      status: 'cancelled',
    }, true);
    pushAuditEvent(req, 'warn', `Filesystem entr${job.sourcePaths.length === 1 ? 'y' : 'ies'} ${job.kind} cancelled`, {
      destination: job.destinationPath,
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
  const message = completed.failureCount > 0
    ? `${job.kind === 'move' ? 'Move' : 'Copy'} completed with ${completed.failureCount} failure${completed.failureCount === 1 ? '' : 's'}`
    : `${job.kind === 'move' ? 'Move' : 'Copy'} complete`;
  tracker.set({
    message,
    status,
  }, true);

  pushAuditEvent(req, status === 'success' ? 'info' : 'warn', `Filesystem entr${job.sourcePaths.length === 1 ? 'y' : 'ies'} ${job.kind}d`, {
    destination: job.destinationPath,
    failureCount: completed.failureCount,
    items: job.sourcePaths,
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

const filesystemOperationsListHandler = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 25) || 25));
    return res.json({
      operations: listFsOperations(limit).map((job) => serializeFsOperation(job, false)),
    });
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to list filesystem operations') });
  }
};

const filesystemOperationDetailHandler = async (req, res) => {
  const job = readFsOperation(req.params.id || '');
  if (!job) {
    return res.status(404).json({ error: 'Filesystem operation not found' });
  }
  return res.json(serializeFsOperation(job, true));
};

const filesystemOperationControlHandler = async (req, res) => {
  try {
    const job = readFsOperation(req.params.id || '');
    if (!job) {
      return res.status(404).json({ error: 'Filesystem operation not found' });
    }

    const action = String(req.body?.action || '').trim().toLowerCase();
    if (action === 'cancel') {
      if (job.status === 'cancelled') {
        return res.json({ operation: serializeFsOperation(job, true), success: true });
      }
      if (FS_OPERATION_TERMINAL_STATUSES.has(job.status)) {
        return res.status(409).json({ error: 'Operation is already complete', operation: serializeFsOperation(job, true) });
      }

      if (job.status === 'queued' || (job.kind === 'upload' && job.status === 'receiving')) {
        const cancelledJob = markFsOperationCancelled(
          job.id,
          job.kind === 'delete'
            ? 'Recycle cancelled'
            : job.kind === 'move'
              ? 'Move cancelled'
              : job.kind === 'upload'
                ? 'Upload cancelled'
                : 'Copy cancelled',
        );
        pushAuditEvent(req, 'warn', 'Filesystem operation cancelled', {
          kind: job.kind,
          operationId: job.id,
          status: job.status,
        });
        return res.json({ operation: serializeFsOperation(cancelledJob, true), success: true });
      }

      const nextJob = job.status === 'cancelling'
        ? job
        : updateFsOperation(job.id, {
          message: 'Cancelling operation',
          status: 'cancelling',
        });
      pushAuditEvent(req, 'warn', 'Filesystem operation cancellation requested', {
        kind: job.kind,
        operationId: job.id,
        status: job.status,
      });
      return res.json({ operation: serializeFsOperation(nextJob, true), success: true });
    }

    if (action === 'dismiss') {
      if (!FS_OPERATION_TERMINAL_STATUSES.has(job.status)) {
        return res.status(409).json({ error: 'Only completed operations can be dismissed' });
      }
      cleanupFsOperationArtifacts(job);
      removeFsOperationState(job.id);
      return res.json({ dismissed: true, operationId: job.id, success: true });
    }

    return res.status(400).json({ error: 'Unsupported operation control action' });
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to control filesystem operation') });
  }
};

const filesystemOperationTransferHandler = async (req, res) => {
  try {
    const sourceRelatives = Array.isArray(req.body?.sourcePaths)
      ? req.body.sourcePaths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
      : [];
    const singleRelative = normalizeLocalRelativePath(req.body?.sourcePath || '');
    const destinationRelative = normalizeLocalRelativePath(req.body?.destinationPath || '');
    const mode = String(req.body?.mode || 'copy').toLowerCase() === 'move' ? 'move' : 'copy';
    const sourcePaths = sourceRelatives.length > 0 ? [...new Set(sourceRelatives)] : singleRelative ? [singleRelative] : [];

    if (sourcePaths.length === 0 || !destinationRelative) {
      return res.status(400).json({ error: 'Source paths and destination path are required' });
    }

    await ensureShareAccess(destinationRelative, req, 'write');
    ensureFsTargetAllowed(destinationRelative);

    const destinationAbsolute = resolveFsPath(destinationRelative).absolutePath;
    if (!fs.existsSync(destinationAbsolute) || !fs.statSync(destinationAbsolute).isDirectory()) {
      return res.status(400).json({ error: 'Destination must be an existing folder' });
    }

    const stats = [];
    for (const sourceRelative of sourcePaths) {
      await ensureShareAccess(sourceRelative, req, mode === 'move' ? 'write' : 'read');
      if (await isProtectedFsPath(sourceRelative)) {
        return res.status(403).json({ error: `This path cannot be ${mode === 'move' ? 'moved' : 'copied'}` });
      }
      const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
      if (!fs.existsSync(sourceAbsolute)) {
        return res.status(404).json({ error: `Source path not found: ${sourceRelative}` });
      }
      stats.push(collectFsEntryStats(sourceAbsolute));
    }

    const totals = sumFsStats(stats);
    const job = createFsOperationJob(mode, {
      destinationPath: destinationRelative,
      message: 'Queued',
      sourcePaths,
      totalBytes: totals.totalBytes,
      totalItems: totals.totalItems,
    });
    enqueueFsOperation(job.id, () => processFsTransferJob(job.id, req));
    return res.status(202).json({
      operationId: job.id,
      operation: serializeFsOperation(job, true),
      success: true,
    });
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to start transfer') });
  }
};

const filesystemOperationDeleteHandler = async (req, res) => {
  try {
    const sourceRelatives = Array.isArray(req.body?.paths)
      ? req.body.paths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
      : [];
    const singleRelative = normalizeLocalRelativePath(req.body?.path || '');
    const sourcePaths = sourceRelatives.length > 0 ? [...new Set(sourceRelatives)] : singleRelative ? [singleRelative] : [];

    if (sourcePaths.length === 0) {
      return res.status(400).json({ error: 'At least one path is required' });
    }

    const stats = [];
    for (const sourceRelative of sourcePaths) {
      await ensureShareAccess(sourceRelative, req, 'write');
      if (await isProtectedFsPath(sourceRelative)) {
        return res.status(403).json({ error: 'This path cannot be deleted' });
      }
      const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
      if (!fs.existsSync(sourceAbsolute)) {
        return res.status(404).json({ error: `Path not found: ${sourceRelative}` });
      }
      stats.push(collectFsEntryStats(sourceAbsolute));
    }

    const totals = sumFsStats(stats);
    const job = createFsOperationJob('delete', {
      message: 'Queued',
      sourcePaths,
      totalBytes: totals.totalBytes,
      totalItems: totals.totalItems,
    });
    enqueueFsOperation(job.id, () => processFsDeleteJob(job.id, req));
    return res.status(202).json({
      operationId: job.id,
      operation: serializeFsOperation(job, true),
      success: true,
    });
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to start delete operation') });
  }
};

const filesystemOperationUploadCreateHandler = async (req, res) => {
  try {
    const destinationRelative = normalizeLocalRelativePath(req.body?.destinationPath || '');
    const manifest = Array.isArray(req.body?.manifest)
      ? req.body.manifest.map((entry) => normalizeFsOperationManifestEntry(entry)).filter(Boolean)
      : [];

    if (!destinationRelative) {
      return res.status(400).json({ error: 'destinationPath is required' });
    }
    if (manifest.length === 0) {
      return res.status(400).json({ error: 'At least one file is required' });
    }

    await ensureShareAccess(destinationRelative, req, 'write');
    ensureFsTargetAllowed(destinationRelative);
    if (!fs.existsSync(resolveFsPath(destinationRelative).absolutePath) || !fs.statSync(resolveFsPath(destinationRelative).absolutePath).isDirectory()) {
      return res.status(400).json({ error: 'Destination must be an existing folder' });
    }

    const dedupedManifest = [...new Map(manifest.map((entry) => [entry.relativePath, entry])).values()];
    const totals = dedupedManifest.reduce((acc, entry) => ({
      totalBytes: acc.totalBytes + entry.size,
      totalItems: acc.totalItems + 1,
    }), { totalBytes: 0, totalItems: 0 });
    const job = createFsOperationJob('upload', {
      destinationPath: destinationRelative,
      manifest: dedupedManifest,
      message: 'Waiting for file data',
      stagingPath: getFsOperationStagingRoot(sanitizeFsOperationId(`upload-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)),
      status: 'receiving',
      totalBytes: totals.totalBytes,
      totalItems: totals.totalItems,
      uploadedFiles: [],
    });

    const stagingPath = getFsOperationStagingRoot(job.id);
    fs.mkdirSync(stagingPath, { recursive: true });
    const updatedJob = updateFsOperation(job.id, { stagingPath });
    return res.status(202).json({
      operationId: updatedJob.id,
      operation: serializeFsOperation(updatedJob, true),
      success: true,
    });
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to create upload operation') });
  }
};

const filesystemOperationUploadFileHandler = async (req, res) => {
  const job = readFsOperation(req.params.id || '');
  if (!job || job.kind !== 'upload') {
    return res.status(404).json({ error: 'Upload operation not found' });
  }
  if (job.status === 'cancelling' || job.status === 'cancelled') {
    return res.status(409).json({ error: 'Upload operation was cancelled', operation: serializeFsOperation(job, true) });
  }
  if (job.status !== 'receiving') {
    return res.status(409).json({ error: 'Upload operation is not accepting files right now' });
  }

  const relativePath = normalizeFsUploadRelativePath(req.query.relativePath || req.headers['x-file-relative-path'] || '');
  if (!relativePath) {
    return res.status(400).json({ error: 'relativePath is required' });
  }
  const manifestEntry = job.manifest.find((entry) => entry.relativePath === relativePath);
  if (!manifestEntry) {
    return res.status(404).json({ error: 'File is not part of this upload manifest' });
  }

  const tempPath = path.join(job.stagingPath, `${relativePath}.part`);
  const targetPath = path.join(job.stagingPath, relativePath);
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });

  try {
    await new Promise((resolve, reject) => {
      let receivedBytes = 0;
      let lastPersistAt = 0;
      const stream = fs.createWriteStream(tempPath, { flags: 'w' });

      const fail = (error) => {
        try {
          stream.destroy();
        } catch {
          // ignore
        }
        try {
          fs.rmSync(tempPath, { force: true });
        } catch {
          // ignore
        }
        reject(error);
      };

      req.on('data', (chunk) => {
        if (isFsOperationCancellationRequested(job.id)) {
          fail(createFsOperationCancelledError('Upload cancelled'));
          return;
        }
        receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        const now = Date.now();
        if (now - lastPersistAt > 200) {
          lastPersistAt = now;
          const current = readFsOperation(job.id);
          if (current) {
            const currentUploaded = current.manifest
              .filter((entry) => current.uploadedFiles.includes(entry.relativePath))
              .reduce((sum, entry) => sum + entry.size, 0);
            writeFsOperation({
              ...current,
              message: `Receiving ${path.basename(relativePath)}`,
              processedBytes: Math.min(current.totalBytes, currentUploaded + receivedBytes),
            });
          }
        }
      });
      req.on('aborted', () => fail(new Error('Upload aborted by client')));
      req.on('error', fail);
      stream.on('error', fail);
      stream.on('finish', resolve);
      if (isFsOperationCancellationRequested(job.id)) {
        fail(createFsOperationCancelledError('Upload cancelled'));
        return;
      }
      req.pipe(stream);
    });

    throwIfFsOperationCancelled(job.id, 'Upload cancelled');
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }
    fs.renameSync(tempPath, targetPath);

    const nextJob = updateFsOperation(job.id, (current) => {
      const uploadedFiles = [...new Set([...current.uploadedFiles, relativePath])];
      const uploadedBytes = current.manifest
        .filter((entry) => uploadedFiles.includes(entry.relativePath))
        .reduce((sum, entry) => sum + entry.size, 0);
      return {
        ...current,
        message: `Received ${uploadedFiles.length}/${current.totalItems} file${current.totalItems === 1 ? '' : 's'}`,
        processedBytes: Math.min(current.totalBytes, uploadedBytes),
        processedItems: Math.min(current.totalItems, uploadedFiles.length),
        uploadedFiles,
      };
    });

    return res.json({
      operation: serializeFsOperation(nextJob, true),
      success: true,
    });
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore
    }
    if (isFsOperationCancelledError(error)) {
      const latest = readFsOperation(job.id);
      if (latest && latest.status !== 'cancelled') {
        try {
          markFsOperationCancelled(job.id, 'Upload cancelled');
        } catch {
          // ignore
        }
      }
      const cancelledJob = readFsOperation(job.id) || latest || job;
      return res.status(409).json({
        error: 'Upload cancelled',
        operation: serializeFsOperation(cancelledJob, true),
      });
    }
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to receive upload file') });
  }
};

const filesystemOperationUploadFinalizeHandler = async (req, res) => {
  try {
    const job = readFsOperation(req.params.id || '');
    if (!job || job.kind !== 'upload') {
      return res.status(404).json({ error: 'Upload operation not found' });
    }
    if (job.status === 'cancelling' || job.status === 'cancelled') {
      return res.status(409).json({ error: 'Upload operation was cancelled', operation: serializeFsOperation(job, true) });
    }
    if (job.status !== 'receiving') {
      return res.status(409).json({ error: 'Upload operation is not waiting for finalize' });
    }

    const missingEntries = job.manifest
      .map((entry) => entry.relativePath)
      .filter((relativePath) => !job.uploadedFiles.includes(relativePath));
    if (missingEntries.length > 0) {
      return res.status(400).json({ error: 'Not all files were uploaded', missing: missingEntries });
    }

    const queuedJob = updateFsOperation(job.id, {
      message: 'Queued for finalize',
      status: 'queued',
    });
    enqueueFsOperation(queuedJob.id, () => processFsUploadFinalizeJob(queuedJob.id, req));
    return res.status(202).json({
      operationId: queuedJob.id,
      operation: serializeFsOperation(queuedJob, true),
      success: true,
    });
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to finalize upload') });
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

const mediaTorrentAddHandler = async (req, res) => {
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
  const mappedQb = lane === 'arr'
    ? TORRENT_LANE_MAPPING.arr[mediaType]
    : TORRENT_LANE_MAPPING.standalone;

  try {
    const storageProtection = readStorageProtectionState();
    const storageBlock = getStorageBlockForService('qbittorrent', storageProtection);
    if (storageBlock.blocked) {
      const error = storageBlock.reason || 'Blocked by storage watchdog';
      pushAuditEvent(req, 'warn', 'Torrent add blocked by storage watchdog', {
        code: 'storage_blocked',
        lane,
        mediaType,
        error,
      });
      return res.status(423).json({
        error,
        blockedBy: 'storage_watchdog',
        code: 'storage_blocked',
      });
    }

    const qbInstall = await resolveServiceInstall('qbittorrent', SERVICES.qbittorrent);
    if (!qbInstall.available) {
      const error = 'qBittorrent service is unavailable on this host';
      pushAuditEvent(req, 'error', 'Torrent add failed', { code: 'qb_service_unavailable', lane, mediaType, error });
      return res.status(503).json({ error, code: 'qb_service_unavailable' });
    }

    const qbHealth = await checkServiceHealth('qbittorrent', SERVICES.qbittorrent);
    if (!qbHealth.running) {
      const error = 'qBittorrent service is not reachable';
      pushAuditEvent(req, 'error', 'Torrent add failed', { code: 'qb_service_unavailable', lane, mediaType, error });
      return res.status(503).json({ error, code: 'qb_service_unavailable' });
    }

    await addTorrentToQbittorrentWebUi({
      source,
      category: mappedQb.category,
      savePath: mappedQb.savePath,
    });

    const response = {
      success: true,
      lane,
      mediaType,
      source,
      qb: {
        category: mappedQb.category,
        savePath: mappedQb.savePath,
      },
      addedAt: new Date().toISOString(),
    };
    pushAuditEvent(req, 'info', 'Torrent add succeeded', {
      lane,
      mediaType,
      sourceType: source.toLowerCase().startsWith('magnet:') ? 'magnet' : 'url',
      qb: response.qb,
    });
    return res.status(200).json(response);
  } catch (err) {
    const error = String(err?.message || err || 'qBittorrent add failed');
    const code = String(err?.code || 'qb_service_unavailable');
    const status = code === 'qb_upstream_error'
      ? 502
      : (code === 'qb_auth_required' || code === 'qb_service_unavailable')
        ? 503
        : 503;
    const stableCode = code === 'qb_upstream_error'
      ? 'qb_upstream_error'
      : (code === 'qb_auth_required' ? 'qb_auth_required' : 'qb_service_unavailable');
    pushAuditEvent(req, status >= 500 ? 'error' : 'warn', 'Torrent add failed', {
      code: stableCode,
      lane,
      mediaType,
      error,
    });
    return res.status(status).json({
      error,
      code: stableCode,
    });
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
registerDualRoute('get', '/ui/bootstrap', requireAuth, requireAdmin, uiBootstrapHandler);
registerDualRoute('get', '/ui/workspaces/:workspaceKey', requireAuth, requireAdmin, uiWorkspacePayloadHandler);
registerDualRoute('get', '/connections', requireAuth, requireAdmin, connectionsHandler);
registerDualRoute('post', '/connections/:id/disconnect', requireAuth, requireAdmin, disconnectConnectionHandler);
registerDualRoute('get', '/storage', requireAuth, requireAdmin, storageHandler);
registerDualRoute('get', '/storage/protection', requireAuth, requireAdmin, storageProtectionHandler);
registerDualRoute('post', '/storage/protection/recheck', requireAuth, requireAdmin, storageProtectionRecheckHandler);
registerDualRoute('post', '/storage/protection/resume', requireAuth, requireAdmin, storageProtectionResumeHandler);
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
registerDualRoute('get', '/fs/operations', requireAuth, filesystemOperationsListHandler);
registerDualRoute('get', '/fs/operations/:id', requireAuth, filesystemOperationDetailHandler);
registerDualRoute('post', '/fs/operations/:id/control', requireAuth, filesystemOperationControlHandler);
registerDualRoute('post', '/fs/operations/upload', requireAuth, filesystemOperationUploadCreateHandler);
registerDualRoute('post', '/fs/operations/:id/file', requireAuth, filesystemOperationUploadFileHandler);
registerDualRoute('post', '/fs/operations/:id/finalize', requireAuth, filesystemOperationUploadFinalizeHandler);
registerDualRoute('post', '/fs/operations/transfer', requireAuth, filesystemOperationTransferHandler);
registerDualRoute('post', '/fs/operations/delete', requireAuth, filesystemOperationDeleteHandler);
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
registerDualRoute('post', '/media/torrents/add', requireAuth, requireAdmin, mediaTorrentAddHandler);
registerDualRoute('get', '/llm/state', requireAuth, requireAdmin, llmStateHandler);
registerDualRoute('post', '/llm/models/select', requireAuth, requireAdmin, llmModelSelectHandler);
registerDualRoute('post', '/llm/models/add-local', requireAuth, requireAdmin, llmModelAddLocalHandler);
registerDualRoute('post', '/llm/models/pull', requireAuth, requireAdmin, llmModelPullHandler);
registerDualRoute('get', '/llm/models/pull/:jobId', requireAuth, requireAdmin, llmModelPullStatusHandler);
registerDualRoute('post', '/llm/online/models/refresh', requireAuth, requireAdmin, llmOnlineModelsRefreshHandler);
registerDualRoute('post', '/llm/online/models/select', requireAuth, requireAdmin, llmOnlineModelSelectHandler);
registerDualRoute('get', '/llm/conversations', requireAuth, requireAdmin, llmConversationsHandler);
registerDualRoute('get', '/llm/conversations/:id/messages', requireAuth, requireAdmin, llmConversationMessagesHandler);
registerDualRoute('delete', '/llm/conversations/:id', requireAuth, requireAdmin, llmConversationDeleteHandler);
registerDualRoute('post', '/llm/chat', requireAuth, requireAdmin, llmChatHandler);
registerDualRoute('post', '/llm/chat/stream', requireAuth, requireAdmin, llmChatStreamHandler);
registerDualRoute('get', '/openai/v1/models', requireAdminOrLlmKey, openAiModelsHandler);
registerDualRoute('post', '/openai/v1/chat/completions', requireAdminOrLlmKey, openAiChatCompletionsHandler);

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
