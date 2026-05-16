const normalizeName = (value) => String(value || '').trim().toLowerCase();

const createClusterManager = ({
  clusterConfig = {},
  serviceManager,
  stateStore,
  eventBus,
  now = () => Date.now(),
} = {}) => {
  if (!serviceManager) {
    throw new Error('clusterManager requires serviceManager');
  }

  const clusters = Object.entries(clusterConfig).reduce((acc, [name, def]) => {
    const key = normalizeName(name);
    if (!key) {
      return acc;
    }
    acc[key] = {
      dependsOn: Array.isArray(def?.dependsOn) ? def.dependsOn.map(normalizeName).filter(Boolean) : [],
      services: Array.isArray(def?.services) ? def.services.map((entry) => String(entry || '').trim()).filter(Boolean) : [],
    };
    return acc;
  }, {});

  const operationLocks = new Map();

  const emit = (event, payload = {}) => {
    if (eventBus && typeof eventBus.emit === 'function') {
      eventBus.emit(event, payload);
    }
  };

  const getClusterDefinition = (name) => {
    const key = normalizeName(name);
    return clusters[key] || null;
  };

  const detectCircularDependencies = () => {
    const visiting = new Set();
    const visited = new Set();

    const visit = (clusterName, stack = []) => {
      if (visited.has(clusterName)) {
        return null;
      }
      if (visiting.has(clusterName)) {
        const cycleStart = stack.indexOf(clusterName);
        const cycle = cycleStart >= 0 ? stack.slice(cycleStart) : [clusterName];
        cycle.push(clusterName);
        return cycle;
      }

      visiting.add(clusterName);
      stack.push(clusterName);
      const definition = clusters[clusterName];
      const dependencies = Array.isArray(definition?.dependsOn) ? definition.dependsOn : [];

      for (const dependency of dependencies) {
        if (!clusters[dependency]) {
          continue;
        }
        const cycle = visit(dependency, stack);
        if (cycle) {
          return cycle;
        }
      }

      stack.pop();
      visiting.delete(clusterName);
      visited.add(clusterName);
      return null;
    };

    for (const clusterName of Object.keys(clusters)) {
      const cycle = visit(clusterName, []);
      if (cycle) {
        return cycle;
      }
    }

    return null;
  };

  const validateClusterConfig = async () => {
    const cycle = detectCircularDependencies();
    if (cycle) {
      throw new Error(`Cluster dependency cycle detected: ${cycle.join(' -> ')}`);
    }

    const knownServices = new Set(
      typeof serviceManager.listControlTargets === 'function'
        ? await serviceManager.listControlTargets()
        : []
    );

    const missing = [];
    for (const [name, definition] of Object.entries(clusters)) {
      const unknownDependencies = definition.dependsOn.filter((dependency) => !clusters[dependency]);
      if (unknownDependencies.length > 0) {
        missing.push(`cluster:${name}:dependsOn:${unknownDependencies.join(',')}`);
      }
      for (const service of definition.services) {
        if (!knownServices.has(service)) {
          missing.push(`service:${service}:cluster:${name}`);
        }
      }
    }

    return {
      clusterCount: Object.keys(clusters).length,
      missing,
      valid: missing.length === 0,
    };
  };

  const resolveDependencies = (name, { includeSelf = false } = {}) => {
    const key = normalizeName(name);
    if (!clusters[key]) {
      throw new Error(`Unknown cluster '${key}'`);
    }

    const resolved = [];
    const visited = new Set();
    const stack = new Set();

    const dfs = (clusterName) => {
      if (stack.has(clusterName)) {
        throw new Error(`Cluster dependency cycle detected at '${clusterName}'`);
      }
      if (visited.has(clusterName)) {
        return;
      }

      visited.add(clusterName);
      stack.add(clusterName);

      const definition = clusters[clusterName] || { dependsOn: [] };
      for (const dependency of definition.dependsOn) {
        if (!clusters[dependency]) {
          throw new Error(`Unknown dependency '${dependency}' referenced by cluster '${clusterName}'`);
        }
        dfs(dependency);
      }

      stack.delete(clusterName);
      if (clusterName !== key || includeSelf) {
        resolved.push(clusterName);
      }
    };

    dfs(key);
    return resolved;
  };

  const resolveDependents = (name, { includeSelf = true } = {}) => {
    const key = normalizeName(name);
    if (!clusters[key]) {
      throw new Error(`Unknown cluster '${key}'`);
    }

    const reverseGraph = Object.entries(clusters).reduce((acc, [clusterName, definition]) => {
      for (const dependency of definition.dependsOn) {
        if (!acc[dependency]) {
          acc[dependency] = [];
        }
        acc[dependency].push(clusterName);
      }
      return acc;
    }, {});

    const visited = new Set();
    const ordered = [];

    const visitDependent = (clusterName) => {
      if (visited.has(clusterName)) {
        return;
      }
      visited.add(clusterName);
      const dependents = reverseGraph[clusterName] || [];
      for (const dependent of dependents) {
        visitDependent(dependent);
      }
      ordered.push(clusterName);
    };

    visitDependent(key);
    return includeSelf ? ordered : ordered.filter((entry) => entry !== key);
  };

  const summarizeClusterState = (serviceStatuses = []) => {
    if (serviceStatuses.length === 0) {
      return {
        state: 'stopped',
        running: 0,
        total: 0,
      };
    }

    const running = serviceStatuses.filter((entry) => Boolean(entry?.running)).length;
    if (running === serviceStatuses.length) {
      return {
        state: 'running',
        running,
        total: serviceStatuses.length,
      };
    }
    if (running === 0) {
      return {
        state: 'stopped',
        running,
        total: serviceStatuses.length,
      };
    }
    return {
      state: 'degraded',
      running,
      total: serviceStatuses.length,
    };
  };

  const getClusterRuntime = async (name) => {
    const key = normalizeName(name);
    const definition = getClusterDefinition(key);
    if (!definition) {
      throw new Error(`Unknown cluster '${key}'`);
    }

    const services = await Promise.all(
      definition.services.map(async (service) => {
        try {
          const status = await serviceManager.getServiceStatus(service);
          return {
            name: service,
            ...status,
          };
        } catch (error) {
          return {
            name: service,
            running: false,
            state: 'down',
            success: false,
            error: String(error?.message || error || 'status check failed'),
          };
        }
      })
    );

    const summary = summarizeClusterState(services);
    const stored = stateStore && typeof stateStore.getClusterState === 'function'
      ? stateStore.getClusterState(key)
      : null;

    const clusterPayload = {
      name: key,
      dependsOn: [...definition.dependsOn],
      services,
      state: summary.state,
      runningServices: summary.running,
      totalServices: summary.total,
      updatedAt: new Date(now()).toISOString(),
      ...(stored && typeof stored === 'object' ? {
        lastAction: stored.lastAction || null,
        lastTransitionAt: stored.lastTransitionAt || null,
      } : {}),
    };

    return clusterPayload;
  };

  const persistClusterRuntime = (clusterRuntime, lastAction) => {
    if (!stateStore || typeof stateStore.upsertClusterState !== 'function') {
      return;
    }

    stateStore.upsertClusterState(clusterRuntime.name, {
      dependsOn: clusterRuntime.dependsOn,
      lastAction,
      lastTransitionAt: new Date(now()).toISOString(),
      runningServices: clusterRuntime.runningServices,
      services: clusterRuntime.services,
      state: clusterRuntime.state,
      totalServices: clusterRuntime.totalServices,
    });
  };

  const withClusterLock = async (clusterName, handler) => {
    const key = normalizeName(clusterName);
    const existing = operationLocks.get(key);
    if (existing) {
      return existing;
    }

    const operation = Promise.resolve()
      .then(handler)
      .finally(() => {
        operationLocks.delete(key);
      });

    operationLocks.set(key, operation);
    return operation;
  };

  const startCluster = async (name) => withClusterLock(name, async () => {
    const target = normalizeName(name);
    const ordered = resolveDependencies(target, { includeSelf: true });

    for (const clusterName of ordered) {
      const definition = getClusterDefinition(clusterName);
      for (const service of definition.services) {
        await serviceManager.startService(service);
      }
      const runtime = await getClusterRuntime(clusterName);
      persistClusterRuntime(runtime, 'start');
      emit('cluster.started', {
        cluster: clusterName,
        state: runtime.state,
        timestamp: runtime.updatedAt,
      });
    }

    return getClusterRuntime(target);
  });

  const stopCluster = async (name) => withClusterLock(name, async () => {
    const target = normalizeName(name);
    const ordered = resolveDependents(target, { includeSelf: true });

    for (const clusterName of ordered) {
      const definition = getClusterDefinition(clusterName);
      for (const service of definition.services) {
        await serviceManager.stopService(service);
      }
      const runtime = await getClusterRuntime(clusterName);
      persistClusterRuntime(runtime, 'stop');
      emit('cluster.stopped', {
        cluster: clusterName,
        state: runtime.state,
        timestamp: runtime.updatedAt,
      });
    }

    return getClusterRuntime(target);
  });

  const restartCluster = async (name) => withClusterLock(name, async () => {
    const target = normalizeName(name);
    const definition = getClusterDefinition(target);
    if (!definition) {
      throw new Error(`Unknown cluster '${target}'`);
    }

    for (const service of definition.services) {
      await serviceManager.restartService(service);
    }

    const runtime = await getClusterRuntime(target);
    persistClusterRuntime(runtime, 'restart');
    emit('cluster.restarted', {
      cluster: target,
      state: runtime.state,
      timestamp: runtime.updatedAt,
    });

    return runtime;
  });

  const listClusters = async () => {
    const entries = Object.keys(clusters);
    const payload = [];
    for (const clusterName of entries) {
      // Sequential to avoid excessive shell checks on Termux.
      // eslint-disable-next-line no-await-in-loop
      payload.push(await getClusterRuntime(clusterName));
    }
    return payload;
  };

  return {
    detectCircularDependencies,
    getCluster: getClusterRuntime,
    listClusters,
    resolveDependencies,
    restartCluster,
    startCluster,
    stopCluster,
    validateClusterConfig,
  };
};

module.exports = {
  createClusterManager,
};
