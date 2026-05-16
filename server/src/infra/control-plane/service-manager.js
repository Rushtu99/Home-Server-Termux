const toActionCommandMap = (entry = {}) => ({
  restart: entry.restart,
  start: entry.start,
  status: entry.check,
  stop: entry.stop,
});

const parseWorkerStateFromStatusOutput = (output) => {
  const text = String(output || '').trim();
  if (!text) {
    return null;
  }

  const parseJsonCandidate = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  const parsed = parseJsonCandidate(text)
    || (
      firstBrace >= 0
      && lastBrace > firstBrace
      && parseJsonCandidate(text.slice(firstBrace, lastBrace + 1))
    );

  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.running === 'boolean') {
      return parsed.running;
    }
    const state = String(parsed.state || parsed.status || '').trim().toLowerCase();
    if (state) {
      if (['running', 'working', 'healthy', 'active', 'up'].includes(state)) {
        return true;
      }
      if (['stopped', 'inactive', 'failed', 'down', 'crashed'].includes(state)) {
        return false;
      }
    }
  }

  const normalized = text.toLowerCase();
  if (normalized.includes('stopped') || normalized.includes('inactive')) {
    return false;
  }
  if (normalized.includes('running') || normalized.includes('active')) {
    return true;
  }
  return null;
};

