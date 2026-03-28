const fs = require('fs');
const path = require('path');
const { loadEnvFile } = require('node:process');
const express = require('express');
const cors = require('cors');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const net = require('net');
const jwt = require('jsonwebtoken');

const ENV_FILE = path.resolve(__dirname, '.env');
if (typeof loadEnvFile === 'function' && fs.existsSync(ENV_FILE)) {
  loadEnvFile(ENV_FILE);
}

const app = express();
app.set('trust proxy', 'loopback');
const ROOT_DIR = path.resolve(__dirname, '..');
const HOME_DIR = process.env.HOME || '/data/data/com.termux/files/home';
const FILEBROWSER_ROOT = process.env.FILEBROWSER_ROOT || path.join(HOME_DIR, 'nas');
const FTP_ROOT = process.env.FTP_ROOT || FILEBROWSER_ROOT;
const RUNTIME_DIR = process.env.RUNTIME_DIR || path.join(ROOT_DIR, 'runtime');
const FILEBROWSER_DB = process.env.FILEBROWSER_DB_PATH || path.join(RUNTIME_DIR, 'filebrowser.db');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PORT = Number(process.env.PORT || 4000);
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || 'admin123';
const ADMIN_ACTION_PASSWORD = process.env.ADMIN_ACTION_PASSWORD || DASHBOARD_PASS;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const TOKEN_TTL = process.env.TOKEN_TTL || '12h';
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'hs_jwt';
const FRONTEND_TOKEN_COOKIE = process.env.FRONTEND_TOKEN_COOKIE || 'dashboard_token';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '';
const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'lax';
const EXEC_SHELL = process.env.SHELL || '/bin/sh';
const STORAGE_FS_TYPES = new Set(['ext2', 'ext3', 'ext4', 'f2fs', 'xfs', 'btrfs', 'ntfs', 'exfat', 'vfat', 'fuse']);
const CONNECTION_TTL_MS = 10 * 60 * 1000;
const MAX_CONNECTIONS = 50;

if (CORS_ORIGIN === '*') {
  app.use(cors());
} else {
  const allowList = CORS_ORIGIN
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  app.use(cors({ origin: allowList }));
}
app.use(express.json({ limit: '256kb' }));

const authError = { error: 'Unauthorized' };

/* ---------------- CONFIG ---------------- */

