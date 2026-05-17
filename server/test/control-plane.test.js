const fs = require('fs');
const os = require('os');
const path = require('path');
const { createControlPlane } = require('../src/infra/control-plane');
const { createClusterManager } = require('../src/infra/control-plane/cluster-manager');
const { createEventBus } = require('../src/infra/control-plane/event-bus');
const { buildCatalogEntries } = require('../src/infra/control-plane/service-catalog');
const { createServiceManager } = require('../src/infra/control-plane/service-manager');
const { createWorkflowEngine } = require('../src/infra/control-plane/workflow-engine');

describe('control-plane catalog', () => {
  it('builds canonical catalog entries with worker metadata', () => {
    const entries = buildCatalogEntries({
      manageableServiceNames: ['nginx', 'sonarr'],
      optionalServiceNames: ['sonarr'],
      serviceCatalog: [
        { available: true, group: 'platform', key: 'nginx', label: 'nginx', status: 'working' },
        { available: true, group: 'arr', key: 'sonarr', label: 'Sonarr', status: 'working' },
      ],
      serviceCommands: {
        nginx: { start: '/home/scripts/nginx-service.sh start' },
        sonarr: { start: '/home/scripts/sonarr-service.sh start' },
      },
      workerCommands: {
        'media-workflow': {
          start: '/home/scripts/media-workflow-service.sh start',
          status: '/home/scripts/media-workflow-service.sh status --json',
        },
      },
    });

    const sonarr = entries.find((entry) => entry.key === 'sonarr');
    const worker = entries.find((entry) => entry.key === 'media-workflow');

    expect(sonarr).toBeTruthy();
    expect(sonarr.group).toBe('media');
    expect(sonarr.capabilities.optional).toBe(true);
    expect(sonarr.wrapper.command).toContain('sonarr-service.sh');

    expect(worker).toBeTruthy();
    expect(worker.type).toBe('worker');
    expect(worker.group).toBe('workers');
    expect(worker.capabilities.controllable).toBe(true);
    expect(worker.wrapper.command).toContain('media-workflow-service.sh');
  });
});

