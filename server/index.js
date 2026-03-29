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
const FILEBROWSER_ROOT = process.env.FILEBROWSER_ROOT || path.join(HOME_DIR, 'Drives');
const FTP_ROOT = process.env.FTP_ROOT || FILEBROWSER_ROOT;
const FTP_CLIENT_DOWNLOAD_ROOT = process.env.FTP_CLIENT_DOWNLOAD_ROOT || FILEBROWSER_ROOT;
const RUNTIME_DIR = process.env.RUNTIME_DIR || path.join(ROOT_DIR, 'runtime');
const APP_DB_PATH = process.env.APP_DB_PATH || path.join(RUNTIME_DIR, 'app.db');
const FTP_MOUNT_RUNTIME_DIR = process.env.FTP_MOUNT_RUNTIME_DIR || path.join(RUNTIME_DIR, 'ftp-mounts');
const TERMUX_CLOUD_MOUNT_CMD = process.env.TERMUX_CLOUD_MOUNT_CMD || '/data/data/com.termux/files/usr/bin/termux-cloud-mount';
const TERMUX_CLOUD_MOUNT_ROOT = process.env.TERMUX_CLOUD_MOUNT_ROOT || '/mnt/cloud/home-server';
const NGINX_PID = process.env.NGINX_PID_PATH || path.join(RUNTIME_DIR, 'nginx.pid');
const TTYD_PID = process.env.TTYD_PID_PATH || path.join(RUNTIME_DIR, 'ttyd.pid');
const FTP_PID = process.env.FTP_PID_PATH || path.join(RUNTIME_DIR, 'ftp.pid');
const SSHD_PID = process.env.SSHD_PID_PATH || path.join(RUNTIME_DIR, 'sshd.pid');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const PORT = Number(process.env.PORT || 4000);
const BACKEND_BIND_HOST = process.env.BACKEND_BIND_HOST || '127.0.0.1';
const TTYD_BIND_HOST = process.env.TTYD_BIND_HOST || '127.0.0.1';
const FTP_BIND_HOST = process.env.FTP_BIND_HOST || '127.0.0.1';
const FTP_SERVER_PORT = Number(process.env.FTP_SERVER_PORT || 2121);
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
};

/* ---------------- HELPERS ---------------- */

const debugEvents = [];
const recentConnections = new Map();
const activeSessions = new Map();
const loginAttempts = new Map();
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
const MAX_DEBUG_EVENTS = 300;
let cpuSnapshot = null;
let verboseLoggingEnabled = appDb.getBooleanSetting('logging.verboseEnabled', false);
const serviceStateCache = {};
let ftpProviderCache = {
  checkedAt: 0,
  provider: null,
};
let networkSnapshotCache = null;
const timedCache = {
  monitor: { expiresAt: 0, value: null, promise: null },
  services: { expiresAt: 0, value: null, promise: null },
  storage: { expiresAt: 0, value: null, promise: null },
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

    names.push(name);
  }

  return names;
};

