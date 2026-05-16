const registerApiRoutes = ({ registerDualRoute, middleware, handlers, rawUploadParser }) => {
  const { requireAuth, requireAdmin, requireAdminOrLlmKey } = middleware;
  const {
    statusHandler,
    servicesHandler,
    controlUnlockHandler,
    controlLockHandler,
    controlHandler,
    monitorHandler,
    dashboardHandler,
    uiBootstrapHandler,
    uiInitialHandler,
    uiWorkspacePayloadHandler,
    catalogServicesHandler,
    catalogWorkersHandler,
    clustersHandler,
    clusterDetailHandler,
    clusterActionHandler,
    serviceDetailHandler,
    serviceActionHandler,
    workflowStateServicesHandler,
    workflowDefinitionsHandler,
    workflowRunsHandler,
    workflowRunDetailHandler,
    workflowRunHandler,
    workflowStartHandler,
    workflowDetailHandler,
    workflowResumeHandler,
    workflowEventsHandler,
    metricsHandler,
    healthHandler,
    stateHandler,
    networkExposureHandler,
    connectionsHandler,
    disconnectConnectionHandler,
    storageHandler,
    storageProtectionHandler,
    storageProtectionRecheckHandler,
    storageProtectionResumeHandler,
    storageHelpersRepairHandler,
    logsHandler,
    loggingGetHandler,
    loggingPostHandler,
    drivesHandler,
    drivesCheckHandler,
    sharesHandler,
    createShareHandler,
    updateShareHandler,
    usersHandler,
    createUserHandler,
    updateUserHandler,
    telemetryHandler,
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
    mediaTorrentAddHandler,
    llmStateHandler,
    llmModelSelectHandler,
    llmModelAddLocalHandler,
    llmModelPullHandler,
    llmModelPullStatusHandler,
    llmOnlineModelsRefreshHandler,
    llmOnlineModelSelectHandler,
    llmConversationsHandler,
    llmConversationMessagesHandler,
    llmConversationDeleteHandler,
    llmChatHandler,
    llmChatStreamHandler,
    openAiModelsHandler,
    openAiChatCompletionsHandler,
  } = handlers;

  registerDualRoute('get', '/status', requireAuth, statusHandler);
  registerDualRoute('get', '/services', requireAuth, requireAdmin, servicesHandler);
  registerDualRoute('post', '/control/unlock', requireAuth, requireAdmin, controlUnlockHandler);
  registerDualRoute('post', '/control/lock', requireAuth, requireAdmin, controlLockHandler);
  registerDualRoute('post', '/control', requireAuth, requireAdmin, controlHandler);
  registerDualRoute('get', '/monitor', requireAuth, requireAdmin, monitorHandler);
  registerDualRoute('get', '/dashboard', requireAuth, requireAdmin, dashboardHandler);
  registerDualRoute('get', '/ui/bootstrap', requireAuth, requireAdmin, uiBootstrapHandler);
  registerDualRoute('get', '/ui/initial', requireAuth, requireAdmin, uiInitialHandler);
  registerDualRoute('get', '/ui/workspaces/:workspaceKey', requireAuth, requireAdmin, uiWorkspacePayloadHandler);
  registerDualRoute('get', '/catalog/services', requireAuth, requireAdmin, catalogServicesHandler);
  registerDualRoute('get', '/catalog/workers', requireAuth, requireAdmin, catalogWorkersHandler);
  registerDualRoute('get', '/state/services', requireAuth, requireAdmin, workflowStateServicesHandler);
  registerDualRoute('get', '/clusters', requireAuth, requireAdmin, clustersHandler);
  registerDualRoute('get', '/clusters/:name', requireAuth, requireAdmin, clusterDetailHandler);
  registerDualRoute('post', '/clusters/:name/start', requireAuth, requireAdmin, clusterActionHandler);
  registerDualRoute('post', '/clusters/:name/stop', requireAuth, requireAdmin, clusterActionHandler);
  registerDualRoute('post', '/clusters/:name/restart', requireAuth, requireAdmin, clusterActionHandler);
  registerDualRoute('get', '/services/:name', requireAuth, requireAdmin, serviceDetailHandler);
  registerDualRoute('post', '/services/:name/start', requireAuth, requireAdmin, serviceActionHandler);
  registerDualRoute('post', '/services/:name/stop', requireAuth, requireAdmin, serviceActionHandler);
  registerDualRoute('post', '/services/:name/restart', requireAuth, requireAdmin, serviceActionHandler);
  registerDualRoute('get', '/workflows', requireAuth, requireAdmin, workflowDefinitionsHandler);
  registerDualRoute('get', '/workflows/runs', requireAuth, requireAdmin, workflowRunsHandler);
  registerDualRoute('get', '/workflows/runs/:id', requireAuth, requireAdmin, workflowRunDetailHandler);
  registerDualRoute('post', '/workflows/:key/run', requireAuth, requireAdmin, workflowRunHandler);
  registerDualRoute('post', '/workflows/:name/start', requireAuth, requireAdmin, workflowStartHandler);
  registerDualRoute('post', '/workflows/runs/:id/resume', requireAuth, requireAdmin, workflowResumeHandler);
  registerDualRoute('get', '/workflows/:id', requireAuth, requireAdmin, workflowDetailHandler);
  registerDualRoute('get', '/events/workflows', requireAuth, requireAdmin, workflowEventsHandler);
  registerDualRoute('get', '/metrics', requireAuth, requireAdmin, metricsHandler);
  registerDualRoute('get', '/health', requireAuth, requireAdmin, healthHandler);
  registerDualRoute('get', '/state', requireAuth, requireAdmin, stateHandler);
  registerDualRoute('get', '/system/network/exposure', requireAuth, requireAdmin, networkExposureHandler);
  registerDualRoute('get', '/connections', requireAuth, requireAdmin, connectionsHandler);
  registerDualRoute('post', '/connections/:id/disconnect', requireAuth, requireAdmin, disconnectConnectionHandler);
  registerDualRoute('get', '/storage', requireAuth, requireAdmin, storageHandler);
  registerDualRoute('get', '/storage/protection', requireAuth, requireAdmin, storageProtectionHandler);
  registerDualRoute('post', '/storage/protection/recheck', requireAuth, requireAdmin, storageProtectionRecheckHandler);
  registerDualRoute('post', '/storage/protection/resume', requireAuth, requireAdmin, storageProtectionResumeHandler);
  registerDualRoute('post', '/drives/helpers/repair', requireAuth, requireAdmin, storageHelpersRepairHandler);
  registerDualRoute('get', '/logs', requireAuth, requireAdmin, logsHandler);
  registerDualRoute('get', '/logging', requireAuth, requireAdmin, loggingGetHandler);
  registerDualRoute('post', '/logging', requireAuth, requireAdmin, loggingPostHandler);
  registerDualRoute('get', '/drives', requireAuth, requireAdmin, drivesHandler);
  registerDualRoute('post', '/drives/check', requireAuth, requireAdmin, drivesCheckHandler);
  registerDualRoute('get', '/shares', requireAuth, requireAdmin, sharesHandler);
  registerDualRoute('post', '/shares', requireAuth, requireAdmin, createShareHandler);
  registerDualRoute('put', '/shares/:id', requireAuth, requireAdmin, updateShareHandler);
  registerDualRoute('get', '/users', requireAuth, requireAdmin, usersHandler);
  registerDualRoute('post', '/users', requireAuth, requireAdmin, createUserHandler);
  registerDualRoute('put', '/users/:id', requireAuth, requireAdmin, updateUserHandler);
  registerDualRoute('get', '/telemetry', requireAuth, requireAdmin, telemetryHandler);
  registerDualRoute('get', '/fs/list', requireAuth, filesystemListHandler);
  registerDualRoute('post', '/fs/mkdir', requireAuth, filesystemMkdirHandler);
  registerDualRoute('post', '/fs/rename', requireAuth, filesystemRenameHandler);
  registerDualRoute('get', '/fs/operations', requireAuth, filesystemOperationsListHandler);
  registerDualRoute('get', '/fs/operations/:id', requireAuth, filesystemOperationDetailHandler);
  registerDualRoute('post', '/fs/operations/:id/control', requireAuth, filesystemOperationControlHandler);
  registerDualRoute('post', '/fs/operations/upload', requireAuth, filesystemOperationUploadCreateHandler);
  registerDualRoute('post', '/fs/operations/:id/file', requireAuth, filesystemOperationUploadFileHandler);
  registerDualRoute('post', '/fs/operations/:id/finalize', requireAuth, filesystemOperationUploadFinalizeHandler);
  registerDualRoute('post', '/fs/operations/transfer', requireAuth, filesystemOperationTransferHandler);
  registerDualRoute('post', '/fs/operations/delete', requireAuth, filesystemOperationDeleteHandler);
  registerDualRoute('post', '/fs/delete', requireAuth, filesystemDeleteHandler);
  registerDualRoute('get', '/fs/download', requireAuth, filesystemDownloadHandler);
  registerDualRoute('post', '/fs/upload', requireAuth, rawUploadParser, filesystemUploadHandler);
  registerDualRoute('post', '/fs/paste', requireAuth, filesystemPasteHandler);
  registerDualRoute('get', '/ftp/defaults', requireAuth, requireAdmin, ftpDefaultsHandler);
  registerDualRoute('get', '/ftp/favourites', requireAuth, requireAdmin, ftpFavouritesHandler);
  registerDualRoute('post', '/ftp/favourites', requireAuth, requireAdmin, createFtpFavouriteHandler);
  registerDualRoute('put', '/ftp/favourites/:id', requireAuth, requireAdmin, updateFtpFavouriteHandler);
  registerDualRoute('delete', '/ftp/favourites/:id', requireAuth, requireAdmin, deleteFtpFavouriteHandler);
  registerDualRoute('post', '/ftp/favourites/:id/mount', requireAuth, requireAdmin, mountFtpFavouriteHandler);
  registerDualRoute('post', '/ftp/favourites/:id/unmount', requireAuth, requireAdmin, unmountFtpFavouriteHandler);
  registerDualRoute('post', '/ftp/list', requireAuth, requireAdmin, ftpListHandler);
  registerDualRoute('post', '/ftp/download', requireAuth, requireAdmin, ftpDownloadHandler);
  registerDualRoute('post', '/ftp/upload', requireAuth, requireAdmin, ftpUploadHandler);
  registerDualRoute('post', '/ftp/mkdir', requireAuth, requireAdmin, ftpMkdirHandler);
  registerDualRoute('post', '/media/torrents/add', requireAuth, requireAdmin, mediaTorrentAddHandler);
  registerDualRoute('get', '/llm/state', requireAuth, requireAdmin, llmStateHandler);
  registerDualRoute('post', '/llm/models/select', requireAuth, requireAdmin, llmModelSelectHandler);
  registerDualRoute('post', '/llm/models/add-local', requireAuth, requireAdmin, llmModelAddLocalHandler);
  registerDualRoute('post', '/llm/models/pull', requireAuth, requireAdmin, llmModelPullHandler);
  registerDualRoute('get', '/llm/models/pull/:jobId', requireAuth, requireAdmin, llmModelPullStatusHandler);
  registerDualRoute('post', '/llm/online/models/refresh', requireAuth, requireAdmin, llmOnlineModelsRefreshHandler);
  registerDualRoute('post', '/llm/online/models/select', requireAuth, requireAdmin, llmOnlineModelSelectHandler);
  registerDualRoute('get', '/llm/conversations', requireAuth, requireAdmin, llmConversationsHandler);
  registerDualRoute('get', '/llm/conversations/:id/messages', requireAuth, requireAdmin, llmConversationMessagesHandler);
  registerDualRoute('delete', '/llm/conversations/:id', requireAuth, requireAdmin, llmConversationDeleteHandler);
  registerDualRoute('post', '/llm/chat', requireAuth, requireAdmin, llmChatHandler);
  registerDualRoute('post', '/llm/chat/stream', requireAuth, requireAdmin, llmChatStreamHandler);
  registerDualRoute('get', '/openai/v1/models', requireAdminOrLlmKey, openAiModelsHandler);
  registerDualRoute('post', '/openai/v1/chat/completions', requireAdminOrLlmKey, openAiChatCompletionsHandler);
};

module.exports = {
  registerApiRoutes,
};
