const buildSystemHandlers = ({
  os,
  getNetworkExposureSnapshot,
  pushAuditEvent,
}) => {
  const statusHandler = (req, res) => {
    res.json({
      uptime: `${(os.uptime() / 3600).toFixed(1)} hrs`,
    });
  };

  const networkExposureHandler = async (req, res) => {
    try {
      res.json(await getNetworkExposureSnapshot({ force: String(req.query.force || '') === 'true' }));
    } catch (err) {
      pushAuditEvent(req, 'error', 'Network exposure audit failed', { error: String(err) });
      res.status(500).json({ error: 'Unable to build network exposure audit' });
    }
  };

  return {
    statusHandler,
    networkExposureHandler,
  };
};

module.exports = {
  buildSystemHandlers,
};
