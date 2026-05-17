const { exec } = require('child_process');
const path = require('path');
const { createDescriptorRegistry } = require('../services/registry');
const { createStateEngine } = require('../state/engine');
const { createLogger } = require('../logging');
const { runHealthCheck } = require('../health/checks');
const { createPersistentEventLog } = require('../events');
const { shouldBlockHeavyService } = require('../power/android');
const {
  resolveDependencyOrder,
  resolveDependentOrder,
  resolveServiceDependencyOrder,
} = require('./graph');

const runCommand = (command) => new Promise((resolve, reject) => {
  exec(command, { cwd: path.resolve(__dirname, '../..'), timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
    if (error) {
      error.output = `${stdout || ''}${stderr || ''}`.trim();
      reject(error);
      return;
    }
    resolve(`${stdout || ''}${stderr || ''}`.trim());
  });
});

const createStandaloneOrchestrator = ({ projectRoot } = {}) => {
  const root = projectRoot || path.resolve(__dirname, '../..');
  const registry = createDescriptorRegistry({ projectRoot: root });
  const state = createStateEngine({ projectRoot: root });
  const logger = createLogger({ projectRoot: root, scope: 'orchestrator', name: 'hs' });
  const events = createPersistentEventLog({ projectRoot: root });

  const commandFor = (service, action) => {
    const name = registry.resolveServiceName(service);
    const descriptor = registry.serviceCommands[name];
    if (!descriptor) throw new Error(`Unknown service '${service}'`);
    const command = action === 'status' ? descriptor.check : descriptor[action];
    if (!command) throw new Error(`Service '${name}' does not support ${action}`);
    return { command, name };
  };

  const controlSingleService = async (service, action) => {
    const normalizedAction = String(action || '').toLowerCase();
    const { command, name } = commandFor(service, normalizedAction);
    const descriptor = registry.serviceDescriptors[name] || {};
    if (['start', 'restart'].includes(normalizedAction)) {
      const block = shouldBlockHeavyService({ descriptor });
      if (block.blocked) throw new Error(`Power guard blocked ${name}: ${block.reason}`);
    }
    logger.info(`service.${normalizedAction}`, { service: name });
    events.emit(`service.${normalizedAction}.requested`, name);
    const output = await runCommand(command);
    const status = await getServiceStatus(name).catch((error) => ({ running: false, error: error.message }));
    state.updateService(name, {
      desiredState: normalizedAction === 'stop' ? 'stopped' : 'running',
      lastAction: normalizedAction,
      output,
      running: Boolean(status.running),
      status: status.running ? 'running' : 'stopped',
    });
    events.emit(`service.${normalizedAction}.completed`, name, { running: Boolean(status.running) });
    return { output, service: name, success: normalizedAction === 'stop' ? !status.running : Boolean(status.running), ...status };
  };

  const controlService = async (service, action) => {
    const normalizedAction = String(action || '').toLowerCase();
    const name = registry.resolveServiceName(service);
    if (!registry.serviceDescriptors[name]) throw new Error(`Unknown service '${service}'`);

    if (['start', 'restart'].includes(normalizedAction)) {
      const order = resolveServiceDependencyOrder(registry.serviceDescriptors, name, { includeSelf: true });
      const results = [];
      for (const serviceName of order) {
        if (serviceName !== name) {
          // eslint-disable-next-line no-await-in-loop
          const current = await getServiceStatus(serviceName).catch(() => ({ running: false }));
          if (current.running) {
            results.push({ service: serviceName, skipped: true });
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          results.push(await controlSingleService(serviceName, 'start'));
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        results.push(await controlSingleService(serviceName, normalizedAction));
      }
      return results[results.length - 1];
    }

    if (normalizedAction === 'stop') {
      const order = resolveDependentOrder(registry.serviceDescriptors, name, { includeSelf: true });
      const results = [];
      for (const serviceName of order) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await controlSingleService(serviceName, 'stop'));
      }
      return results[results.length - 1];
    }

    return controlSingleService(name, normalizedAction);
  };

  const getServiceStatus = async (service) => {
    const { command, name } = commandFor(service, 'status');
    try {
      const output = await runCommand(command);
      state.updateService(name, { health: 'unknown', running: true, status: 'running' });
      return { output, running: true, service: name, status: 'running' };
    } catch (error) {
      state.updateService(name, { error: error.output || error.message, running: false, status: 'stopped' });
      return { error: error.output || error.message, running: false, service: name, status: 'stopped' };
    }
  };

  const runServiceHealth = async (service) => {
    const name = registry.resolveServiceName(service);
    const descriptor = registry.serviceDescriptors[name];
    if (!descriptor) throw new Error(`Unknown service '${service}'`);
    const command = registry.serviceCommands[name]?.health || registry.serviceCommands[name]?.check;
    const result = await runHealthCheck({
      ...descriptor,
      health: {
        ...(descriptor.health || {}),
        command: descriptor.health?.command || command,
      },
    });
    state.updateService(name, { health: result.ok ? 'healthy' : 'unhealthy', healthResult: result });
    return { service: name, ...result };
  };

  const resolveCluster = (cluster) => {
    const name = registry.resolveClusterName(cluster);
    const descriptor = registry.clusterDescriptors[name];
    if (!descriptor) throw new Error(`Unknown cluster '${cluster}'`);
    return { descriptor, name };
  };

  const startCluster = async (cluster) => {
    const { name } = resolveCluster(cluster);
    const order = resolveDependencyOrder(registry.clusterConfig, name, { includeSelf: true });
    const results = [];
    for (const clusterName of order) {
      const descriptor = registry.clusterDescriptors[clusterName];
      for (const service of descriptor.services) {
        // eslint-disable-next-line no-await-in-loop
        const current = await getServiceStatus(service).catch(() => ({ running: false }));
        if (current.running) {
          results.push({ cluster: clusterName, service, skipped: true });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        results.push({ cluster: clusterName, ...(await controlService(service, 'start')) });
      }
      state.updateCluster(clusterName, { desiredState: 'running', lastAction: 'start' });
      events.emit('cluster.started', clusterName);
    }
    return { cluster: name, order, results, success: true };
  };

  const stopCluster = async (cluster) => {
    const { name } = resolveCluster(cluster);
    const order = resolveDependentOrder(registry.clusterConfig, name, { includeSelf: true });
    const results = [];
    for (const clusterName of order) {
      const descriptor = registry.clusterDescriptors[clusterName];
      for (const service of [...descriptor.services].reverse()) {
        // eslint-disable-next-line no-await-in-loop
        results.push({ cluster: clusterName, ...(await controlSingleService(service, 'stop')) });
      }
      state.updateCluster(clusterName, { desiredState: 'stopped', lastAction: 'stop' });
      events.emit('cluster.stopped', clusterName);
    }
    return { cluster: name, order, results, success: true };
  };

  const restartCluster = async (cluster) => {
    await stopCluster(cluster);
    return startCluster(cluster);
  };

  const status = async () => {
    const services = [];
    for (const name of Object.keys(registry.serviceDescriptors)) {
      // eslint-disable-next-line no-await-in-loop
      services.push(await getServiceStatus(name));
    }
    return {
      clusters: Object.keys(registry.clusterDescriptors).map((name) => ({ name, ...(state.getCluster(name) || {}) })),
      generatedAt: new Date().toISOString(),
      services,
    };
  };

  const healthSweep = async ({ repair = false } = {}) => {
    const results = [];
    for (const name of Object.keys(registry.serviceDescriptors)) {
      // eslint-disable-next-line no-await-in-loop
      const health = await runServiceHealth(name);
      const stored = state.getService(name) || {};
      const descriptor = registry.serviceDescriptors[name] || {};
      const restart = descriptor.restart && typeof descriptor.restart === 'object' ? descriptor.restart : {};
      const maxRestarts = Number.isFinite(Number(restart.maxRestarts)) ? Number(restart.maxRestarts) : 3;
      const restartCount = Number(stored.restartCount || 0);
      const shouldRepair = repair && !health.ok && stored.desiredState === 'running' && restartCount < maxRestarts;

      if (shouldRepair) {
        events.emit('service.repair.requested', name, { restartCount, maxRestarts });
        try {
          // eslint-disable-next-line no-await-in-loop
          const restarted = await controlSingleService(name, 'restart');
          state.updateService(name, { restartCount: restartCount + 1 });
          results.push({ ...health, repaired: true, restart: restarted });
          continue;
        } catch (error) {
          results.push({ ...health, repaired: false, repairError: error.message });
          continue;
        }
      }

      results.push({ ...health, repaired: false });
    }
    return { generatedAt: new Date().toISOString(), repair, services: results };
  };

  return {
    controlService,
    controlSingleService,
    events,
    getServiceStatus,
    healthSweep,
    logger,
    registry,
    restartCluster,
    runServiceHealth,
    startCluster,
    state,
    status,
    stopCluster,
  };
};

module.exports = {
  createStandaloneOrchestrator,
};
