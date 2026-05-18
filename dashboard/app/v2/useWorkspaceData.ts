'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchControlPlaneSnapshot, fetchUiBootstrap, fetchUiInitialPayload, fetchWorkspacePayload } from './api';
import { DEFAULT_WORKSPACE, resolveWorkspaceFromQuery } from './workspaceMap';
import type { NormalizedUiInitial, UiBootstrapResponse, UiWorkspaceResponse, WorkspaceKey } from './types';

const CONTROL_PLANE_CACHE_TTL_MS = 15000;

type UseWorkspaceDataResult = {
  activeWorkspace: WorkspaceKey;
  displayedWorkspace: WorkspaceKey;
  bootstrap: UiBootstrapResponse | null;
  bootstrapError: string;
  isWorkspaceStale: boolean;
  loadingBootstrap: boolean;
  markLoggedOut: () => void;
  reloadBootstrap: () => void;
  setActiveWorkspace: (workspace: WorkspaceKey) => void;
  transitionLabel: string;
  reloadWorkspace: () => void;
  prefetchWorkspaceIntent: (workspace: WorkspaceKey) => void;
  workspaceData: UiWorkspaceResponse | null;
  workspaceError: string;
  loadingWorkspace: boolean;
};

export function useWorkspaceData(): UseWorkspaceDataResult {
  const [activeWorkspace, setActiveWorkspaceState] = useState<WorkspaceKey>(DEFAULT_WORKSPACE);
  const [displayedWorkspace, setDisplayedWorkspace] = useState<WorkspaceKey>(DEFAULT_WORKSPACE);
  const [bootstrap, setBootstrap] = useState<UiBootstrapResponse | null>(null);
  const [bootstrapError, setBootstrapError] = useState('');
  const [isWorkspaceStale, setIsWorkspaceStale] = useState(false);
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);
  const [bootstrapReloadTick, setBootstrapReloadTick] = useState(0);
  const [isHidden, setIsHidden] = useState(() => (typeof document === 'undefined' ? false : document.hidden));
  const [sessionInactive, setSessionInactive] = useState(false);
  const [workspaceData, setWorkspaceData] = useState<UiWorkspaceResponse | null>(null);
  const [workspaceError, setWorkspaceError] = useState('');
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [workspaceReloadTick, setWorkspaceReloadTick] = useState(0);
  const workspaceRequestRef = useRef(0);
  const loadedWorkspaceKeyRef = useRef('');
  const workspaceCacheRef = useRef<Map<string, UiWorkspaceResponse>>(new Map());
  const prefetchedWorkspacesRef = useRef<Set<string>>(new Set());
  const controlPlaneRef = useRef<UiWorkspaceResponse['controlPlane'] | null>(null);
  const controlPlaneFetchedAtRef = useRef(0);
  const controlPlaneInFlightRef = useRef<Promise<UiWorkspaceResponse['controlPlane']> | null>(null);
  const workspaceFetchInFlightRef = useRef<Map<string, Promise<UiWorkspaceResponse>>>(new Map());
  const prefetchQueueRef = useRef<string[]>([]);
  const prefetchInFlightCountRef = useRef(0);

  const mergeControlPlane = useCallback(
    (workspace: UiWorkspaceResponse, controlPlane: UiWorkspaceResponse['controlPlane'] | null): UiWorkspaceResponse => ({
      ...workspace,
      controlPlane: controlPlane || undefined,
    }),
    []
  );

  const applyInitialPayload = useCallback(
    (requestedWorkspace: WorkspaceKey, payload: NormalizedUiInitial) => {
      if (!payload.bootstrap && payload.workspace) {
        setBootstrap(null);
        setBootstrapError(
          payload.sections.bootstrap.error?.message || 'Unable to load workspace bootstrap'
        );
        setWorkspaceData(null);
        setWorkspaceError('');
        setIsWorkspaceStale(false);
        setLoadingWorkspace(false);
        return;
      }

      if (payload.bootstrap) {
        setBootstrap(payload.bootstrap);
        setBootstrapError('');
        setSessionInactive(false);
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const mappedWorkspace = resolveWorkspaceFromQuery(params, payload.bootstrap.legacyTabMap);
          setActiveWorkspaceState(mappedWorkspace);
        }
      }

      if (payload.workspace) {
        const resolvedWorkspace = String(payload.workspace.workspaceKey || requestedWorkspace) as WorkspaceKey;
        const mergedWorkspace = mergeControlPlane(payload.workspace, controlPlaneRef.current);
        workspaceCacheRef.current.set(resolvedWorkspace, mergedWorkspace);
        loadedWorkspaceKeyRef.current = resolvedWorkspace;
        setWorkspaceData(mergedWorkspace);
        setDisplayedWorkspace(resolvedWorkspace);
        setWorkspaceError('');
        setIsWorkspaceStale(false);
      } else if (payload.bootstrap) {
        setWorkspaceError(
          payload.sections.workspace.error?.message || `Unable to load ${requestedWorkspace} workspace`
        );
        setIsWorkspaceStale(Boolean(loadedWorkspaceKeyRef.current));
      }

      setLoadingWorkspace(false);
    },
    [mergeControlPlane]
  );

  const requestWorkspacePayload = useCallback((workspace: WorkspaceKey): Promise<UiWorkspaceResponse> => {
    const key = String(workspace);
    const existing = workspaceFetchInFlightRef.current.get(key);
    if (existing) {
      return existing;
    }
    const request = fetchWorkspacePayload(workspace)
      .finally(() => {
        const current = workspaceFetchInFlightRef.current.get(key);
        if (current === request) {
          workspaceFetchInFlightRef.current.delete(key);
        }
      });
    workspaceFetchInFlightRef.current.set(key, request);
    return request;
  }, []);

  const flushPrefetchQueue = useCallback((maxConcurrent = 2) => {
    while (prefetchInFlightCountRef.current < maxConcurrent && prefetchQueueRef.current.length > 0) {
      const normalized = String(prefetchQueueRef.current.shift() || '').trim();
      if (!normalized || workspaceCacheRef.current.has(normalized) || prefetchedWorkspacesRef.current.has(normalized)) {
        continue;
      }
      prefetchedWorkspacesRef.current.add(normalized);
      prefetchInFlightCountRef.current += 1;
      void requestWorkspacePayload(normalized as WorkspaceKey)
        .then((payload) => {
          const resolvedKey = String(payload.workspaceKey || normalized);
          const mergedPayload = mergeControlPlane(payload, controlPlaneRef.current);
          workspaceCacheRef.current.set(resolvedKey, mergedPayload);
        })
        .catch(() => {
          prefetchedWorkspacesRef.current.delete(normalized);
        })
        .finally(() => {
          prefetchInFlightCountRef.current = Math.max(0, prefetchInFlightCountRef.current - 1);
          flushPrefetchQueue(maxConcurrent);
        });
    }
  }, [mergeControlPlane, requestWorkspacePayload]);

  const queueWorkspacePrefetch = useCallback((workspace: WorkspaceKey, { prioritize = false } = {}) => {
    const normalized = String(workspace || '').trim();
    if (!normalized || workspaceCacheRef.current.has(normalized) || prefetchedWorkspacesRef.current.has(normalized)) {
      return;
    }
    if (prefetchQueueRef.current.includes(normalized)) {
      if (prioritize) {
        prefetchQueueRef.current = [normalized, ...prefetchQueueRef.current.filter((entry) => entry !== normalized)];
      }
      return;
    }
    if (prioritize) {
      prefetchQueueRef.current.unshift(normalized);
    } else {
      prefetchQueueRef.current.push(normalized);
    }
  }, []);

  const prefetchWorkspaces = useCallback((workspaceKeys: WorkspaceKey[]) => {
    if (!workspaceKeys.length) {
      return;
    }
    const priorityOrder = ['overview', 'media', 'files', 'transfers'];
    const secondaryOrder = ['ai', 'terminal'];
    for (const key of priorityOrder) {
      if (workspaceKeys.includes(key as WorkspaceKey)) {
        queueWorkspacePrefetch(key as WorkspaceKey);
      }
    }
    for (const key of secondaryOrder) {
      if (workspaceKeys.includes(key as WorkspaceKey)) {
        queueWorkspacePrefetch(key as WorkspaceKey);
      }
    }
    flushPrefetchQueue(2);
  }, [flushPrefetchQueue, queueWorkspacePrefetch]);

  const prefetchWorkspaceIntent = useCallback((workspace: WorkspaceKey) => {
    queueWorkspacePrefetch(workspace, { prioritize: true });
    flushPrefetchQueue(2);
  }, [flushPrefetchQueue, queueWorkspacePrefetch]);

  const setActiveWorkspace = useCallback((workspace: WorkspaceKey) => {
    setActiveWorkspaceState(workspace);
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('workspace', workspace);
    url.searchParams.delete('tab');
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

  const loadControlPlaneSnapshot = useCallback(async (force = false) => {
    const now = Date.now();
    if (
      !force
      && controlPlaneRef.current
      && controlPlaneFetchedAtRef.current > 0
      && now - controlPlaneFetchedAtRef.current < CONTROL_PLANE_CACHE_TTL_MS
    ) {
      return controlPlaneRef.current;
    }

    if (controlPlaneInFlightRef.current) {
      return controlPlaneInFlightRef.current;
    }

    const request = fetchControlPlaneSnapshot().then((snapshot) => {
      const controlPlane = {
        catalog: snapshot.catalog,
        clusters: snapshot.clusters,
        errors: snapshot.errors,
        health: snapshot.health || null,
        metrics: snapshot.metrics || null,
        serviceState: snapshot.serviceState || null,
        state: snapshot.state || null,
        workflowEvents: snapshot.workflowEvents,
        workflowRuns: snapshot.workflowRuns,
        workflows: snapshot.workflows,
      };
      controlPlaneRef.current = controlPlane;
      controlPlaneFetchedAtRef.current = Date.now();
      return controlPlane;
    }).finally(() => {
      if (controlPlaneInFlightRef.current === request) {
        controlPlaneInFlightRef.current = null;
      }
    });

    controlPlaneInFlightRef.current = request;
    return request;
  }, []);

  const markLoggedOut = useCallback(() => {
    setSessionInactive(true);
    loadedWorkspaceKeyRef.current = '';
    workspaceCacheRef.current.clear();
    prefetchedWorkspacesRef.current.clear();
    prefetchQueueRef.current = [];
    prefetchInFlightCountRef.current = 0;
    controlPlaneRef.current = null;
    controlPlaneFetchedAtRef.current = 0;
    controlPlaneInFlightRef.current = null;
    workspaceFetchInFlightRef.current.clear();
    setBootstrap(null);
    setBootstrapError('Login required');
    setDisplayedWorkspace(DEFAULT_WORKSPACE);
    setIsWorkspaceStale(false);
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
    if (typeof document === 'undefined') {
      return;
    }
    const handleVisibilityChange = () => {
      const hidden = document.hidden;
      setIsHidden(hidden);
      if (!hidden) {
        setBootstrapReloadTick((current) => current + 1);
        setWorkspaceReloadTick((current) => current + 1);
      }
    };
    setIsHidden(document.hidden);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
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
        applyInitialPayload(requestedWorkspace, payload);
        const navWorkspaces = Array.isArray(payload.bootstrap?.nav)
          ? payload.bootstrap.nav
            .map((entry) => String(entry?.key || '').trim())
            .filter(Boolean) as WorkspaceKey[]
          : [];
        prefetchWorkspaces(navWorkspaces);
        void loadControlPlaneSnapshot().then((controlPlane) => {
          if (cancelled || !controlPlane) {
            return;
          }
          setWorkspaceData((current) => (current ? mergeControlPlane(current, controlPlane) : current));
        }).catch(() => null);
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
    }, isHidden ? 60000 : 30000);

    return () => {
      cancelled = true;
      window.clearInterval(bootstrapTimer);
    };
  }, [applyInitialPayload, bootstrapReloadTick, isHidden, loadControlPlaneSnapshot, mergeControlPlane, prefetchWorkspaces, sessionInactive]);

  useEffect(() => {
    if (sessionInactive) {
      setLoadingWorkspace(false);
      setIsWorkspaceStale(false);
      return;
    }
    let cancelled = false;

    const cachedWorkspace = workspaceCacheRef.current.get(activeWorkspace);
    if (cachedWorkspace) {
      setWorkspaceData(cachedWorkspace);
      setDisplayedWorkspace(String(cachedWorkspace.workspaceKey || activeWorkspace) as WorkspaceKey);
      setWorkspaceError('');
      setIsWorkspaceStale(false);
      setLoadingWorkspace(false);
    }

    const loadWorkspace = async () => {
      const requestId = workspaceRequestRef.current + 1;
      workspaceRequestRef.current = requestId;
      const hasDisplayedWorkspace = Boolean(workspaceData || loadedWorkspaceKeyRef.current);
      setLoadingWorkspace(!hasDisplayedWorkspace);
      setIsWorkspaceStale(hasDisplayedWorkspace && !cachedWorkspace);
      try {
        const payload = await requestWorkspacePayload(activeWorkspace);
        if (cancelled || requestId !== workspaceRequestRef.current) {
          return;
        }
        const mergedPayload = mergeControlPlane(payload, controlPlaneRef.current);
        workspaceCacheRef.current.set(String(payload.workspaceKey || activeWorkspace), mergedPayload);
        setWorkspaceData(mergedPayload);
        loadedWorkspaceKeyRef.current = String(payload.workspaceKey || activeWorkspace);
        setDisplayedWorkspace(String(payload.workspaceKey || activeWorkspace) as WorkspaceKey);
        setWorkspaceError('');
        setIsWorkspaceStale(false);
        void loadControlPlaneSnapshot(activeWorkspace === 'admin').then((controlPlane) => {
          if (cancelled || requestId !== workspaceRequestRef.current || !controlPlane) {
            return;
          }
          setWorkspaceData((current) => {
            if (!current) {
              return current;
            }
            if (String(current.workspaceKey || '') !== String(payload.workspaceKey || activeWorkspace)) {
              return current;
            }
            return mergeControlPlane(current, controlPlane);
          });
        }).catch(() => null);
      } catch (error) {
        if (cancelled || requestId !== workspaceRequestRef.current) {
          return;
        }
        setWorkspaceError(String(error instanceof Error ? error.message : error || `Unable to load ${activeWorkspace} workspace`));
        setIsWorkspaceStale(Boolean(loadedWorkspaceKeyRef.current));
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
    }, isHidden ? 60000 : activeWorkspace === 'overview' ? 5000 : 9000);

    return () => {
      cancelled = true;
      window.clearInterval(workspaceTimer);
    };
  }, [activeWorkspace, isHidden, loadControlPlaneSnapshot, mergeControlPlane, requestWorkspacePayload, sessionInactive, workspaceReloadTick, workspaceData]);

  const transitionLabel = useMemo(() => {
    if (!isWorkspaceStale || displayedWorkspace === activeWorkspace) {
      return '';
    }
    return `Loading ${activeWorkspace}, showing ${displayedWorkspace} snapshot`;
  }, [activeWorkspace, displayedWorkspace, isWorkspaceStale]);

  return useMemo(
    () => ({
      activeWorkspace,
      displayedWorkspace,
      bootstrap,
      bootstrapError,
      isWorkspaceStale,
      loadingBootstrap,
      markLoggedOut,
      reloadBootstrap,
      setActiveWorkspace,
      transitionLabel,
      reloadWorkspace,
      prefetchWorkspaceIntent,
      workspaceData,
      workspaceError,
      loadingWorkspace,
    }),
    [
      activeWorkspace,
      displayedWorkspace,
      bootstrap,
      bootstrapError,
      isWorkspaceStale,
      loadingBootstrap,
      markLoggedOut,
      reloadBootstrap,
      loadingWorkspace,
      reloadWorkspace,
      prefetchWorkspaceIntent,
      setActiveWorkspace,
      transitionLabel,
      workspaceData,
      workspaceError,
    ]
  );
}
