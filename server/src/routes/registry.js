const createRouteRegistry = ({
  app,
  rawBodyParser = null,
  envLoadGuardEnabled = true,
  jsonBodyLimit = '256kb',
  getTrustProxy = () => '',
  pollIntervalMs = 10000,
} = {}) => {
  const routeManifestRegistry = [];
  let routeRegistrationIndex = 0;
  let firstAuthRouteIndex = null;
  let firstDualRouteIndex = null;
  let errorMiddlewareIndex = null;

  const toRouteToken = (handler, method, routePath, position) => {
    if (typeof handler === 'function' && handler.name) {
      return handler.name;
    }
    return `anonymous@${method}:${routePath}:${position}`;
  };

  const routeMirrorPath = (routePath) =>
    String(routePath || '').startsWith('/api/')
      ? String(routePath || '').replace(/^\/api/, '')
      : `/api${routePath}`;

  const routeMirrorGroup = (routePath) =>
    String(routePath || '').startsWith('/api/')
      ? String(routePath || '').replace(/^\/api/, '')
      : String(routePath || '');

  const isRawBodyParserHandler = (handler) =>
    handler === rawBodyParser
    || (typeof handler === 'function' && String(handler.name || '').toLowerCase().includes('raw'));

  const registerTrackedRoute = ({ method, routePath, handlers, registrar }) => {
    app[method](routePath, ...handlers);
    const methodUpper = String(method || '').toUpperCase();
    const registrationIndex = routeRegistrationIndex;
    routeRegistrationIndex += 1;

    if (registrar === 'explicit-auth' && firstAuthRouteIndex === null) {
      firstAuthRouteIndex = registrationIndex;
    }
    if (registrar === 'dual-route' && firstDualRouteIndex === null) {
      firstDualRouteIndex = registrationIndex;
    }

    const handler = handlers[handlers.length - 1] || null;
    const authHandlers = handlers.slice(0, -1);

    routeManifestRegistry.push({
      registrationIndex,
      method: methodUpper,
      path: routePath,
      mirrorPath: routeMirrorPath(routePath),
      mirrorGroup: routeMirrorGroup(routePath),
      authChain: authHandlers.map((entry, index) => toRouteToken(entry, methodUpper, routePath, index)),
      middlewareChain: handlers.map((entry, index) => toRouteToken(entry, methodUpper, routePath, index)),
      handlerName: toRouteToken(handler, methodUpper, routePath, Math.max(0, handlers.length - 1)),
      rawBodyParser: handlers.some(isRawBodyParserHandler),
      registrar,
    });
  };

  const registerAuthRoute = (method, routePath, ...handlers) =>
    registerTrackedRoute({ method, routePath, handlers, registrar: 'explicit-auth' });

  const registerDualRoute = (method, routePath, ...handlers) => {
    registerTrackedRoute({ method, routePath, handlers, registrar: 'dual-route' });
    registerTrackedRoute({ method, routePath: `/api${routePath}`, handlers, registrar: 'dual-route' });
  };

  const markErrorMiddlewareRegistered = () => {
    errorMiddlewareIndex = routeRegistrationIndex;
  };

  const buildRouteManifestSnapshot = () => ({
    schemaVersion: 1,
    sourceEntrypoint: 'server/index.js',
    totalRoutes: routeManifestRegistry.length,
    routes: routeManifestRegistry.map((entry) => ({ ...entry })),
  });

  const buildStartupInvariantsSnapshot = () => ({
    schemaVersion: 1,
    sourceEntrypoint: 'server/index.js',
    invariants: {
      envLoadGuardEnabled: Boolean(envLoadGuardEnabled),
      trustProxy: String(getTrustProxy() || ''),
      jsonBodyLimit: String(jsonBodyLimit || '256kb'),
      authRoutesBeforeDualRoutes: firstAuthRouteIndex !== null && firstDualRouteIndex !== null
        ? firstAuthRouteIndex < firstDualRouteIndex
        : false,
      errorMiddlewareLast: errorMiddlewareIndex !== null ? errorMiddlewareIndex >= (routeRegistrationIndex - 1) : false,
      pollIntervalMs: Number(pollIntervalMs || 10000),
    },
    registrationOrder: {
      firstAuthRouteIndex,
      firstDualRouteIndex,
      errorMiddlewareIndex,
      lastRouteIndex: Math.max(-1, routeRegistrationIndex - 1),
    },
  });

  return {
    registerAuthRoute,
    registerDualRoute,
    markErrorMiddlewareRegistered,
    buildRouteManifestSnapshot,
    buildStartupInvariantsSnapshot,
    routeManifestRegistry,
  };
};

module.exports = {
  createRouteRegistry,
};
