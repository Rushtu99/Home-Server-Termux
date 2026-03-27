const express = require('express');
const cors = require('cors');
const os = require('os');
const { exec } = require('child_process');

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
  },
  filebrowser: {
    start: 'filebrowser -d ~/filebrowser.db -r ~/nas -p 8080 -a 0.0.0.0',
    stop: 'pkill filebrowser',
    restart: 'pkill filebrowser && filebrowser -d ~/filebrowser.db -r ~/nas -p 8080 -a 0.0.0.0',
    check: 'pgrep filebrowser',
  },
  ttyd: {
    start: 'ttyd -p 7681 bash -l',
    stop: 'pkill ttyd',
    restart: 'pkill ttyd && ttyd -p 7681 bash -l',
    check: 'pgrep ttyd',
  },
  sshd: {
    start: 'sshd',
    stop: 'pkill sshd',
    restart: 'pkill sshd && sshd',
    check: 'pgrep sshd',
  },
};

/* ---------------- HELPERS ---------------- */

const runCommand = (cmd) =>
  new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(stderr);
      resolve(stdout);
    });
  });

const checkService = async (cmd) => {
  try {
    await runCommand(cmd);
    return true;
  } catch {
    return false;
  }
};

/* ---------------- ROUTES ---------------- */

// Health
app.get('/api/status', (req, res) => {
  res.json({
    uptime: `${(os.uptime() / 3600).toFixed(1)} hrs`,
  });
});

// Services status
app.get('/api/services', async (req, res) => {
  const result = {};

  for (const [name, svc] of Object.entries(SERVICES)) {
    result[name] = await checkService(svc.check);
  }

  res.json(result);
});

// Control services
app.post('/api/control', async (req, res) => {
  const { service, action } = req.body;

  if (!SERVICES[service]) {
    return res.status(400).json({ error: 'Unknown service' });
  }

  if (!SERVICES[service][action]) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  try {
    const output = await runCommand(SERVICES[service][action]);
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});

// Monitoring (FIXED CPU)
app.get('/api/monitor', (req, res) => {
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
});

/* ---------------- START ---------------- */

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
