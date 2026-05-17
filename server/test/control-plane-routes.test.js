const { registerApiRoutes } = require('../src/routes/register-api-routes');

const createHandlerStub = () => () => {};

const buildHandlers = () => ({
  catalogServicesHandler: createHandlerStub(),
  catalogWorkersHandler: createHandlerStub(),
  clustersHandler: createHandlerStub(),
  clusterDetailHandler: createHandlerStub(),
  clusterActionHandler: createHandlerStub(),
  serviceDetailHandler: createHandlerStub(),
  serviceActionHandler: createHandlerStub(),
  connectionsHandler: createHandlerStub(),
  controlHandler: createHandlerStub(),
  controlLockHandler: createHandlerStub(),
  controlUnlockHandler: createHandlerStub(),
  createFtpDirectoryHandler: createHandlerStub(),
  createFtpFavouriteHandler: createHandlerStub(),
  createShareHandler: createHandlerStub(),
  createUserHandler: createHandlerStub(),
  dashboardHandler: createHandlerStub(),
  deleteFtpFavouriteHandler: createHandlerStub(),
  disconnectConnectionHandler: createHandlerStub(),
  drivesCheckHandler: createHandlerStub(),
  drivesHandler: createHandlerStub(),
  filesystemDeleteHandler: createHandlerStub(),
  filesystemDownloadHandler: createHandlerStub(),
  filesystemListHandler: createHandlerStub(),
  filesystemMkdirHandler: createHandlerStub(),
  filesystemOperationControlHandler: createHandlerStub(),
  filesystemOperationDeleteHandler: createHandlerStub(),
  filesystemOperationDetailHandler: createHandlerStub(),
  filesystemOperationTransferHandler: createHandlerStub(),
  filesystemOperationUploadCreateHandler: createHandlerStub(),
  filesystemOperationUploadFileHandler: createHandlerStub(),
  filesystemOperationUploadFinalizeHandler: createHandlerStub(),
  filesystemOperationsListHandler: createHandlerStub(),
  filesystemPasteHandler: createHandlerStub(),
  filesystemRenameHandler: createHandlerStub(),
  filesystemUploadHandler: createHandlerStub(),
  ftpDefaultsHandler: createHandlerStub(),
  ftpDownloadHandler: createHandlerStub(),
  ftpFavouritesHandler: createHandlerStub(),
  ftpListHandler: createHandlerStub(),
  ftpMkdirHandler: createHandlerStub(),
  ftpUploadHandler: createHandlerStub(),
  llmChatHandler: createHandlerStub(),
  llmChatStreamHandler: createHandlerStub(),
  llmConversationDeleteHandler: createHandlerStub(),
  llmConversationMessagesHandler: createHandlerStub(),
  llmConversationsHandler: createHandlerStub(),
  llmModelAddLocalHandler: createHandlerStub(),
  llmModelPullHandler: createHandlerStub(),
  llmModelPullStatusHandler: createHandlerStub(),
  llmModelSelectHandler: createHandlerStub(),
  llmOnlineModelSelectHandler: createHandlerStub(),
  llmOnlineModelsRefreshHandler: createHandlerStub(),
  llmStateHandler: createHandlerStub(),
  loggingGetHandler: createHandlerStub(),
  loggingPostHandler: createHandlerStub(),
  logsHandler: createHandlerStub(),
  mediaTorrentAddHandler: createHandlerStub(),
  monitorHandler: createHandlerStub(),
  mountFtpFavouriteHandler: createHandlerStub(),
  networkExposureHandler: createHandlerStub(),
  openAiChatCompletionsHandler: createHandlerStub(),
  openAiModelsHandler: createHandlerStub(),
  sharesHandler: createHandlerStub(),
  statusHandler: createHandlerStub(),
  storageHandler: createHandlerStub(),
  storageHelpersRepairHandler: createHandlerStub(),
  storageProtectionHandler: createHandlerStub(),
  storageProtectionRecheckHandler: createHandlerStub(),
  storageProtectionResumeHandler: createHandlerStub(),
  telemetryHandler: createHandlerStub(),
  uiBootstrapHandler: createHandlerStub(),
  uiInitialHandler: createHandlerStub(),
  uiWorkspacePayloadHandler: createHandlerStub(),
  unmountFtpFavouriteHandler: createHandlerStub(),
  updateFtpFavouriteHandler: createHandlerStub(),
  updateShareHandler: createHandlerStub(),
  updateUserHandler: createHandlerStub(),
  usersHandler: createHandlerStub(),
  workflowDefinitionsHandler: createHandlerStub(),
  workflowEventsHandler: createHandlerStub(),
  workflowResumeHandler: createHandlerStub(),
  workflowRunDetailHandler: createHandlerStub(),
  workflowRunHandler: createHandlerStub(),
  workflowStartHandler: createHandlerStub(),
  workflowDetailHandler: createHandlerStub(),
  workflowRunsHandler: createHandlerStub(),
  workflowStateServicesHandler: createHandlerStub(),
  metricsHandler: createHandlerStub(),
  healthHandler: createHandlerStub(),
  stateHandler: createHandlerStub(),
});

describe('registerApiRoutes control-plane integration', () => {
  it('registers compatibility routes and new control-plane routes', () => {
    const routes = [];
    registerApiRoutes({
      handlers: buildHandlers(),
      middleware: {
        requireAdmin: createHandlerStub(),
        requireAdminOrLlmKey: createHandlerStub(),
        requireAuth: createHandlerStub(),
      },
      rawUploadParser: createHandlerStub(),
      registerDualRoute: (method, path) => {
        routes.push(`${String(method).toUpperCase()} ${String(path)}`);
      },
    });

    expect(routes).toContain('GET /services');
    expect(routes).toContain('POST /control');
    expect(routes).toContain('GET /catalog/services');
    expect(routes).toContain('GET /catalog/workers');
    expect(routes).toContain('GET /state/services');
    expect(routes).toContain('GET /services/status');
    expect(routes).toContain('GET /clusters');
    expect(routes).toContain('GET /clusters/:name');
    expect(routes).toContain('POST /clusters/start/:name');
    expect(routes).toContain('POST /clusters/stop/:name');
    expect(routes).toContain('POST /clusters/restart/:name');
    expect(routes).toContain('POST /clusters/:name/start');
    expect(routes).toContain('POST /clusters/:name/stop');
    expect(routes).toContain('POST /clusters/:name/restart');
    expect(routes).toContain('GET /services/:name');
    expect(routes).toContain('POST /services/start/:name');
    expect(routes).toContain('POST /services/stop/:name');
    expect(routes).toContain('POST /services/restart/:name');
    expect(routes).toContain('POST /services/:name/start');
    expect(routes).toContain('POST /services/:name/stop');
    expect(routes).toContain('GET /workflows');
    expect(routes).toContain('GET /workflows/runs');
    expect(routes).toContain('POST /workflows/:name/start');
    expect(routes).toContain('GET /workflows/:id');
    expect(routes).toContain('POST /workflows/:key/run');
    expect(routes).toContain('POST /workflows/runs/:id/resume');
    expect(routes).toContain('GET /events/workflows');
    expect(routes).toContain('GET /metrics');
    expect(routes).toContain('GET /health');
    expect(routes).toContain('GET /state');
  });
});
