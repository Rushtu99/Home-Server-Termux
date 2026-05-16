const { buildAuthHandlers } = require('./auth-handlers');
const { buildDashboardHandlers } = require('./dashboard-handlers');
const { buildControlPlaneHandlers } = require('./control-plane-handlers');
const { buildFilesHandlers } = require('./files-handlers');
const { buildFtpHandlers } = require('./ftp-handlers');
const { buildLlmHandlers } = require('./llm-handlers');
const { buildServiceHandlers } = require('./service-handlers');
const { buildSystemHandlers } = require('./system-handlers');

module.exports = {
  buildAuthHandlers,
  buildDashboardHandlers,
  buildControlPlaneHandlers,
  buildFilesHandlers,
  buildFtpHandlers,
  buildLlmHandlers,
  buildServiceHandlers,
  buildSystemHandlers,
};
