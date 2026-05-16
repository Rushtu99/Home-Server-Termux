const { buildServiceStateSnapshot } = require('./health-manager');
const { buildCatalogEntries, GROUP_ORDER } = require('./service-catalog');
const { loadClusterConfig } = require('./cluster-config');
const { createClusterManager } = require('./cluster-manager');
const { createEventBus } = require('./event-bus');
const { createHealthManager } = require('./health-manager');
const { createServiceManager } = require('./service-manager');
const { createStateStore } = require('./state-store');
const { createWorkflowEngine } = require('./workflow-engine');

const DEFAULT_SERVICE_ALIASES = {
  'fs-worker': 'media-importer',
  'llama.cpp': 'llm',
  'mount-service': 'usb-mount-service',
};

const createControlPlane = ({
  fs,
  runtimeDir,
  projectRoot,
  services,
  workerCommands,
  getManageableServiceNames,
  resolveServiceInstall,
  readStorageProtectionState,
  getStorageBlockForService,
  runCommand,
  waitForServiceState,
  classifyServiceState,
  serviceStateCache,
  clearStorageResumeRequirementForService,
  optionalServiceNames,
  buildLegacyServiceCatalog,
  getLegacyServicesSnapshot,
  serviceStateTtlMs = 7000,
  getSystemMetricsSnapshot,
} = {}) => {
  const eventBus = createEventBus();
  const stateStore = createStateStore({
    fs,
    runtimeDir,
  });
  let serviceStateSnapshotInFlight = null;

  const serviceManager = createServiceManager({
    classifyServiceState,
    clearStorageResumeRequirementForService,
    eventBus,
    getManageableServiceNames,
    getStorageBlockForService,
    readStorageProtectionState,
    resolveServiceInstall,
    runCommand,
    serviceAliases: DEFAULT_SERVICE_ALIASES,
    serviceStateCache,
    services,
    waitForServiceState,
    workerCommands,
  });

  const clusterConfig = loadClusterConfig({ projectRoot });
  const clusterManager = createClusterManager({
    clusterConfig: clusterConfig.clusters,
    eventBus,
    serviceManager,
    stateStore,
  });

  const workflowEngine = createWorkflowEngine({
    eventBus,
    executeCommand: runCommand,
    stateStore,
  });

  const healthManager = createHealthManager({
    eventBus,
    serviceManager,
    stateStore,
  });

  const validateClustersPromise = clusterManager.validateClusterConfig().catch((error) => ({
    clusterCount: 0,
    missing: [String(error?.message || error || 'cluster validation failed')],
    valid: false,
  }));

  const buildCanonicalCatalog = async () => {
    const [legacyCatalog, manageableServiceNames] = await Promise.all([
      buildLegacyServiceCatalog(),
      serviceManager.listServiceNames(),
    ]);

    return buildCatalogEntries({
      manageableServiceNames,
      optionalServiceNames,
      serviceCatalog: legacyCatalog,
      serviceCommands: services,
      workerCommands,
    });
  };

  const snapshotServiceState = async () => {
    const [catalog, servicesSnapshot] = await Promise.all([
      buildCanonicalCatalog(),
      getLegacyServicesSnapshot(),
    ]);

    const snapshot = buildServiceStateSnapshot({
      catalog,
      services: servicesSnapshot,
    });

    return stateStore.writeServiceStateSnapshot(snapshot);
  };

  const getServiceStateSnapshot = async ({ force = false } = {}) => {
    const cached = stateStore.readServiceStateSnapshot();
    const generatedAtMs = Date.parse(String(cached?.generatedAt || ''));
    const ageMs = Number.isFinite(generatedAtMs) ? Math.max(0, Date.now() - generatedAtMs) : Number.POSITIVE_INFINITY;
    const ttlMs = Math.max(1000, Number(serviceStateTtlMs) || 7000);
    const isFresh = !force && Number.isFinite(generatedAtMs) && ageMs <= ttlMs;

    if (isFresh) {
      return {
        ...cached,
        ageMs,
        stale: false,
      };
    }

    if (!serviceStateSnapshotInFlight) {
      serviceStateSnapshotInFlight = snapshotServiceState().finally(() => {
        serviceStateSnapshotInFlight = null;
      });
    }

    const refreshed = await serviceStateSnapshotInFlight;
    return {
      ...refreshed,
      ageMs: 0,
      stale: false,
    };
  };

  const wrapHandler = ({ scope, action }, handler) => {
    if (typeof handler !== 'function') {
      return handler;
    }

    const wrappedHandler = async (req, res, next) => {
      const metadata = {
        action: String(action || 'unknown'),
        method: req?.method || '',
        path: req?.originalUrl || req?.url || '',
        scope: String(scope || 'general'),
      };

      eventBus.emit(`operation.${metadata.scope}.started`, metadata);

      try {
        const result = await handler(req, res, next);
        eventBus.emit(`operation.${metadata.scope}.completed`, {
          ...metadata,
          statusCode: res?.statusCode || 200,
        });
        return result;
      } catch (error) {
        eventBus.emit(`operation.${metadata.scope}.failed`, {
          ...metadata,
          error: String(error?.message || error || 'Operation failed'),
          statusCode: res?.statusCode || 500,
        });
        throw error;
      }
    };

    const originalName = String(handler.name || '').trim();
    if (originalName) {
      try {
        Object.defineProperty(wrappedHandler, 'name', {
          value: originalName,
          configurable: true,
        });
      } catch (_) {
        // Preserve behavior even if runtime blocks function-name reassignment.
      }
    }

    return wrappedHandler;
  };

  const runWorkflow = async ({ key, input, metadata }) => workflowEngine.runWorkflow(
    key,
    input,
    {
      clusterManager,
      serviceManager,
      workerCommands,
    },
    metadata,
  );

  const resumeWorkflow = async (runId) => workflowEngine.resumeWorkflowRun(runId, {
    clusterManager,
    serviceManager,
    workerCommands,
  });

  const refreshMetricsSnapshot = async () => {
    const metrics = typeof getSystemMetricsSnapshot === 'function'
      ? await getSystemMetricsSnapshot()
      : {};
    return stateStore.writeMetricsSnapshot(metrics);
  };

  const getMetricsSnapshot = async ({ force = false } = {}) => {
    if (force) {
      return refreshMetricsSnapshot();
    }

    const cached = stateStore.readMetricsSnapshot();
    if (cached?.generatedAt) {
      return cached;
    }
    return refreshMetricsSnapshot();
  };

  const getSystemState = async ({ force = false } = {}) => {
    if (force) {
      await Promise.all([
        snapshotServiceState().catch(() => null),
        refreshMetricsSnapshot().catch(() => null),
        healthManager.runCheck().catch(() => null),
      ]);
    }

    return {
      ...(stateStore.readOrchestratorState ? stateStore.readOrchestratorState() : {}),
      events: eventBus.listEvents({ limit: 300 }),
      generatedAt: new Date().toISOString(),
    };
  };

  const start = async () => {
    const validation = await validateClustersPromise;
    if (!validation.valid) {
      eventBus.emit('cluster.config.invalid', {
        missing: validation.missing,
        path: clusterConfig.path,
      });
    }
    healthManager.start();
    return {
      clusterConfigPath: clusterConfig.path,
      validation,
    };
  };

  const stop = () => {
    healthManager.stop();
  };

  void start();

  return {
    buildCanonicalCatalog,
    clusterConfigPath: clusterConfig.path,
    clusterManager,
    eventBus,
    getCluster: (name) => clusterManager.getCluster(name),
    getMetricsSnapshot,
    getServiceStateSnapshot,
    getSystemState,
    groupOrder: GROUP_ORDER,
    healthManager,
    listClusters: () => clusterManager.listClusters(),
    listWorkflowDefinitions: workflowEngine.listWorkflowDefinitions,
    listWorkflowEvents: workflowEngine.listWorkflowEvents,
    listWorkflowRuns: workflowEngine.listWorkflowRuns,
    readServiceStateSnapshot: stateStore.readServiceStateSnapshot,
    restartCluster: (name) => clusterManager.restartCluster(name),
    resumeWorkflow,
    runWorkflow,
    serviceManager,
    snapshotServiceState,
    startCluster: (name) => clusterManager.startCluster(name),
    stateStore,
    stop,
    stopCluster: (name) => clusterManager.stopCluster(name),
    validateClusters: () => validateClustersPromise,
    wrapHandler,
    workflowEngine,
  };
};

module.exports = {
  createControlPlane,
};
