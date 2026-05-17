const fs = require('fs');
const path = require('path');

const safeLogTarget = (value) => String(value || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
const readV2Log = (target) => {
  const name = safeLogTarget(target);
  if (!name) {
    return null;
  }
  const projectRoot = process.env.PROJECT || path.resolve(__dirname, '../../..');
  const candidates = [
    path.join(projectRoot, 'logs', 'services', `${name}.log`),
    path.join(projectRoot, 'logs', 'clusters', `${name}.log`),
    path.join(projectRoot, 'logs', 'orchestrator', `${name}.log`),
    path.join(projectRoot, 'logs', `${name}.log`),
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    return {
      entries: [],
      path: candidates[0],
      target: name,
    };
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).slice(-300);
  return {
    entries: lines.map((line, index) => ({ line, index })),
    path: filePath,
    target: name,
  };
};

const buildDashboardHandlers = ({
  getLogsSnapshot,
  getVerboseLoggingEnabled,
  setVerboseLoggingEnabled,
  buildMarkdownLog,
  appDb,
  pushAuditEvent,
  getDashboardSnapshot,
  pushDebugEvent,
}) => {
  const logsHandler = (req, res) => {
    const target = req.query?.target || req.query?.service || req.query?.cluster || '';
    const v2Log = readV2Log(target);
    if (v2Log) {
      res.json({
        generatedAt: new Date().toISOString(),
        ...v2Log,
      });
      return;
    }
    res.json(getLogsSnapshot());
  };

  const loggingGetHandler = (req, res) => {
    res.json({
      verboseLoggingEnabled: getVerboseLoggingEnabled(),
      markdown: buildMarkdownLog(80),
    });
  };

  const loggingPostHandler = (req, res) => {
    const nextVerboseLoggingEnabled = Boolean(req.body?.enabled);
    setVerboseLoggingEnabled(nextVerboseLoggingEnabled);
    appDb.setSetting('logging.verboseEnabled', nextVerboseLoggingEnabled ? 'true' : 'false');
    pushAuditEvent(req, 'info', nextVerboseLoggingEnabled ? 'Verbose logging enabled' : 'Verbose logging disabled');
    res.json({
      success: true,
      verboseLoggingEnabled: nextVerboseLoggingEnabled,
      markdown: buildMarkdownLog(80),
    });
  };

  const dashboardHandler = async (req, res) => {
    try {
      const payload = await getDashboardSnapshot(req.session?.id);
      res.json(payload);
    } catch (err) {
      pushDebugEvent('error', 'Dashboard snapshot failed', { error: String(err) }, true);
      res.status(500).json({ error: 'Unable to build dashboard snapshot' });
    }
  };

  return {
    logsHandler,
    loggingGetHandler,
    loggingPostHandler,
    dashboardHandler,
  };
};

module.exports = {
  buildDashboardHandlers,
};