const SERVICES = {
  nginx: {
    start: `mkdir -p "${ROOT_DIR}/logs" && nginx -p "${ROOT_DIR}" -c "${ROOT_DIR}/nginx.conf"`,
    stop: 'pkill nginx 2>/dev/null || true',
    restart: `pkill nginx 2>/dev/null || true; mkdir -p "${ROOT_DIR}/logs" && nginx -p "${ROOT_DIR}" -c "${ROOT_DIR}/nginx.conf"`,
    check: 'pgrep nginx',
    port: 8088,
    binary: 'nginx',
  },
  filebrowser: {
    start: `mkdir -p "${RUNTIME_DIR}" "${ROOT_DIR}/logs" && filebrowser config set -d "${FILEBROWSER_DB}" --auth.method=noauth >/dev/null 2>&1 || true; filebrowser -d "${FILEBROWSER_DB}" -r "${FILEBROWSER_ROOT}" -p 8080 -a 127.0.0.1 -b /files --noauth > "${ROOT_DIR}/logs/filebrowser.log" 2>&1 &`,
    stop: 'pkill filebrowser 2>/dev/null || true',
    restart: `pkill filebrowser 2>/dev/null || true; mkdir -p "${RUNTIME_DIR}" "${ROOT_DIR}/logs" && filebrowser config set -d "${FILEBROWSER_DB}" --auth.method=noauth >/dev/null 2>&1 || true; filebrowser -d "${FILEBROWSER_DB}" -r "${FILEBROWSER_ROOT}" -p 8080 -a 127.0.0.1 -b /files --noauth > "${ROOT_DIR}/logs/filebrowser.log" 2>&1 &`,
    check: 'pgrep filebrowser',
    port: 8080,
    binary: 'filebrowser',
  },
  ttyd: {
    start: `mkdir -p "${ROOT_DIR}/logs" && ttyd -W -i 127.0.0.1 -p 7681 bash -l > "${ROOT_DIR}/logs/ttyd.log" 2>&1 &`,
    stop: 'pkill ttyd 2>/dev/null || true',
    restart: `pkill ttyd 2>/dev/null || true; mkdir -p "${ROOT_DIR}/logs" && ttyd -W -i 127.0.0.1 -p 7681 bash -l > "${ROOT_DIR}/logs/ttyd.log" 2>&1 &`,
    check: 'pgrep ttyd',
    port: 7681,
    binary: 'ttyd',
  },
  sshd: {
    start: 'sshd',
    stop: 'pkill sshd 2>/dev/null || true',
    restart: 'pkill sshd 2>/dev/null || true; sshd',
    check: 'pgrep sshd',
    port: 8022,
    binary: 'sshd',
  },
  ftp: {
    start: `mkdir -p "${ROOT_DIR}/logs" && if command -v python3 >/dev/null 2>&1 && python3 -c "import pyftpdlib" >/dev/null 2>&1; then python3 -m pyftpdlib -p 2121 -w -d "${FTP_ROOT}" > "${ROOT_DIR}/logs/ftp.log" 2>&1 & elif command -v busybox >/dev/null 2>&1; then busybox tcpsvd -vE 0.0.0.0 2121 busybox ftpd -w "${FTP_ROOT}" > "${ROOT_DIR}/logs/ftp.log" 2>&1 & else echo "No supported FTP server found (install pyftpdlib or busybox)"; exit 1; fi`,
    stop: 'pkill -f "pyftpdlib -p 2121" 2>/dev/null || pkill -f "tcpsvd -vE 0.0.0.0 2121" 2>/dev/null || true',
    restart: `pkill -f "pyftpdlib -p 2121" 2>/dev/null || pkill -f "tcpsvd -vE 0.0.0.0 2121" 2>/dev/null || true; mkdir -p "${ROOT_DIR}/logs" && if command -v python3 >/dev/null 2>&1 && python3 -c "import pyftpdlib" >/dev/null 2>&1; then python3 -m pyftpdlib -p 2121 -w -d "${FTP_ROOT}" > "${ROOT_DIR}/logs/ftp.log" 2>&1 & elif command -v busybox >/dev/null 2>&1; then busybox tcpsvd -vE 0.0.0.0 2121 busybox ftpd -w "${FTP_ROOT}" > "${ROOT_DIR}/logs/ftp.log" 2>&1 & else echo "No supported FTP server found (install pyftpdlib or busybox)"; exit 1; fi`,
    check: 'pgrep -f "pyftpdlib -p 2121|tcpsvd -vE 0.0.0.0 2121"',
    port: 2121,
    binary: 'python3',
  },
};

/* ---------------- HELPERS ---------------- */

const debugEvents = [];
const recentConnections = new Map();
const MAX_DEBUG_EVENTS = 300;
let cpuSnapshot = null;
let verboseLoggingEnabled = false;
const serviceStateCache = {};
let ftpProviderCache = {
  checkedAt: 0,
  provider: null,
};

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

  return isPortOpen(svc.port);
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
  return cookies[AUTH_COOKIE_NAME] || cookies[FRONTEND_TOKEN_COOKIE] || null;
};

const readToken = (req) => readBearerToken(req) || readCookieToken(req);

const verifyToken = (token) => jwt.verify(token, JWT_SECRET);

const normalizeIp = (ip = '') => String(ip).replace(/^::ffff:/, '');

const protocolFromRequest = (req) => {
  const originalUri = String(req.headers['x-original-uri'] || '');

  if (originalUri.startsWith('/files/')) {
    return 'Filesystem';
  }

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
      const decoded = verifyToken(token);
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

const requireAuth = (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json(authError);
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json(authError);
  }
};

app.use((req, res, next) => {
  rememberConnection(req);
  next();
});

const issueToken = () => jwt.sign(
  { sub: DASHBOARD_USER, role: 'admin' },
  JWT_SECRET,
  { expiresIn: TOKEN_TTL }
);

