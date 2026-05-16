const buildControlPlaneHandlers = ({ controlPlane, pushDebugEvent }) => {
  if (!controlPlane) {
    const unavailable = (req, res) => res.status(503).json({ error: 'Control plane is not initialized' });
    return {
      catalogServicesHandler: unavailable,
      catalogWorkersHandler: unavailable,
      clusterActionHandler: unavailable,
      clusterDetailHandler: unavailable,
      clustersHandler: unavailable,
      healthHandler: unavailable,
      metricsHandler: unavailable,
      serviceActionHandler: unavailable,
      serviceDetailHandler: unavailable,
      stateHandler: unavailable,
      workflowDefinitionsHandler: unavailable,
      workflowDetailHandler: unavailable,
      workflowEventsHandler: unavailable,
      workflowResumeHandler: unavailable,
      workflowRunDetailHandler: unavailable,
      workflowRunHandler: unavailable,
      workflowRunsHandler: unavailable,
      workflowStartHandler: unavailable,
      workflowStateServicesHandler: unavailable,
    };
  }

  const catalogServicesHandler = async (req, res) => {
    const catalog = await controlPlane.buildCanonicalCatalog();
    const services = catalog.filter((entry) => entry.type === 'service');
    res.json({
      generatedAt: new Date().toISOString(),
      groups: controlPlane.groupOrder,
      services,
    });
  };

  const catalogWorkersHandler = async (req, res) => {
    const catalog = await controlPlane.buildCanonicalCatalog();
    const workers = catalog.filter((entry) => entry.type === 'worker');
    res.json({
      generatedAt: new Date().toISOString(),
      workers,
    });
  };

  const workflowStateServicesHandler = async (req, res) => {
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const payload = typeof controlPlane.getServiceStateSnapshot === 'function'
      ? await controlPlane.getServiceStateSnapshot({ force })
      : (force
        ? await controlPlane.snapshotServiceState()
        : controlPlane.readServiceStateSnapshot());

    res.json({
      generatedAt: new Date().toISOString(),
      ...payload,
    });
  };

  const workflowDefinitionsHandler = (req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      workflows: controlPlane.listWorkflowDefinitions(),
    });
  };

  const workflowRunsHandler = (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 60) || 60));
    res.json({
      generatedAt: new Date().toISOString(),
      runs: controlPlane.listWorkflowRuns({ limit }),
    });
  };

  const workflowRunDetailHandler = (req, res) => {
    const run = controlPlane.workflowEngine.getWorkflowRun(req.params.id || '');
    if (!run) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    return res.json(run);
  };

  const runWorkflowInternal = async ({ key, metadata = {}, input = {} }) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      throw new Error('Workflow key is required');
    }

    return controlPlane.runWorkflow({
      key: normalizedKey,
      input,
      metadata,
    });
  };

  const workflowRunHandler = async (req, res) => {
    const key = String(req.params.key || req.body?.key || '').trim();
    if (!key) {
      return res.status(400).json({ error: 'Workflow key is required' });
    }

    try {
      const run = await runWorkflowInternal({
        key,
        input: req.body?.input && typeof req.body.input === 'object' ? req.body.input : {},
        metadata: {
          actor: String(req.user?.sub || req.session?.username || ''),
          source: 'api',
        },
      });

      return res.status(202).json({
        success: ['running', 'queued'].includes(String(run.status || '')),
        run,
      });
    } catch (error) {
      pushDebugEvent('error', 'Workflow start failed', { error: String(error) }, true);
      return res.status(500).json({ error: String(error?.message || error || 'Unable to start workflow') });
    }
  };

  const workflowStartHandler = async (req, res) => {
    const name = String(req.params.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Workflow name is required' });
    }

    try {
      const run = await runWorkflowInternal({
        key: name,
        input: req.body?.input && typeof req.body.input === 'object' ? req.body.input : {},
        metadata: {
          actor: String(req.user?.sub || req.session?.username || ''),
          source: 'api',
        },
      });

      return res.status(202).json({
        success: ['running', 'queued'].includes(String(run.status || '')),
        run,
      });
    } catch (error) {
      pushDebugEvent('error', 'Workflow start failed', { error: String(error) }, true);
      return res.status(500).json({ error: String(error?.message || error || 'Unable to start workflow') });
    }
  };

  const workflowResumeHandler = async (req, res) => {
    try {
      const run = await controlPlane.resumeWorkflow(req.params.id || '');
      if (!run) {
        return res.status(404).json({ error: 'Workflow run not found' });
      }
      return res.json({ success: true, run });
    } catch (error) {
      pushDebugEvent('error', 'Workflow resume failed', { error: String(error) }, true);
      return res.status(500).json({ error: String(error?.message || error || 'Unable to resume workflow') });
    }
  };

  const workflowEventsHandler = (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200) || 200));
    const sinceRaw = String(req.query.since || '').trim();
    const since = sinceRaw ? Date.parse(sinceRaw) : null;

    res.json({
      events: controlPlane.listWorkflowEvents({
        limit,
        since: Number.isFinite(since) ? since : null,
      }),
      generatedAt: new Date().toISOString(),
    });
  };

  const clustersHandler = async (req, res) => {
    try {
      const payload = await controlPlane.listClusters();
      return res.json({
        clusters: payload,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({ error: String(error?.message || error || 'Unable to list clusters') });
    }
  };

  const clusterDetailHandler = async (req, res) => {
    try {
      const payload = await controlPlane.getCluster(req.params.name || '');
      return res.json(payload);
    } catch (error) {
      const message = String(error?.message || error || 'Unable to resolve cluster');
      if (message.toLowerCase().includes('unknown cluster')) {
        return res.status(404).json({ error: message });
      }
      return res.status(500).json({ error: message });
    }
  };

  const clusterActionHandler = async (req, res) => {
    const routePath = String(req.params.action || req.path || req.originalUrl || '').trim().toLowerCase();
    const action = ['start', 'stop', 'restart'].find((token) => routePath.endsWith(`/${token}`)) || String(req.params.action || '').trim().toLowerCase();
    const name = String(req.params.name || '').trim();
    if (!name || !['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ error: 'Invalid cluster action' });
    }

    try {
      const payload = action === 'start'
        ? await controlPlane.startCluster(name)
        : action === 'stop'
          ? await controlPlane.stopCluster(name)
          : await controlPlane.restartCluster(name);

      return res.json({
        action,
        cluster: payload,
        success: true,
      });
    } catch (error) {
      const message = String(error?.message || error || 'Cluster action failed');
      if (message.toLowerCase().includes('unknown cluster')) {
        return res.status(404).json({ error: message });
      }
      return res.status(500).json({ error: message });
    }
  };

  const serviceDetailHandler = async (req, res) => {
    const name = String(req.params.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Service name is required' });
    }

    try {
      const status = await controlPlane.serviceManager.getServiceStatus(name);
      return res.json(status);
    } catch (error) {
      const message = String(error?.message || error || 'Unable to get service status');
      if (message.toLowerCase().includes('unknown service')) {
        return res.status(404).json({ error: message });
      }
      return res.status(500).json({ error: message });
    }
  };

  const serviceActionHandler = async (req, res) => {
    const name = String(req.params.name || '').trim();
    const routePath = String(req.params.action || req.path || req.originalUrl || '').trim().toLowerCase();
    const action = ['start', 'stop', 'restart'].find((token) => routePath.endsWith(`/${token}`)) || String(req.params.action || '').trim().toLowerCase();
    if (!name || !['start', 'stop', 'restart'].includes(action)) {
      return res.status(400).json({ error: 'Invalid service action' });
    }

    try {
      const payload = await controlPlane.serviceManager.control({
        action,
        service: name,
      });
      return res.json(payload);
    } catch (error) {
      const message = String(error?.message || error || 'Service action failed');
      if (message.toLowerCase().includes('unknown service')) {
        return res.status(404).json({ error: message });
      }
      if (error?.code === 'blocked_by_storage') {
        return res.status(423).json({
          blockedBy: 'storage_watchdog',
          error: message,
          service: name,
          state: error.state || 'unknown',
        });
      }
      return res.status(500).json({ error: message });
    }
  };

  const workflowDetailHandler = (req, res) => {
    const key = String(req.params.id || '').trim();
    if (!key) {
      return res.status(400).json({ error: 'Workflow id is required' });
    }

    const run = controlPlane.workflowEngine.getWorkflowRun(key);
    if (run) {
      return res.json(run);
    }

    const definition = controlPlane
      .listWorkflowDefinitions()
      .find((entry) => String(entry.key || '') === key);

    if (definition) {
      return res.json({
        generatedAt: new Date().toISOString(),
        type: 'definition',
        workflow: definition,
      });
    }

    return res.status(404).json({ error: 'Workflow not found' });
  };

  const metricsHandler = async (req, res) => {
    try {
      const force = String(req.query.force || '').toLowerCase() === 'true';
      const metrics = await controlPlane.getMetricsSnapshot({ force });
      return res.json(metrics);
    } catch (error) {
      return res.status(500).json({ error: String(error?.message || error || 'Unable to fetch metrics') });
    }
  };

  const healthHandler = async (req, res) => {
    try {
      const force = String(req.query.force || '').toLowerCase() === 'true';
      const snapshot = force
        ? await controlPlane.healthManager.runCheck()
        : controlPlane.healthManager.getSnapshot();
      return res.json(snapshot);
    } catch (error) {
      return res.status(500).json({ error: String(error?.message || error || 'Unable to fetch health') });
    }
  };

  const stateHandler = async (req, res) => {
    try {
      const force = String(req.query.force || '').toLowerCase() === 'true';
      const payload = await controlPlane.getSystemState({ force });
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: String(error?.message || error || 'Unable to fetch state') });
    }
  };

  return {
    catalogServicesHandler,
    catalogWorkersHandler,
    clusterActionHandler,
    clusterDetailHandler,
    clustersHandler,
    healthHandler,
    metricsHandler,
    serviceActionHandler,
    serviceDetailHandler,
    stateHandler,
    workflowDefinitionsHandler,
    workflowDetailHandler,
    workflowEventsHandler,
    workflowResumeHandler,
    workflowRunDetailHandler,
    workflowRunHandler,
    workflowRunsHandler,
    workflowStartHandler,
    workflowStateServicesHandler,
  };
};

module.exports = {
  buildControlPlaneHandlers,
};
