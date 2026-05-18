const buildServiceHandlers = ({
  getServicesSnapshot,
  getControlledServiceNames,
  buildServiceCatalog,
  pushDebugEvent,
  isServiceControllerUnlocked,
  buildStackLifecycleSummary,
  buildServiceGroups,
  buildMediaWorkflowSnapshot,
  secureCompare,
  ADMIN_ACTION_PASSWORD,
  pushAuditEvent,
  unlockServiceController,
  unlockedServiceControllers,
  getManageableServiceNames,
  SERVICES,
  readStorageProtectionState,
  getStorageBlockForService,
  resolveServiceInstall,
  runCommand,
  waitForServiceState,
  serviceStateCache,
  classifyServiceState,
  clearStorageResumeRequirementForService,
  getMonitorSnapshot,
  getTelemetrySnapshot,
  getConnectionsSnapshot,
  activeSessions,
  invalidateSession,
  recentConnections,
  getStorageSnapshot,
  controlPlane,
}) => {
  const wrapOperation = (action, handler) => {
    if (!controlPlane || typeof controlPlane.wrapHandler !== 'function') {
      return handler;
    }
    return controlPlane.wrapHandler({ scope: 'service', action }, handler);
  };

  const servicesHandler = async (req, res) => {
    const [controlledServiceNames, serviceCatalog] = await Promise.all([
      getControlledServiceNames(),
      controlPlane && typeof controlPlane.buildCanonicalCatalog === 'function'
        ? controlPlane.buildCanonicalCatalog()
        : buildServiceCatalog(),
    ]);
    const result = serviceCatalog.reduce((acc, entry) => {
      if (entry.type !== 'service' || !entry.available) {
        return acc;
      }
      acc[entry.key] = entry.status === 'working' || entry.status === 'external';
      return acc;
    }, {});

    pushDebugEvent('info', 'Services snapshot served', { count: Object.keys(result).length });
    res.json({
      controller: {
        locked: !isServiceControllerUnlocked(req.session?.id),
        optionalServices: controlledServiceNames,
      },
      lifecycle: buildStackLifecycleSummary(serviceCatalog),
      services: result,
      serviceCatalog,
      serviceGroups: buildServiceGroups(serviceCatalog),
      mediaWorkflow: buildMediaWorkflowSnapshot(serviceCatalog),
    });
  };

  const controlUnlockHandler = (req, res) => {
    const password = String(req.body?.adminPassword || '');
    if (!password) {
      return res.status(400).json({ error: 'Admin password is required' });
    }

    if (!secureCompare(password, ADMIN_ACTION_PASSWORD)) {
      pushAuditEvent(req, 'warn', 'Service controller unlock rejected (bad admin password)');
      return res.status(403).json({ error: 'Invalid admin password' });
    }

    const expiresAt = unlockServiceController(req.session?.id);
    pushAuditEvent(req, 'info', 'Service controller unlocked', { expiresAt: new Date(expiresAt).toISOString() });
    return res.json({
      success: true,
      locked: false,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  };

  const controlLockHandler = (req, res) => {
    if (req.session?.id) {
      unlockedServiceControllers.delete(req.session.id);
    }

    pushAuditEvent(req, 'info', 'Service controller locked');
    return res.json({ success: true, locked: true });
  };

  const controlHandler = async (req, res) => {
    const { service, action, adminPassword } = req.body || {};
    const controlledServiceNames = await getManageableServiceNames();
    const normalizedAction = String(action || '').trim().toLowerCase();

    if (!controlledServiceNames.includes(service)) {
      return res.status(400).json({ error: 'Unknown service' });
    }

    if (!['start', 'stop', 'restart'].includes(normalizedAction)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (!Object.prototype.hasOwnProperty.call(SERVICES[service], normalizedAction)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const providedPassword = String(adminPassword || '').trim();
    const unlocked = isServiceControllerUnlocked(req.session?.id);

    if (!unlocked) {
      if (!providedPassword) {
        return res.status(423).json({ error: 'Service controller is locked' });
      }
      if (!secureCompare(providedPassword, ADMIN_ACTION_PASSWORD)) {
        pushAuditEvent(req, 'warn', 'Service control rejected (bad admin password)', { service, action: normalizedAction });
        return res.status(403).json({ error: 'Invalid admin password' });
      }
      unlockServiceController(req.session?.id);
    } else if (providedPassword && !secureCompare(providedPassword, ADMIN_ACTION_PASSWORD)) {
      pushAuditEvent(req, 'warn', 'Service control rejected (bad admin password)', { service, action: normalizedAction });
      return res.status(403).json({ error: 'Invalid admin password' });
    }

    try {
      const serviceManager = controlPlane?.serviceManager;
      const outcome = serviceManager && typeof serviceManager.control === 'function'
        ? await serviceManager.control({ service, action: normalizedAction })
        : await (async () => {
          const svc = SERVICES[service];
          const storageProtection = readStorageProtectionState();
          const storageBlock = getStorageBlockForService(service, storageProtection);

          if (['start', 'restart'].includes(normalizedAction)) {
            if (storageBlock.blocked) {
              const blockedError = new Error(storageBlock.reason || 'Service is blocked by storage watchdog');
              blockedError.code = 'blocked_by_storage';
              blockedError.state = storageProtection.state;
              throw blockedError;
            }
            const install = await resolveServiceInstall(service, svc);
            if (!install.available) {
              throw new Error(`Command '${install.label}' is not installed`);
            }
          }

          const output = await runCommand(svc[normalizedAction]);
          const expectedRunning = normalizedAction !== 'stop';
          const running = await waitForServiceState(svc, expectedRunning);
          serviceStateCache[service] = classifyServiceState(running);

          if (running && expectedRunning && ['start', 'restart'].includes(normalizedAction)) {
            clearStorageResumeRequirementForService(service);
          }

          return {
            success: running === expectedRunning,
            running,
            expectedRunning,
            output,
          };
        })();

      pushAuditEvent(
        req,
        outcome.success ? 'info' : 'warn',
        `${service} ${normalizedAction} requested`,
        { running: outcome.running, expectedRunning: outcome.expectedRunning, output: outcome.output || '(no output)', service, action: normalizedAction }
      );
      res.json(outcome);
    } catch (err) {
      if (err && err.code === 'blocked_by_storage') {
        pushAuditEvent(req, 'warn', `${service} ${normalizedAction} blocked by storage watchdog`, { service, action: normalizedAction, error: err.message });
        return res.status(423).json({
          error: String(err.message || 'Service is blocked by storage watchdog'),
          blockedBy: 'storage_watchdog',
          service,
          state: err.state || readStorageProtectionState()?.state || 'unknown',
        });
      }
      const errorText = String(err || 'Unknown error');
      const hint = errorText.includes('Operation not permitted')
        ? 'Permission denied while controlling service. Stop root-owned process first or run service as the same user.'
        : null;
      pushAuditEvent(req, 'error', `${service} ${normalizedAction} failed`, { error: errorText, hint, service, action: normalizedAction });
      res.status(500).json({ error: errorText, hint });
    }
  };

  const monitorHandler = async (req, res) => {
    const payload = await getMonitorSnapshot();

    res.json(payload);
    pushDebugEvent('info', 'Monitor snapshot served', { cpuLoad: Number(payload.cpuLoad.toFixed(2)) });
  };

  const telemetryHandler = async (req, res) => {
    try {
      const payload = await getTelemetrySnapshot(req.session?.id);
      res.json(payload);
    } catch (err) {
      pushDebugEvent('error', 'Telemetry snapshot failed', { error: String(err) }, true);
      res.status(500).json({ error: 'Unable to build telemetry snapshot' });
    }
  };

  const connectionsHandler = (req, res) => {
    const payload = getConnectionsSnapshot();

    pushDebugEvent('info', 'Connections snapshot served', { count: payload.users.length });
    res.json(payload);
  };

  const disconnectConnectionHandler = (req, res) => {
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'Connection id is required' });
    }

    if (sessionId === String(req.session?.id || '')) {
      return res.status(400).json({ error: 'You cannot disconnect your current session' });
    }

    const session = activeSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    invalidateSession(sessionId);

    for (const [key, entry] of recentConnections.entries()) {
      if (entry.sessionId === sessionId) {
        recentConnections.delete(key);
      }
    }

    pushAuditEvent(req, 'warn', 'Dashboard session disconnected', {
      sessionId,
      username: session.username,
    });

    return res.json({
      sessionId,
      success: true,
      username: session.username,
    });
  };

  const storageHandler = async (req, res) => {
    try {
      const payload = await getStorageSnapshot();
      pushDebugEvent('info', 'Storage snapshot served', { count: payload.mounts.length });
      res.json(payload);
    } catch (err) {
      pushDebugEvent('error', 'Storage snapshot failed', { error: String(err) }, true);
      res.status(500).json({ error: String(err), mounts: [], summary: { totalSize: 0, totalUsed: 0 } });
    }
  };

  return {
    servicesHandler: wrapOperation('services.snapshot', servicesHandler),
    controlUnlockHandler: wrapOperation('control.unlock', controlUnlockHandler),
    controlLockHandler: wrapOperation('control.lock', controlLockHandler),
    controlHandler: wrapOperation('control.service', controlHandler),
    monitorHandler: wrapOperation('monitor.snapshot', monitorHandler),
    telemetryHandler: wrapOperation('telemetry.snapshot', telemetryHandler),
    connectionsHandler: wrapOperation('connections.snapshot', connectionsHandler),
    disconnectConnectionHandler: wrapOperation('connections.disconnect', disconnectConnectionHandler),
    storageHandler: wrapOperation('storage.snapshot', storageHandler),
  };
};

module.exports = {
  buildServiceHandlers,
};
