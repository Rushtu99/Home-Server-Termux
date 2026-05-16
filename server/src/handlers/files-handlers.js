const buildFilesHandlers = ({
  listFilesystemDirectory,
  pushDebugEvent,
  normalizeLocalRelativePath,
  ensureShareAccess,
  path,
  isProtectedFsPath,
  resolveFsPath,
  fs,
  pushAuditEvent,
  listFsOperations,
  serializeFsOperation,
  readFsOperation,
  FS_OPERATION_TERMINAL_STATUSES,
  markFsOperationCancelled,
  cleanupFsOperationArtifacts,
  removeFsOperationState,
  FS_CONFLICT_RESOLVE_ACTIONS,
  updateFsOperation,
  enqueueFsOperation,
  processFsTransferJob,
  ensureFsTargetAllowed,
  collectFsEntryStats,
  sumFsStats,
  createFsOperationJob,
  processFsDeleteJob,
  normalizeFsOperationManifestEntry,
  getFsOperationStagingRoot,
  sanitizeFsOperationId,
  crypto,
  normalizeFsUploadRelativePath,
  isFsOperationCancellationRequested,
  writeFsOperation,
  throwIfFsOperationCancelled,
  createFsOperationCancelledError,
  isFsOperationCancelledError,
  processFsUploadFinalizeJob,
  moveFsEntryToRecycleBin,
  moveFsEntry,
  copyFsEntry,
  FS_OPERATION_CANCELLATION_STATUSES,
  controlPlane,
}) => {
  const filesystemListHandler = async (req, res) => {
    try {
      res.json(await listFilesystemDirectory(req.query.path || '', req));
    } catch (err) {
      const message = String(err?.message || err || 'Unable to list files');
      const status = Number(err?.statusCode) || (/not found/i.test(message) ? 404 : 400);
      pushDebugEvent('error', 'Filesystem list failed', { error: message, path: String(req.query.path || '') }, true);
      res.status(status).json({ error: message });
    }
  };

  const filesystemMkdirHandler = async (req, res) => {
    try {
      const parentPath = normalizeLocalRelativePath(req.body?.path || '');
      if (!parentPath) {
        return res.status(400).json({ error: 'Create shares from the root instead of raw folders' });
      }
      await ensureShareAccess(parentPath, req, 'write');
      const folderName = path.basename(String(req.body?.name || '').replace(/[\\/]+/g, ' ').trim());
      if (!folderName) {
        return res.status(400).json({ error: 'Folder name is required' });
      }

      const targetRelative = normalizeLocalRelativePath(path.join(parentPath, folderName));
      if (await isProtectedFsPath(targetRelative)) {
        return res.status(403).json({ error: 'This destination is protected' });
      }
      const { absolutePath } = resolveFsPath(targetRelative);
      if (fs.existsSync(absolutePath)) {
        return res.status(400).json({ error: 'Target already exists' });
      }

      fs.mkdirSync(absolutePath, { recursive: true });
      pushAuditEvent(req, 'info', 'Filesystem directory created', { path: targetRelative });
      res.json({ success: true, path: targetRelative });
    } catch (err) {
      const message = String(err?.message || err || 'Unable to create folder');
      pushAuditEvent(req, 'error', 'Filesystem mkdir failed', { error: message });
      res.status(400).json({ error: message });
    }
  };

  const filesystemRenameHandler = async (req, res) => {
    try {
      const sourceRelative = normalizeLocalRelativePath(req.body?.path || '');
      const nextName = path.basename(String(req.body?.name || '').replace(/[\\/]+/g, ' ').trim());
      if (!sourceRelative || !nextName) {
        return res.status(400).json({ error: 'Path and next name are required' });
      }
      await ensureShareAccess(sourceRelative, req, 'write');
      if (await isProtectedFsPath(sourceRelative)) {
        return res.status(403).json({ error: 'This path cannot be renamed' });
      }

      const parentRelative = path.dirname(sourceRelative) === '.' ? '' : path.dirname(sourceRelative);
      const targetRelative = normalizeLocalRelativePath(path.join(parentRelative, nextName));
      if (await isProtectedFsPath(targetRelative)) {
        return res.status(403).json({ error: 'This destination is protected' });
      }
      const sourcePath = resolveFsPath(sourceRelative).absolutePath;
      const targetPath = resolveFsPath(targetRelative).absolutePath;
      if (!fs.existsSync(sourcePath)) {
        return res.status(404).json({ error: 'Source path not found' });
      }
      if (fs.existsSync(targetPath)) {
        return res.status(400).json({ error: 'Target already exists' });
      }

      fs.renameSync(sourcePath, targetPath);
      pushAuditEvent(req, 'info', 'Filesystem entry renamed', { from: sourceRelative, to: targetRelative });
      res.json({ success: true, path: targetRelative });
    } catch (err) {
      const message = String(err?.message || err || 'Unable to rename entry');
      pushAuditEvent(req, 'error', 'Filesystem rename failed', { error: message });
      res.status(400).json({ error: message });
    }
  };

  const filesystemOperationsListHandler = async (req, res) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 25) || 25));
      return res.json({
        operations: listFsOperations(limit).map((job) => serializeFsOperation(job, false)),
      });
    } catch (error) {
      return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to list filesystem operations') });
    }
  };

  const filesystemOperationDetailHandler = async (req, res) => {
    const job = readFsOperation(req.params.id || '');
    if (!job) {
      return res.status(404).json({ error: 'Filesystem operation not found' });
    }
    return res.json(serializeFsOperation(job, true));
  };

  const filesystemOperationControlHandler = async (req, res) => {
    try {
      const job = readFsOperation(req.params.id || '');
      if (!job) {
        return res.status(404).json({ error: 'Filesystem operation not found' });
      }

      const action = String(req.body?.action || '').trim().toLowerCase();
      if (action === 'cancel') {
        if (job.status === 'cancelled') {
          return res.json({ operation: serializeFsOperation(job, true), success: true });
        }
        if (FS_OPERATION_TERMINAL_STATUSES.has(job.status)) {
          return res.status(409).json({ error: 'Operation is already complete', operation: serializeFsOperation(job, true) });
        }

        if (job.status === 'queued' || job.status === 'standby' || (job.kind === 'upload' && job.status === 'receiving')) {
          const cancelledJob = markFsOperationCancelled(
            job.id,
            job.kind === 'delete'
              ? 'Recycle cancelled'
              : job.kind === 'move'
                ? 'Move cancelled'
                : job.kind === 'upload'
                  ? 'Upload cancelled'
                  : 'Copy cancelled',
          );
          pushAuditEvent(req, 'warn', 'Filesystem operation cancelled', {
            kind: job.kind,
            operationId: job.id,
            status: job.status,
          });
          return res.json({ operation: serializeFsOperation(cancelledJob, true), success: true });
        }

        const nextJob = job.status === 'cancelling'
          ? job
          : updateFsOperation(job.id, {
            message: 'Cancelling operation',
            status: 'cancelling',
          });
        pushAuditEvent(req, 'warn', 'Filesystem operation cancellation requested', {
          kind: job.kind,
          operationId: job.id,
          status: job.status,
        });
        return res.json({ operation: serializeFsOperation(nextJob, true), success: true });
      }

      if (action === 'dismiss') {
        if (!FS_OPERATION_TERMINAL_STATUSES.has(job.status)) {
          return res.status(409).json({ error: 'Only completed operations can be dismissed' });
        }
        cleanupFsOperationArtifacts(job);
        removeFsOperationState(job.id);
        return res.json({ dismissed: true, operationId: job.id, success: true });
      }

      if (action === 'resolve_conflict') {
        if (job.kind !== 'copy' && job.kind !== 'move') {
          return res.status(409).json({ error: 'Conflict resolution is only supported for copy or move operations' });
        }
        if (job.status !== 'standby' || !job.conflict) {
          return res.status(409).json({ error: 'Operation is not waiting for conflict resolution', operation: serializeFsOperation(job, true) });
        }

        const decision = String(req.body?.decision || '').trim().toLowerCase();
        if (!FS_CONFLICT_RESOLVE_ACTIONS.has(decision)) {
          return res.status(400).json({ error: 'Unsupported conflict decision' });
        }

        const currentRelation = String(job.conflict.sizeRelation || 'unknown');
        if (decision === 'replace_all_diff_size' && currentRelation !== 'different') {
          return res.status(409).json({ error: 'replace_all_diff_size is only available for different-size file conflicts' });
        }
        if (decision === 'skip_all_same_size' && currentRelation !== 'same') {
          return res.status(409).json({ error: 'skip_all_same_size is only available for same-size file conflicts' });
        }

        const resumedJob = updateFsOperation(job.id, (current) => ({
          ...current,
          conflict: null,
          conflictPolicy: {
            replaceAllDifferentSize: Boolean(current.conflictPolicy?.replaceAllDifferentSize) || decision === 'replace_all_diff_size',
            skipAllSameSize: Boolean(current.conflictPolicy?.skipAllSameSize) || decision === 'skip_all_same_size',
          },
          conflictResolution: decision === 'replace' || decision === 'replace_all_diff_size'
            ? 'replace'
            : 'skip',
          message: 'Conflict decision accepted; resuming transfer',
          status: 'queued',
        }));

        enqueueFsOperation(resumedJob.id, () => processFsTransferJob(resumedJob.id, req));
        pushAuditEvent(req, 'info', 'Filesystem conflict resolved', {
          decision,
          operationId: resumedJob.id,
        });
        return res.json({ operation: serializeFsOperation(resumedJob, true), success: true });
      }

      return res.status(400).json({ error: 'Unsupported operation control action' });
    } catch (error) {
      return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to control filesystem operation') });
    }
  };

  const filesystemOperationTransferHandler = async (req, res) => {
    try {
      const sourceRelatives = Array.isArray(req.body?.sourcePaths)
        ? req.body.sourcePaths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
        : [];
      const singleRelative = normalizeLocalRelativePath(req.body?.sourcePath || '');
      const destinationRelative = normalizeLocalRelativePath(req.body?.destinationPath || '');
      const mode = String(req.body?.mode || 'copy').toLowerCase() === 'move' ? 'move' : 'copy';
      const sourcePaths = sourceRelatives.length > 0 ? [...new Set(sourceRelatives)] : singleRelative ? [singleRelative] : [];

      if (sourcePaths.length === 0 || !destinationRelative) {
        return res.status(400).json({ error: 'Source paths and destination path are required' });
      }

      await ensureShareAccess(destinationRelative, req, 'write');
      ensureFsTargetAllowed(destinationRelative);

      const destinationAbsolute = resolveFsPath(destinationRelative).absolutePath;
      if (!fs.existsSync(destinationAbsolute) || !fs.statSync(destinationAbsolute).isDirectory()) {
        return res.status(400).json({ error: 'Destination must be an existing folder' });
      }

      const stats = [];
      for (const sourceRelative of sourcePaths) {
        await ensureShareAccess(sourceRelative, req, mode === 'move' ? 'write' : 'read');
        if (await isProtectedFsPath(sourceRelative)) {
          return res.status(403).json({ error: `This path cannot be ${mode === 'move' ? 'moved' : 'copied'}` });
        }
        const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
        if (!fs.existsSync(sourceAbsolute)) {
          return res.status(404).json({ error: `Source path not found: ${sourceRelative}` });
        }
        stats.push(collectFsEntryStats(sourceAbsolute));
      }

      const totals = sumFsStats(stats);
      const job = createFsOperationJob(mode, {
        destinationPath: destinationRelative,
        message: 'Queued',
        sourcePaths,
        totalBytes: totals.totalBytes,
        totalItems: totals.totalItems,
      });
      enqueueFsOperation(job.id, () => processFsTransferJob(job.id, req));
      return res.status(202).json({
        operationId: job.id,
        operation: serializeFsOperation(job, true),
        success: true,
      });
    } catch (error) {
      return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to start transfer') });
    }
  };

  const filesystemOperationDeleteHandler = async (req, res) => {
    try {
      const sourceRelatives = Array.isArray(req.body?.paths)
        ? req.body.paths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
        : [];
      const singleRelative = normalizeLocalRelativePath(req.body?.path || '');
      const sourcePaths = sourceRelatives.length > 0 ? [...new Set(sourceRelatives)] : singleRelative ? [singleRelative] : [];

      if (sourcePaths.length === 0) {
        return res.status(400).json({ error: 'At least one path is required' });
      }

      const stats = [];
      for (const sourceRelative of sourcePaths) {
        await ensureShareAccess(sourceRelative, req, 'write');
        if (await isProtectedFsPath(sourceRelative)) {
          return res.status(403).json({ error: 'This path cannot be deleted' });
        }
        const sourceAbsolute = resolveFsPath(sourceRelative).absolutePath;
        if (!fs.existsSync(sourceAbsolute)) {
          return res.status(404).json({ error: `Path not found: ${sourceRelative}` });
        }
        stats.push(collectFsEntryStats(sourceAbsolute));
      }

      const totals = sumFsStats(stats);
      const job = createFsOperationJob('delete', {
        message: 'Queued',
        sourcePaths,
        totalBytes: totals.totalBytes,
        totalItems: totals.totalItems,
      });
      enqueueFsOperation(job.id, () => processFsDeleteJob(job.id, req));
      return res.status(202).json({
        operationId: job.id,
        operation: serializeFsOperation(job, true),
        success: true,
      });
    } catch (error) {
      return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to start delete operation') });
    }
  };

  const filesystemOperationUploadCreateHandler = async (req, res) => {
    try {
      const destinationRelative = normalizeLocalRelativePath(req.body?.destinationPath || '');
      const manifest = Array.isArray(req.body?.manifest)
        ? req.body.manifest.map((entry) => normalizeFsOperationManifestEntry(entry)).filter(Boolean)
        : [];

      if (!destinationRelative) {
        return res.status(400).json({ error: 'destinationPath is required' });
      }
      if (manifest.length === 0) {
        return res.status(400).json({ error: 'At least one file is required' });
      }

      await ensureShareAccess(destinationRelative, req, 'write');
      ensureFsTargetAllowed(destinationRelative);
      if (!fs.existsSync(resolveFsPath(destinationRelative).absolutePath) || !fs.statSync(resolveFsPath(destinationRelative).absolutePath).isDirectory()) {
        return res.status(400).json({ error: 'Destination must be an existing folder' });
      }

      const dedupedManifest = [...new Map(manifest.map((entry) => [entry.relativePath, entry])).values()];
      const totals = dedupedManifest.reduce((acc, entry) => ({
        totalBytes: acc.totalBytes + entry.size,
        totalItems: acc.totalItems + 1,
      }), { totalBytes: 0, totalItems: 0 });
      const job = createFsOperationJob('upload', {
        destinationPath: destinationRelative,
        manifest: dedupedManifest,
        message: 'Waiting for file data',
        stagingPath: getFsOperationStagingRoot(sanitizeFsOperationId(`upload-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)),
        status: 'receiving',
        totalBytes: totals.totalBytes,
        totalItems: totals.totalItems,
        uploadedFiles: [],
      });

      const stagingPath = getFsOperationStagingRoot(job.id);
      fs.mkdirSync(stagingPath, { recursive: true });
      const updatedJob = updateFsOperation(job.id, { stagingPath });
      return res.status(202).json({
        operationId: updatedJob.id,
        operation: serializeFsOperation(updatedJob, true),
        success: true,
      });
    } catch (error) {
      return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to create upload operation') });
    }
  };

  const filesystemOperationUploadFileHandler = async (req, res) => {
    const job = readFsOperation(req.params.id || '');
    if (!job || job.kind !== 'upload') {
      return res.status(404).json({ error: 'Upload operation not found' });
    }
    if (job.status === 'cancelling' || job.status === 'cancelled') {
      return res.status(409).json({ error: 'Upload operation was cancelled', operation: serializeFsOperation(job, true) });
    }
    if (job.status !== 'receiving') {
      return res.status(409).json({ error: 'Upload operation is not accepting files right now' });
    }

    const relativePath = normalizeFsUploadRelativePath(req.query.relativePath || req.headers['x-file-relative-path'] || '');
    if (!relativePath) {
      return res.status(400).json({ error: 'relativePath is required' });
    }
    const manifestEntry = job.manifest.find((entry) => entry.relativePath === relativePath);
    if (!manifestEntry) {
      return res.status(404).json({ error: 'File is not part of this upload manifest' });
    }

    const tempPath = path.join(job.stagingPath, `${relativePath}.part`);
    const targetPath = path.join(job.stagingPath, relativePath);
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });

    try {
      await new Promise((resolve, reject) => {
        let receivedBytes = 0;
        let lastPersistAt = 0;
        const stream = fs.createWriteStream(tempPath, { flags: 'w' });

        const fail = (error) => {
          try {
            stream.destroy();
          } catch {
            // ignore
          }
          try {
            fs.rmSync(tempPath, { force: true });
          } catch {
            // ignore
          }
          reject(error);
        };

        req.on('data', (chunk) => {
          if (isFsOperationCancellationRequested(job.id)) {
            fail(createFsOperationCancelledError('Upload cancelled'));
            return;
          }
          receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
          const now = Date.now();
          if (now - lastPersistAt > 200) {
            lastPersistAt = now;
            const current = readFsOperation(job.id);
            if (current) {
              const currentUploaded = current.manifest
                .filter((entry) => current.uploadedFiles.includes(entry.relativePath))
                .reduce((sum, entry) => sum + entry.size, 0);
              writeFsOperation({
                ...current,
                message: `Receiving ${path.basename(relativePath)}`,
                processedBytes: Math.min(current.totalBytes, currentUploaded + receivedBytes),
              });
            }
          }
        });
        req.on('aborted', () => fail(new Error('Upload aborted by client')));
        req.on('error', fail);
        stream.on('error', fail);
        stream.on('finish', resolve);
        if (isFsOperationCancellationRequested(job.id)) {
          fail(createFsOperationCancelledError('Upload cancelled'));
          return;
        }
        req.pipe(stream);
      });

      throwIfFsOperationCancelled(job.id, 'Upload cancelled');
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { force: true });
      }
      fs.renameSync(tempPath, targetPath);

      const nextJob = updateFsOperation(job.id, (current) => {
        const uploadedFiles = [...new Set([...current.uploadedFiles, relativePath])];
        const uploadedBytes = current.manifest
          .filter((entry) => uploadedFiles.includes(entry.relativePath))
          .reduce((sum, entry) => sum + entry.size, 0);
        return {
          ...current,
          message: `Received ${uploadedFiles.length}/${current.totalItems} file${current.totalItems === 1 ? '' : 's'}`,
          processedBytes: Math.min(current.totalBytes, uploadedBytes),
          processedItems: Math.min(current.totalItems, uploadedFiles.length),
          uploadedFiles,
        };
      });

      return res.json({
        operation: serializeFsOperation(nextJob, true),
        success: true,
      });
    } catch (error) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // ignore
      }
      if (isFsOperationCancelledError(error)) {
        const latest = readFsOperation(job.id);
        if (latest && latest.status !== 'cancelled') {
          try {
            markFsOperationCancelled(job.id, 'Upload cancelled');
          } catch {
            // ignore
          }
        }
        const cancelledJob = readFsOperation(job.id) || latest || job;
        return res.status(409).json({
          error: 'Upload cancelled',
          operation: serializeFsOperation(cancelledJob, true),
        });
      }
      return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to receive upload file') });
    }
  };

  const filesystemOperationUploadFinalizeHandler = async (req, res) => {
    try {
      const job = readFsOperation(req.params.id || '');
      if (!job || job.kind !== 'upload') {
        return res.status(404).json({ error: 'Upload operation not found' });
      }
      if (job.status === 'cancelling' || job.status === 'cancelled') {
        return res.status(409).json({ error: 'Upload operation was cancelled', operation: serializeFsOperation(job, true) });
      }
      if (job.status !== 'receiving') {
        return res.status(409).json({ error: 'Upload operation is not waiting for finalize' });
      }

      const missingEntries = job.manifest
        .map((entry) => entry.relativePath)
        .filter((relativePath) => !job.uploadedFiles.includes(relativePath));
      if (missingEntries.length > 0) {
        return res.status(400).json({ error: 'Not all files were uploaded', missing: missingEntries });
      }

      const queuedJob = updateFsOperation(job.id, {
        message: 'Queued for finalize',
        status: 'queued',
      });
      enqueueFsOperation(queuedJob.id, () => processFsUploadFinalizeJob(queuedJob.id, req));
      return res.status(202).json({
        operationId: queuedJob.id,
        operation: serializeFsOperation(queuedJob, true),
        success: true,
      });
    } catch (error) {
      return res.status(400).json({ error: String(error instanceof Error ? error.message : error || 'Unable to finalize upload') });
    }
  };

  const filesystemDeleteHandler = async (req, res) => {
    try {
      const sourceRelatives = Array.isArray(req.body?.paths)
        ? req.body.paths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
        : [];
      const singleRelative = normalizeLocalRelativePath(req.body?.path || '');
      const targets = sourceRelatives.length > 0
        ? [...new Set(sourceRelatives)]
        : singleRelative
          ? [singleRelative]
          : [];

      if (targets.length === 0) {
        return res.status(400).json({ error: 'At least one path is required' });
      }

      const recycledItems = [];
      const failures = [];

      for (const sourceRelative of targets) {
        try {
          await ensureShareAccess(sourceRelative, req, 'write');
          if (await isProtectedFsPath(sourceRelative)) {
            throw new Error('This path cannot be deleted');
          }

          const { absolutePath } = resolveFsPath(sourceRelative);
          if (!fs.existsSync(absolutePath)) {
            throw new Error('Path not found');
          }

          const recycled = moveFsEntryToRecycleBin(sourceRelative);
          recycledItems.push({
            path: sourceRelative,
            recyclePath: recycled.path,
            recycledAt: recycled.recycledAt,
          });
          pushAuditEvent(req, 'info', 'Filesystem entry recycled', { from: sourceRelative, to: recycled.path, recycledAt: recycled.recycledAt });
        } catch (error) {
          failures.push({
            error: String(error instanceof Error ? error.message : error || 'Unable to delete entry'),
            path: sourceRelative,
          });
        }
      }

      if (recycledItems.length === 0) {
        return res.status(400).json({
          error: failures[0]?.error || 'Unable to delete entries',
          failureCount: failures.length,
          failures,
          successCount: 0,
        });
      }

      res.json({
        success: failures.length === 0,
        recycled: true,
        recyclePath: recycledItems[0]?.recyclePath || '',
        recycledItems,
        failureCount: failures.length,
        failures,
        successCount: recycledItems.length,
      });
    } catch (err) {
      const message = String(err?.message || err || 'Unable to delete entry');
      pushAuditEvent(req, 'error', 'Filesystem delete failed', { error: message });
      res.status(400).json({ error: message });
    }
  };

  const filesystemDownloadHandler = async (req, res) => {
    try {
      const relativePath = normalizeLocalRelativePath(req.query.path || '');
      if (!relativePath) {
        return res.status(400).json({ error: 'Path is required' });
      }
      await ensureShareAccess(relativePath, req, 'read');

      const { absolutePath } = resolveFsPath(relativePath);
      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ error: 'Path not found' });
      }

      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Only file downloads are supported right now' });
      }

      pushAuditEvent(req, 'info', 'Filesystem file download requested', { path: relativePath });
      res.download(absolutePath, path.basename(absolutePath));
    } catch (err) {
      const message = String(err?.message || err || 'Unable to download file');
      pushAuditEvent(req, 'error', 'Filesystem download failed', { error: message });
      res.status(400).json({ error: message });
    }
  };

  const filesystemUploadHandler = async (req, res) => {
    try {
      const parentRelative = normalizeLocalRelativePath(req.query.path || '');
      if (!parentRelative) {
        return res.status(400).json({ error: 'Upload into a share folder, not the root' });
      }
      await ensureShareAccess(parentRelative, req, 'write');
      const fileName = path.basename(String(req.query.name || req.headers['x-file-name'] || '').replace(/[\\/]+/g, ' ').trim());
      if (!fileName) {
        return res.status(400).json({ error: 'A file name is required' });
      }
      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: 'Upload body is missing' });
      }

      const targetRelative = normalizeLocalRelativePath(path.join(parentRelative, fileName));
      if (await isProtectedFsPath(targetRelative)) {
        return res.status(403).json({ error: 'This destination is protected' });
      }
      const { absolutePath } = resolveFsPath(targetRelative);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, req.body);
      pushAuditEvent(req, 'info', 'Filesystem file uploaded', { path: targetRelative, size: req.body.length });
      res.json({ success: true, path: targetRelative });
    } catch (err) {
      const message = String(err?.message || err || 'Unable to upload file');
      pushAuditEvent(req, 'error', 'Filesystem upload failed', { error: message });
      res.status(400).json({ error: message });
    }
  };

  const filesystemPasteHandler = async (req, res) => {
    try {
      const sourceRelatives = Array.isArray(req.body?.sourcePaths)
        ? req.body.sourcePaths.map((entry) => normalizeLocalRelativePath(entry || '')).filter(Boolean)
        : [];
      const sourceRelative = normalizeLocalRelativePath(req.body?.sourcePath || '');
      const destinationRelative = normalizeLocalRelativePath(req.body?.destinationPath || '');
      const mode = String(req.body?.mode || 'copy').toLowerCase();
      const sources = sourceRelatives.length > 0
        ? [...new Set(sourceRelatives)]
        : sourceRelative
          ? [sourceRelative]
          : [];

      if (sources.length === 0 || !destinationRelative) {
        return res.status(400).json({ error: 'Source paths and destination path are required' });
      }
      if (mode !== 'copy' && mode !== 'move') {
        return res.status(400).json({ error: 'Mode must be copy or move' });
      }
      await ensureShareAccess(destinationRelative, req, 'write');

      ensureFsTargetAllowed(destinationRelative);

      const destination = resolveFsPath(destinationRelative);
      if (!fs.existsSync(destination.absolutePath) || !fs.statSync(destination.absolutePath).isDirectory()) {
        return res.status(400).json({ error: 'Destination must be an existing folder' });
      }

      const pastedItems = [];
      const failures = [];

      for (const sourceItemRelative of sources) {
        try {
          await ensureShareAccess(sourceItemRelative, req, mode === 'move' ? 'write' : 'read');
          if (await isProtectedFsPath(sourceItemRelative)) {
            throw new Error(`This path cannot be ${mode === 'move' ? 'moved' : 'copied'}`);
          }

          const source = resolveFsPath(sourceItemRelative);
          if (!fs.existsSync(source.absolutePath)) {
            throw new Error('Source path not found');
          }

          const targetRelative = normalizeLocalRelativePath(path.join(destination.relativePath, path.basename(source.relativePath)));
          if (await isProtectedFsPath(targetRelative)) {
            throw new Error('This destination is protected');
          }

          const target = resolveFsPath(targetRelative);
          if (fs.existsSync(target.absolutePath)) {
            throw new Error('A file or folder with that name already exists in the destination');
          }
          if (target.absolutePath.startsWith(`${source.absolutePath}${path.sep}`)) {
            throw new Error('Cannot paste a folder into itself');
          }

          if (mode === 'move') {
            moveFsEntry(source.absolutePath, target.absolutePath);
          } else {
            copyFsEntry(source.absolutePath, target.absolutePath);
          }

          pastedItems.push({
            from: sourceItemRelative,
            path: targetRelative,
          });
        } catch (error) {
          failures.push({
            error: String(error instanceof Error ? error.message : error || 'Unable to paste entry'),
            path: sourceItemRelative,
          });
        }
      }

      if (pastedItems.length === 0) {
        return res.status(400).json({
          error: failures[0]?.error || 'Unable to paste entries',
          failureCount: failures.length,
          failures,
          successCount: 0,
        });
      }

      pushAuditEvent(req, 'info', `Filesystem entr${pastedItems.length === 1 ? 'y' : 'ies'} ${mode}d`, {
        destination: destinationRelative,
        failureCount: failures.length,
        items: pastedItems,
      });
      res.json({
        success: failures.length === 0,
        path: pastedItems[0]?.path || '',
        pastedItems,
        failureCount: failures.length,
        failures,
        successCount: pastedItems.length,
      });
    } catch (err) {
      const message = String(err?.message || err || 'Unable to paste entry');
      pushAuditEvent(req, 'error', 'Filesystem paste failed', { error: message });
      res.status(400).json({ error: message });
    }
  };

  const handlers = {
    filesystemListHandler,
    filesystemMkdirHandler,
    filesystemRenameHandler,
    filesystemOperationsListHandler,
    filesystemOperationDetailHandler,
    filesystemOperationControlHandler,
    filesystemOperationUploadCreateHandler,
    filesystemOperationUploadFileHandler,
    filesystemOperationUploadFinalizeHandler,
    filesystemOperationTransferHandler,
    filesystemOperationDeleteHandler,
    filesystemDeleteHandler,
    filesystemDownloadHandler,
    filesystemUploadHandler,
    filesystemPasteHandler,
  };

  if (!controlPlane || typeof controlPlane.wrapHandler !== 'function') {
    return handlers;
  }

  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      controlPlane.wrapHandler({ scope: 'filesystem', action: name }, handler),
    ])
  );
};

module.exports = {
  buildFilesHandlers,
};
