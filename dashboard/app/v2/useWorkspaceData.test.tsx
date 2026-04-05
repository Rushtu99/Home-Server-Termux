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
});
