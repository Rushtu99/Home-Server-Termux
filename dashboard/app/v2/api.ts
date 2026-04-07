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

const parseError = async (response: Response) => {
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  return String(payload?.error || `Request failed with ${response.status}`);
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
  const response = await appFetch(url, { credentials: 'include' });
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

const postJson = async <T>(url: string, body: Record<string, unknown> = {}): Promise<T> => {
  const response = await appFetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<T>;
};

const deleteJson = async <T>(url: string): Promise<T> => {
  const response = await appFetch(url, {
    method: 'DELETE',
    credentials: 'include',
  });
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

export const checkDrives = () =>
  postJson<{ success?: boolean; error?: string }>(`${API}/drives/check`);

export const recheckStorageProtection = () =>
  postJson<{ success?: boolean; error?: string }>(`${API}/storage/protection/recheck`);

export const resumeStorageProtection = () =>
  postJson<{ success?: boolean; resumed?: string[]; failed?: Array<{ service: string; error: string }>; error?: string }>(
    `${API}/storage/protection/resume`
  );

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
    const response = await appFetch(`${API}/ftp/favourites/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
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