const buildCookieOptions = () => {
  const options = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAME_SITE,
    path: '/',
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

const setAuthCookie = (res, token) => {
  const options = buildCookieOptions();
  const maxAge = tokenMaxAgeMs(token);
  if (maxAge) {
    options.maxAge = maxAge;
  }
  res.cookie(AUTH_COOKIE_NAME, token, options);
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, buildCookieOptions());
};

/* ---------------- ROUTES ---------------- */

const loginHandler = (req, res) => {
  const { username, password } = req.body || {};
  const validUser = secureCompare(username || '', DASHBOARD_USER);
  const validPass = secureCompare(password || '', DASHBOARD_PASS);

  if (!validUser || !validPass) {
    const usernameHint = (username || '(empty)').slice(0, 2);
    pushDebugEvent('warn', 'Dashboard login failed', { usernameHint: `${usernameHint}***` }, true);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = issueToken();
  setAuthCookie(res, token);

  pushDebugEvent('info', 'Dashboard login success', { username: DASHBOARD_USER }, true);
  return res.json({
    token,
    tokenType: 'Bearer',
    expiresIn: TOKEN_TTL,
    cookieName: AUTH_COOKIE_NAME,
    user: { username: DASHBOARD_USER },
  });
};

const meHandler = (req, res) => {
  return res.json({
    user: {
      username: req.user?.sub || DASHBOARD_USER,
      role: req.user?.role || 'admin',
    },
  });
};

const verifyHandler = (req, res) => res.status(204).end();

const logoutHandler = (req, res) => {
  clearAuthCookie(res);
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

// Health
app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    uptime: `${(os.uptime() / 3600).toFixed(1)} hrs`,
  });
});

// Services status
app.get('/api/services', requireAuth, async (req, res) => {
  const result = {};
  const controlledServiceNames = await getControlledServiceNames();

  for (const name of controlledServiceNames) {
    const svc = SERVICES[name];
    result[name] = await checkService(svc);
  }

  pushDebugEvent('info', 'Services snapshot served', { count: Object.keys(result).length });
  res.json(result);
});

// Control services
app.post('/api/control', requireAuth, async (req, res) => {
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
});

// Monitoring (FIXED CPU)
app.get('/api/monitor', requireAuth, async (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuPercent = await readCpuUsage();

  res.json({
    cpuLoad: cpuPercent,
    totalMem,
    freeMem,
    usedMem: totalMem - freeMem,
    uptime: os.uptime(),
  });
  pushDebugEvent('info', 'Monitor snapshot served', { cpuLoad: Number(cpuPercent.toFixed(2)) });
});

const connectionsHandler = (req, res) => {
  pruneRecentConnections();

  const users = [...recentConnections.values()]
    .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
    .slice(0, MAX_CONNECTIONS)
    .map(({ lastSeenMs, ...entry }) => entry);

  pushDebugEvent('info', 'Connections snapshot served', { count: users.length });
  res.json({ users });
};

const storageHandler = async (req, res) => {
  try {
    const payload = await parseStorageInventory();
    pushDebugEvent('info', 'Storage snapshot served', { count: payload.mounts.length });
    res.json(payload);
  } catch (err) {
    pushDebugEvent('error', 'Storage snapshot failed', { error: String(err) }, true);
    res.status(500).json({ error: String(err), mounts: [], summary: { totalSize: 0, totalUsed: 0 } });
  }
};

const logsHandler = (req, res) => {
  res.json({
    logs: debugEvents.slice(-120).reverse(),
    markdown: buildMarkdownLog(80),
    verboseLoggingEnabled,
  });
};

const loggingGetHandler = (req, res) => {
  res.json({
    verboseLoggingEnabled,
    markdown: buildMarkdownLog(80),
  });
};

const loggingPostHandler = (req, res) => {
  verboseLoggingEnabled = Boolean(req.body?.enabled);
  pushDebugEvent('info', verboseLoggingEnabled ? 'Verbose logging enabled' : 'Verbose logging disabled', null, true);
  res.json({
    success: true,
    verboseLoggingEnabled,
    markdown: buildMarkdownLog(80),
  });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  pushDebugEvent('info', 'Backend loaded', { port: PORT }, true);
});

setInterval(() => {
  pollServiceStateTransitions().catch((err) => {
    pushDebugEvent('error', 'Service state polling failed', { error: String(err) }, true);
  });
}, 10000);
