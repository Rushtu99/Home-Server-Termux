import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceData } from './useWorkspaceData';

const { fetchControlPlaneSnapshot, fetchUiBootstrap, fetchUiInitialPayload, fetchWorkspacePayload } = vi.hoisted(() => ({
  fetchControlPlaneSnapshot: vi.fn(),
  fetchUiBootstrap: vi.fn(),
  fetchUiInitialPayload: vi.fn(),
  fetchWorkspacePayload: vi.fn(),
}));

vi.mock('./api', () => ({
  fetchControlPlaneSnapshot,
  fetchUiBootstrap,
  fetchUiInitialPayload,
  fetchWorkspacePayload,
}));

const CONTROL_PLANE_SNAPSHOT = {
  catalog: {
    groups: ['core'],
    services: [{ key: 'svc-1' }],
    workers: [{ key: 'worker-1' }],
  },
  errors: ['catalog degraded'],
  serviceState: { state: 'healthy' },
  workflowRuns: [{ id: 'run-1' }],
  workflows: [{ id: 'workflow-1' }],
};

describe('useWorkspaceData', () => {
  beforeEach(() => {
    fetchUiBootstrap.mockReset();
    fetchUiInitialPayload.mockReset();
    fetchWorkspacePayload.mockReset();
    fetchControlPlaneSnapshot.mockReset();
    fetchControlPlaneSnapshot.mockResolvedValue(CONTROL_PLANE_SNAPSHOT);
    window.history.replaceState({}, '', '?workspace=media');
  });

  it('loads bootstrap/workspace data and can mark the session as logged out', async () => {
    fetchUiInitialPayload.mockResolvedValue({
      bootstrap: {
        lifecycle: { state: 'healthy' },
        nav: [],
        user: { username: 'admin' },
        legacyTabMap: { media: 'media' },
        capabilities: {},
        generatedAt: new Date().toISOString(),
      },
      workspace: {
        generatedAt: new Date().toISOString(),
        workspaceKey: 'media',
      },
    });
    fetchUiBootstrap.mockResolvedValue({
      lifecycle: { state: 'healthy' },
      nav: [],
      user: { username: 'admin' },
      legacyTabMap: { media: 'media' },
      capabilities: {},
      generatedAt: new Date().toISOString(),
    });
    fetchWorkspacePayload.mockResolvedValue({
      generatedAt: new Date().toISOString(),
      workspaceKey: 'media',
    });

    const { result } = renderHook(() => useWorkspaceData());

    await waitFor(() => {
      expect(result.current.bootstrap?.user?.username).toBe('admin');
      expect(result.current.workspaceData?.workspaceKey).toBe('media');
    });

    await waitFor(() => {
      expect(fetchControlPlaneSnapshot).toHaveBeenCalledTimes(1);
      expect(result.current.workspaceData?.controlPlane).toMatchObject(CONTROL_PLANE_SNAPSHOT);
    });

    act(() => {
      result.current.markLoggedOut();
    });

    expect(result.current.bootstrap).toBeNull();
    expect(result.current.bootstrapError).toBe('Login required');
    expect(result.current.workspaceData).toBeNull();
    expect(result.current.loadingBootstrap).toBe(false);
    expect(result.current.loadingWorkspace).toBe(false);
    expect(result.current.activeWorkspace).toBe('overview');
  });

  it('keeps the previous workspace visible when the next workspace fails during initial load', async () => {
    fetchUiInitialPayload.mockResolvedValueOnce({
      schemaVersion: 1,
      status: 'ok',
      retryAfterMs: 0,
      bootstrap: {
        lifecycle: { state: 'healthy' },
        nav: [],
        user: { username: 'admin' },
        legacyTabMap: { media: 'media' },
        capabilities: {},
        generatedAt: new Date().toISOString(),
      },
      workspace: {
        generatedAt: new Date().toISOString(),
        workspaceKey: 'media',
      },
      sections: {
        bootstrap: { ok: true, retryable: false, stale: false },
        workspace: { ok: true, retryable: false, stale: false },
      },
    });
    fetchUiBootstrap.mockResolvedValue({
      lifecycle: { state: 'healthy' },
      nav: [],
      user: { username: 'admin' },
      legacyTabMap: { media: 'media' },
      capabilities: {},
      generatedAt: new Date().toISOString(),
    });
    fetchWorkspacePayload.mockImplementation(async (workspace) => {
      if (workspace === 'overview') {
        throw new Error('workspace fetch failed');
      }
      return {
        generatedAt: new Date().toISOString(),
        workspaceKey: workspace,
      };
    });

    const { result } = renderHook(() => useWorkspaceData());

    await waitFor(() => {
      expect(result.current.displayedWorkspace).toBe('media');
      expect(result.current.workspaceData?.workspaceKey).toBe('media');
    });

    act(() => {
      result.current.setActiveWorkspace('overview');
    });

    await waitFor(() => {
      expect(result.current.workspaceError).toContain('workspace fetch failed');
    });

    expect(result.current.activeWorkspace).toBe('overview');
    expect(result.current.displayedWorkspace).toBe('media');
    expect(result.current.workspaceData?.workspaceKey).toBe('media');
    expect(result.current.isWorkspaceStale).toBe(true);
    expect(result.current.transitionLabel).toContain('Loading overview, showing media snapshot');
  });

  it('merges control-plane snapshot into the workspace payload after switching workspaces', async () => {
    fetchUiInitialPayload.mockResolvedValue({
      bootstrap: {
        lifecycle: { state: 'healthy' },
        nav: [],
        user: { username: 'admin' },
        legacyTabMap: { media: 'media' },
        capabilities: {},
        generatedAt: new Date().toISOString(),
      },
      workspace: {
        generatedAt: new Date().toISOString(),
        workspaceKey: 'media',
      },
    });
    fetchUiBootstrap.mockResolvedValue({
      lifecycle: { state: 'healthy' },
      nav: [],
      user: { username: 'admin' },
      legacyTabMap: { media: 'media' },
      capabilities: {},
      generatedAt: new Date().toISOString(),
    });
    fetchWorkspacePayload.mockImplementation(async (workspace) => ({
      generatedAt: new Date().toISOString(),
      workspaceKey: workspace,
      payloadSource: 'workspace-api',
    }));

    const { result } = renderHook(() => useWorkspaceData());

    await waitFor(() => {
      expect(result.current.workspaceData?.workspaceKey).toBe('media');
    });

    act(() => {
      result.current.setActiveWorkspace('overview');
    });

    await waitFor(() => {
      expect(result.current.workspaceData?.workspaceKey).toBe('overview');
    });

    expect(fetchControlPlaneSnapshot).toHaveBeenCalled();
    expect(result.current.workspaceData?.payloadSource).toBe('workspace-api');
    expect(result.current.workspaceData?.controlPlane).toMatchObject(CONTROL_PLANE_SNAPSHOT);
  });

  it('switches polling intervals to hidden cadence when tab visibility changes', async () => {
    fetchUiInitialPayload.mockResolvedValue({
      bootstrap: {
        lifecycle: { state: 'healthy' },
        nav: [],
        user: { username: 'admin' },
        legacyTabMap: { media: 'media' },
        capabilities: {},
        generatedAt: new Date().toISOString(),
      },
      workspace: {
        generatedAt: new Date().toISOString(),
        workspaceKey: 'media',
      },
    });
    fetchUiBootstrap.mockResolvedValue({
      lifecycle: { state: 'healthy' },
      nav: [],
      user: { username: 'admin' },
      legacyTabMap: { media: 'media' },
      capabilities: {},
      generatedAt: new Date().toISOString(),
    });
    fetchWorkspacePayload.mockResolvedValue({
      generatedAt: new Date().toISOString(),
      workspaceKey: 'media',
    });

    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    let hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });

    const { unmount } = renderHook(() => useWorkspaceData());

    await waitFor(() => {
      expect(fetchUiInitialPayload).toHaveBeenCalled();
    });

    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 30000)).toBe(true);
    expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 9000)).toBe(true);

    act(() => {
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 60000)).toBe(true);
    });

    unmount();
    setIntervalSpy.mockRestore();
    if (originalHidden) {
      Object.defineProperty(document, 'hidden', originalHidden);
    }
  });
});
