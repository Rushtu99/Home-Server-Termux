const { buildAuthHandlers } = require('../handlers/auth-handlers');
const { buildControlPlaneHandlers } = require('../handlers/control-plane-handlers');
const { buildDashboardHandlers } = require('../handlers/dashboard-handlers');
const { buildFilesHandlers } = require('../handlers/files-handlers');
const { buildFtpHandlers } = require('../handlers/ftp-handlers');
const { buildLlmHandlers } = require('../handlers/llm-handlers');
const { buildServiceHandlers } = require('../handlers/service-handlers');
const { buildSystemHandlers } = require('../handlers/system-handlers');

const createAuthRouteHandlers = (dependencies) => buildAuthHandlers(dependencies);
const createControlPlaneRouteHandlers = (dependencies) => buildControlPlaneHandlers(dependencies);
const createDashboardRouteHandlers = (dependencies) => buildDashboardHandlers(dependencies);
const createFilesRouteHandlers = (dependencies) => buildFilesHandlers(dependencies);
const createFtpRouteHandlers = (dependencies) => buildFtpHandlers(dependencies);
const createLlmRouteHandlers = (dependencies) => buildLlmHandlers(dependencies);
const createServiceRouteHandlers = (dependencies) => buildServiceHandlers(dependencies);
const createSystemRouteHandlers = (dependencies) => buildSystemHandlers(dependencies);

module.exports = {
  createAuthRouteHandlers,
  createControlPlaneRouteHandlers,
  createDashboardRouteHandlers,
  createFilesRouteHandlers,
  createFtpRouteHandlers,
  createLlmRouteHandlers,
  createServiceRouteHandlers,
  createSystemRouteHandlers,
};
