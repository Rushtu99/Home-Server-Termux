const createServerLifecycle = ({
  app,
  createApp,
  pollServiceStateTransitions,
  pushDebugEvent,
  pollIntervalMs,
  defaultHost,
  defaultPort,
}) => {
  const runtimeState = {
    server: null,
    pollIntervalId: null,
    pollInFlight: false,
  };

  const startPolling = () => {
    if (runtimeState.pollIntervalId) {
      return;
    }
    runtimeState.pollIntervalId = setInterval(() => {
      if (runtimeState.pollInFlight) {
        return;
      }
      runtimeState.pollInFlight = true;
      pollServiceStateTransitions().catch((err) => {
        pushDebugEvent('error', 'Service state polling failed', { error: String(err) }, true);
      }).finally(() => {
        runtimeState.pollInFlight = false;
      });
    }, pollIntervalMs);
  };

  const stopPolling = () => {
    if (!runtimeState.pollIntervalId) {
      return;
    }
    clearInterval(runtimeState.pollIntervalId);
    runtimeState.pollIntervalId = null;
    runtimeState.pollInFlight = false;
  };

  const startServer = async (options = {}) => {
    if (runtimeState.server) {
      const currentAddress = runtimeState.server.address();
      return {
        server: runtimeState.server,
        appRuntime: createApp(options),
        host: typeof currentAddress === 'object' && currentAddress ? currentAddress.address : (options.host || defaultHost),
        port: typeof currentAddress === 'object' && currentAddress ? currentAddress.port : (Number(options.port) || defaultPort),
      };
    }

    const host = options.host || defaultHost;
    const requestedPort = Number(options.port);
    const port = Number.isFinite(requestedPort) ? requestedPort : defaultPort;
    const enablePolling = options.enablePolling !== false;
    const appRuntime = createApp({ ...options, enablePolling });

    const server = await new Promise((resolve, reject) => {
      const instance = app.listen(port, host, () => resolve(instance));
      instance.on('error', reject);
    });
    runtimeState.server = server;

    const address = server.address();
    const resolvedHost = typeof address === 'object' && address ? address.address : host;
    const resolvedPort = typeof address === 'object' && address ? address.port : port;

    if (enablePolling) {
      startPolling();
    } else {
      stopPolling();
    }

    if (!options.silent) {
      console.log(`🚀 Backend running on ${resolvedHost}:${resolvedPort}`);
    }
    pushDebugEvent('info', 'Backend loaded', { host: resolvedHost, port: resolvedPort }, true);

    return {
      server,
      appRuntime,
      host: resolvedHost,
      port: resolvedPort,
    };
  };

  const stopServer = async (runtime = null) => {
    stopPolling();
    const server = runtime?.server || runtimeState.server;
    if (!server) {
      return;
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    if (server === runtimeState.server) {
      runtimeState.server = null;
    }
  };

  return {
    runtimeState,
    startPolling,
    stopPolling,
    startServer,
    stopServer,
  };
};

module.exports = {
  createServerLifecycle,
};
