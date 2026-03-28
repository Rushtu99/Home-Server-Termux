const express = require('express');
const cors = require('cors');
const os = require('os');
const { exec } = require('child_process');
const net = require('net');

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

/* ---------------- CONFIG ---------------- */

const SERVICES = {
  nginx: {
    start: 'nginx -c ~/home-server/nginx.conf',
    stop: 'pkill nginx',
    restart: 'pkill nginx && nginx -c ~/home-server/nginx.conf',
    check: 'pgrep nginx',
    port: 8088,
  },
  filebrowser: {
    start: 'filebrowser -d ~/filebrowser.db -r ~/nas -p 8080 -a 0.0.0.0',
    stop: 'pkill filebrowser',
    restart: 'pkill filebrowser && filebrowser -d ~/filebrowser.db -r ~/nas -p 8080 -a 0.0.0.0',
    check: 'pgrep filebrowser',
    port: 8080,
  },
  ttyd: {
    start: 'ttyd -p 7681 bash -l',
    stop: 'pkill ttyd',
    restart: 'pkill ttyd && ttyd -p 7681 bash -l',
    check: 'pgrep ttyd',
    port: 7681,
  },
  sshd: {
    start: 'sshd',
    stop: 'pkill sshd',
    restart: 'pkill sshd && sshd',
    check: 'pgrep sshd',
    port: 8022,
  },
};

/* ---------------- HELPERS ---------------- */

const runCommand = (cmd) =>
  new Promise((resolve, reject) => {
    exec(cmd, { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(stderr?.trim() || stdout?.trim() || err.message);
      }
      resolve(stdout?.trim() || '');
    });
  });

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

/* ---------------- ROUTES ---------------- */

// Health
const statusHandler = (req, res) => {
  res.json({
    uptime: `${(os.uptime() / 3600).toFixed(1)} hrs`,
  });
};

app.get('/status', statusHandler);
app.get('/api/status', statusHandler);

// Services status
const servicesHandler = async (req, res) => {
  const result = {};

  for (const [name, svc] of Object.entries(SERVICES)) {
    result[name] = await checkService(svc);
  }

  res.json(result);
};

app.get('/services', servicesHandler);
app.get('/api/services', servicesHandler);

// Control services
const controlHandler = async (req, res) => {
  const { service, action } = req.body;

  if (!SERVICES[service]) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  if (!SERVICES[service][action]) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  try {
    const svc = SERVICES[service];
    const output = await runCommand(svc[action]);

    const expectedRunning = action !== 'stop';
    const running = await waitForServiceState(svc, expectedRunning);

    res.json({
      success: running === expectedRunning,
      running,
      expectedRunning,
      output,
    });
  } catch (err) {
    res.status(500).json({ error: err });
  }
};

app.post('/control', controlHandler);
app.post('/api/control', controlHandler);

// Monitoring (FIXED CPU)
const monitorHandler = (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  const cpuLoadRaw = os.loadavg()[0];
  const cpuPercent = (cpuLoadRaw / os.cpus().length) * 100;

  res.json({
    cpuLoad: Math.min(cpuPercent, 100),
    totalMem,
    freeMem,
    usedMem: totalMem - freeMem,
    uptime: os.uptime(),
  });
};

app.get('/monitor', monitorHandler);
app.get('/api/monitor', monitorHandler);

/* ---------------- START ---------------- */

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