describe('service-manager', () => {
  it('maps service and worker commands through unified control', async () => {
    const calls = [];
    const serviceStateCache = {};
    const manager = createServiceManager({
      classifyServiceState: (running) => (running ? 'working' : 'stalled'),
      eventBus: createEventBus(),
      getManageableServiceNames: async () => ['jellyfin'],
      getStorageBlockForService: () => ({ blocked: false }),
      readStorageProtectionState: () => ({ state: 'healthy' }),
      resolveServiceInstall: async () => ({ available: true, label: 'jellyfin-service.sh' }),
      runCommand: async (command) => {
        calls.push(command);
        if (command.includes('jellyfin-service.sh status')) {
          throw new Error('stopped');
        }
        return 'ok';
      },
      serviceStateCache,
      services: {
        jellyfin: {
          check: '/home/scripts/jellyfin-service.sh status',
          restart: '/home/scripts/jellyfin-service.sh restart',
          start: '/home/scripts/jellyfin-service.sh start',
          stop: '/home/scripts/jellyfin-service.sh stop',
        },
      },
      waitForServiceState: async (_service, expectedRunning) => expectedRunning,
      workerCommands: {
        'usb-mount-service': {
          restart: '/home/scripts/usb-mount-service.sh restart',
          start: '/home/scripts/usb-mount-service.sh start',
          status: '/home/scripts/usb-mount-service.sh status --json',
          stop: '/home/scripts/usb-mount-service.sh stop',
        },
      },
    });

    const serviceResult = await manager.control({ action: 'start', service: 'jellyfin' });
    const workerResult = await manager.control({ action: 'restart', service: 'usb-mount-service' });

    expect(serviceResult.success).toBe(true);
    expect(workerResult.success).toBe(true);
    expect(serviceStateCache.jellyfin).toBe('working');
    expect(calls).toContain('/home/scripts/jellyfin-service.sh start');
    expect(calls).toContain('/home/scripts/usb-mount-service.sh restart');
  });

  it('uses worker status json output to report stopped workers correctly', async () => {
    const calls = [];
    const manager = createServiceManager({
      runCommand: async (command) => {
        calls.push(command);
        if (command.includes('status')) {
          return JSON.stringify({ running: false, service: 'usb-mount-service' });
        }
        return 'ok';
      },
      services: {},
      waitForServiceState: async () => true,
      workerCommands: {
        'usb-mount-service': {
          start: '/home/scripts/usb-mount-service.sh start',
          status: '/home/scripts/usb-mount-service.sh status --json',
          stop: '/home/scripts/usb-mount-service.sh stop',
        },
      },
    });

    const stopped = await manager.control({ action: 'stop', service: 'usb-mount-service' });
    expect(stopped.running).toBe(false);
    expect(stopped.success).toBe(true);
    expect(calls).toContain('/home/scripts/usb-mount-service.sh status --json');
  });

  it('blocks managed service start when storage watchdog blocks the service', async () => {
    const manager = createServiceManager({
      getManageableServiceNames: async () => ['jellyfin'],
      getStorageBlockForService: () => ({ blocked: true, reason: 'storage degraded' }),
      readStorageProtectionState: () => ({ state: 'degraded' }),
      resolveServiceInstall: async () => ({ available: true }),
      runCommand: async () => 'ok',
      services: {
        jellyfin: {
          restart: 'restart',
          start: 'start',
          stop: 'stop',
        },
      },
      waitForServiceState: async () => true,
    });

    await expect(manager.control({ action: 'start', service: 'jellyfin' }))
      .rejects
      .toMatchObject({ code: 'blocked_by_storage' });
  });

  it('starts descriptor dependencies before a dependent service', async () => {
    const calls = [];
    const running = new Set();
    const manager = createServiceManager({
      getManageableServiceNames: async () => ['filesystem', 'jellyfin'],
      getStorageBlockForService: () => ({ blocked: false }),
      readStorageProtectionState: () => ({ state: 'healthy' }),
      resolveServiceInstall: async () => ({ available: true }),
      runCommand: async (command) => {
        calls.push(command);
        if (command.endsWith(' status')) {
          const service = command.split(' ')[0];
          if (running.has(service)) return 'running';
          throw new Error('stopped');
        }
        running.add(command.split(' ')[0]);
        return 'ok';
      },
      serviceDependencies: {
        jellyfin: ['filesystem'],
      },
      services: {
        filesystem: {
          check: 'filesystem status',
          start: 'filesystem start',
          stop: 'filesystem stop',
        },
        jellyfin: {
          check: 'jellyfin status',
          start: 'jellyfin start',
          stop: 'jellyfin stop',
        },
      },
      waitForServiceState: async (_service, expectedRunning) => expectedRunning,
    });

    const result = await manager.control({ action: 'start', service: 'jellyfin' });

    expect(result.success).toBe(true);
    expect(calls).toContain('filesystem start');
    expect(calls).toContain('jellyfin start');
    expect(calls.indexOf('filesystem start')).toBeLessThan(calls.indexOf('jellyfin start'));
  });
});

describe('cluster-manager', () => {
  it('resolves dependencies and starts clusters through service manager', async () => {
    const calls = [];
    const serviceManager = {
      getServiceStatus: async (name) => ({ running: calls.includes(`start:${name}`), service: name }),
      listControlTargets: async () => ['qbittorrent', 'jellyfin'],
      restartService: async (name) => {
        calls.push(`restart:${name}`);
        return { success: true };
      },
      startService: async (name) => {
        calls.push(`start:${name}`);
        return { success: true };
      },
      stopService: async (name) => {
        calls.push(`stop:${name}`);
        return { success: true };
      },
    };

    const stateStore = {
      getClusterState: () => null,
      upsertClusterState: () => {},
    };

    const manager = createClusterManager({
      clusterAliases: {
        downloads: 'torrent',
        streaming: 'media',
      },
      clusterConfig: {
        media: { services: ['jellyfin'], dependsOn: ['downloads'] },
        torrent: { services: ['qbittorrent'], dependsOn: [] },
      },
      serviceManager,
      stateStore,
    });

    const validation = await manager.validateClusterConfig();
    expect(validation.valid).toBe(true);

    await manager.startCluster('streaming');
    expect(calls).toEqual(['start:qbittorrent', 'start:jellyfin']);

    const dependencies = manager.resolveDependencies('streaming', { includeSelf: true });
    expect(dependencies).toEqual(['torrent', 'media']);
    expect(manager.resolveClusterName('downloads')).toBe('torrent');
  });
});

