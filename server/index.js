require('dotenv').config();
// Bot guidance:
// - Keep API response shapes stable for dashboard/app/page.tsx.
// - Keep SERVICE commands aligned with start.sh and start-wsl.sh.
// - Do not expose nginx in CONTROLLED_SERVICE_NAMES (prevents dashboard lockout).

const express = require('express');
const cors = require('cors');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const net = require('net');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = Number(process.env.PORT || 4000);
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || 'admin123';
// Bot note: keep admin control password separate from login when deploying publicly.
const ADMIN_ACTION_PASSWORD = process.env.ADMIN_ACTION_PASSWORD || DASHBOARD_PASS;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
const TOKEN_TTL = process.env.TOKEN_TTL || '12h';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const ROOT_DIR = path.resolve(__dirname, '..');
const HOME_DIR = process.env.HOME || '/home/admin';
const FILEBROWSER_ROOT = process.env.FILEBROWSER_ROOT || HOME_DIR;
const FTP_ROOT = process.env.FTP_ROOT || FILEBROWSER_ROOT;
// Termux does not guarantee /bin/bash; use current shell if available.
const EXEC_SHELL = process.env.SHELL || '/bin/bash';
const IS_WSL = Boolean(process.env.WSL_DISTRO_NAME);
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'hs_jwt';
const FRONTEND_TOKEN_COOKIE = process.env.FRONTEND_TOKEN_COOKIE || 'dashboard_token';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '';
const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'lax';

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'change-this-in-production') {
  throw new Error('JWT_SECRET must be set in production');
}
if (process.env.NODE_ENV === 'production' && DASHBOARD_PASS === 'admin123') {
  throw new Error('DASHBOARD_PASS must be changed in production');
}

if (CORS_ORIGIN === '*') {
  app.use(cors());
} else {
  const allowList = CORS_ORIGIN.split(',').map((item) => item.trim()).filter(Boolean);
  app.use(cors({ origin: allowList }));
}
app.use(express.json({ limit: '256kb' }));

const authError = { error: 'Unauthorized' };

const secureCompare = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const parseCookieHeader = (cookieHeader = '') => {
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value || '');
  }
  return out;
};

const readBearerToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
};

const readCookieToken = (req) => {
  const cookies = parseCookieHeader(req.headers.cookie || '');
  return cookies[AUTH_COOKIE_NAME] || cookies[FRONTEND_TOKEN_COOKIE] || null;
};

const readToken = (req) => readBearerToken(req) || readCookieToken(req);

const verifyToken = (token) => jwt.verify(token, JWT_SECRET);

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

/* ---------------- CONFIG ---------------- */

const SERVICES = {
  nginx: {
    start: `mkdir -p "${ROOT_DIR}/logs" && nginx -p "${ROOT_DIR}" -c "${ROOT_DIR}/nginx.conf"`,
    stop: `nginx -p "${ROOT_DIR}" -c "${ROOT_DIR}/nginx.conf" -s quit || pkill -f "nginx: master process" || true`,
    restart: `nginx -p "${ROOT_DIR}" -c "${ROOT_DIR}/nginx.conf" -s quit || true; mkdir -p "${ROOT_DIR}/logs" && nginx -p "${ROOT_DIR}" -c "${ROOT_DIR}/nginx.conf"`,
    check: 'pgrep nginx',
    port: 8088,
    binary: 'nginx',
  },
  filebrowser: {
    start: `filebrowser config set -d "${ROOT_DIR}/filebrowser.db" --auth.method=noauth >/dev/null 2>&1 || true; filebrowser -d "${ROOT_DIR}/filebrowser.db" -r "${FILEBROWSER_ROOT}" -p 8080 -a 127.0.0.1 -b /files --noauth`,
    stop: `pkill -f "filebrowser -d ${ROOT_DIR}/filebrowser.db" || pkill filebrowser || true`,
    restart: `pkill -f "filebrowser -d ${ROOT_DIR}/filebrowser.db" || pkill filebrowser || true; filebrowser config set -d "${ROOT_DIR}/filebrowser.db" --auth.method=noauth >/dev/null 2>&1 || true; filebrowser -d "${ROOT_DIR}/filebrowser.db" -r "${FILEBROWSER_ROOT}" -p 8080 -a 127.0.0.1 -b /files --noauth`,
    check: 'pgrep filebrowser',
    port: 8080,
    binary: 'filebrowser',
  },
  ttyd: {
    start: 'ttyd -W -i 127.0.0.1 -p 7681 bash -l',
    stop: 'pkill -f "ttyd -p 7681" || pkill ttyd || true',
    restart: 'pkill -f "ttyd -p 7681" || pkill ttyd || true; ttyd -W -i 127.0.0.1 -p 7681 bash -l',
    check: 'pgrep ttyd',
    port: 7681,
    binary: 'ttyd',
  },
  sshd: {
    start: 'sshd',
    stop: 'pkill sshd || true',
    restart: 'pkill sshd || true; sshd',
    check: 'pgrep sshd',
    port: 8022,
    binary: 'sshd',
  },
  ftp: {
    start: `if command -v python3 >/dev/null 2>&1 && python3 -c "import pyftpdlib" >/dev/null 2>&1; then python3 -m pyftpdlib -p 2121 -w -d "${FTP_ROOT}"; elif command -v busybox >/dev/null 2>&1; then busybox tcpsvd -vE 0.0.0.0 2121 busybox ftpd -w "${FTP_ROOT}"; else echo "No supported FTP server found (install pyftpdlib or busybox)"; exit 1; fi`,
    stop: 'pkill -f "pyftpdlib -p 2121" || pkill -f "tcpsvd -vE 0.0.0.0 2121" || true',
    restart: `pkill -f "pyftpdlib -p 2121" || pkill -f "tcpsvd -vE 0.0.0.0 2121" || true; if command -v python3 >/dev/null 2>&1 && python3 -c "import pyftpdlib" >/dev/null 2>&1; then python3 -m pyftpdlib -p 2121 -w -d "${FTP_ROOT}"; elif command -v busybox >/dev/null 2>&1; then busybox tcpsvd -vE 0.0.0.0 2121 busybox ftpd -w "${FTP_ROOT}"; else echo "No supported FTP server found (install pyftpdlib or busybox)"; exit 1; fi`,
    check: 'pgrep -f "pyftpdlib -p 2121|tcpsvd -vE 0.0.0.0 2121"',
    port: 2121,
    binary: 'python3',
  },
};
const CONTROLLED_SERVICE_NAMES = Object.keys(SERVICES).filter((name) => name !== 'nginx');
const STORAGE_TYPES = new Set(['ext2', 'ext3', 'ext4', 'f2fs', 'xfs', 'btrfs', 'ntfs', 'exfat', 'vfat', 'drvfs']);

