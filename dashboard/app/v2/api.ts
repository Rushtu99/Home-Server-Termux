'use client';

import { appFetch } from '../demo-api';
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