describe('workflow-engine', () => {
  it('supports blocked run and resume with explicit workflow events', async () => {
    const runs = [];
    const events = [];
    const bus = createEventBus();
    const stateStore = {
      appendWorkflowEvent: (event) => {
        events.push(event);
        return event;
      },
      getWorkflowRun: (runId) => runs.find((entry) => entry.id === runId) || null,
      listWorkflowEvents: () => [...events],
      listWorkflowRuns: () => [...runs],
      upsertWorkflowRun: (run) => {
        const index = runs.findIndex((entry) => entry.id === run.id);
        if (index >= 0) {
          runs[index] = { ...runs[index], ...run };
          return runs[index];
        }
        runs.push({ ...run });
        return runs[runs.length - 1];
      },
    };

    const executed = [];
    const engine = createWorkflowEngine({
      definitions: {
        'test-flow': {
          key: 'test-flow',
          steps: [
            {
              key: 'step-1',
              resolveCommand: (ctx) => ctx.workerCommands?.runner?.start || null,
            },
          ],
          title: 'Test flow',
          worker: 'runner',
        },
      },
      eventBus: bus,
      executeCommand: async (command) => {
        executed.push(command);
        return 'ok';
      },
      randomId: () => 'seed',
      stateStore,
    });

    const queued = await engine.runWorkflow('test-flow', {}, { workerCommands: {} });
    expect(queued.status).toBe('queued');

    await new Promise((resolve) => setTimeout(resolve, 25));
    const blocked = engine.getWorkflowRun(queued.id);
    expect(blocked).toBeTruthy();
    expect(blocked.status).toBe('blocked');
    expect(blocked.cursor).toBe(0);

    const resumedQueued = await engine.resumeWorkflowRun(blocked.id, {
      workerCommands: {
        runner: {
          start: 'runner-start-command',
        },
      },
    });
    expect(resumedQueued.status).toBe('queued');

    await new Promise((resolve) => setTimeout(resolve, 25));
    const resumed = engine.getWorkflowRun(blocked.id);
    expect(resumed).toBeTruthy();

    expect(resumed.status).toBe('completed');
    expect(executed).toContain('runner-start-command');
    expect(events.some((entry) => entry.event === 'workflow.test-flow.blocked')).toBe(true);
    expect(events.some((entry) => entry.event === 'workflow.test-flow.resumed')).toBe(true);
    expect(events.some((entry) => entry.event === 'workflow.test-flow.completed')).toBe(true);
  });
});

describe('control-plane state snapshot freshness', () => {
  it('refreshes stale snapshots even when callers do not pass force=true', async () => {
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-state-'));
    const controlPlane = createControlPlane({
      buildLegacyServiceCatalog: async () => [
        { available: true, key: 'nginx', label: 'nginx', status: 'working' },
      ],
      classifyServiceState: (running) => (running ? 'working' : 'stalled'),
      clearStorageResumeRequirementForService: () => {},
      fs,
      getLegacyServicesSnapshot: async () => ({ nginx: true }),
      getManageableServiceNames: async () => ['nginx'],
      runCommand: async () => 'ok',
      runtimeDir,
      services: {
        nginx: {
          check: '/home/scripts/nginx-service.sh status',
          start: '/home/scripts/nginx-service.sh start',
          stop: '/home/scripts/nginx-service.sh stop',
        },
      },
      waitForServiceState: async () => true,
      workerCommands: {},
      serviceStateTtlMs: 1,
    });

    try {
      await controlPlane.snapshotServiceState();
      const stalePath = path.join(runtimeDir, 'control-plane', 'service-state.json');
      const payload = JSON.parse(fs.readFileSync(stalePath, 'utf8'));
      payload.generatedAt = '2000-01-01T00:00:00.000Z';
      fs.writeFileSync(stalePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

      const snapshot = await controlPlane.getServiceStateSnapshot();
      expect(snapshot.generatedAt).not.toBe('2000-01-01T00:00:00.000Z');
      expect(Array.isArray(snapshot.services)).toBe(true);
    } finally {
      controlPlane.stop();
      await new Promise((resolve) => setTimeout(resolve, 25));
      fs.rmSync(runtimeDir, { force: true, recursive: true });
    }
  });
});
