const path = require('path');

const ensureDir = (fsImpl, targetPath) => {
  fsImpl.mkdirSync(targetPath, { recursive: true });
};

const safeJsonParse = (value, fallback) => {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
};

const readJsonFile = (fsImpl, filePath, fallback) => {
  try {
    if (!fsImpl.existsSync(filePath)) {
      return fallback;
    }
    return safeJsonParse(fsImpl.readFileSync(filePath, 'utf8'), fallback);
  } catch {
    return fallback;
  }
};

const writeJsonFile = (fsImpl, filePath, payload) => {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fsImpl.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fsImpl.renameSync(tmpPath, filePath);
};

const appendJsonLine = (fsImpl, filePath, payload) => {
  fsImpl.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
};

const createStateStore = ({
  fs,
  runtimeDir,
  now = () => Date.now(),
  files = {},
} = {}) => {
  if (!fs) {
    throw new Error('stateStore requires fs');
  }

  const baseDir = path.join(runtimeDir, 'control-plane');
  ensureDir(fs, baseDir);

  const workflowRunsFile = files.workflowRunsFile || path.join(baseDir, 'workflow-runs.json');
  const workflowEventsFile = files.workflowEventsFile || path.join(baseDir, 'workflow-events.jsonl');
  const serviceStateFile = files.serviceStateFile || path.join(baseDir, 'service-state.json');
  const clusterStateFile = files.clusterStateFile || path.join(baseDir, 'cluster-state.json');
  const metricsSnapshotFile = files.metricsSnapshotFile || path.join(baseDir, 'metrics-snapshot.json');
  const healthSnapshotFile = files.healthSnapshotFile || path.join(baseDir, 'health-snapshot.json');

  const nowIso = () => new Date(now()).toISOString();

  const getWorkflowRuns = () => {
    const payload = readJsonFile(fs, workflowRunsFile, { schemaVersion: 1, runs: [] });
    const runs = Array.isArray(payload?.runs) ? payload.runs : [];
    return runs.filter((entry) => entry && typeof entry === 'object');
  };

  const writeWorkflowRuns = (runs) => {
    writeJsonFile(fs, workflowRunsFile, {
      schemaVersion: 1,
      updatedAt: nowIso(),
      runs,
    });
  };

  const upsertWorkflowRun = (run) => {
    const runId = String(run?.id || '').trim();
    if (!runId) {
      throw new Error('workflow run id is required');
    }

    const runs = getWorkflowRuns();
    const index = runs.findIndex((entry) => String(entry.id || '') === runId);
    if (index >= 0) {
      runs[index] = { ...runs[index], ...run };
    } else {
      runs.push({ ...run });
    }
    writeWorkflowRuns(runs);
    return runs[index >= 0 ? index : runs.length - 1];
  };

  const getWorkflowRun = (runId) => {
    const target = String(runId || '').trim();
    if (!target) {
      return null;
    }
    return getWorkflowRuns().find((entry) => String(entry.id || '') === target) || null;
  };

  const listWorkflowRuns = ({ limit = 60 } = {}) => {
    const normalizedLimit = Math.min(500, Math.max(1, Number(limit) || 60));
    return getWorkflowRuns().slice(-normalizedLimit);
  };

  const listActiveWorkflows = () => getWorkflowRuns().filter((entry) => ['queued', 'running', 'blocked'].includes(String(entry.status || '')));

  const appendWorkflowEvent = (event) => {
    const payload = {
      ...event,
      loggedAt: nowIso(),
    };
    appendJsonLine(fs, workflowEventsFile, payload);
    return payload;
  };

  const listWorkflowEvents = ({ limit = 200, since = null } = {}) => {
    if (!fs.existsSync(workflowEventsFile)) {
      return [];
    }

    const raw = fs.readFileSync(workflowEventsFile, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const entries = [];
    const sinceMs = Number.isFinite(Number(since)) ? Number(since) : null;

    for (const line of lines) {
      const parsed = safeJsonParse(line, null);
      if (!parsed || typeof parsed !== 'object') {
        continue;
      }
      if (sinceMs !== null) {
        const eventTime = Date.parse(String(parsed.timestamp || parsed.loggedAt || ''));
        if (!Number.isFinite(eventTime) || eventTime < sinceMs) {
          continue;
        }
      }
      entries.push(parsed);
    }

    const normalizedLimit = Math.min(2000, Math.max(1, Number(limit) || 200));
    return entries.slice(-normalizedLimit);
  };

  const readServiceStateSnapshot = () => readJsonFile(fs, serviceStateFile, {
    schemaVersion: 1,
    generatedAt: null,
    services: [],
  });

  const writeServiceStateSnapshot = (snapshot) => {
    const payload = {
      schemaVersion: 1,
      generatedAt: nowIso(),
      ...snapshot,
    };
    writeJsonFile(fs, serviceStateFile, payload);
    return payload;
  };

  const readClusterStateSnapshot = () => readJsonFile(fs, clusterStateFile, {
    schemaVersion: 1,
    generatedAt: null,
    clusters: {},
  });

  const writeClusterStateSnapshot = (snapshot) => {
    const payload = {
      schemaVersion: 1,
      generatedAt: nowIso(),
      ...snapshot,
    };
    writeJsonFile(fs, clusterStateFile, payload);
    return payload;
  };

  const upsertClusterState = (name, state) => {
    const key = String(name || '').trim();
    if (!key) {
      throw new Error('cluster name is required');
    }

    const current = readClusterStateSnapshot();
    const clusters = current && typeof current.clusters === 'object' && current.clusters ? { ...current.clusters } : {};
    clusters[key] = {
      ...(clusters[key] || {}),
      ...(state && typeof state === 'object' ? state : {}),
      updatedAt: nowIso(),
    };

    return writeClusterStateSnapshot({
      clusters,
    });
  };

  const getClusterState = (name) => {
    const key = String(name || '').trim();
    if (!key) {
      return null;
    }
    const payload = readClusterStateSnapshot();
    return payload?.clusters?.[key] || null;
  };

  const listClusterStates = () => {
    const payload = readClusterStateSnapshot();
    const clusters = payload && payload.clusters && typeof payload.clusters === 'object' ? payload.clusters : {};
    return Object.entries(clusters).map(([name, state]) => ({
      name,
      ...(state && typeof state === 'object' ? state : {}),
    }));
  };

  const readMetricsSnapshot = () => readJsonFile(fs, metricsSnapshotFile, {
    schemaVersion: 1,
    generatedAt: null,
    metrics: {},
  });

  const writeMetricsSnapshot = (metrics) => {
    const payload = {
      schemaVersion: 1,
      generatedAt: nowIso(),
      metrics: metrics && typeof metrics === 'object' ? { ...metrics } : {},
    };
    writeJsonFile(fs, metricsSnapshotFile, payload);
    return payload;
  };

  const readHealthSnapshot = () => readJsonFile(fs, healthSnapshotFile, {
    schemaVersion: 1,
    generatedAt: null,
    services: {},
    summary: {
      down: 0,
      healthy: 0,
      recovering: 0,
      unknown: 0,
    },
  });

  const writeHealthSnapshot = (snapshot) => {
    const payload = {
      schemaVersion: 1,
      generatedAt: nowIso(),
      services: snapshot?.services && typeof snapshot.services === 'object' ? { ...snapshot.services } : {},
      summary: snapshot?.summary && typeof snapshot.summary === 'object'
        ? {
          down: Number(snapshot.summary.down || 0),
          healthy: Number(snapshot.summary.healthy || 0),
          recovering: Number(snapshot.summary.recovering || 0),
          unknown: Number(snapshot.summary.unknown || 0),
        }
        : {
          down: 0,
          healthy: 0,
          recovering: 0,
          unknown: 0,
        },
    };
    writeJsonFile(fs, healthSnapshotFile, payload);
    return payload;
  };

  const readOrchestratorState = () => ({
    activeWorkflows: listActiveWorkflows(),
    clusters: readClusterStateSnapshot(),
    health: readHealthSnapshot(),
    metrics: readMetricsSnapshot(),
    services: readServiceStateSnapshot(),
    workflows: {
      events: listWorkflowEvents({ limit: 300 }),
      runs: listWorkflowRuns({ limit: 300 }),
    },
    generatedAt: nowIso(),
  });

  return {
    appendWorkflowEvent,
    getClusterState,
    getWorkflowRun,
    listActiveWorkflows,
    listClusterStates,
    listWorkflowEvents,
    listWorkflowRuns,
    readClusterStateSnapshot,
    readHealthSnapshot,
    readMetricsSnapshot,
    readOrchestratorState,
    readServiceStateSnapshot,
    upsertClusterState,
    upsertWorkflowRun,
    writeClusterStateSnapshot,
    writeHealthSnapshot,
    writeMetricsSnapshot,
    writeServiceStateSnapshot,
  };
};

module.exports = {
  createStateStore,
};
