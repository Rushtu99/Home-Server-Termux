const { createRouteRegistry } = require('./registry');
const { registerAuthRoutes } = require('./auth-routes');
const { createDualRouteRegistrar } = require('./dual-route');
const { registerApiRoutes } = require('./register-api-routes');
const {
  createAuthRouteHandlers,
  createControlPlaneRouteHandlers,
  createDashboardRouteHandlers,
  createFilesRouteHandlers,
  createFtpRouteHandlers,
  createLlmRouteHandlers,
  createServiceRouteHandlers,
  createSystemRouteHandlers,
} = require('./route-handlers');

module.exports = {
  createRouteRegistry,
  registerAuthRoutes,
  createDualRouteRegistrar,
  registerApiRoutes,
  createAuthRouteHandlers,
  createControlPlaneRouteHandlers,
  createDashboardRouteHandlers,
  createFilesRouteHandlers,
  createFtpRouteHandlers,
  createLlmRouteHandlers,
  createServiceRouteHandlers,
  createSystemRouteHandlers,
};
