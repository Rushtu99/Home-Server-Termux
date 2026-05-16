const { buildControlPlaneHandlers } = require('../src/handlers/control-plane-handlers');

const createResponse = () => {
  const response = {
    body: null,
    statusCode: 200,
  };
  response.json = (payload) => {
    response.body = payload;
    return response;
  };
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  return response;
};

describe('control-plane handlers', () => {
  it('returns 503 when control plane is unavailable', async () => {
    const handlers = buildControlPlaneHandlers({ controlPlane: null, pushDebugEvent: () => {} });
    const res = createResponse();
    await handlers.catalogServicesHandler({}, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('not initialized');
  });

  it('serves catalog/state/workflow payloads from control-plane facade', async () => {
    const controlPlane = {
      buildCanonicalCatalog: async () => ([
        { key: 'nginx', type: 'service' },
        { key: 'media-workflow', type: 'worker' },
      ]),
      getCluster: async () => ({ name: 'media', state: 'running' }),
      getMetricsSnapshot: async () => ({ metrics: { cpu: 1 } }),
      getSystemState: async () => ({ services: { services: [] } }),
      groupOrder: ['platform', 'workers'],
      healthManager: {
        getSnapshot: () => ({ summary: { healthy: 1 } }),
        runCheck: async () => ({ summary: { healthy: 1 } }),
      },
      listClusters: async () => [{ name: 'media', state: 'running' }],
      listWorkflowDefinitions: () => [{ key: 'movie-intake', title: 'Movie intake' }],
      listWorkflowEvents: () => [{ event: 'workflow.movie-intake.queued' }],
      listWorkflowRuns: () => [{ id: 'run-1', status: 'queued' }],
      getServiceStateSnapshot: async ({ force }) => (force
        ? { state: 'healthy', services: [{ key: 'nginx' }] }
        : { state: 'healthy', services: [] }),
      readServiceStateSnapshot: () => ({ state: 'healthy', services: [] }),
      resumeWorkflow: async () => ({ id: 'run-1', status: 'completed' }),
      runWorkflow: async () => ({ id: 'run-2', status: 'queued' }),
      serviceManager: {
        control: async () => ({ success: true }),
        getServiceStatus: async () => ({ running: true, service: 'nginx' }),
      },
      snapshotServiceState: async () => ({ state: 'healthy', services: [{ key: 'nginx' }] }),
      startCluster: async () => ({ name: 'media', state: 'running' }),
      stopCluster: async () => ({ name: 'media', state: 'stopped' }),
      restartCluster: async () => ({ name: 'media', state: 'running' }),
      workflowEngine: {
        getWorkflowRun: () => ({ id: 'run-1', status: 'queued' }),
      },
    };
    const handlers = buildControlPlaneHandlers({ controlPlane, pushDebugEvent: () => {} });

    const servicesRes = createResponse();
    await handlers.catalogServicesHandler({}, servicesRes);
    expect(servicesRes.body.services).toHaveLength(1);
    expect(servicesRes.body.services[0].key).toBe('nginx');

    const workersRes = createResponse();
    await handlers.catalogWorkersHandler({}, workersRes);
    expect(workersRes.body.workers).toHaveLength(1);
    expect(workersRes.body.workers[0].key).toBe('media-workflow');

    const stateRes = createResponse();
    await handlers.workflowStateServicesHandler({ query: {} }, stateRes);
    expect(stateRes.body.state).toBe('healthy');

    const stateForceRes = createResponse();
    await handlers.workflowStateServicesHandler({ query: { force: 'true' } }, stateForceRes);
    expect(stateForceRes.body.services).toHaveLength(1);

    const definitionsRes = createResponse();
    handlers.workflowDefinitionsHandler({}, definitionsRes);
    expect(definitionsRes.body.workflows).toHaveLength(1);

    const runsRes = createResponse();
    handlers.workflowRunsHandler({ query: { limit: 10 } }, runsRes);
    expect(runsRes.body.runs).toHaveLength(1);

    const runDetailRes = createResponse();
    handlers.workflowRunDetailHandler({ params: { id: 'run-1' } }, runDetailRes);
    expect(runDetailRes.body.id).toBe('run-1');

    const runRes = createResponse();
    await handlers.workflowRunHandler(
      { body: { input: { lane: 'arr' } }, params: { key: 'movie-intake' }, session: { username: 'admin' }, user: { sub: 'admin' } },
      runRes,
    );
    expect(runRes.statusCode).toBe(202);
    expect(runRes.body.run.id).toBe('run-2');

    const resumeRes = createResponse();
    await handlers.workflowResumeHandler({ params: { id: 'run-1' } }, resumeRes);
    expect(resumeRes.body.run.status).toBe('completed');

    const eventsRes = createResponse();
    handlers.workflowEventsHandler({ query: { limit: 20 } }, eventsRes);
    expect(eventsRes.body.events).toHaveLength(1);

    const clustersRes = createResponse();
    await handlers.clustersHandler({}, clustersRes);
    expect(clustersRes.body.clusters).toHaveLength(1);

    const clusterRes = createResponse();
    await handlers.clusterDetailHandler({ params: { name: 'media' } }, clusterRes);
    expect(clusterRes.body.name).toBe('media');

    const clusterActionRes = createResponse();
    await handlers.clusterActionHandler({ params: { action: 'start', name: 'media' } }, clusterActionRes);
    expect(clusterActionRes.body.success).toBe(true);

    const serviceRes = createResponse();
    await handlers.serviceDetailHandler({ params: { name: 'nginx' } }, serviceRes);
    expect(serviceRes.body.running).toBe(true);

    const serviceActionRes = createResponse();
    await handlers.serviceActionHandler({ params: { action: 'restart', name: 'nginx' } }, serviceActionRes);
    expect(serviceActionRes.body.success).toBe(true);

    const metricsRes = createResponse();
    await handlers.metricsHandler({ query: {} }, metricsRes);
    expect(metricsRes.body.metrics.cpu).toBe(1);

    const healthRes = createResponse();
    await handlers.healthHandler({ query: {} }, healthRes);
    expect(healthRes.body.summary.healthy).toBe(1);

    const stateSnapshotRes = createResponse();
    await handlers.stateHandler({ query: {} }, stateSnapshotRes);
    expect(stateSnapshotRes.body.services).toBeTruthy();
  });

  it('returns 404 for unknown workflow run detail/resume', async () => {
    const controlPlane = {
      listWorkflowDefinitions: () => [],
      listWorkflowEvents: () => [],
      listWorkflowRuns: () => [],
      listClusters: async () => [],
      getServiceStateSnapshot: async () => ({ services: [] }),
      getCluster: async () => ({ name: 'x' }),
      getMetricsSnapshot: async () => ({}),
      getSystemState: async () => ({}),
      healthManager: {
        getSnapshot: () => ({}),
        runCheck: async () => ({}),
      },
      readServiceStateSnapshot: () => ({ services: [] }),
      restartCluster: async () => ({ name: 'x' }),
      startCluster: async () => ({ name: 'x' }),
      stopCluster: async () => ({ name: 'x' }),
      serviceManager: {
        control: async () => ({ success: true }),
        getServiceStatus: async () => ({ running: false }),
      },
      workflowEngine: { getWorkflowRun: () => null },
      buildCanonicalCatalog: async () => [],
      groupOrder: [],
      runWorkflow: async () => ({ id: 'run-1', status: 'queued' }),
      resumeWorkflow: async () => null,
      snapshotServiceState: async () => ({ services: [] }),
    };
    const handlers = buildControlPlaneHandlers({ controlPlane, pushDebugEvent: () => {} });

    const detailRes = createResponse();
    handlers.workflowRunDetailHandler({ params: { id: 'missing' } }, detailRes);
    expect(detailRes.statusCode).toBe(404);

    const resumeRes = createResponse();
    await handlers.workflowResumeHandler({ params: { id: 'missing' } }, resumeRes);
    expect(resumeRes.statusCode).toBe(404);
  });
});