const createServiceManager = ({
  services = {},
  workerCommands = {},
  getManageableServiceNames,
  resolveServiceInstall,
  readStorageProtectionState,
  getStorageBlockForService,
  runCommand,
  waitForServiceState,
  classifyServiceState,
  serviceStateCache = {},
  clearStorageResumeRequirementForService = () => {},
  eventBus,
  serviceAliases = {},
} = {}) => {
  if (typeof runCommand !== 'function') {
    throw new Error('serviceManager requires runCommand');
  }

  const supervisedServices = new Map();

  const emit = (eventName, payload = {}) => {
    if (eventBus && typeof eventBus.emit === 'function') {
      eventBus.emit(eventName, payload);
    }
  };

  const resolveAlias = (name) => {
    const key = String(name || '').trim();
    if (!key) {
      return key;
    }
    const mapped = serviceAliases[key];
    return mapped ? String(mapped).trim() : key;
  };

  const listServiceNames = async () => {
    if (typeof getManageableServiceNames === 'function') {
      return getManageableServiceNames();
    }
    return Object.keys(services);
  };

  const listControlTargets = async () => {
    const [manageableNames] = await Promise.all([
      listServiceNames(),
    ]);

    const workerNames = Object.keys(workerCommands);
    const aliasNames = Object.keys(serviceAliases);
    return [...new Set([...manageableNames, ...workerNames, ...aliasNames])].sort();
  };

  const getControlDescriptor = (name) => {
    const aliasResolved = resolveAlias(name);
    const key = String(aliasResolved || '').trim();
    if (workerCommands[key]) {
      return {
        commands: workerCommands[key],
        key,
        kind: 'worker',
        originalName: String(name || '').trim(),
      };
    }
    if (services[key]) {
      return {
        commands: toActionCommandMap(services[key]),
        key,
        kind: 'service',
        originalName: String(name || '').trim(),
        serviceConfig: services[key],
      };
    }
    return null;
  };

  const getRunningState = async (descriptor, normalizedAction) => {
    if (descriptor.kind === 'worker') {
      const statusCommand = descriptor.commands.status;
      if (!statusCommand) {
        return normalizedAction !== 'stop';
      }
      try {
        const output = await runCommand(statusCommand);
        const parsedState = parseWorkerStateFromStatusOutput(output);
        if (typeof parsedState === 'boolean') {
          return parsedState;
        }
        return true;
      } catch (error) {
        const parsedState = parseWorkerStateFromStatusOutput(error);
        if (typeof parsedState === 'boolean') {
          return parsedState;
        }
        return false;
      }
    }

    const expectedRunning = normalizedAction !== 'stop';
    if (typeof waitForServiceState === 'function') {
      return waitForServiceState(descriptor.serviceConfig, expectedRunning);
    }
    return expectedRunning;
  };

  const getServiceStatus = async (serviceName) => {
    const descriptor = getControlDescriptor(serviceName);
    if (!descriptor) {
      throw new Error(`Unknown service '${serviceName}'`);
    }

    const running = await getRunningState(descriptor, 'status');
    const state = running ? 'running' : 'stopped';
    return {
      checkedAt: new Date().toISOString(),
      kind: descriptor.kind,
      running,
      service: descriptor.originalName || descriptor.key,
      serviceKey: descriptor.key,
      state,
      success: true,
    };
  };

  const ensureServiceAllowed = async (serviceKey, descriptor, normalizedAction) => {
    if (descriptor.kind !== 'service') {
      return;
    }

    const manageableNames = await listServiceNames();
    if (!manageableNames.includes(serviceKey)) {
      throw new Error('Unknown service');
    }

    if (['start', 'restart'].includes(normalizedAction)
      && typeof readStorageProtectionState === 'function'
      && typeof getStorageBlockForService === 'function') {
      const storageProtection = readStorageProtectionState();
      const storageBlock = getStorageBlockForService(serviceKey, storageProtection);
      if (storageBlock?.blocked) {
        const err = new Error(storageBlock.reason || 'Service is blocked by storage watchdog');
        err.code = 'blocked_by_storage';
        err.state = storageProtection?.state || 'unknown';
        throw err;
      }
    }

    if (['start', 'restart'].includes(normalizedAction) && typeof resolveServiceInstall === 'function') {
      const install = await resolveServiceInstall(serviceKey, descriptor.serviceConfig);
      if (!install?.available) {
        throw new Error(`Command '${install?.label || serviceKey}' is not installed`);
      }
    }
  };

  const control = async ({ service, action }) => {
    const requestedServiceKey = String(service || '').trim();
    const normalizedAction = String(action || '').trim().toLowerCase();

    if (!requestedServiceKey) {
      throw new Error('Service is required');
    }
    if (!['start', 'stop', 'restart'].includes(normalizedAction)) {
      throw new Error('Invalid action');
    }

    const descriptor = getControlDescriptor(requestedServiceKey);
    if (!descriptor) {
      throw new Error('Unknown service');
    }

    const serviceKey = descriptor.key;

    await ensureServiceAllowed(serviceKey, descriptor, normalizedAction);

    const command = descriptor.commands[normalizedAction];
    if (!command) {
      throw new Error('Invalid action');
    }

    const statusBefore = await getServiceStatus(serviceKey).catch(() => ({ running: false }));
    const alreadyInTargetState = normalizedAction === 'stop' && statusBefore.running === false;

    emit('service.control.requested', {
      action: normalizedAction,
      alreadyInTargetState,
      kind: descriptor.kind,
      requestedService: requestedServiceKey,
      service: serviceKey,
    });

    let output = '';
    if (!alreadyInTargetState || normalizedAction === 'restart') {
      output = await runCommand(command);
    } else {
      output = `No-op: ${serviceKey} already ${normalizedAction === 'start' ? 'running' : 'stopped'}`;
    }

    const expectedRunning = normalizedAction !== 'stop';
    const running = await getRunningState(descriptor, normalizedAction);

    if (descriptor.kind === 'service') {
      serviceStateCache[serviceKey] = typeof classifyServiceState === 'function'
        ? classifyServiceState(running)
        : (running ? 'working' : 'stalled');

      if (running && expectedRunning && ['start', 'restart'].includes(normalizedAction)) {
        clearStorageResumeRequirementForService(serviceKey);
      }
    }

    supervisedServices.set(serviceKey, {
      expectedRunning,
      lastAction: normalizedAction,
      lastUpdatedAt: new Date().toISOString(),
      requestedServiceKey,
    });

    emit('service.control.completed', {
      action: normalizedAction,
      expectedRunning,
      kind: descriptor.kind,
      requestedService: requestedServiceKey,
      running,
      service: serviceKey,
      success: running === expectedRunning,
    });

    return {
      expectedRunning,
      output,
      requestedService: requestedServiceKey,
      running,
      service: serviceKey,
      success: running === expectedRunning,
      wasNoop: alreadyInTargetState && normalizedAction !== 'restart',
    };
  };

  const startService = async (serviceName) => control({ service: serviceName, action: 'start' });
  const stopService = async (serviceName) => control({ service: serviceName, action: 'stop' });
  const restartService = async (serviceName) => control({ service: serviceName, action: 'restart' });

  return {
    control,
    getControlDescriptor,
    getServiceStatus,
    listControlTargets,
    listServiceNames,
    restartService,
    startService,
    stopService,
    supervisedServices,
  };
};

module.exports = {
  createServiceManager,
};