/* ---------------- HELPERS ---------------- */

const debugEvents = [];
const MAX_DEBUG_EVENTS = 300;
let cpuSnapshot = null;
let verboseLoggingEnabled = false;
const serviceStateCache = {};

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
  const counts = recent.reduce((acc, e) => {
    acc[e.level] = (acc[e.level] || 0) + 1;
    return acc;
  }, {});
  const summary = `info=${counts.info || 0}, warn=${counts.warn || 0}, error=${counts.error || 0}`;
  return `### Debug Summary\n- entries: ${recent.length}\n- ${summary}\n\n\`\`\`log\n${lines.join('\n')}\n\`\`\``;
};

const readCpuSnapshot = () => {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }

  return { idle, total };
};

const readCpuUsage = () => {
  const current = readCpuSnapshot();
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isPortOpen = (port, host = '127.0.0.1', timeoutMs = 1200) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (open) => {
      if (done) return;
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

const classifyServiceState = (running) => (running ? 'working' : 'stalled');

const pollServiceStateTransitions = async () => {
  if (!verboseLoggingEnabled) return;

  for (const [name, svc] of Object.entries(SERVICES)) {
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
  const maxAge = tokenMaxAgeMs(token);
  const options = buildCookieOptions();
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
  res.json({
    user: {
      username: req.user?.sub || DASHBOARD_USER,
      role: req.user?.role || 'admin',
    },
  });
};

const verifyHandler = (req, res) => {
  return res.status(204).end();
};

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
const statusHandler = (req, res) => {
  res.json({
    uptime: `${(os.uptime() / 3600).toFixed(1)} hrs`,
  });
};

app.get('/status', requireAuth, statusHandler);
app.get('/api/status', requireAuth, statusHandler);

// Services status
const servicesHandler = async (req, res) => {
  const result = {};

  for (const name of CONTROLLED_SERVICE_NAMES) {
    const svc = SERVICES[name];
    result[name] = await checkService(svc);
  }

  res.json(result);
  pushDebugEvent('info', 'Services snapshot served', { count: Object.keys(result).length });
};

app.get('/services', requireAuth, servicesHandler);
app.get('/api/services', requireAuth, servicesHandler);

// Control services
const controlHandler = async (req, res) => {
  const { service, action, adminPassword } = req.body || {};

  if (!CONTROLLED_SERVICE_NAMES.includes(service)) {
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
      let exists = await commandExists(svc.binary);
      if (service === 'ftp' && !exists) {
        exists = await commandExists('busybox');
      }
      if (!exists) {
        const msg = `Command '${svc.binary}' is not installed`;
        pushDebugEvent('error', `${service} ${action} failed`, { error: msg }, true);
        return res.status(500).json({ error: msg });
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
};

app.post('/control', requireAuth, controlHandler);
app.post('/api/control', requireAuth, controlHandler);

// Monitoring
const monitorHandler = (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuPercent = readCpuUsage();

  res.json({
    cpuLoad: cpuPercent,
    totalMem,
    freeMem,
    usedMem: totalMem - freeMem,
    uptime: os.uptime(),
  });
  pushDebugEvent('info', 'Monitor snapshot served', { cpuLoad: Number(cpuPercent.toFixed(2)) });
};

app.get('/monitor', requireAuth, monitorHandler);
app.get('/api/monitor', requireAuth, monitorHandler);

const connectionsHandler = async (req, res) => {
  try {
    const raw = await runCommand('ss -tn state established || true');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('Recv-Q'));

    const seen = new Set();
    const rows = [];

    for (const line of lines) {
      const cols = line.split(/\s+/);
      const local = cols[3] || '';
      const peer = cols[4] || '';
      const ip = peer.includes(':') ? peer.slice(0, peer.lastIndexOf(':')) : peer;
      const port = peer.includes(':') ? peer.slice(peer.lastIndexOf(':') + 1) : '';
      const key = `${ip}:${port}`;
      if (!ip || seen.has(key)) continue;
      seen.add(key);

      rows.push({
        username: ip === '127.0.0.1' || ip === '::1' ? 'local-user' : 'remote-user',
        ip,
        port,
        protocol: local.includes(':4000') ? 'API' : local.includes(':3000') ? 'Dashboard' : 'Gateway',
        status: 'connected',
        lastSeen: new Date().toISOString(),
      });
    }

    res.json({ users: rows.slice(0, 50) });
    pushDebugEvent('info', 'Connections snapshot served', { count: rows.length });
  } catch (err) {
    res.status(500).json({ error: String(err), users: [] });
  }
};

app.get('/connections', requireAuth, connectionsHandler);
app.get('/api/connections', requireAuth, connectionsHandler);

const storageHandler = async (req, res) => {
  try {
    const output = await runCommand('df -B1 -T -x tmpfs -x devtmpfs');
    const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
    const mounts = [];

    for (const line of lines.slice(1)) {
      const parts = line.split(/\s+/);
      if (parts.length < 7) continue;
      const fsType = parts[1];
      const mountPoint = parts[6];
      const isCandidateMount =
        mountPoint === '/' ||
        mountPoint.startsWith('/home') ||
        mountPoint.startsWith('/mnt') ||
        mountPoint.startsWith('/storage') ||
        mountPoint.includes('wsl');

      if (!STORAGE_TYPES.has(fsType) || !isCandidateMount) {
        continue;
      }

      const category = (IS_WSL && (fsType === 'drvfs' || mountPoint.startsWith('/mnt/')))
        ? 'wsl'
        : (mountPoint.startsWith('/mnt') || mountPoint.startsWith('/storage'))
          ? 'external'
          : 'internal';

      mounts.push({
        filesystem: parts[0],
        fsType,
        size: Number(parts[2]) || 0,
        used: Number(parts[3]) || 0,
        available: Number(parts[4]) || 0,
        usePercent: Number(String(parts[5]).replace('%', '')) || 0,
        mount: mountPoint,
        category,
      });
    }

    const totalSize = mounts.reduce((sum, m) => sum + m.size, 0);
    const totalUsed = mounts.reduce((sum, m) => sum + m.used, 0);
    res.json({ mounts, summary: { totalSize, totalUsed } });
    pushDebugEvent('info', 'Storage snapshot served', { count: mounts.length });
  } catch (err) {
    res.status(500).json({ error: String(err), mounts: [], summary: { totalSize: 0, totalUsed: 0 } });
  }
};

app.get('/storage', requireAuth, storageHandler);
app.get('/api/storage', requireAuth, storageHandler);

const logsHandler = (req, res) => {
  res.json({
    logs: debugEvents.slice(-120).reverse(),
    markdown: buildMarkdownLog(80),
    verboseLoggingEnabled,
  });
};

app.get('/logs', requireAuth, logsHandler);
app.get('/api/logs', requireAuth, logsHandler);

const loggingHandler = (req, res) => {
  verboseLoggingEnabled = Boolean(req.body?.enabled);
  pushDebugEvent('info', verboseLoggingEnabled ? 'Verbose logging enabled' : 'Verbose logging disabled', null, true);
  res.json({ success: true, verboseLoggingEnabled, markdown: buildMarkdownLog(80) });
};

app.get('/logging', requireAuth, (req, res) => {
  res.json({ verboseLoggingEnabled, markdown: buildMarkdownLog(80) });
});
app.get('/api/logging', requireAuth, (req, res) => {
  res.json({ verboseLoggingEnabled, markdown: buildMarkdownLog(80) });
});
app.post('/logging', requireAuth, loggingHandler);
app.post('/api/logging', requireAuth, loggingHandler);

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

// Ensure JSON parse and unexpected server errors are always JSON responses.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON request body' });
  }

  if (err) {
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }

  return next();
});
