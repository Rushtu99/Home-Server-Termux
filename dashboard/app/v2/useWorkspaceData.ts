'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchUiBootstrap, fetchUiInitialPayload, fetchWorkspacePayload } from './api';
import { DEFAULT_WORKSPACE, resolveWorkspaceFromQuery } from './workspaceMap';
import type { UiBootstrapResponse, UiWorkspaceResponse, WorkspaceKey } from './types';

type UseWorkspaceDataResult = {
  activeWorkspace: WorkspaceKey;
  bootstrap: UiBootstrapResponse | null;
  bootstrapError: string;
  loadingBootstrap: boolean;
  markLoggedOut: () => void;
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
  const [sessionInactive, setSessionInactive] = useState(false);
  const [workspaceData, setWorkspaceData] = useState<UiWorkspaceResponse | null>(null);
  const [workspaceError, setWorkspaceError] = useState('');
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [workspaceReloadTick, setWorkspaceReloadTick] = useState(0);
  const workspaceRequestRef = useRef(0);
  const loadedWorkspaceKeyRef = useRef('');
  const workspaceCacheRef = useRef<Map<string, UiWorkspaceResponse>>(new Map());

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
    setSessionInactive(false);
    setBootstrapError('');
    setLoadingBootstrap(true);
    setBootstrapReloadTick((current) => current + 1);
  }, []);

  const reloadWorkspace = useCallback(() => {
    setWorkspaceReloadTick((current) => current + 1);
  }, []);

  const markLoggedOut = useCallback(() => {
    setSessionInactive(true);
    loadedWorkspaceKeyRef.current = '';
    workspaceCacheRef.current.clear();
    setBootstrap(null);
    setBootstrapError('Login required');
    setLoadingBootstrap(false);
    setWorkspaceData(null);
    setWorkspaceError('');
    setLoadingWorkspace(false);
    setActiveWorkspaceState(DEFAULT_WORKSPACE);
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
    if (sessionInactive) {
      setLoadingBootstrap(false);
      return;
    }
    let cancelled = false;

    const resolveRequestedWorkspace = () => {
      if (typeof window === 'undefined') {
        return DEFAULT_WORKSPACE;
      }
      const params = new URLSearchParams(window.location.search);
      return resolveWorkspaceFromQuery(params);
    };

    const loadInitial = async () => {
      try {
        const requestedWorkspace = resolveRequestedWorkspace();
        const payload = await fetchUiInitialPayload(requestedWorkspace);
        if (cancelled) {
          return;
        }
        setBootstrap(payload.bootstrap);
        setBootstrapError('');
        setSessionInactive(false);
        workspaceCacheRef.current.set(String(payload.workspace.workspaceKey || requestedWorkspace), payload.workspace);
        loadedWorkspaceKeyRef.current = String(payload.workspace.workspaceKey || requestedWorkspace);
        setWorkspaceData(payload.workspace);
        setWorkspaceError('');
        setLoadingWorkspace(false);
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const mappedWorkspace = resolveWorkspaceFromQuery(params, payload.bootstrap.legacyTabMap);
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

    const refreshBootstrap = async () => {
      try {
        const payload = await fetchUiBootstrap();
        if (cancelled) {
          return;
        }
        setBootstrap(payload);
        setSessionInactive(false);
        setBootstrapError('');
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

    void loadInitial();
    const bootstrapTimer = window.setInterval(() => {
      void refreshBootstrap();
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(bootstrapTimer);
    };
  }, [bootstrapReloadTick, sessionInactive]);

  useEffect(() => {
    if (sessionInactive) {
      setLoadingWorkspace(false);
      return;
    }
    let cancelled = false;

    const cachedWorkspace = workspaceCacheRef.current.get(activeWorkspace);
    if (cachedWorkspace) {
      setWorkspaceData(cachedWorkspace);
      setLoadingWorkspace(false);
    }

    const loadWorkspace = async () => {
      const requestId = workspaceRequestRef.current + 1;
      workspaceRequestRef.current = requestId;
      const shouldBlockRender = !cachedWorkspace && loadedWorkspaceKeyRef.current !== activeWorkspace;
      if (shouldBlockRender) {
        setLoadingWorkspace(true);
      } else {
        setLoadingWorkspace(true);
      }
      try {
        const payload = await fetchWorkspacePayload(activeWorkspace);
        if (cancelled || requestId !== workspaceRequestRef.current) {
          return;
        }
        workspaceCacheRef.current.set(String(payload.workspaceKey || activeWorkspace), payload);
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

    const hasLoadedCurrentWorkspace = loadedWorkspaceKeyRef.current === activeWorkspace || Boolean(cachedWorkspace);
    if (!hasLoadedCurrentWorkspace || workspaceReloadTick > 0) {
      void loadWorkspace();
    }
    const workspaceTimer = window.setInterval(() => {
      void loadWorkspace();
    }, activeWorkspace === 'overview' ? 12000 : 18000);

    return () => {
      cancelled = true;
      window.clearInterval(workspaceTimer);
    };
  }, [activeWorkspace, sessionInactive, workspaceReloadTick]);

  return useMemo(
    () => ({
      activeWorkspace,
      bootstrap,
      bootstrapError,
      loadingBootstrap,
      markLoggedOut,
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
      markLoggedOut,
      reloadBootstrap,
      loadingWorkspace,
      reloadWorkspace,
      setActiveWorkspace,
      workspaceData,
      workspaceError,
    ]
  );
}
