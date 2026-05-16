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
