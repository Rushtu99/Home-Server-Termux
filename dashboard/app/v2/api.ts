'use client';

import { appFetch } from '../demo-api';
import { dispatchLlmStreamEvent, parseSseChunk, type LlmChatStreamHandlers } from './llm-stream';
import type { UiBootstrapResponse, UiWorkspaceResponse, WorkspaceKey } from './types';

const API = '/api';

const parseError = async (response: Response) => {
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  return String(payload?.error || `Request failed with ${response.status}`);
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await appFetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<T>;
};

export const fetchUiBootstrap = () => fetchJson<UiBootstrapResponse>(`${API}/ui/bootstrap`);

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
