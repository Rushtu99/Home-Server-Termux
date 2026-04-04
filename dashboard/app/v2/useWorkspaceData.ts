'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchUiBootstrap, fetchWorkspacePayload } from './api';
import { DEFAULT_WORKSPACE, resolveWorkspaceFromQuery } from './workspaceMap';
import type { UiBootstrapResponse, UiWorkspaceResponse, WorkspaceKey } from './types';

type UseWorkspaceDataResult = {
  activeWorkspace: WorkspaceKey;
  bootstrap: UiBootstrapResponse | null;
  bootstrapError: string;
  loadingBootstrap: boolean;
  reloadBootstrap: () => void;
  setActiveWorkspace: (workspace: WorkspaceKey) => void;
  reloadWorkspace: () => void;
  workspaceData: UiWorkspaceResponse | null;
  workspaceError: string;
  loadingWorkspace: boolean;
};

export function useWorkspaceData(): UseWorkspaceDataResult {
  const [activeWorkspace, setActiveWorkspaceState] = useState<WorkspaceKey>(DEFAULT_WORKSPACE);
  const [bootstrap, setBootstrap] = useState<UiBootstrapResponse | null>(null);
  const [bootstrapError, setBootstrapError] = useState('');
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);
  const [bootstrapReloadTick, setBootstrapReloadTick] = useState(0);
  const [workspaceData, setWorkspaceData] = useState<UiWorkspaceResponse | null>(null);
  const [workspaceError, setWorkspaceError] = useState('');
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [workspaceReloadTick, setWorkspaceReloadTick] = useState(0);
  const workspaceRequestRef = useRef(0);
  const loadedWorkspaceKeyRef = useRef('');

  const setActiveWorkspace = useCallback((workspace: WorkspaceKey) => {
    setActiveWorkspaceState(workspace);
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('workspace', workspace);
    window.history.replaceState({}, '', url.toString());
  }, []);

  const reloadBootstrap = useCallback(() => {
    setBootstrapError('');
    setLoadingBootstrap(true);
    setBootstrapReloadTick((current) => current + 1);
  }, []);

  const reloadWorkspace = useCallback(() => {
    setWorkspaceReloadTick((current) => current + 1);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const mappedWorkspace = resolveWorkspaceFromQuery(params);
    setActiveWorkspaceState(mappedWorkspace);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadBootstrap = async () => {
      try {
        const payload = await fetchUiBootstrap();
        if (cancelled) {
          return;
        }
        setBootstrap(payload);
        setBootstrapError('');
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const mappedWorkspace = resolveWorkspaceFromQuery(params, payload.legacyTabMap);
          setActiveWorkspaceState(mappedWorkspace);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBootstrapError(String(error instanceof Error ? error.message : error || 'Unable to load workspace bootstrap'));
      } finally {
        if (!cancelled) {
          setLoadingBootstrap(false);
        }
      }
    };

    void loadBootstrap();
    const bootstrapTimer = window.setInterval(() => {
      void loadBootstrap();
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(bootstrapTimer);
    };
  }, [bootstrapReloadTick]);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspace = async () => {
      const requestId = workspaceRequestRef.current + 1;
      workspaceRequestRef.current = requestId;
      const shouldBlockRender = loadedWorkspaceKeyRef.current !== activeWorkspace;
      if (shouldBlockRender) {
        setLoadingWorkspace(true);
      }
      try {
        const payload = await fetchWorkspacePayload(activeWorkspace);
        if (cancelled || requestId !== workspaceRequestRef.current) {
          return;
        }
        setWorkspaceData(payload);
        loadedWorkspaceKeyRef.current = String(payload.workspaceKey || activeWorkspace);
        setWorkspaceError('');
      } catch (error) {
        if (cancelled || requestId !== workspaceRequestRef.current) {
          return;
        }
        setWorkspaceError(String(error instanceof Error ? error.message : error || `Unable to load ${activeWorkspace} workspace`));
      } finally {
        if (!cancelled && requestId === workspaceRequestRef.current) {
          setLoadingWorkspace(false);
        }
      }
    };

    void loadWorkspace();
    const workspaceTimer = window.setInterval(() => {
      void loadWorkspace();
    }, activeWorkspace === 'overview' ? 12000 : 18000);

    return () => {
      cancelled = true;
      window.clearInterval(workspaceTimer);
    };
  }, [activeWorkspace, workspaceReloadTick]);

  return useMemo(
    () => ({
      activeWorkspace,
      bootstrap,
      bootstrapError,
      loadingBootstrap,
      reloadBootstrap,
      setActiveWorkspace,
      reloadWorkspace,
      workspaceData,
      workspaceError,
      loadingWorkspace,
    }),
    [
      activeWorkspace,
      bootstrap,
      bootstrapError,
      loadingBootstrap,
      reloadBootstrap,
      loadingWorkspace,
      reloadWorkspace,
      setActiveWorkspace,
      workspaceData,
      workspaceError,
    ]
  );
}
