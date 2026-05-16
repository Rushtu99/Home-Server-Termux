const buildFtpHandlers = ({
  getCloudMountCapability,
  DEFAULT_PS4_FTP_NAME,
  DEFAULT_PS4_HOST,
  DEFAULT_PS4_PORT,
  DEFAULT_PS4_USER,
  FTP_CLIENT_DOWNLOAD_ROOT,
  processEnv,
  appDb,
  serializeFtpFavourite,
  validateFtpFavouriteInput,
  pushAuditEvent,
  getFtpFavouriteOrThrow,
  getFtpMountState,
  unmountFtpFavourite,
  fs,
  getFtpFavouriteRuntime,
  mountFtpFavourite,
  listFtpDirectory,
  resolveFtpFavouritePayload,
  normalizeRemotePath,
  path,
  sanitizeFtpFavouriteName,
  sanitizeHostLabel,
  normalizeLocalRelativePath,
  ensureWithinRoot,
  withFtpClient,
  downloadFtpDirectoryTree,
  controlPlane,
}) => {
  const ftpDefaultsHandler = (req, res) => {
    const ftpMounting = getCloudMountCapability();
    res.json({
      defaultName: DEFAULT_PS4_FTP_NAME,
      host: processEnv.FTP_CLIENT_HOST || DEFAULT_PS4_HOST,
      port: Number(processEnv.FTP_CLIENT_PORT || DEFAULT_PS4_PORT),
      user: processEnv.FTP_CLIENT_USER || DEFAULT_PS4_USER,
      secure: processEnv.FTP_CLIENT_SECURE === 'true',
      downloadRoot: FTP_CLIENT_DOWNLOAD_ROOT,
      ftpMounting,
    });
  };

  const ftpFavouritesHandler = (req, res) => {
    res.json({
      favourites: appDb.listFtpFavourites().map(serializeFtpFavourite),
    });
  };

  const createFtpFavouriteHandler = (req, res) => {
    try {
      const favourite = appDb.createFtpFavourite(validateFtpFavouriteInput(req.body || {}));
      pushAuditEvent(req, 'info', 'FTP favourite created', { id: favourite.id, name: favourite.name });
      res.status(201).json({ favourite: serializeFtpFavourite(favourite) });
    } catch (err) {
      const error = String(err?.message || err || 'Unable to create FTP favourite');
      pushAuditEvent(req, 'error', 'FTP favourite creation failed', { error });
      res.status(400).json({ error });
    }
  };

  const updateFtpFavouriteHandler = async (req, res) => {
    try {
      const existing = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });
      const currentMount = getFtpMountState(existing);
      if (currentMount.mounted || currentMount.running) {
        await unmountFtpFavourite(existing).catch(() => {});
      }

      const favourite = appDb.updateFtpFavourite(existing.id, validateFtpFavouriteInput(req.body || {}, existing));
      pushAuditEvent(req, 'info', 'FTP favourite updated', { id: favourite.id, name: favourite.name });
      res.json({ favourite: serializeFtpFavourite(favourite) });
    } catch (err) {
      const message = String(err?.message || err || 'Unable to update FTP favourite');
      const status = /not found/i.test(message) ? 404 : 400;
      pushAuditEvent(req, 'error', 'FTP favourite update failed', { error: message });
      res.status(status).json({ error: message });
    }
  };

  const deleteFtpFavouriteHandler = async (req, res) => {
    try {
      const favourite = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });

      await unmountFtpFavourite(favourite).catch(() => {});
      appDb.deleteFtpFavourite(favourite.id);
      fs.rmSync(getFtpFavouriteRuntime(favourite).helperRequestPath, { force: true });

      pushAuditEvent(req, 'info', 'FTP favourite deleted', { id: favourite.id, name: favourite.name });
      res.json({ success: true });
    } catch (err) {
      const message = String(err?.message || err || 'Unable to delete FTP favourite');
      const status = /not found/i.test(message) ? 404 : 400;
      pushAuditEvent(req, 'error', 'FTP favourite deletion failed', { error: message });
      res.status(status).json({ error: message });
    }
  };

  const mountFtpFavouriteHandler = async (req, res) => {
    try {
      const favourite = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });
      const mount = await mountFtpFavourite(favourite);
      const payload = serializeFtpFavourite(getFtpFavouriteOrThrow(favourite.id, { includeSecrets: false }));

      if (!mount.mounted) {
        const error = mount.error || mount.reason || 'Mount failed on this host';
        pushAuditEvent(req, 'error', 'FTP favourite mount failed', { id: favourite.id, name: favourite.name, error });
        return res.status(500).json({ error, favourite: payload });
      }

      pushAuditEvent(req, 'info', 'FTP favourite mounted', {
        id: favourite.id,
        name: favourite.name,
        mirrorMountPoint: mount.mirrorMountPoint,
        mountPoint: mount.mountPoint,
      });
      return res.json({ success: true, favourite: payload });
    } catch (err) {
      const error = String(err?.message || err || 'Unable to mount FTP favourite');
      pushAuditEvent(req, 'error', 'FTP favourite mount failed', { error, id: req.params.id });
      return res.status(500).json({ error });
    }
  };

  const unmountFtpFavouriteHandler = async (req, res) => {
    try {
      const favourite = getFtpFavouriteOrThrow(req.params.id, { includeSecrets: true });
      await unmountFtpFavourite(favourite);
      pushAuditEvent(req, 'info', 'FTP favourite unmounted', { id: favourite.id, name: favourite.name });
      res.json({
        success: true,
        favourite: serializeFtpFavourite(getFtpFavouriteOrThrow(favourite.id, { includeSecrets: false })),
      });
    } catch (err) {
      const error = String(err?.message || err || 'Unable to unmount FTP favourite');
      pushAuditEvent(req, 'error', 'FTP favourite unmount failed', { error, id: req.params.id });
      res.status(500).json({ error });
    }
  };

  const ftpListHandler = async (req, res) => {
    try {
      const payload = await listFtpDirectory(req.body || {});
      pushAuditEvent(req, 'info', 'FTP directory listed', { host: payload.connection.host, path: payload.path, count: payload.entries.length }, false);
      res.json(payload);
    } catch (err) {
      const error = String(err?.message || err || 'FTP list failed');
      pushAuditEvent(req, 'error', 'FTP list failed', { error });
      res.status(500).json({ error });
    }
  };

  const ftpDownloadHandler = async (req, res) => {
    try {
      const resolvedPayload = resolveFtpFavouritePayload(req.body || {});
      const remotePath = normalizeRemotePath(req.body?.remotePath || '/');
      const remoteName = path.posix.basename(remotePath);
      const recursive = req.body?.recursive === true || req.body?.recursive === 'true';
      const entryType = String(req.body?.entryType || (recursive ? 'directory' : 'file'));

      if (!remoteName || remoteName === '/' || remoteName === '.') {
        return res.status(400).json({ error: 'A remote path is required for download' });
      }

      const favourite = req.body?.favouriteId ? getFtpFavouriteOrThrow(req.body.favouriteId, { includeSecrets: false }) : null;
      const targetLabel = favourite
        ? sanitizeFtpFavouriteName(favourite.mountName || favourite.name, favourite.name)
        : sanitizeHostLabel(resolvedPayload.host);
      const targetRelative = normalizeLocalRelativePath(
        req.body?.targetPath || path.join(targetLabel, remoteName)
      );
      if (!targetRelative) {
        return res.status(400).json({ error: 'A valid local target path is required' });
      }

      const localPath = ensureWithinRoot(FTP_CLIENT_DOWNLOAD_ROOT, path.join(FTP_CLIENT_DOWNLOAD_ROOT, targetRelative));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });

      await withFtpClient(resolvedPayload, async (client, access) => {
        if (recursive || entryType === 'directory') {
          const fileCount = await downloadFtpDirectoryTree(client, remotePath, localPath);
          pushAuditEvent(req, 'info', 'FTP directory downloaded', { host: access.host, remotePath, localPath, fileCount });
          return;
        }

        await client.downloadTo(localPath, remotePath);
        pushAuditEvent(req, 'info', 'FTP file downloaded', { host: access.host, remotePath, localPath });
      });

      res.json({
        success: true,
        entryType: recursive || entryType === 'directory' ? 'directory' : 'file',
        remotePath,
        localPath,
      });
    } catch (err) {
      const error = String(err?.message || err || 'FTP download failed');
      pushAuditEvent(req, 'error', 'FTP download failed', { error });
      res.status(500).json({ error });
    }
  };

  const ftpUploadHandler = async (req, res) => {
    try {
      const resolvedPayload = resolveFtpFavouritePayload(req.body || {});
      const localPath = String(req.body?.localPath || '').trim();
      const remotePath = normalizeRemotePath(req.body?.remotePath || '/');

      if (!localPath) {
        return res.status(400).json({ error: 'A local file path is required for upload' });
      }

      const localResolved = path.resolve(localPath);
      if (!fs.existsSync(localResolved)) {
        return res.status(400).json({ error: 'Local file does not exist' });
      }

      if (!fs.statSync(localResolved).isFile()) {
        return res.status(400).json({ error: 'Local path must be a file' });
      }

      await withFtpClient(resolvedPayload, async (client, access) => {
        await client.ensureDir(path.posix.dirname(remotePath));
        await client.uploadFrom(localResolved, remotePath);
        pushAuditEvent(req, 'info', 'FTP file uploaded', { host: access.host, remotePath, localPath: localResolved });
      });

      res.json({
        success: true,
        localPath: localResolved,
        remotePath,
      });
    } catch (err) {
      const error = String(err?.message || err || 'FTP upload failed');
      pushAuditEvent(req, 'error', 'FTP upload failed', { error });
      res.status(500).json({ error });
    }
  };

  const ftpMkdirHandler = async (req, res) => {
    try {
      const resolvedPayload = resolveFtpFavouritePayload(req.body || {});
      const remotePath = normalizeRemotePath(req.body?.remotePath || '/');

      await withFtpClient(resolvedPayload, async (client, access) => {
        await client.ensureDir(remotePath);
        pushAuditEvent(req, 'info', 'FTP directory created', { host: access.host, remotePath });
      });

      res.json({ success: true, remotePath });
    } catch (err) {
      const error = String(err?.message || err || 'FTP mkdir failed');
      pushAuditEvent(req, 'error', 'FTP mkdir failed', { error });
      res.status(500).json({ error });
    }
  };

  const handlers = {
    ftpDefaultsHandler,
    ftpFavouritesHandler,
    createFtpFavouriteHandler,
    updateFtpFavouriteHandler,
    deleteFtpFavouriteHandler,
    mountFtpFavouriteHandler,
    unmountFtpFavouriteHandler,
    ftpListHandler,
    ftpDownloadHandler,
    ftpUploadHandler,
    ftpMkdirHandler,
  };

  if (!controlPlane || typeof controlPlane.wrapHandler !== 'function') {
    return handlers;
  }

  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      controlPlane.wrapHandler({ scope: 'ftp', action: name }, handler),
    ])
  );
};

module.exports = {
  buildFtpHandlers,
};
