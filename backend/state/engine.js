const fs = require('fs');
const path = require('path');

const ensureDir = (target) => fs.mkdirSync(target, { recursive: true });
const readJson = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
};

const processIsAlive = (pid) => {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
};

const createStateEngine = ({ projectRoot } = {}) => {
  const root = projectRoot || path.resolve(__dirname, '../..');
  const serviceDir = path.join(root, 'state', 'services');
  const clusterDir = path.join(root, 'state', 'clusters');
  ensureDir(serviceDir);
  ensureDir(clusterDir);

  const serviceFile = (name) => path.join(serviceDir, `${String(name).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
  const clusterFile = (name) => path.join(clusterDir, `${String(name).replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);

  const updateService = (name, patch = {}) => {
    const now = new Date().toISOString();
    const current = readJson(serviceFile(name), { name, restartCount: 0 });
    const nextStatus = String(patch.status || patch.state || current.status || '');
    const wasRunning = current.running === true || current.status === 'running';
    const isRunning = patch.running === true || nextStatus === 'running';
    const startedAt = isRunning
      ? (wasRunning && current.startedAt ? current.startedAt : now)
      : (current.startedAt || null);
    const next = {
      ...current,
      ...patch,
      name,
      ...(isRunning ? { startedAt } : { stoppedAt: now }),
      ...(patch.lastAction === 'restart' ? { restartCount: Number(current.restartCount || 0) + 1 } : {}),
      ...(patch.health || patch.healthState || patch.healthResult ? { lastHealthCheck: now } : {}),
      updatedAt: now,
    };
    if (isRunning && next.startedAt) {
      const startedMs = Date.parse(next.startedAt);
      if (Number.isFinite(startedMs)) next.uptimeSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    }
    if (!isRunning) {
      next.uptimeSec = 0;
    }
    if (patch.pid !== undefined && patch.pid !== null && patch.pid !== '') {
      fs.writeFileSync(path.join(serviceDir, `${name}.pid`), `${patch.pid}\n`, 'utf8');
    } else if (patch.pid === null || patch.running === false || next.status === 'stopped') {
      fs.rmSync(path.join(serviceDir, `${name}.pid`), { force: true });
    }
    if (patch.status || patch.state) fs.writeFileSync(path.join(serviceDir, `${name}.status`), `${patch.status || patch.state}\n`, 'utf8');
    if (patch.health || patch.healthState) fs.writeFileSync(path.join(serviceDir, `${name}.health`), `${patch.health || patch.healthState}\n`, 'utf8');
    writeJson(serviceFile(name), next);
    return next;
  };

  const cleanupStalePid = (name) => {
    const pidFile = path.join(serviceDir, `${name}.pid`);
    if (!fs.existsSync(pidFile)) return { stale: false };
    const pid = fs.readFileSync(pidFile, 'utf8').trim();
    if (!pid || processIsAlive(pid)) return { pid, stale: false };
    fs.rmSync(pidFile, { force: true });
    const next = updateService(name, {
      pid: null,
      running: false,
      status: 'stopped',
      stalePid: pid,
    });
    return { pid, service: next, stale: true };
  };

  const updateCluster = (name, patch = {}) => {
    const current = readJson(clusterFile(name), { name });
    const next = {
      ...current,
      ...patch,
      name,
      updatedAt: new Date().toISOString(),
    };
    writeJson(clusterFile(name), next);
    return next;
  };

  return {
    clusterDir,
    cleanupStalePid,
    getCluster: (name) => readJson(clusterFile(name), null),
    getService: (name) => readJson(serviceFile(name), null),
    listClusters: () => fs.readdirSync(clusterDir).filter((entry) => entry.endsWith('.json')).map((entry) => readJson(path.join(clusterDir, entry), null)).filter(Boolean),
    listServices: () => fs.readdirSync(serviceDir).filter((entry) => entry.endsWith('.json')).map((entry) => readJson(path.join(serviceDir, entry), null)).filter(Boolean),
    serviceDir,
    updateCluster,
    updateService,
  };
};

module.exports = {
  createStateEngine,
};