const resolveServiceInstall = async (serviceName, svc) => {
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

const isPortOpen = (port, host = '127.0.0.1', timeoutMs = 1200) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (open) => {
      if (done) {
        return;
      }

      done = true;
      socket.destroy();
      resolve(open);
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

  return isPortOpen(svc.port, svc.host || '127.0.0.1');
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

  for (const [name, svc] of Object.entries(SERVICES)) {
    if (name === 'sshd' && !ENABLE_SSHD) {
      continue;
    }

    if (name === 'ftp' && !(await detectFtpProvider())) {
      continue;
    }

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

  const token = readToken(req);
  if (token) {
    try {
      const { decoded } = validateSessionToken(token);
      username = decoded?.sub || username;
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

const collectMonitorSnapshot = async () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuLoad = await readCpuUsage();
  const processMemory = process.memoryUsage();
  const [load1m, load5m, load15m] = os.loadavg();
  const loopMeanMs = Number((eventLoopDelay.mean / 1e6).toFixed(2));
  const loopP95Ms = Number((eventLoopDelay.percentile(95) / 1e6).toFixed(2));
  const cpuCores = (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) || 1;
  eventLoopDelay.reset();

  return {
    cpuCores,
    cpuLoad,
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
  const controlledServiceNames = await getControlledServiceNames();

  for (const name of controlledServiceNames) {
    const svc = SERVICES[name];
    result[name] = await checkService(svc);
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
      .map(({ lastSeenMs, ...entry }) => entry),
  };
};

const getNetworkDevicesSnapshot = () => ({
  devices: readLanDevices(),
});

const getLogsSnapshot = () => ({
  logs: debugEvents.slice(-120).reverse(),
  markdown: buildMarkdownLog(80),
  verboseLoggingEnabled,
});

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

const getDashboardSnapshot = async () => {
  const [services, monitor, storage] = await Promise.all([
    getServicesSnapshot(),
    getMonitorSnapshot(),
    getStorageSnapshot(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    services,
    monitor,
    connections: getConnectionsSnapshot(),
    networkDevices: getNetworkDevicesSnapshot(),
    storage,
    logs: getLogsSnapshot(),
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

const FS_HIDDEN_NAMES = new Set(['.state', 'filebrowser.db']);

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

const isProtectedFsPath = (relativePath = '') => {
  const segments = relativeSegments(relativePath);
  if (segments.length === 0) {
    return true;
  }

  return segments.length === 1 && (segments[0] === 'C' || FS_HIDDEN_NAMES.has(segments[0]));
};

const getDriveNames = async () => {
  const snapshot = await getDriveSnapshot();
  return new Set(['C', ...snapshot.manifest.drives.map((drive) => drive.dirName).filter(Boolean)]);
};

const buildFsBreadcrumbs = (relativePath = '') => {
  const segments = relativeSegments(relativePath);
  const crumbs = [{ label: 'Drives', path: '' }];
  let currentPath = '';

  for (const segment of segments) {
    currentPath = currentPath ? path.join(currentPath, segment) : segment;
    crumbs.push({
      label: segment,
      path: currentPath,
    });
  }

  return crumbs;
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

const listFilesystemDirectory = async (inputPath = '') => {
  const { absolutePath, relativePath } = resolveFsPath(inputPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error('Directory not found');
  }

  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  const driveNames = await getDriveNames();
  const names = fs.readdirSync(absolutePath, { encoding: 'utf8' });
  const entries = names
    .filter((name) => !FS_HIDDEN_NAMES.has(name))
    .map((name) => {
      const childAbsolute = path.join(absolutePath, name);
      const childRelative = relativePath ? path.join(relativePath, name) : name;
      const dirent = fs.lstatSync(childAbsolute);
      const resolvedStat = dirent.isSymbolicLink() ? fs.statSync(childAbsolute) : dirent;
      const type = describeFsType(dirent, resolvedStat);
      const topLevel = relativeSegments(childRelative)[0] || name;
      const protectedEntry = isProtectedFsPath(childRelative) || driveNames.has(topLevel);

      return {
        editable: !protectedEntry,
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
    breadcrumbs: buildFsBreadcrumbs(relativePath),
    entries,
    path: relativePath,
    root: FILEBROWSER_ROOT,
  };
};

const ensureFsTargetAllowed = (relativePath = '') => {
  const segments = relativeSegments(relativePath);
  if (segments.length === 0) {
    throw new Error('Destination folder is required');
  }

  const topLevel = segments[0];
  if (topLevel === 'C' || FS_HIDDEN_NAMES.has(topLevel)) {
    throw new Error('This destination is protected');
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
  writeCloudMountRequest(favourite, { includeSecrets: true });
  runCloudMountHelper(['mount', '--request', getFtpFavouriteRuntime(favourite).helperRequestPath]);
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
    user: {
      username: req.user?.sub || req.session?.username || BOOTSTRAP_DASHBOARD_USER,
      role: req.user?.role || req.session?.role || 'admin',
    },
  });
};

const verifyHandler = (req, res) => res.status(204).end();

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
app.post('/auth/logout', logoutHandler);
app.post('/api/auth/logout', logoutHandler);

const statusHandler = (req, res) => {
  res.json({
    uptime: `${(os.uptime() / 3600).toFixed(1)} hrs`,
  });
};

const servicesHandler = async (req, res) => {
  const result = await getServicesSnapshot();

  pushDebugEvent('info', 'Services snapshot served', { count: Object.keys(result).length });
  res.json(result);
};

const controlHandler = async (req, res) => {
  const { service, action, adminPassword } = req.body || {};
  const controlledServiceNames = await getControlledServiceNames();

  if (!controlledServiceNames.includes(service)) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  if (!SERVICES[service][action]) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  if (!secureCompare(adminPassword || '', ADMIN_ACTION_PASSWORD)) {
    pushDebugEvent('warn', 'Service control rejected (bad admin password)', { service, action }, true);
    return res.status(403).json({ error: 'Invalid admin password' });
  }

  try {
    const svc = SERVICES[service];

    if (['start', 'restart'].includes(action)) {
      const install = await resolveServiceInstall(service, svc);
      if (!install.available) {
        const error = `Command '${install.label}' is not installed`;
        pushDebugEvent('error', `${service} ${action} failed`, { error }, true);
        return res.status(500).json({ error });
      }
    }

    const output = await runCommand(svc[action]);
    const expectedRunning = action !== 'stop';
    const running = await waitForServiceState(svc, expectedRunning);
    serviceStateCache[service] = classifyServiceState(running);

    pushDebugEvent(
      running === expectedRunning ? 'info' : 'warn',
      `${service} ${action} requested`,
      { running, expectedRunning, output: output || '(no output)' }
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
    pushDebugEvent('error', `${service} ${action} failed`, { error: errorText, hint }, true);
    res.status(500).json({ error: errorText, hint });
  }
};

const monitorHandler = async (req, res) => {
  const payload = await getMonitorSnapshot();

  res.json(payload);
  pushDebugEvent('info', 'Monitor snapshot served', { cpuLoad: Number(payload.cpuLoad.toFixed(2)) });
};

const connectionsHandler = (req, res) => {
  const payload = getConnectionsSnapshot();

  pushDebugEvent('info', 'Connections snapshot served', { count: payload.users.length });
  res.json(payload);
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
  pushDebugEvent('info', verboseLoggingEnabled ? 'Verbose logging enabled' : 'Verbose logging disabled', null, true);
  res.json({
    success: true,
    verboseLoggingEnabled,
    markdown: buildMarkdownLog(80),
  });
};

const dashboardHandler = async (req, res) => {
  try {
    const payload = await getDashboardSnapshot();
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
    pushDebugEvent('info', 'Drive agent scan requested', { count: payload.manifest.drives.length }, true);
    return res.json({ success: true, ...payload });
  } catch (err) {
    const error = String(err || 'Drive scan failed');
    pushDebugEvent('error', 'Drive agent scan failed', { error }, true);
    return res.status(500).json({ error, ...(await getDriveSnapshot()) });
  }
};

const filesystemListHandler = async (req, res) => {
  try {
    res.json(await listFilesystemDirectory(req.query.path || ''));
  } catch (err) {
    const message = String(err?.message || err || 'Unable to list files');
    const status = /not found/i.test(message) ? 404 : 400;
    pushDebugEvent('error', 'Filesystem list failed', { error: message, path: String(req.query.path || '') }, true);
    res.status(status).json({ error: message });
  }
};

const filesystemMkdirHandler = async (req, res) => {
  try {
    const parentPath = normalizeLocalRelativePath(req.body?.path || '');
    const folderName = path.basename(String(req.body?.name || '').replace(/[\\/]+/g, ' ').trim());
    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const targetRelative = normalizeLocalRelativePath(path.join(parentPath, folderName));
    const { absolutePath } = resolveFsPath(targetRelative);
    if (fs.existsSync(absolutePath)) {
      return res.status(400).json({ error: 'Target already exists' });
    }

    fs.mkdirSync(absolutePath, { recursive: true });
    pushDebugEvent('info', 'Filesystem directory created', { path: targetRelative }, true);
    res.json({ success: true, path: targetRelative });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to create folder');
    pushDebugEvent('error', 'Filesystem mkdir failed', { error: message }, true);
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
    if (isProtectedFsPath(sourceRelative)) {
      return res.status(403).json({ error: 'This path cannot be renamed' });
    }

    const parentRelative = path.dirname(sourceRelative) === '.' ? '' : path.dirname(sourceRelative);
    const targetRelative = normalizeLocalRelativePath(path.join(parentRelative, nextName));
    const sourcePath = resolveFsPath(sourceRelative).absolutePath;
    const targetPath = resolveFsPath(targetRelative).absolutePath;
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Source path not found' });
    }
    if (fs.existsSync(targetPath)) {
      return res.status(400).json({ error: 'Target already exists' });
    }

    fs.renameSync(sourcePath, targetPath);
    pushDebugEvent('info', 'Filesystem entry renamed', { from: sourceRelative, to: targetRelative }, true);
    res.json({ success: true, path: targetRelative });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to rename entry');
    pushDebugEvent('error', 'Filesystem rename failed', { error: message }, true);
    res.status(400).json({ error: message });
  }
};

const filesystemDeleteHandler = async (req, res) => {
  try {
    const sourceRelative = normalizeLocalRelativePath(req.body?.path || '');
    if (!sourceRelative) {
      return res.status(400).json({ error: 'Path is required' });
    }
    if (isProtectedFsPath(sourceRelative)) {
      return res.status(403).json({ error: 'This path cannot be deleted' });
    }

    const { absolutePath } = resolveFsPath(sourceRelative);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    fs.rmSync(absolutePath, { recursive: true, force: true });
    pushDebugEvent('info', 'Filesystem entry deleted', { path: sourceRelative }, true);
    res.json({ success: true });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to delete entry');
    pushDebugEvent('error', 'Filesystem delete failed', { error: message }, true);
    res.status(400).json({ error: message });
  }
};

const filesystemDownloadHandler = async (req, res) => {
  try {
    const relativePath = normalizeLocalRelativePath(req.query.path || '');
    if (!relativePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const { absolutePath } = resolveFsPath(relativePath);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'Only file downloads are supported right now' });
    }

    pushDebugEvent('info', 'Filesystem file download requested', { path: relativePath }, true);
    res.download(absolutePath, path.basename(absolutePath));
  } catch (err) {
    const message = String(err?.message || err || 'Unable to download file');
    pushDebugEvent('error', 'Filesystem download failed', { error: message }, true);
    res.status(400).json({ error: message });
  }
};

const filesystemUploadHandler = async (req, res) => {
  try {
    const parentRelative = normalizeLocalRelativePath(req.query.path || '');
    const fileName = path.basename(String(req.query.name || req.headers['x-file-name'] || '').replace(/[\\/]+/g, ' ').trim());
    if (!fileName) {
      return res.status(400).json({ error: 'A file name is required' });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Upload body is missing' });
    }

    const targetRelative = normalizeLocalRelativePath(path.join(parentRelative, fileName));
    const { absolutePath } = resolveFsPath(targetRelative);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, req.body);
    pushDebugEvent('info', 'Filesystem file uploaded', { path: targetRelative, size: req.body.length }, true);
    res.json({ success: true, path: targetRelative });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to upload file');
    pushDebugEvent('error', 'Filesystem upload failed', { error: message }, true);
    res.status(400).json({ error: message });
  }
};

const filesystemPasteHandler = async (req, res) => {
  try {
    const sourceRelative = normalizeLocalRelativePath(req.body?.sourcePath || '');
    const destinationRelative = normalizeLocalRelativePath(req.body?.destinationPath || '');
    const mode = String(req.body?.mode || 'copy').toLowerCase();

    if (!sourceRelative || !destinationRelative) {
      return res.status(400).json({ error: 'Source and destination paths are required' });
    }
    if (mode !== 'copy' && mode !== 'move') {
      return res.status(400).json({ error: 'Mode must be copy or move' });
    }
    if (isProtectedFsPath(sourceRelative)) {
      return res.status(403).json({ error: `This path cannot be ${mode === 'move' ? 'moved' : 'copied'}` });
    }

    ensureFsTargetAllowed(destinationRelative);

    const source = resolveFsPath(sourceRelative);
    const destination = resolveFsPath(destinationRelative);
    if (!fs.existsSync(source.absolutePath)) {
      return res.status(404).json({ error: 'Source path not found' });
    }
    if (!fs.existsSync(destination.absolutePath) || !fs.statSync(destination.absolutePath).isDirectory()) {
      return res.status(400).json({ error: 'Destination must be an existing folder' });
    }

    const targetRelative = normalizeLocalRelativePath(path.join(destination.relativePath, path.basename(source.relativePath)));
    const target = resolveFsPath(targetRelative);
    if (fs.existsSync(target.absolutePath)) {
      return res.status(400).json({ error: 'A file or folder with that name already exists in the destination' });
    }
    if (target.absolutePath.startsWith(`${source.absolutePath}${path.sep}`)) {
      return res.status(400).json({ error: 'Cannot paste a folder into itself' });
    }

    if (mode === 'move') {
      moveFsEntry(source.absolutePath, target.absolutePath);
    } else {
      copyFsEntry(source.absolutePath, target.absolutePath);
    }

    pushDebugEvent('info', `Filesystem entry ${mode}d`, {
      from: sourceRelative,
      to: targetRelative,
    }, true);
    res.json({ success: true, path: targetRelative });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to paste entry');
    pushDebugEvent('error', 'Filesystem paste failed', { error: message }, true);
    res.status(400).json({ error: message });
  }
};

// Health
app.get('/status', requireAuth, statusHandler);
app.get('/api/status', requireAuth, statusHandler);

// Services status
app.get('/services', requireAuth, servicesHandler);
app.get('/api/services', requireAuth, servicesHandler);

// Control services
app.post('/control', requireAuth, controlHandler);
app.post('/api/control', requireAuth, controlHandler);

// Monitoring
app.get('/monitor', requireAuth, monitorHandler);
app.get('/api/monitor', requireAuth, monitorHandler);

app.get('/dashboard', requireAuth, dashboardHandler);
app.get('/api/dashboard', requireAuth, dashboardHandler);

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
    pushDebugEvent('info', 'FTP favourite created', { id: favourite.id, name: favourite.name }, true);
    res.status(201).json({ favourite: serializeFtpFavourite(favourite) });
  } catch (err) {
    const error = String(err?.message || err || 'Unable to create FTP favourite');
    pushDebugEvent('error', 'FTP favourite creation failed', { error }, true);
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
    pushDebugEvent('info', 'FTP favourite updated', { id: favourite.id, name: favourite.name }, true);
    res.json({ favourite: serializeFtpFavourite(favourite) });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to update FTP favourite');
    const status = /not found/i.test(message) ? 404 : 400;
    pushDebugEvent('error', 'FTP favourite update failed', { error: message }, true);
    res.status(status).json({ error: message });
  }
};

const deleteFtpFavouriteHandler = async (req, res) => {
  try {
    const favourite = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });

    await unmountFtpFavourite(favourite).catch(() => {});
    appDb.deleteFtpFavourite(favourite.id);
    fs.rmSync(getFtpFavouriteRuntime(favourite).helperRequestPath, { force: true });

    pushDebugEvent('info', 'FTP favourite deleted', { id: favourite.id, name: favourite.name }, true);
    res.json({ success: true });
  } catch (err) {
    const message = String(err?.message || err || 'Unable to delete FTP favourite');
    const status = /not found/i.test(message) ? 404 : 400;
    pushDebugEvent('error', 'FTP favourite deletion failed', { error: message }, true);
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
      pushDebugEvent('error', 'FTP favourite mount failed', { id: favourite.id, name: favourite.name, error }, true);
      return res.status(500).json({ error, favourite: payload });
    }

    pushDebugEvent('info', 'FTP favourite mounted', { id: favourite.id, name: favourite.name, mountPoint: mount.mountPoint }, true);
    return res.json({ success: true, favourite: payload });
  } catch (err) {
    const error = String(err?.message || err || 'Unable to mount FTP favourite');
    pushDebugEvent('error', 'FTP favourite mount failed', { error, id: req.params.id }, true);
    return res.status(500).json({ error });
  }
};

const unmountFtpFavouriteHandler = async (req, res) => {
  try {
    const favourite = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });
    await unmountFtpFavourite(favourite);
    pushDebugEvent('info', 'FTP favourite unmounted', { id: favourite.id, name: favourite.name }, true);
    res.json({
      success: true,
      favourite: serializeFtpFavourite(getFtpFavouriteOrThrow(favourite.id, { includeSecrets: false })),
    });
  } catch (err) {
    const error = String(err?.message || err || 'Unable to unmount FTP favourite');
    pushDebugEvent('error', 'FTP favourite unmount failed', { error, id: req.params.id }, true);
    res.status(500).json({ error });
  }
};

const ftpListHandler = async (req, res) => {
  try {
    const payload = await listFtpDirectory(req.body || {});
    pushDebugEvent('info', 'FTP directory listed', { host: payload.connection.host, path: payload.path, count: payload.entries.length });
    res.json(payload);
  } catch (err) {
    const error = String(err?.message || err || 'FTP list failed');
    pushDebugEvent('error', 'FTP list failed', { error }, true);
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
        pushDebugEvent('info', 'FTP directory downloaded', { host: access.host, remotePath, localPath, fileCount }, true);
        return;
      }

      await client.downloadTo(localPath, remotePath);
      pushDebugEvent('info', 'FTP file downloaded', { host: access.host, remotePath, localPath }, true);
    });

    res.json({
      success: true,
      entryType: recursive || entryType === 'directory' ? 'directory' : 'file',
      remotePath,
      localPath,
    });
  } catch (err) {
    const error = String(err?.message || err || 'FTP download failed');
    pushDebugEvent('error', 'FTP download failed', { error }, true);
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
      pushDebugEvent('info', 'FTP file uploaded', { host: access.host, remotePath, localPath: localResolved }, true);
    });

    res.json({
      success: true,
      localPath: localResolved,
      remotePath,
    });
  } catch (err) {
    const error = String(err?.message || err || 'FTP upload failed');
    pushDebugEvent('error', 'FTP upload failed', { error }, true);
    res.status(500).json({ error });
  }
};

