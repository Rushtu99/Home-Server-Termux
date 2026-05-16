const toLifecycleState = (entry) => {
  const status = String(entry?.status || '').toLowerCase();
  const controlMode = String(entry?.controlMode || 'optional');

  if (status === 'blocked') {
    return 'blocked';
  }
  if (status === 'working' || status === 'external') {
    return 'healthy';
  }
  if (status === 'stopped') {
    return 'stopped';
  }
  if (status === 'stalled') {
    return controlMode === 'always_on' ? 'crashed' : 'degraded';
  }
  if (status === 'degraded') {
    return 'degraded';
  }
  if (status === 'unavailable' || status === 'deferred') {
    return 'degraded';
  }
  return 'degraded';
};

const buildServiceStateSnapshot = ({ catalog = [], services = {} } = {}) => {
  const entries = catalog.map((entry) => {
    const key = String(entry.key || '');
    const running = services && Object.prototype.hasOwnProperty.call(services, key)
      ? Boolean(services[key])
      : String(entry.status || '').toLowerCase() === 'working';

    const lifecycle = entry.type === 'worker' && String(entry.status || '').toLowerCase() === 'unknown'
      ? 'stopped'
      : (entry.state || toLifecycleState(entry));

    return {
      available: Boolean(entry.available),
      checkedAt: entry.checkedAt || entry.lastCheckedAt || null,
      key,
      label: entry.label || key,
      lifecycle,
      reason: entry.reason || entry.statusReason || entry.blocker || '',
      running,
      status: entry.status || 'unknown',
      type: entry.type || 'service',
      wrapper: entry.wrapper || null,
    };
  });

  const counts = entries.reduce((acc, entry) => {
    const state = String(entry.lifecycle || 'degraded');
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {
    blocked: 0,
    crashed: 0,
    degraded: 0,
    healthy: 0,
    stopped: 0,
  });

  let overall = 'healthy';
  if (counts.crashed > 0) {
    overall = 'crashed';
  } else if (counts.blocked > 0) {
    overall = 'blocked';
  } else if (counts.degraded > 0) {
    overall = 'degraded';
  } else if (counts.healthy === 0) {
    overall = 'stopped';
  }

  return {
    counts,
    services: entries,
    state: overall,
  };
};

const createHealthManager = ({
  serviceManager,
  eventBus,
  stateStore,
  intervalMs = 15000,
  maxRestarts = 3,
  restartWindowMs = 5 * 60 * 1000,
  now = () => Date.now(),
  logger = null,
} = {}) => {
  const serviceState = new Map();
  const restartHistory = new Map();
  let timer = null;

  const log = (message, meta = {}) => {
    if (logger && typeof logger.info === 'function') {
      logger.info(message, meta);
    }
  };

  const emit = (eventName, payload) => {
    if (eventBus && typeof eventBus.emit === 'function') {
      eventBus.emit(eventName, payload);
    }
  };

  const getRestartBudgetState = (name) => {
    const key = String(name || '');
    const history = Array.isArray(restartHistory.get(key)) ? restartHistory.get(key) : [];
    const nowMs = now();
    const activeWindow = history.filter((value) => nowMs - Number(value || 0) <= restartWindowMs);
    restartHistory.set(key, activeWindow);
    return {
      count: activeWindow.length,
      remaining: Math.max(0, maxRestarts - activeWindow.length),
    };
  };

  const recordRestart = (name) => {
    const key = String(name || '');
    const history = Array.isArray(restartHistory.get(key)) ? restartHistory.get(key) : [];
    history.push(now());
    restartHistory.set(key, history);
  };

  const classify = (statusPayload) => {
    if (!statusPayload) {
      return 'unknown';
    }
    if (statusPayload.running === true) {
      return 'healthy';
    }
    if (statusPayload.running === false) {
      return 'down';
    }
    return 'unknown';
  };

  const runCheck = async () => {
    if (!serviceManager || typeof serviceManager.listControlTargets !== 'function') {
      return {
        generatedAt: new Date(now()).toISOString(),
        services: {},
        summary: { down: 0, healthy: 0, recovering: 0, unknown: 0 },
      };
    }

    const targets = await serviceManager.listControlTargets();
    const snapshot = {
      generatedAt: new Date(now()).toISOString(),
      services: {},
      summary: { down: 0, healthy: 0, recovering: 0, unknown: 0 },
    };

    for (const target of targets) {
      const name = String(target || '');
      if (!name) {
        continue;
      }

      let statusPayload = null;
      try {
        statusPayload = await serviceManager.getServiceStatus(name);
      } catch (error) {
        statusPayload = {
          error: String(error?.message || error || 'status check failed'),
          running: false,
          service: name,
          success: false,
        };
      }

      const previous = serviceState.get(name) || 'unknown';
      let current = classify(statusPayload);
      let recovering = false;

      if (current === 'down') {
        const budget = getRestartBudgetState(name);
        if (budget.remaining > 0) {
          try {
            recordRestart(name);
            await serviceManager.restartService(name);
            const afterRestart = await serviceManager.getServiceStatus(name);
            if (afterRestart.running === true) {
              current = 'healthy';
              recovering = true;
              emit('SERVICE_RECOVERED', {
                recovery: 'auto-restart',
                service: name,
                timestamp: snapshot.generatedAt,
              });
              emit('service.recovered', {
                recovery: 'auto-restart',
                service: name,
                timestamp: snapshot.generatedAt,
              });
            }
          } catch (restartError) {
            statusPayload.error = String(restartError?.message || restartError || 'restart failed');
          }
        }

        if (current === 'down' && previous !== 'down') {
          emit('SERVICE_DOWN', {
            reason: statusPayload.error || 'health check failed',
            service: name,
            timestamp: snapshot.generatedAt,
          });
          emit('service.down', {
            reason: statusPayload.error || 'health check failed',
            service: name,
            timestamp: snapshot.generatedAt,
          });
        }
      }

      if (current === 'healthy' && previous === 'down' && !recovering) {
        emit('SERVICE_RECOVERED', {
          recovery: 'manual-or-external',
          service: name,
          timestamp: snapshot.generatedAt,
        });
        emit('service.recovered', {
          recovery: 'manual-or-external',
          service: name,
          timestamp: snapshot.generatedAt,
        });
      }

      serviceState.set(name, current);

      snapshot.services[name] = {
        checkedAt: snapshot.generatedAt,
        error: statusPayload?.error || '',
        restarting: recovering,
        running: Boolean(statusPayload?.running),
        state: recovering ? 'recovering' : current,
      };

      if (recovering) {
        snapshot.summary.recovering += 1;
      } else if (current === 'healthy') {
        snapshot.summary.healthy += 1;
      } else if (current === 'down') {
        snapshot.summary.down += 1;
      } else {
        snapshot.summary.unknown += 1;
      }
    }

    if (stateStore && typeof stateStore.writeHealthSnapshot === 'function') {
      stateStore.writeHealthSnapshot(snapshot);
    }

    return snapshot;
  };

  const start = () => {
    if (timer) {
      return;
    }
    log('health-manager.start', { intervalMs });
    timer = setInterval(() => {
      void runCheck();
    }, Math.max(3000, Number(intervalMs) || 15000));
    timer.unref?.();
    void runCheck();
  };

  const stop = () => {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = null;
    log('health-manager.stop');
  };

  const getSnapshot = () => {
    if (stateStore && typeof stateStore.readHealthSnapshot === 'function') {
      return stateStore.readHealthSnapshot();
    }
    return {
      generatedAt: new Date(now()).toISOString(),
      services: {},
      summary: { down: 0, healthy: 0, recovering: 0, unknown: 0 },
    };
  };

  return {
    getSnapshot,
    runCheck,
    start,
    stop,
  };
};

module.exports = {
  buildServiceStateSnapshot,
  createHealthManager,
  toLifecycleState,
};
