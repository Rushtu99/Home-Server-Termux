import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceData } from './useWorkspaceData';

const { fetchUiBootstrap, fetchUiInitialPayload, fetchWorkspacePayload } = vi.hoisted(() => ({
  fetchUiBootstrap: vi.fn(),
  fetchUiInitialPayload: vi.fn(),
  fetchWorkspacePayload: vi.fn(),
}));

vi.mock('./api', () => ({
  fetchUiBootstrap,
  fetchUiInitialPayload,
  fetchWorkspacePayload,
}));

describe('useWorkspaceData', () => {
  beforeEach(() => {
    fetchUiBootstrap.mockReset();
    fetchUiInitialPayload.mockReset();
    fetchWorkspacePayload.mockReset();
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
});
