const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createWorkflowEngine = ({
  eventBus,
  stateStore,
  executeCommand,
  now = () => Date.now(),
  randomId = () => Math.random().toString(36).slice(2, 10),
  definitions = {},
} = {}) => {
  if (!eventBus || !stateStore || typeof executeCommand !== 'function') {
    throw new Error('workflowEngine requires eventBus, stateStore, and executeCommand');
  }

  const defaultDefinitions = {
    MOVIE_DOWNLOAD: {
      key: 'MOVIE_DOWNLOAD',
      title: 'Movie download pipeline',
      steps: [
        { key: 'arr-ready', kind: 'clusterAction', cluster: 'arr', action: 'start', retries: 1 },
        { key: 'torrent-ready', kind: 'clusterAction', cluster: 'torrent', action: 'start', retries: 1 },
        { key: 'download-complete', kind: 'eventWait', event: 'DOWNLOAD_COMPLETE', timeoutMs: 30 * 60 * 1000 },
        { key: 'filemanagement-ready', kind: 'clusterAction', cluster: 'filemanagement', action: 'start', retries: 1 },
        { key: 'media-ready', kind: 'clusterAction', cluster: 'media', action: 'start', retries: 1 },
      ],
    },
    SERIES_DOWNLOAD: {
      key: 'SERIES_DOWNLOAD',
      title: 'Series download pipeline',
      steps: [
        { key: 'arr-ready', kind: 'clusterAction', cluster: 'arr', action: 'start', retries: 1 },
        { key: 'torrent-ready', kind: 'clusterAction', cluster: 'torrent', action: 'start', retries: 1 },
        { key: 'download-complete', kind: 'eventWait', event: 'DOWNLOAD_COMPLETE', timeoutMs: 30 * 60 * 1000 },
        { key: 'filemanagement-ready', kind: 'clusterAction', cluster: 'filemanagement', action: 'start', retries: 1 },
        { key: 'media-ready', kind: 'clusterAction', cluster: 'media', action: 'start', retries: 1 },
      ],
    },
    FILE_UPLOAD: {
      key: 'FILE_UPLOAD',
      title: 'File upload processing',
      steps: [
        { key: 'file-ready', kind: 'clusterAction', cluster: 'file', action: 'start', retries: 1 },
        { key: 'filemanagement-ready', kind: 'clusterAction', cluster: 'filemanagement', action: 'start', retries: 1 },
        { key: 'file-moved', kind: 'eventWait', event: 'FILE_MOVED', timeoutMs: 10 * 60 * 1000 },
        { key: 'analytics-ready', kind: 'clusterAction', cluster: 'analytics', action: 'start', retries: 1 },
      ],
    },
    STORAGE_GUARD: {
      key: 'STORAGE_GUARD',
      title: 'Storage guard and recovery',
      steps: [
        { key: 'analytics-ready', kind: 'clusterAction', cluster: 'analytics', action: 'start', retries: 1 },
        { key: 'storage-alert', kind: 'eventWait', event: 'SERVICE_DOWN', timeoutMs: 5 * 60 * 1000 },
        { key: 'pause-media', kind: 'clusterAction', cluster: 'media', action: 'stop', retries: 1, onFailure: 'continue' },
        { key: 'pause-arr', kind: 'clusterAction', cluster: 'arr', action: 'stop', retries: 1, onFailure: 'continue' },
      ],
    },
    'movie-intake': {
      key: 'movie-intake',
      title: 'Movie intake',
      steps: [{ key: 'run', kind: 'command', resolveCommand: (ctx) => ctx.workerCommands['media-workflow']?.start || null }],
    },
    'series-intake': {
      key: 'series-intake',
      title: 'Series intake',
      steps: [{ key: 'run', kind: 'command', resolveCommand: (ctx) => ctx.workerCommands['media-workflow']?.start || null }],
    },
    'file-move-copy-delete': {
      key: 'file-move-copy-delete',
      title: 'File move/copy/delete',
      steps: [],
    },
    'jellyfin-library-sync': {
      key: 'jellyfin-library-sync',
      title: 'Jellyfin library sync',
      steps: [{ key: 'sync', kind: 'command', resolveCommand: (ctx) => ctx.workerCommands['jellyfin-library-sync']?.start || null }],
    },
    'storage-guard-and-resume': {
      key: 'storage-guard-and-resume',
      title: 'Storage guard and resume',
      steps: [{ key: 'check', kind: 'command', resolveCommand: (ctx) => ctx.workerCommands['storage-watchdog']?.start || null }],
    },
    'subtitle-sync': {
      key: 'subtitle-sync',
      title: 'Subtitle sync',
      steps: [{ key: 'run', kind: 'command', resolveCommand: (ctx) => ctx.workerCommands['media-importer']?.start || null }],
    },
    'usb-drive-mount-discovery': {
      key: 'usb-drive-mount-discovery',
      title: 'USB drive mount/discovery',
      steps: [{ key: 'scan', kind: 'command', resolveCommand: (ctx) => ctx.workerCommands['usb-mount-service']?.restart || ctx.workerCommands['usb-mount-service']?.start || null }],
    },
  };

  const workflowDefinitions = {
    ...defaultDefinitions,
    ...definitions,
  };
  const activeRunIds = new Set();

  const appendEvent = (run, event, payload = {}) => {
    const eventName = `workflow.${run.key}.${event}`;
    const eventPayload = {
      runId: run.id,
      workflowKey: run.key,
      ...payload,
    };
    const emitted = eventBus.emit(eventName, eventPayload);
    stateStore.appendWorkflowEvent(emitted);
  };

  const persistRun = (run) => {
    stateStore.upsertWorkflowRun(run);
    return run;
  };

  const waitForEvent = async ({ event, timeoutMs = 30000, predicate = null }) => {
    return new Promise((resolve, reject) => {
      let timeout = null;
      const off = eventBus.on(event, (emitted) => {
        if (typeof predicate === 'function' && !predicate(emitted)) {
          return;
        }
        if (timeout) {
          clearTimeout(timeout);
        }
        off();
        resolve(emitted);
      });

      timeout = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for event '${event}'`));
      }, Math.max(1000, Number(timeoutMs) || 30000));
    });
  };

  const runStep = async (step, context, run) => {
    const kind = String(step?.kind || 'command');

    if (kind === 'command') {
      const command = typeof step?.resolveCommand === 'function'
        ? step.resolveCommand(context)
        : step?.command;
      if (!command) {
        throw new Error(`Missing command for step '${step.key}'`);
      }
      const output = await executeCommand(command);
      return {
        details: {
          command,
        },
        output: String(output || '').trim(),
      };
    }

    if (kind === 'serviceAction') {
      if (!context.serviceManager || typeof context.serviceManager.control !== 'function') {
        throw new Error('serviceManager is not available in workflow context');
      }
      const service = String(step.service || '').trim();
      const action = String(step.action || 'start').trim().toLowerCase();
      if (!service || !['start', 'stop', 'restart'].includes(action)) {
        throw new Error(`Invalid serviceAction step '${step.key}'`);
      }
      const result = await context.serviceManager.control({ service, action });
      return {
        details: {
          action,
          service,
        },
        output: JSON.stringify(result),
      };
    }

    if (kind === 'clusterAction') {
      if (!context.clusterManager) {
        throw new Error('clusterManager is not available in workflow context');
      }
      const cluster = String(step.cluster || '').trim().toLowerCase();
      const action = String(step.action || 'start').trim().toLowerCase();
      if (!cluster || !['start', 'stop', 'restart'].includes(action)) {
        throw new Error(`Invalid clusterAction step '${step.key}'`);
      }

      const fn = action === 'start'
        ? context.clusterManager.startCluster
        : action === 'stop'
          ? context.clusterManager.stopCluster
          : context.clusterManager.restartCluster;

      const result = await fn(cluster);
      return {
        details: {
          action,
          cluster,
        },
        output: JSON.stringify(result),
      };
    }

    if (kind === 'eventWait') {
      const event = String(step.event || '').trim();
      if (!event) {
        throw new Error(`Missing event name for step '${step.key}'`);
      }
      const payload = await waitForEvent({
        event,
        timeoutMs: Number(step.timeoutMs || 30000),
        predicate: typeof step.predicate === 'function'
          ? (emitted) => step.predicate(emitted, run)
          : null,
      });
      return {
        details: {
          event,
          timeoutMs: Number(step.timeoutMs || 30000),
        },
        output: JSON.stringify(payload || {}),
      };
    }

    throw new Error(`Unknown step kind '${kind}'`);
  };

  const executeRunSteps = async (run, context = {}) => {
    const definition = workflowDefinitions[run.key];
    if (!definition) {
      run.status = 'failed';
      run.error = `Unknown workflow '${run.key}'`;
      run.updatedAt = new Date(now()).toISOString();
      persistRun(run);
      appendEvent(run, 'failed', { error: run.error });
      return run;
    }

    run.definitionVersion = Number(definition.version || 1);
    run.updatedAt = new Date(now()).toISOString();
    run.status = 'running';
    run.failures = Array.isArray(run.failures) ? run.failures : [];
    persistRun(run);
    appendEvent(run, 'started', { startedAt: run.updatedAt });
    eventBus.emit('WORKFLOW_STARTED', {
      runId: run.id,
      workflowKey: run.key,
    });

    const steps = Array.isArray(definition.steps) ? definition.steps : [];
    for (let stepIndex = Number(run.cursor || 0); stepIndex < steps.length; stepIndex += 1) {
      const step = steps[stepIndex];
      const stepKey = String(step?.key || `step-${stepIndex + 1}`);
      const maxRetries = Math.max(0, Number(step?.retries || 0) || 0);
      const retryDelayMs = Math.max(0, Number(step?.retryDelayMs || 1000) || 1000);
      const onFailure = String(step?.onFailure || 'fail').toLowerCase();

      appendEvent(run, 'progress', {
        step: stepKey,
        stepIndex,
        totalSteps: steps.length,
      });

      let attempt = 0;
      let completed = false;
      let lastError = null;

      while (!completed && attempt <= maxRetries) {
        try {
          attempt += 1;
          appendEvent(run, 'step.started', {
            attempt,
            step: stepKey,
            stepIndex,
          });

          // eslint-disable-next-line no-await-in-loop
          const result = await runStep(step, context, run);

          run.lastOutput = String(result?.output || '').trim();
          run.cursor = stepIndex + 1;
          run.updatedAt = new Date(now()).toISOString();
          persistRun(run);

          appendEvent(run, 'step.completed', {
            attempt,
            details: result?.details || {},
            step: stepKey,
            stepIndex,
          });

          completed = true;
        } catch (error) {
          lastError = error;
          const errorText = String(error?.message || error || `Step '${stepKey}' failed`);

          appendEvent(run, 'step.failed', {
            attempt,
            error: errorText,
            step: stepKey,
            stepIndex,
          });

          eventBus.emit('WORKFLOW_STEP_FAILED', {
            error: errorText,
            runId: run.id,
            stepKey,
            workflowKey: run.key,
          });

          if (attempt <= maxRetries) {
            appendEvent(run, 'step.retrying', {
              attempt,
              retryDelayMs,
              step: stepKey,
              stepIndex,
            });
            // eslint-disable-next-line no-await-in-loop
            await sleep(retryDelayMs);
          }
        }
      }

      if (!completed) {
        const errorText = String(lastError?.message || lastError || `Step '${stepKey}' failed`);
        run.failures.push({
          error: errorText,
          step: stepKey,
          stepIndex,
          timestamp: new Date(now()).toISOString(),
        });

        if (onFailure === 'continue') {
          run.cursor = stepIndex + 1;
          run.updatedAt = new Date(now()).toISOString();
          persistRun(run);
          appendEvent(run, 'step.continued_after_failure', {
            error: errorText,
            step: stepKey,
            stepIndex,
          });
          continue;
        }

        run.status = errorText.startsWith('Missing command for step')
          ? 'blocked'
          : 'failed';
        run.error = errorText;
        run.cursor = stepIndex;
        run.updatedAt = new Date(now()).toISOString();
        persistRun(run);
        appendEvent(run, run.status === 'blocked' ? 'blocked' : 'failed', {
          error: run.error,
          step: stepKey,
          stepIndex,
        });
        return run;
      }
    }

    run.status = 'completed';
    run.error = '';
    run.cursor = steps.length;
    run.completedAt = new Date(now()).toISOString();
    run.updatedAt = run.completedAt;
    persistRun(run);
    appendEvent(run, 'completed', { completedAt: run.completedAt });
    return run;
  };

  const queueRun = (workflowKey, input = {}, metadata = {}) => {
    const run = {
      createdAt: new Date(now()).toISOString(),
      cursor: 0,
      definitionVersion: 1,
      error: '',
      failures: [],
      id: `${workflowKey}-${now()}-${randomId()}`,
      input,
      key: workflowKey,
      metadata: metadata && typeof metadata === 'object' ? { ...metadata } : {},
      status: 'queued',
      updatedAt: new Date(now()).toISOString(),
    };
    persistRun(run);
    appendEvent(run, 'queued', {
      queuedAt: run.createdAt,
    });
    return run;
  };

  const scheduleRunExecution = (runId, context = {}) => {
    setTimeout(async () => {
      if (activeRunIds.has(runId)) {
        return;
      }
      const run = stateStore.getWorkflowRun(runId);
      if (!run) {
        return;
      }
      activeRunIds.add(runId);
      try {
        await executeRunSteps(run, context);
      } finally {
        activeRunIds.delete(runId);
      }
    }, 0);
  };

  const runWorkflow = async (workflowKey, input = {}, context = {}, metadata = {}) => {
    const key = String(workflowKey || '').trim();
    if (!key) {
      throw new Error('workflow key is required');
    }
    const run = queueRun(key, input, metadata);
    scheduleRunExecution(run.id, context);
    return run;
  };

  const resumeWorkflowRun = async (runId, context = {}) => {
    const run = stateStore.getWorkflowRun(runId);
    if (!run) {
      return null;
    }

    if (!['blocked', 'failed', 'queued', 'running'].includes(String(run.status || ''))) {
      return run;
    }

    run.status = 'queued';
    run.updatedAt = new Date(now()).toISOString();
    persistRun(run);
    appendEvent(run, 'resumed', {
      resumedAt: run.updatedAt,
    });
    scheduleRunExecution(run.id, context);
    return run;
  };

  const listWorkflowDefinitions = () => Object.values(workflowDefinitions).map((definition) => ({
    key: definition.key,
    title: definition.title,
    version: Number(definition.version || 1),
    steps: Array.isArray(definition.steps)
      ? definition.steps.map((step) => ({
        action: step.action || null,
        cluster: step.cluster || null,
        event: step.event || null,
        key: step.key || '',
        kind: step.kind || 'command',
        retries: Number(step.retries || 0),
        service: step.service || null,
        timeoutMs: Number(step.timeoutMs || 0) || null,
      }))
      : [],
  }));

  return {
    getWorkflowRun: (runId) => stateStore.getWorkflowRun(runId),
    listWorkflowDefinitions,
    listWorkflowEvents: (options = {}) => stateStore.listWorkflowEvents(options),
    listWorkflowRuns: (options = {}) => stateStore.listWorkflowRuns(options),
    resumeWorkflowRun,
    runWorkflow,
  };
};

module.exports = {
  createWorkflowEngine,
};
