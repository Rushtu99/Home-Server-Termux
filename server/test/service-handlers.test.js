const { buildServiceHandlers } = require('../src/handlers/service-handlers');

const createResponse = () => ({
  body: null,
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const createDependencies = (overrides = {}) => {
  const runCommand = overrides.runCommand || vi.fn().mockResolvedValue('ok');
  const waitForServiceState = overrides.waitForServiceState || vi.fn().mockResolvedValue(true);

  return {
    getServicesSnapshot: vi.fn().mockResolvedValue({}),
    getControlledServiceNames: vi.fn().mockResolvedValue(['nginx']),
    buildServiceCatalog: vi.fn().mockResolvedValue([]),
    pushDebugEvent: vi.fn(),
    isServiceControllerUnlocked: vi.fn().mockReturnValue(true),
    buildStackLifecycleSummary: vi.fn().mockReturnValue({}),
    buildServiceGroups: vi.fn().mockReturnValue({}),
    buildMediaWorkflowSnapshot: vi.fn().mockReturnValue({}),
    secureCompare: vi.fn().mockReturnValue(true),
    ADMIN_ACTION_PASSWORD: 'secret',
    pushAuditEvent: vi.fn(),
    unlockServiceController: vi.fn().mockReturnValue(Date.now() + 60_000),
    unlockedServiceControllers: new Map(),
    getManageableServiceNames: vi.fn().mockResolvedValue(['nginx']),
    SERVICES: {
      nginx: {
        start: 'echo start',
        stop: 'echo stop',
        restart: 'echo restart',
      },
    },
    readStorageProtectionState: vi.fn().mockReturnValue({ state: 'healthy' }),
    getStorageBlockForService: vi.fn().mockReturnValue({ blocked: false }),
    resolveServiceInstall: vi.fn().mockResolvedValue({ available: true, label: 'nginx' }),
    runCommand,
    waitForServiceState,
    serviceStateCache: {},
    classifyServiceState: vi.fn().mockReturnValue('working'),
    clearStorageResumeRequirementForService: vi.fn(),
    getMonitorSnapshot: vi.fn().mockResolvedValue({ cpuLoad: 0 }),
    getTelemetrySnapshot: vi.fn().mockResolvedValue({}),
    getConnectionsSnapshot: vi.fn().mockReturnValue({ users: [] }),
    activeSessions: new Map(),
    invalidateSession: vi.fn(),
    recentConnections: new Map(),
    getStorageSnapshot: vi.fn().mockResolvedValue({ mounts: [] }),
    ...overrides,
  };
};

describe('service control handler', () => {
  it('rejects prototype action values', async () => {
    const dependencies = createDependencies();
    const handlers = buildServiceHandlers(dependencies);
    const req = {
      body: { service: 'nginx', action: 'toString' },
      session: { id: 'session-1' },
    };
    const res = createResponse();

    await handlers.controlHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid action' });
    expect(dependencies.runCommand).not.toHaveBeenCalled();
  });

  it('executes valid actions', async () => {
    const dependencies = createDependencies();
    const handlers = buildServiceHandlers(dependencies);
    const req = {
      body: { service: 'nginx', action: 'restart' },
      session: { id: 'session-1' },
    };
    const res = createResponse();

    await handlers.controlHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      running: true,
      expectedRunning: true,
      output: 'ok',
    });
    expect(dependencies.runCommand).toHaveBeenCalledWith('echo restart');
  });
});