const ftpMkdirHandler = async (req, res) => {
  try {
    const resolvedPayload = resolveFtpFavouritePayload(req.body || {});
    const remotePath = normalizeRemotePath(req.body?.remotePath || '/');

    await withFtpClient(resolvedPayload, async (client, access) => {
      await client.ensureDir(remotePath);
      pushDebugEvent('info', 'FTP directory created', { host: access.host, remotePath }, true);
    });

    res.json({ success: true, remotePath });
  } catch (err) {
    const error = String(err?.message || err || 'FTP mkdir failed');
    pushDebugEvent('error', 'FTP mkdir failed', { error }, true);
    res.status(500).json({ error });
  }
};

app.get('/connections', requireAuth, connectionsHandler);
app.get('/api/connections', requireAuth, connectionsHandler);
app.get('/storage', requireAuth, storageHandler);
app.get('/api/storage', requireAuth, storageHandler);
app.get('/logs', requireAuth, logsHandler);
app.get('/api/logs', requireAuth, logsHandler);
app.get('/logging', requireAuth, loggingGetHandler);
app.get('/api/logging', requireAuth, loggingGetHandler);
app.post('/logging', requireAuth, loggingPostHandler);
app.post('/api/logging', requireAuth, loggingPostHandler);
app.get('/drives', requireAuth, drivesHandler);
app.get('/api/drives', requireAuth, drivesHandler);
app.post('/drives/check', requireAuth, drivesCheckHandler);
app.post('/api/drives/check', requireAuth, drivesCheckHandler);
app.get('/fs/list', requireAuth, filesystemListHandler);
app.get('/api/fs/list', requireAuth, filesystemListHandler);
app.post('/fs/mkdir', requireAuth, filesystemMkdirHandler);
app.post('/api/fs/mkdir', requireAuth, filesystemMkdirHandler);
app.post('/fs/rename', requireAuth, filesystemRenameHandler);
app.post('/api/fs/rename', requireAuth, filesystemRenameHandler);
app.post('/fs/delete', requireAuth, filesystemDeleteHandler);
app.post('/api/fs/delete', requireAuth, filesystemDeleteHandler);
app.get('/fs/download', requireAuth, filesystemDownloadHandler);
app.get('/api/fs/download', requireAuth, filesystemDownloadHandler);
app.post('/fs/upload', requireAuth, express.raw({ type: '*/*', limit: '128mb' }), filesystemUploadHandler);
app.post('/api/fs/upload', requireAuth, express.raw({ type: '*/*', limit: '128mb' }), filesystemUploadHandler);
app.post('/fs/paste', requireAuth, filesystemPasteHandler);
app.post('/api/fs/paste', requireAuth, filesystemPasteHandler);
app.get('/ftp/defaults', requireAuth, ftpDefaultsHandler);
app.get('/api/ftp/defaults', requireAuth, ftpDefaultsHandler);
app.get('/ftp/favourites', requireAuth, ftpFavouritesHandler);
app.get('/api/ftp/favourites', requireAuth, ftpFavouritesHandler);
app.post('/ftp/favourites', requireAuth, createFtpFavouriteHandler);
app.post('/api/ftp/favourites', requireAuth, createFtpFavouriteHandler);
app.put('/ftp/favourites/:id', requireAuth, updateFtpFavouriteHandler);
app.put('/api/ftp/favourites/:id', requireAuth, updateFtpFavouriteHandler);
app.delete('/ftp/favourites/:id', requireAuth, deleteFtpFavouriteHandler);
app.delete('/api/ftp/favourites/:id', requireAuth, deleteFtpFavouriteHandler);
app.post('/ftp/favourites/:id/mount', requireAuth, mountFtpFavouriteHandler);
app.post('/api/ftp/favourites/:id/mount', requireAuth, mountFtpFavouriteHandler);
app.post('/ftp/favourites/:id/unmount', requireAuth, unmountFtpFavouriteHandler);
app.post('/api/ftp/favourites/:id/unmount', requireAuth, unmountFtpFavouriteHandler);
app.post('/ftp/list', requireAuth, ftpListHandler);
app.post('/api/ftp/list', requireAuth, ftpListHandler);
app.post('/ftp/download', requireAuth, ftpDownloadHandler);
app.post('/api/ftp/download', requireAuth, ftpDownloadHandler);
app.post('/ftp/upload', requireAuth, ftpUploadHandler);
app.post('/api/ftp/upload', requireAuth, ftpUploadHandler);
app.post('/ftp/mkdir', requireAuth, ftpMkdirHandler);
app.post('/api/ftp/mkdir', requireAuth, ftpMkdirHandler);

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
