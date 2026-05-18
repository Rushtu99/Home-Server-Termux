'use client';

import { appFetch } from '../demo-api';
import { dispatchLlmStreamEvent, parseSseChunk, type LlmChatStreamHandlers } from './llm-stream';
import type {
  NormalizedUiInitial,
  UiBootstrapResponse,
  UiInitialResponse,
  UiInitialResponseLegacy,
  UiInitialResponseV2,
  UiWorkspaceResponse,
  WorkspaceKey,
} from './types';

const API = '/api';
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const DEFAULT_ACTION_REQUEST_TIMEOUT_MS = 120000;

const parseError = async (response: Response) => {
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  return String(payload?.error || `Request failed with ${response.status}`);
};

const appFetchWithTimeout = async (
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  const hasExternalSignal = Boolean(init.signal);
  let timedOut = false;
  const timeoutId = hasExternalSignal
    ? null
    : window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

  try {
    return await appFetch(input, {
      ...init,
      signal: init.signal || controller.signal,
    });
  } catch (error) {
    if (timedOut && error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};

const buildOkSection = (generatedAt?: string) => ({
  ok: true,
  retryable: false,
  stale: false,
  ...(generatedAt ? { generatedAt } : {}),
});

export const parseUiInitialResponse = (payload: UiInitialResponse): NormalizedUiInitial => {
  const candidate = payload as Partial<UiInitialResponseV2>;
  if (candidate?.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      status: candidate.status || 'error',
      bootstrap: candidate.bootstrap || null,
      workspace: candidate.workspace || null,
      sections: {
        bootstrap: candidate.sections?.bootstrap || {
          ok: Boolean(candidate.bootstrap),
          retryable: false,
          stale: false,
        },
        workspace: candidate.sections?.workspace || {
          ok: Boolean(candidate.workspace),
          retryable: false,
          stale: false,
        },
      },
      retryAfterMs: Number(candidate.retryAfterMs || 0),
    };
  }

  const legacy = payload as UiInitialResponseLegacy;
  return {
    schemaVersion: 1,
    status: 'ok',
    bootstrap: legacy.bootstrap || null,
    workspace: legacy.workspace || null,
    sections: {
      bootstrap: buildOkSection(legacy.bootstrap?.generatedAt),
      workspace: buildOkSection(legacy.workspace?.generatedAt),
    },
    retryAfterMs: 0,
  };
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await appFetchWithTimeout(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<T>;
};

export const fetchUiBootstrap = () => fetchJson<UiBootstrapResponse>(`${API}/ui/bootstrap`);

export const fetchUiInitialPayload = (workspace: WorkspaceKey) =>
  fetchJson<UiInitialResponse>(`${API}/ui/initial?workspace=${encodeURIComponent(workspace)}`).then(parseUiInitialResponse);

export const fetchWorkspacePayload = (workspace: WorkspaceKey) =>
  fetchJson<UiWorkspaceResponse>(`${API}/ui/workspaces/${workspace}`);

export type ControlPlaneCatalogServicesResponse = {
  generatedAt?: string;
  groups?: string[];
  services?: Array<Record<string, unknown>>;
};

export type ControlPlaneCatalogWorkersResponse = {
  generatedAt?: string;
  workers?: Array<Record<string, unknown>>;
};

export type ControlPlaneServiceStateResponse = {
  generatedAt?: string;
  state?: string;
  counts?: Record<string, number>;
  services?: Array<Record<string, unknown>>;
};

export type ControlPlaneWorkflowDefinitionsResponse = {
  generatedAt?: string;
  workflows?: Array<Record<string, unknown>>;
};

export type ControlPlaneWorkflowRunsResponse = {
  generatedAt?: string;
  runs?: Array<Record<string, unknown>>;
};

export type ControlPlaneClustersResponse = {
  generatedAt?: string;
  clusters?: Array<Record<string, unknown>>;
};

export type ControlPlaneWorkflowEventsResponse = {
  generatedAt?: string;
  events?: Array<Record<string, unknown>>;
};

export type ControlPlaneMetricsResponse = {
  generatedAt?: string;
  metrics?: Record<string, unknown>;
};

export type ControlPlaneHealthResponse = {
  generatedAt?: string;
  summary?: Record<string, unknown>;
  services?: Record<string, unknown>;
};

export type ControlPlaneStateResponse = Record<string, unknown>;

export type ControlPlaneSnapshot = {
  catalog: {
    generatedAt?: string;
    groups: string[];
    services: Array<Record<string, unknown>>;
    workers: Array<Record<string, unknown>>;
  };
  serviceState: ControlPlaneServiceStateResponse | null;
  workflows: Array<Record<string, unknown>>;
  workflowRuns: Array<Record<string, unknown>>;
  workflowEvents: Array<Record<string, unknown>>;
  clusters: Array<Record<string, unknown>>;
  metrics: ControlPlaneMetricsResponse | null;
  health: ControlPlaneHealthResponse | null;
  state: ControlPlaneStateResponse | null;
  errors: string[];
};

export const fetchControlPlaneSnapshot = async (): Promise<ControlPlaneSnapshot> => {
  const [
    servicesResult,
    workersResult,
    stateResult,
    workflowsResult,
    runsResult,
    clustersResult,
    workflowEventsResult,
    metricsResult,
    healthResult,
    systemStateResult,
  ] = await Promise.allSettled([
    fetchJson<ControlPlaneCatalogServicesResponse>(`${API}/catalog/services`),
    fetchJson<ControlPlaneCatalogWorkersResponse>(`${API}/catalog/workers`),
    fetchJson<ControlPlaneServiceStateResponse>(`${API}/state/services`),
    fetchJson<ControlPlaneWorkflowDefinitionsResponse>(`${API}/workflows`),
    fetchJson<ControlPlaneWorkflowRunsResponse>(`${API}/workflows/runs`),
    fetchJson<ControlPlaneClustersResponse>(`${API}/clusters`),
    fetchJson<ControlPlaneWorkflowEventsResponse>(`${API}/events/workflows?limit=80`),
    fetchJson<ControlPlaneMetricsResponse>(`${API}/metrics`),
    fetchJson<ControlPlaneHealthResponse>(`${API}/health`),
    fetchJson<ControlPlaneStateResponse>(`${API}/state`),
  ]);

  const errors: string[] = [];
  const toErrorString = (value: unknown, fallback: string) =>
    String(value instanceof Error ? value.message : value || fallback);

  if (servicesResult.status === 'rejected') {
    errors.push(toErrorString(servicesResult.reason, 'catalog/services failed'));
  }
  if (workersResult.status === 'rejected') {
    errors.push(toErrorString(workersResult.reason, 'catalog/workers failed'));
  }
  if (stateResult.status === 'rejected') {
    errors.push(toErrorString(stateResult.reason, 'state/services failed'));
  }
  if (workflowsResult.status === 'rejected') {
    errors.push(toErrorString(workflowsResult.reason, 'workflows failed'));
  }
  if (runsResult.status === 'rejected') {
    errors.push(toErrorString(runsResult.reason, 'workflows/runs failed'));
  }
  if (clustersResult.status === 'rejected') {
    errors.push(toErrorString(clustersResult.reason, 'clusters failed'));
  }
  if (workflowEventsResult.status === 'rejected') {
    errors.push(toErrorString(workflowEventsResult.reason, 'events/workflows failed'));
  }
  if (metricsResult.status === 'rejected') {
    errors.push(toErrorString(metricsResult.reason, 'metrics failed'));
  }
  if (healthResult.status === 'rejected') {
    errors.push(toErrorString(healthResult.reason, 'health failed'));
  }
  if (systemStateResult.status === 'rejected') {
    errors.push(toErrorString(systemStateResult.reason, 'state failed'));
  }

  const servicesPayload = servicesResult.status === 'fulfilled' ? servicesResult.value : {};
  const workersPayload = workersResult.status === 'fulfilled' ? workersResult.value : {};
  const statePayload = stateResult.status === 'fulfilled' ? stateResult.value : null;
  const workflowsPayload = workflowsResult.status === 'fulfilled' ? workflowsResult.value : {};
  const runsPayload = runsResult.status === 'fulfilled' ? runsResult.value : {};
  const clustersPayload = clustersResult.status === 'fulfilled' ? clustersResult.value : {};
  const workflowEventsPayload = workflowEventsResult.status === 'fulfilled' ? workflowEventsResult.value : {};
  const metricsPayload = metricsResult.status === 'fulfilled' ? metricsResult.value : null;
  const healthPayload = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const systemStatePayload = systemStateResult.status === 'fulfilled' ? systemStateResult.value : null;

  return {
    catalog: {
      generatedAt: servicesPayload.generatedAt || workersPayload.generatedAt,
      groups: Array.isArray(servicesPayload.groups) ? servicesPayload.groups : [],
      services: Array.isArray(servicesPayload.services) ? servicesPayload.services : [],
      workers: Array.isArray(workersPayload.workers) ? workersPayload.workers : [],
    },
    errors,
    serviceState: statePayload,
    clusters: Array.isArray(clustersPayload.clusters) ? clustersPayload.clusters : [],
    workflowEvents: Array.isArray(workflowEventsPayload.events) ? workflowEventsPayload.events : [],
    metrics: metricsPayload,
    health: healthPayload,
    state: systemStatePayload,
    workflowRuns: Array.isArray(runsPayload.runs) ? runsPayload.runs : [],
    workflows: Array.isArray(workflowsPayload.workflows) ? workflowsPayload.workflows : [],
  };
};

const postJson = async <T>(url: string, body: Record<string, unknown> = {}): Promise<T> => {
  const response = await appFetchWithTimeout(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, DEFAULT_ACTION_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<T>;
};

const deleteJson = async <T>(url: string): Promise<T> => {
  const response = await appFetchWithTimeout(url, {
    method: 'DELETE',
    credentials: 'include',
  }, DEFAULT_ACTION_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<T>;
};

export const unlockServiceController = (adminPassword: string) =>
  postJson<{ success: boolean; locked: boolean; expiresAt: string }>(`${API}/control/unlock`, { adminPassword });

export const lockServiceController = () =>
  postJson<{ success: boolean; locked: boolean }>(`${API}/control/lock`);

export const controlService = (
  service: string,
  action: 'start' | 'stop' | 'restart',
  adminPassword?: string
) =>
  postJson<{ success: boolean; running: boolean; expectedRunning: boolean; output: string }>(`${API}/control`, {
    service,
    action,
    ...(adminPassword ? { adminPassword } : {}),
  });

export const listClusters = () =>
  fetchJson<{ generatedAt?: string; clusters?: Array<Record<string, unknown>> }>(`${API}/clusters`);

export const getCluster = (name: string) =>
  fetchJson<Record<string, unknown>>(`${API}/clusters/${encodeURIComponent(name)}`);

export const controlCluster = (name: string, action: 'start' | 'stop' | 'restart') =>
  postJson<{ success?: boolean; cluster?: Record<string, unknown>; error?: string }>(
    `${API}/clusters/${encodeURIComponent(name)}/${action}`,
    {}
  );

export const controlClusterService = (name: string, action: 'start' | 'stop' | 'restart') =>
  postJson<{ success?: boolean; running?: boolean; error?: string }>(
    `${API}/services/${encodeURIComponent(name)}/${action}`,
    {}
  );

export const startWorkflow = (name: string, input: Record<string, unknown> = {}) =>
  postJson<{ success?: boolean; run?: Record<string, unknown>; error?: string }>(
    `${API}/workflows/${encodeURIComponent(name)}/start`,
    { input }
  );

export type StorageHelperStatus = {
  path?: string;
  exists?: boolean;
  installed?: boolean;
};

export type StorageHelperStatuses = {
  usbMount?: StorageHelperStatus;
  watchdog?: StorageHelperStatus;
};

export type StorageProtectionActionResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  warning?: string;
  installHint?: string;
  manualCommand?: string;
  storageProtection?: Record<string, unknown>;
  helpers?: StorageHelperStatuses;
};

export const checkDrives = () =>
  postJson<StorageProtectionActionResponse & Record<string, unknown>>(`${API}/drives/check`);

export const recheckStorageProtection = () =>
  postJson<StorageProtectionActionResponse>(`${API}/storage/protection/recheck`);

export const resumeStorageProtection = () =>
  postJson<StorageProtectionActionResponse & { resumed?: string[]; failed?: Array<{ service: string; error: string }> }>(
    `${API}/storage/protection/resume`
  );

export const repairDriveHelpers = () =>
  postJson<StorageProtectionActionResponse & {
    repaired?: Array<{ helper: string; path: string; action?: string }>;
    started?: Array<{ helper: string; path: string }>;
    failed?: Array<{ helper: string; path: string; error: string }>;
    missing?: Array<{ helper: string; path: string }>;
  }>(`${API}/drives/helpers/repair`);

export const mountFtpFavourite = (id: number) =>
  postJson<{ success?: boolean; error?: string }>(`${API}/ftp/favourites/${id}/mount`);

export const unmountFtpFavourite = (id: number) =>
  postJson<{ success?: boolean; error?: string }>(`${API}/ftp/favourites/${id}/unmount`);

export const listFtpDefaults = () =>
  fetchJson<Record<string, unknown>>(`${API}/ftp/defaults`);

export const listFtpFavourites = () =>
  fetchJson<{ favourites: Array<Record<string, unknown>> }>(`${API}/ftp/favourites`);

export const createFtpFavourite = (payload: Record<string, unknown>) =>
  postJson<{ success?: boolean; error?: string; favourite?: Record<string, unknown> }>(`${API}/ftp/favourites`, payload);

export const updateFtpFavourite = (id: number, payload: Record<string, unknown>) => {
  return (async () => {
    const response = await appFetchWithTimeout(`${API}/ftp/favourites/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
      'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }, DEFAULT_ACTION_REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    return response.json() as Promise<{ success?: boolean; error?: string; favourite?: Record<string, unknown> }>;
  })();
};

export const deleteFtpFavourite = (id: number) =>
  deleteJson<{ success?: boolean; error?: string }>(`${API}/ftp/favourites/${id}`);

export const listFtpDirectory = (payload: Record<string, unknown>) =>
  postJson<Record<string, unknown>>(`${API}/ftp/list`, payload);

export const uploadToFtp = (payload: Record<string, unknown>) =>
  postJson<Record<string, unknown>>(`${API}/ftp/upload`, payload);

export const createFtpDirectory = (payload: Record<string, unknown>) =>
  postJson<Record<string, unknown>>(`${API}/ftp/mkdir`, payload);

export const addMediaTorrent = (payload: {
  source: string;
  lane: 'arr' | 'standalone';
  mediaType?: 'movies' | 'series' | 'manual';
  destinationPath?: string;
}) =>
  postJson<{ success?: boolean; error?: string; message?: string; id?: string }>(`${API}/media/torrents/add`, payload);

export const selectLlmModel = (modelId: string) =>
  postJson<{ success?: boolean; error?: string }>(`${API}/llm/models/select`, { modelId });

export const refreshOnlineModels = () =>
  postJson<{ success?: boolean; error?: string; online?: unknown }>(`${API}/llm/online/models/refresh`);

export const selectOnlineModel = (modelId: string) =>
  postJson<{ success?: boolean; error?: string }>(`${API}/llm/online/models/select`, { modelId });

export const disconnectConnection = (sessionId: string) =>
  postJson<{ success?: boolean; error?: string }>(`${API}/connections/${encodeURIComponent(sessionId)}/disconnect`);

export const fetchLogsSnapshot = () =>
  fetchJson<{
    entries?: Array<{ id?: string; level?: string; message?: string; timestamp?: string; meta?: unknown }>;
    markdown?: string;
    verboseLoggingEnabled?: boolean;
  }>(`${API}/logs`);

export const updateVerboseLogging = (enabled: boolean) =>
  postJson<{ success?: boolean; verboseLoggingEnabled?: boolean; markdown?: string }>(`${API}/logging`, { enabled });

export const sendLlmChat = (payload: {
  message: string;
  mode: 'local' | 'online';
  conversationId?: number | null;
  onlineModelId?: string;
}) =>
  postJson<{
    success?: boolean;
    error?: string;
    conversationId?: number;
    assistantMessage?: {
      id?: number;
      role?: string;
      content?: string;
      createdAt?: string;
      modelId?: string;
    };
  }>(`${API}/llm/chat`, payload);

type LlmChatStreamPayload = {
  message: string;
  mode: 'local' | 'online';
  conversationId?: number | null;
  onlineModelId?: string;
};

export const sendLlmChatStream = async (payload: LlmChatStreamPayload, handlers: LlmChatStreamHandlers) => {
  const response = await appFetch(`${API}/llm/chat/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  if (!response.body) {
    throw new Error('Streaming response body is unavailable');
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let terminalSeen = false;

  try {
    while (!terminalSeen) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        if (!raw.trim()) {
          continue;
        }
        terminalSeen = dispatchLlmStreamEvent(parseSseChunk(raw), handlers) || terminalSeen;
      }
    }

    if (!terminalSeen) {
      buffer += decoder.decode().replace(/\r/g, '');
      for (const raw of buffer.split('\n\n')) {
        if (!raw.trim()) {
          continue;
        }
        terminalSeen = dispatchLlmStreamEvent(parseSseChunk(raw), handlers) || terminalSeen;
        if (terminalSeen) {
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!terminalSeen) {
    throw new Error('Stream ended before terminal event');
  }
};

export const listLlmConversations = () =>
  fetchJson<{
    conversations: Array<{
      id: number;
      title?: string;
      createdAt?: string;
      updatedAt?: string;
    }>;
  }>(`${API}/llm/conversations`);

export const getLlmConversationMessages = (conversationId: number) =>
  fetchJson<{
    conversation: {
      id: number;
      title?: string;
      createdAt?: string;
      updatedAt?: string;
    };
    messages: Array<{
      id: number;
      role: 'user' | 'assistant' | string;
      content: string;
      createdAt?: string;
      modelId?: string;
    }>;
  }>(`${API}/llm/conversations/${conversationId}/messages`);

export const deleteLlmConversation = (conversationId: number) =>
  deleteJson<{ success: boolean; id: number }>(`${API}/llm/conversations/${conversationId}`);
