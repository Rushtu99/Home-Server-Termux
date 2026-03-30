'use client';

import type { CSSProperties, FormEvent, InputHTMLAttributes, ReactNode } from 'react';
import { startTransition, useEffect, useRef, useState } from 'react';
import { useGatewayBase } from './useGatewayBase';

const API = process.env.NEXT_PUBLIC_API || '/api';

const THEME = {
  accent: '#7d936b',
  accentFill: 'rgba(125, 147, 107, 0.12)',
  brightYellow: '#b88b45',
  crimsonRed: '#c45b5b',
  darkPurple: '#2b2f36',
  bg: '#111315',
  panel: '#171a1e',
  panelRaised: '#1d2126',
  text: '#eceee7',
  muted: '#9ca39b',
  ok: '#6f9f70',
  border: '#2d333a',
};

type TabKey = 'home' | 'terminal' | 'filesystem' | 'ftp' | 'settings';
type Services = Record<string, boolean>;

type Monitor = {
  cpuCores: number;
  cpuLoad: number;
  eventLoopLagMs: number;
  eventLoopP95Ms: number;
  freeMem: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  network: {
    rxBytes: number;
    txBytes: number;
    rxRate: number;
    txRate: number;
  };
  processExternal: number;
  processHeapTotal: number;
  processHeapUsed: number;
  processRss: number;
  totalMem: number;
  usedMem: number;
  uptime: number;
};

type ConnectedUser = {
  username: string;
  ip: string;
  port: string;
  protocol: string;
  status: string;
  lastSeen: string;
};

type StorageMount = {
  filesystem: string;
  fsType?: string;
  size: number;
  used: number;
  available: number;
  usePercent: number;
  mount: string;
  category?: string;
};

type DebugLog = {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | string;
  message: string;
  meta?: unknown;
};

type DriveEntry = {
  device: string;
  dirName: string;
  error: string;
  filesystem: string;
  letter: string;
  mountPoint: string;
  name: string;
  state: string;
  uuid: string;
};

type DriveEvent = {
  timestamp: string;
  level: string;
  event: string;
  error?: string;
  letter?: string;
  mountPoint?: string;
  name?: string;
  filesystem?: string;
};

type DrivePayload = {
  agentInstalled: boolean;
  checkedAt: string | null;
  events: DriveEvent[];
  manifest: {
    generatedAt: string | null;
    intervalMs: number;
    drives: DriveEntry[];
  };
  refreshIntervalMs: number;
};

type FtpEntry = {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt?: string;
  rawModifiedAt?: string;
  permissions?: string;
};

type FtpMountState = {
  error?: string;
  mounted: boolean;
  mountName: string;
  mountPoint: string;
  pid?: number | null;
  remoteName: string;
  running: boolean;
  state: 'mounted' | 'starting' | 'error' | 'unmounted' | string;
};

type FtpFavourite = {
  id: number;
  name: string;
  protocol: string;
  host: string;
  port: number;
  username: string;
  secure: boolean;
  remotePath: string;
  mountName: string;
  createdAt: string;
  updatedAt: string;
  mount: FtpMountState;
};

type FtpFavouriteDraft = {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  secure: boolean;
  remotePath: string;
  mountName: string;
};

type FtpDefaults = {
  defaultName: string;
  host: string;
  password: string;
  port: number;
  user: string;
  secure: boolean;
  downloadRoot: string;
};

type DashboardPayload = {
  generatedAt: string;
  services: Services;
  monitor: Monitor;
  connections: {
    users: ConnectedUser[];
  };
  storage: {
    mounts: StorageMount[];
  };
  logs: {
    logs: DebugLog[];
    markdown: string;
    verboseLoggingEnabled: boolean;
  };
};

type SessionUser = {
  role: 'admin' | 'user' | string;
  username: string;
};

type ManagedUser = {
  createdAt: string;
  id: number;
  isDisabled: boolean;
  role: 'admin' | 'user' | string;
  updatedAt: string;
  username: string;
};

type UserDraft = {
  password: string;
  role: 'admin' | 'user';
  username: string;
};

type ControlTarget = {
  service: string;
  action: string;
} | null;

type LayoutMode = 'desktop' | 'tablet' | 'mobile';

const EMPTY_DRIVE_PAYLOAD: DrivePayload = {
  agentInstalled: false,
  checkedAt: null,
  events: [],
  manifest: {
    generatedAt: null,
    intervalMs: 60000,
    drives: [],
  },
  refreshIntervalMs: 60000,
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'home', label: 'Dashboard' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'filesystem', label: 'Filesystem' },
  { key: 'ftp', label: 'FTP' },
  { key: 'settings', label: 'Settings' },
];

const TAB_KEYS = new Set<TabKey>(TABS.map(({ key }) => key));

const fmtBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx < 2 ? 0 : 1)} ${units[idx]}`;
};

const fmtRate = (value: number) => `${fmtBytes(value)}/s`;

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '--';
  }

  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const fmtDateTime = (iso?: string | null) => {
  if (!iso) {
    return '--';
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '--';
  }

  return d.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
};

const normalizeDrivePayload = (payload: Partial<DrivePayload> | null | undefined): DrivePayload => ({
  agentInstalled: Boolean(payload?.agentInstalled),
  checkedAt: typeof payload?.checkedAt === 'string' ? payload.checkedAt : null,
  events: Array.isArray(payload?.events) ? payload.events : [],
  manifest: {
    generatedAt: typeof payload?.manifest?.generatedAt === 'string' ? payload.manifest.generatedAt : null,
    intervalMs: Math.max(60000, Number(payload?.manifest?.intervalMs || payload?.refreshIntervalMs || 60000) || 60000),
    drives: Array.isArray(payload?.manifest?.drives) ? payload.manifest.drives : [],
  },
  refreshIntervalMs: Math.max(60000, Number(payload?.refreshIntervalMs || payload?.manifest?.intervalMs || 60000) || 60000),
});

const joinRemotePath = (basePath: string, child: string) => {
  const parts = `${basePath === '/' ? '' : basePath}/${child}`
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');

  return `/${parts.join('/')}`;
};

const parentRemotePath = (targetPath: string) => {
  const parts = String(targetPath)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');

  parts.pop();
  return `/${parts.join('/')}` || '/';
};

const createFtpFavouriteDraft = (defaults: Partial<FtpFavouriteDraft> = {}): FtpFavouriteDraft => ({
  name: defaults.name || '',
  host: defaults.host || '',
  port: defaults.port || '2121',
  username: defaults.username || 'anonymous',
  password: defaults.password || '',
  secure: defaults.secure === true,
  remotePath: defaults.remotePath || '/',
  mountName: defaults.mountName || '',
});

const createUserDraft = (): UserDraft => ({
  password: '',
  role: 'user',
  username: '',
});

const createFtpFavouriteDraftFromFavourite = (favourite: FtpFavourite): FtpFavouriteDraft =>
  createFtpFavouriteDraft({
    name: favourite.name,
    host: favourite.host,
    port: String(favourite.port || 21),
    username: favourite.username || 'anonymous',
    password: '',
    secure: favourite.secure,
    remotePath: favourite.remotePath || '/',
    mountName: favourite.mountName || favourite.name,
  });

const describeFtpMount = (mount?: FtpMountState | null) => {
  if (!mount) {
    return 'unmounted';
  }

  if (mount.mounted) {
    return `mounted at ${mount.mountPoint}`;
  }

  if (mount.state === 'starting' || mount.running) {
    return 'mount starting';
  }

  if (mount.error) {
    return mount.error;
  }

  return 'unmounted';
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('desktop');
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [services, setServices] = useState<Services>({});
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [connections, setConnections] = useState<ConnectedUser[]>([]);
  const [storage, setStorage] = useState<StorageMount[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const [controlStatus, setControlStatus] = useState('');
  const [controlBusy, setControlBusy] = useState<Record<string, boolean>>({});
  const [verboseLogging, setVerboseLogging] = useState(false);
  const [logsMarkdown, setLogsMarkdown] = useState('');
  const [controlTarget, setControlTarget] = useState<ControlTarget>(null);
  const [controlPassword, setControlPassword] = useState('');
  const [ftpDefaults, setFtpDefaults] = useState<FtpDefaults | null>(null);
  const [ftpHost, setFtpHost] = useState('');
  const [ftpPort, setFtpPort] = useState('2121');
  const [ftpUser, setFtpUser] = useState('anonymous');
  const [ftpPassword, setFtpPassword] = useState('anonymous@');
  const [ftpSecure, setFtpSecure] = useState(false);
  const [ftpPath, setFtpPath] = useState('/');
  const [ftpEntries, setFtpEntries] = useState<FtpEntry[]>([]);
  const [ftpBusy, setFtpBusy] = useState(false);
  const [ftpStatus, setFtpStatus] = useState('');
  const [ftpDownloadRoot, setFtpDownloadRoot] = useState('');
  const [ftpUploadLocalPath, setFtpUploadLocalPath] = useState('');
  const [ftpUploadRemotePath, setFtpUploadRemotePath] = useState('');
  const [ftpFolderName, setFtpFolderName] = useState('');
  const [ftpFavourites, setFtpFavourites] = useState<FtpFavourite[]>([]);
  const [ftpFavouritesBusy, setFtpFavouritesBusy] = useState(false);
  const [ftpFavouriteDraft, setFtpFavouriteDraft] = useState<FtpFavouriteDraft>(() => createFtpFavouriteDraft());
  const [ftpEditingFavouriteId, setFtpEditingFavouriteId] = useState<number | null>(null);
  const [ftpActiveFavouriteId, setFtpActiveFavouriteId] = useState<number | null>(null);
  const [ftpEntryMenuState, setFtpEntryMenuState] = useState<{ key: string; upward: boolean } | null>(null);
  const [ftpSearch, setFtpSearch] = useState('');
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [userStatus, setUserStatus] = useState('');
  const [userDraft, setUserDraft] = useState<UserDraft>(() => createUserDraft());
  const [driveState, setDriveState] = useState<DrivePayload>(EMPTY_DRIVE_PAYLOAD);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [showDriveLog, setShowDriveLog] = useState(false);
  const [dashboardShares, setDashboardShares] = useState<Array<{ id: number; name: string; pathKey: string; sourceType: string }>>([]);

  const cpuCanvas = useRef<HTMLCanvasElement>(null);
  const ramCanvas = useRef<HTMLCanvasElement>(null);
  const ftpMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const fetchInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const tabSyncReadyRef = useRef(false);
  const gatewayBase = useGatewayBase();
  const isCompact = layoutMode !== 'desktop';
  const isPhone = layoutMode === 'mobile';
  const isTablet = layoutMode === 'tablet';

  const clearSession = (message = '') => {
    if (typeof window !== 'undefined') {
      void fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }

    if (!mountedRef.current) {
      return;
    }

    setIsAuthed(false);
    setAuthBusy(false);
    setSessionUser(null);
    setPassword('');
    setServices({});
    setMonitor(null);
    setConnections([]);
    setStorage([]);
    setDebugLogs([]);
    setCpuHistory([]);
    setRamHistory([]);
    setLastUpdated('');
    setControlStatus('');
    setControlBusy({});
    setLogsMarkdown('');
    setFtpDefaults(null);
    setFtpFavourites([]);
    setFtpFavouriteDraft(createFtpFavouriteDraft());
    setFtpEditingFavouriteId(null);
    setFtpActiveFavouriteId(null);
    setFtpEntries([]);
    setFtpEntryMenuState(null);
    setFtpSearch('');
    setFtpPath('/');
    setFtpStatus('');
    setFtpHost('');
    setFtpPort('2121');
    setFtpUser('anonymous');
    setFtpPassword('anonymous@');
    setFtpSecure(false);
    setFtpDownloadRoot('');
    setFtpUploadLocalPath('');
    setFtpUploadRemotePath('');
    setFtpFolderName('');
    setManagedUsers([]);
    setUserStatus('');
    setUserDraft(createUserDraft());
    setDriveState(EMPTY_DRIVE_PAYLOAD);
    setDriveBusy(false);
    setDriveError('');
    setShowDriveLog(false);
    setDashboardShares([]);
    setAuthError(message);
  };

  const authFetch = (path: string, init: RequestInit = {}) =>
    fetch(path, { ...init, credentials: init.credentials || 'include' });

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const res = await fetch(`${API}/auth/me`, { credentials: 'include' });

        if (!mountedRef.current) {
          return;
        }

        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          setIsAuthed(true);
          if (payload?.user?.username) {
            setSessionUser({
              role: String(payload.user.role || 'user'),
              username: String(payload.user.username || ''),
            });
          }
          setAuthError('');
        }
      } catch {
        if (!mountedRef.current) {
          return;
        }
      } finally {
        if (mountedRef.current) {
          setAuthChecked(true);
        }
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    if (requestedTab && TAB_KEYS.has(requestedTab as TabKey)) {
      setActiveTab(requestedTab as TabKey);
    }
    tabSyncReadyRef.current = true;
  }, []);

  useEffect(() => {
    const updateLayout = () => {
      const width = window.innerWidth;
      setLayoutMode(width < 760 ? 'mobile' : width < 1200 ? 'tablet' : 'desktop');
    };
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isAuthed || sessionUser?.role !== 'admin') {
      return;
    }

    const refreshTelemetry = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void fetchAll();
    };

    refreshTelemetry();

    const interval = window.setInterval(refreshTelemetry, activeTab === 'home' ? 2000 : 5000);
    document.addEventListener('visibilitychange', refreshTelemetry);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshTelemetry);
    };
  }, [activeTab, isAuthed, sessionUser?.role]);

  useEffect(() => {
    if (!tabSyncReadyRef.current) {
      return;
    }

    const url = new URL(window.location.href);
    if (activeTab === 'home') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', activeTab);
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [activeTab]);

  useEffect(() => {
    if (!isAuthed || sessionUser?.role !== 'admin') {
      return;
    }

    const bootstrapFtp = async () => {
      try {
        if (!mountedRef.current) {
          return;
        }

        const [defaultsRes, favouritesRes] = await Promise.all([
          authFetch(`${API}/ftp/defaults`),
          authFetch(`${API}/ftp/favourites`),
        ]);

        const [defaultsPayload, favouritesPayload] = await Promise.all([
          defaultsRes.ok ? defaultsRes.json().catch(() => null) : Promise.resolve(null),
          favouritesRes.ok ? favouritesRes.json().catch(() => null) : Promise.resolve(null),
        ]);

        if (!mountedRef.current) {
          return;
        }

        if (defaultsPayload) {
          const nextDefaults = defaultsPayload as FtpDefaults;
          setFtpDefaults(nextDefaults);
          setFtpHost(nextDefaults.host || '');
          setFtpPort(String(nextDefaults.port || 2121));
          setFtpUser(nextDefaults.user || 'anonymous');
          setFtpPassword(nextDefaults.password || 'anonymous@');
          setFtpSecure(Boolean(nextDefaults.secure));
          setFtpDownloadRoot(nextDefaults.downloadRoot || '');
          setFtpFavouriteDraft(createFtpFavouriteDraft({
            name: nextDefaults.defaultName || 'PS4',
            host: nextDefaults.host || '',
            port: String(nextDefaults.port || 2121),
            username: nextDefaults.user || 'anonymous',
            password: nextDefaults.password || 'anonymous@',
            secure: Boolean(nextDefaults.secure),
            remotePath: '/',
            mountName: nextDefaults.defaultName || 'PS4',
          }));
        }

        if (favouritesPayload) {
          setFtpFavourites(Array.isArray(favouritesPayload.favourites) ? favouritesPayload.favourites : []);
        }
      } catch {
        // Ignore FTP defaults bootstrap failures.
      }
    };

    void bootstrapFtp();
  }, [isAuthed, sessionUser?.role]);

  const loadManagedUsers = async () => {
    if (sessionUser?.role !== 'admin') {
      setManagedUsers([]);
      return;
    }

    setUsersBusy(true);
    try {
      const res = await authFetch(`${API}/users`);
      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setUserStatus('Unable to load users');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      setManagedUsers(Array.isArray(payload?.users) ? payload.users : []);
    } catch {
      setUserStatus('Unable to load users');
    } finally {
      if (mountedRef.current) {
        setUsersBusy(false);
      }
    }
  };

  const loadDriveConsole = async () => {
    if (!isAuthed) {
      return;
    }

    setDriveBusy(true);
    try {
      const [driveRes, shareRes] = await Promise.all([
        authFetch(`${API}/drives`),
        authFetch(`${API}/shares`),
      ]);

      if (driveRes.status === 401 || shareRes.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!driveRes.ok) {
        const payload = await driveRes.json().catch(() => ({}));
        setDriveError(String(payload?.error || 'Unable to load drive state'));
      } else {
        const payload = await driveRes.json().catch(() => ({}));
        setDriveState(normalizeDrivePayload(payload));
        setDriveError('');
      }

      if (shareRes.ok) {
        const sharePayload = await shareRes.json().catch(() => ({}));
        setDashboardShares(Array.isArray(sharePayload?.shares)
          ? sharePayload.shares.map((entry: { id?: number; name?: string; pathKey?: string; sourceType?: string }) => ({
              id: Number(entry?.id || 0),
              name: String(entry?.name || ''),
              pathKey: String(entry?.pathKey || ''),
              sourceType: String(entry?.sourceType || 'folder'),
            }))
          : []);
      } else {
        setDashboardShares([]);
      }
    } catch {
      setDriveError('Unable to load drive state');
    } finally {
      if (mountedRef.current) {
        setDriveBusy(false);
      }
    }
  };

  const runDriveCheck = async () => {
    setDriveBusy(true);
    setDriveError('');
    try {
      const res = await authFetch(`${API}/drives/check`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setDriveError(String(payload?.error || 'Drive check failed'));
        return;
      }

      setDriveState(normalizeDrivePayload(payload));
      await loadDriveConsole();
    } catch {
      setDriveError('Drive check failed');
    } finally {
      if (mountedRef.current) {
        setDriveBusy(false);
      }
    }
  };

  useEffect(() => {
    if (!isAuthed || activeTab !== 'settings' || sessionUser?.role !== 'admin') {
      return;
    }

    void loadManagedUsers();
  }, [activeTab, isAuthed, sessionUser?.role]);

  useEffect(() => {
    setFtpEntryMenuState(null);
  }, [ftpPath]);

  useEffect(() => {
    if (!controlTarget) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setControlTarget(null);
        setControlPassword('');
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [controlTarget]);

  useEffect(() => {
    drawTrend(cpuCanvas.current, cpuHistory, THEME.accent, THEME.accentFill);
  }, [cpuHistory]);

  useEffect(() => {
    drawTrend(ramCanvas.current, ramHistory, THEME.brightYellow, 'rgba(255,228,77,0.14)');
  }, [ramHistory]);

  useEffect(() => {
    if (!isAuthed || activeTab !== 'filesystem') {
      return;
    }

    void loadDriveConsole();
  }, [activeTab, isAuthed, sessionUser?.role]);

  const applyDashboardPayload = (payload: DashboardPayload) => {
    setServices(payload.services || {});
    setMonitor(payload.monitor || null);
    setConnections(Array.isArray(payload.connections?.users) ? payload.connections.users : []);
    setStorage(Array.isArray(payload.storage?.mounts) ? payload.storage.mounts : []);
    setDebugLogs(Array.isArray(payload.logs?.logs) ? payload.logs.logs : []);
    setLogsMarkdown(typeof payload.logs?.markdown === 'string' ? payload.logs.markdown : '');
    setVerboseLogging(Boolean(payload.logs?.verboseLoggingEnabled));

    if (payload.monitor) {
      const ramPercent = payload.monitor.totalMem > 0 ? (payload.monitor.usedMem / payload.monitor.totalMem) * 100 : 0;
      setCpuHistory((prev) => [...prev.slice(-39), payload.monitor.cpuLoad]);
      setRamHistory((prev) => [...prev.slice(-39), ramPercent]);
    }

    if (payload.generatedAt) {
      setLastUpdated(new Date(payload.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  };

  const fetchAll = async () => {
    if (sessionUser?.role !== 'admin') {
      return;
    }
    if (fetchInFlightRef.current) {
      return;
    }
    fetchInFlightRef.current = true;

    try {
      const res = await authFetch(`${API}/dashboard`);

      if (!mountedRef.current) {
        return;
      }

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setControlStatus('Unable to refresh dashboard telemetry');
        return;
      }

      const payload = await res.json().catch(() => null);
      if (payload) {
        startTransition(() => {
          applyDashboardPayload(payload as DashboardPayload);
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setControlStatus(`Telemetry fetch error: ${String(err)}`);
      }
    } finally {
      fetchInFlightRef.current = false;
    }
  };

  const openControlPopup = (service: string, action: string) => {
    setControlTarget({ service, action });
    setControlPassword('');
    setControlStatus('');
  };

  const closeControlPopup = () => {
    setControlTarget(null);
    setControlPassword('');
  };

  const executeControl = async () => {
    if (!controlTarget) {
      return;
    }

    const { service, action } = controlTarget;
    const key = `${service}:${action}`;
    setControlStatus('');
    setControlBusy((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await authFetch(`${API}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service,
          action,
          ...(controlPassword.trim() ? { adminPassword: controlPassword } : {}),
        }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        const message = payload?.error || `Failed to ${action} ${service}`;
        setControlStatus(message);
      } else {
        setControlStatus(`${service} ${action} succeeded`);
        closeControlPopup();
      }
    } catch {
      setControlStatus(`Unable to ${action} ${service}`);
    } finally {
      setControlBusy((prev) => ({ ...prev, [key]: false }));
      void fetchAll();
    }
  };

  const usedMemPct = monitor ? Math.min((monitor.totalMem > 0 ? (monitor.usedMem / monitor.totalMem) * 100 : 0), 100) : 0;
  const runningServices = Object.values(services).filter(Boolean).length;
  const totalServices = Object.keys(services).length || 4;
  const totalStorage = storage.reduce((sum, mount) => sum + mount.size, 0);
  const usedStorage = storage.reduce((sum, mount) => sum + mount.used, 0);
  const usedStoragePct = totalStorage > 0 ? Math.min((usedStorage / totalStorage) * 100, 100) : 0;
  const driveCount = driveState.manifest.drives.length;
  const filesystemStatus = !driveState.agentInstalled
    ? 'Drive agent missing'
    : driveCount > 0
      ? `${driveCount} removable drives mounted`
      : 'Only C is present';
  const latestDriveEvent = driveState.events[0] || null;
  const ftpBreadcrumbs = ftpPath.split('/').filter(Boolean);
  const filteredFtpEntries = ftpSearch.trim()
    ? ftpEntries.filter((entry) => entry.name.toLowerCase().includes(ftpSearch.trim().toLowerCase()))
    : ftpEntries;
  const controlStatusColor = !controlStatus
    ? THEME.muted
    : controlStatus.includes('succeeded')
      ? THEME.ok
      : THEME.crimsonRed;
  const ftpStatusColor = !ftpStatus
    ? THEME.muted
    : ftpStatus.toLowerCase().includes('failed') || ftpStatus.toLowerCase().includes('unable') || ftpStatus.toLowerCase().includes('error')
      ? THEME.crimsonRed
      : THEME.ok;
  const activeFtpFavourite = ftpFavourites.find((favourite) => favourite.id === ftpActiveFavouriteId) || null;
  const navButtonLabel = (tab: TabKey) => {
    if (!isTablet) {
      return TABS.find((entry) => entry.key === tab)?.label || tab;
    }

    switch (tab) {
      case 'home':
        return 'Home';
      case 'terminal':
        return 'Term';
      case 'filesystem':
        return 'Files';
      case 'ftp':
        return 'FTP';
      case 'settings':
        return 'Prefs';
      default:
        return tab;
    }
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setAuthError(payload?.error || 'Login failed');
        return;
      }

      setIsAuthed(true);
      if (payload?.user?.username) {
        setSessionUser({
          role: String(payload.user.role || 'user'),
          username: String(payload.user.username || ''),
        });
      }
      setUsername('');
      setPassword('');
      setControlStatus('');
      void fetchAll();
    } catch {
      setAuthError('Unable to reach auth service');
    } finally {
      if (mountedRef.current) {
        setAuthBusy(false);
      }
    }
  };

  const toggleVerboseLogging = async (enabled: boolean) => {
    try {
      const res = await authFetch(`${API}/logging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setControlStatus('Failed to update logging mode');
        return;
      }

      setVerboseLogging(enabled);
      void fetchAll();
    } catch {
      setControlStatus('Unable to update logging mode');
    }
  };

  const createManagedUser = async () => {
    setUserStatus('');
    setUsersBusy(true);
    try {
      const res = await authFetch(`${API}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userDraft),
      });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setUserStatus(String(payload?.error || 'Unable to create user'));
        return;
      }

      setUserDraft(createUserDraft());
      setUserStatus(`Created user ${payload?.user?.username || userDraft.username}`);
      await loadManagedUsers();
    } catch {
      setUserStatus('Unable to create user');
    } finally {
      if (mountedRef.current) {
        setUsersBusy(false);
      }
    }
  };

  const updateManagedUser = async (user: ManagedUser, updates: { role?: string; isDisabled?: boolean; password?: string }) => {
    setUserStatus('');
    setUsersBusy(true);
    try {
      const res = await authFetch(`${API}/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setUserStatus(String(payload?.error || 'Unable to update user'));
        return;
      }

      setUserStatus(`Updated ${payload?.user?.username || user.username}`);
      await loadManagedUsers();
    } catch {
      setUserStatus('Unable to update user');
    } finally {
      if (mountedRef.current) {
        setUsersBusy(false);
      }
    }
  };

  const syncFtpConnection = (favourite: FtpFavourite | null) => {
    if (!favourite) {
      return;
    }

    setFtpHost(favourite.host || '');
    setFtpPort(String(favourite.port || 21));
    setFtpUser(favourite.username || 'anonymous');
    setFtpPassword('');
    setFtpSecure(Boolean(favourite.secure));
    setFtpPath(favourite.remotePath || '/');
    setFtpActiveFavouriteId(favourite.id);
  };

  const resetFtpFavouriteEditor = () => {
    setFtpEditingFavouriteId(null);
    setFtpFavouriteDraft(createFtpFavouriteDraft({
      name: ftpDefaults?.defaultName || ftpHost.trim() || 'PS4',
      host: ftpHost.trim() || ftpDefaults?.host || '',
      port: ftpPort || String(ftpDefaults?.port || 2121),
      username: ftpUser.trim() || ftpDefaults?.user || 'anonymous',
      password: ftpDefaults?.password || ftpPassword || 'anonymous@',
      secure: ftpSecure || Boolean(ftpDefaults?.secure),
      remotePath: ftpPath || '/',
      mountName: ftpDefaults?.defaultName || ftpHost.trim() || 'PS4',
    }));
  };

  const loadFtpFavourites = async () => {
    setFtpFavouritesBusy(true);

    try {
      const res = await authFetch(`${API}/ftp/favourites`);
      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return [];
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Unable to load FTP favourites');
      }

      const nextFavourites = Array.isArray(payload.favourites) ? payload.favourites as FtpFavourite[] : [];
      setFtpFavourites(nextFavourites);

      if (ftpActiveFavouriteId !== null) {
        const active = nextFavourites.find((favourite) => favourite.id === ftpActiveFavouriteId) || null;
        if (active) {
          syncFtpConnection(active);
        } else {
          setFtpActiveFavouriteId(null);
        }
      }

      if (ftpEditingFavouriteId !== null && !nextFavourites.some((favourite) => favourite.id === ftpEditingFavouriteId)) {
        resetFtpFavouriteEditor();
      }

      return nextFavourites;
    } catch (error) {
      setFtpStatus(String(error instanceof Error ? error.message : error || 'Unable to load FTP favourites'));
      return [];
    } finally {
      setFtpFavouritesBusy(false);
    }
  };

  const ftpPayload = (pathOverride?: string, favouriteIdOverride: number | null = ftpActiveFavouriteId) => ({
    favouriteId: favouriteIdOverride ?? undefined,
    host: ftpHost.trim(),
    port: Number(ftpPort || 21),
    user: ftpUser.trim() || 'anonymous',
    password: ftpPassword,
    secure: ftpSecure,
    path: pathOverride || ftpPath,
  });

  const loadFtpDirectory = async (pathOverride?: string, favouriteIdOverride: number | null = ftpActiveFavouriteId) => {
    if (!favouriteIdOverride && !ftpHost.trim()) {
      setFtpStatus('Enter an FTP host or browse a saved favourite first.');
      return;
    }

    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ftpPayload(pathOverride, favouriteIdOverride)),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Unable to list remote directory');
        return;
      }

      const nextFavourite = favouriteIdOverride
        ? ftpFavourites.find((favourite) => favourite.id === favouriteIdOverride) || null
        : null;
      setFtpActiveFavouriteId(favouriteIdOverride ?? null);
      setFtpPath(payload.path || '/');
      setFtpEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setFtpStatus(`Connected to ${nextFavourite?.name || payload.connection?.host || ftpHost.trim()} at ${payload.path || '/'}`);
    } catch {
      setFtpStatus('Unable to reach FTP endpoint');
    } finally {
      setFtpBusy(false);
    }
  };

  const browseFtpFavourite = async (favourite: FtpFavourite) => {
    syncFtpConnection(favourite);
    await loadFtpDirectory(favourite.remotePath || '/', favourite.id);
  };

  const editFtpFavourite = (favourite: FtpFavourite) => {
    setFtpEditingFavouriteId(favourite.id);
    setFtpFavouriteDraft(createFtpFavouriteDraftFromFavourite(favourite));
    setFtpStatus(`Editing saved favourite ${favourite.name}`);
  };

  const saveFtpFavourite = async () => {
    if (!ftpFavouriteDraft.name.trim() || !ftpFavouriteDraft.host.trim()) {
      setFtpStatus('Favourite name and FTP host are required.');
      return;
    }

    setFtpFavouritesBusy(true);
    setFtpStatus('');

    try {
      const body: Record<string, unknown> = {
        name: ftpFavouriteDraft.name.trim(),
        host: ftpFavouriteDraft.host.trim(),
        port: Number(ftpFavouriteDraft.port || 21),
        username: ftpFavouriteDraft.username.trim() || 'anonymous',
        secure: ftpFavouriteDraft.secure,
        remotePath: ftpFavouriteDraft.remotePath.trim() || '/',
        mountName: ftpFavouriteDraft.mountName.trim() || ftpFavouriteDraft.name.trim(),
      };

      if (ftpEditingFavouriteId === null || ftpFavouriteDraft.password) {
        body.password = ftpFavouriteDraft.password;
      }

      const res = await authFetch(
        ftpEditingFavouriteId === null ? `${API}/ftp/favourites` : `${API}/ftp/favourites/${ftpEditingFavouriteId}`,
        {
          method: ftpEditingFavouriteId === null ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Unable to save FTP favourite');
        return;
      }

      const savedName = payload?.favourite?.name || ftpFavouriteDraft.name.trim();
      await loadFtpFavourites();
      setFtpStatus(ftpEditingFavouriteId === null ? `Saved favourite ${savedName}` : `Updated favourite ${savedName}`);
      setFtpEditingFavouriteId(payload?.favourite?.id || ftpEditingFavouriteId);
      setFtpFavouriteDraft((current) => createFtpFavouriteDraft({
        ...current,
        password: '',
      }));
    } catch {
      setFtpStatus('Unable to save FTP favourite');
    } finally {
      setFtpFavouritesBusy(false);
    }
  };

  const deleteFtpFavourite = async (favourite: FtpFavourite) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete FTP favourite "${favourite.name}"?`)) {
      return;
    }

    setFtpFavouritesBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/favourites/${favourite.id}`, {
        method: 'DELETE',
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Unable to delete FTP favourite');
        return;
      }

      if (ftpActiveFavouriteId === favourite.id) {
        setFtpActiveFavouriteId(null);
      }

      if (ftpEditingFavouriteId === favourite.id) {
        resetFtpFavouriteEditor();
      }

      await loadFtpFavourites();
      setFtpStatus(`Deleted favourite ${favourite.name}`);
    } catch {
      setFtpStatus('Unable to delete FTP favourite');
    } finally {
      setFtpFavouritesBusy(false);
    }
  };

  const toggleFtpFavouriteMount = async (favourite: FtpFavourite) => {
    setFtpFavouritesBusy(true);
    setFtpStatus('');

    try {
      const action = favourite.mount?.mounted ? 'unmount' : 'mount';
      const res = await authFetch(`${API}/ftp/favourites/${favourite.id}/${action}`, {
        method: 'POST',
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || `Unable to ${action} favourite`);
        return;
      }

      await loadFtpFavourites();
      setFtpStatus(
        action === 'mount'
          ? `Mounted ${favourite.name} into ~/Drives/${favourite.mount.mountName || favourite.mountName}`
          : `Unmounted ${favourite.name}`
      );
    } catch {
      setFtpStatus(`Unable to ${favourite.mount?.mounted ? 'unmount' : 'mount'} favourite`);
    } finally {
      setFtpFavouritesBusy(false);
    }
  };

  const downloadFtpEntry = async (entry: FtpEntry, { recursive = false }: { recursive?: boolean } = {}) => {
    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpPayload(),
          entryType: entry.type,
          recursive,
          remotePath: joinRemotePath(ftpPath, entry.name),
        }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Download failed');
        return;
      }

      setFtpEntryMenuState(null);
      setFtpStatus(`${payload.entryType === 'directory' ? 'Directory' : 'File'} saved to ${payload.localPath}`);
    } catch {
      setFtpStatus('Download failed');
    } finally {
      setFtpBusy(false);
    }
  };

  const setUploadTargetFromEntry = (entry: FtpEntry) => {
    const remotePath = joinRemotePath(ftpPath, entry.name);
    setFtpUploadRemotePath(entry.type === 'directory' ? `${remotePath}/` : remotePath);
    setFtpEntryMenuState(null);
    setFtpStatus(`Upload target set to ${entry.type === 'directory' ? `${remotePath}/` : remotePath}`);
  };

  const openFtpEntryMenu = (menuKey: string) => {
    const trigger = ftpMenuButtonRefs.current[menuKey];
    const rect = trigger?.getBoundingClientRect();
    const upward = rect ? rect.bottom > window.innerHeight - 180 : false;
    setFtpEntryMenuState((current) => current?.key === menuKey ? null : { key: menuKey, upward });
  };

  const uploadToFtp = async () => {
    if (!ftpUploadLocalPath.trim() || !ftpUploadRemotePath.trim()) {
      setFtpStatus('Set both a local file path and a remote upload path.');
      return;
    }

    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpPayload(),
          localPath: ftpUploadLocalPath.trim(),
          remotePath: ftpUploadRemotePath.trim(),
        }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Upload failed');
        return;
      }

      setFtpStatus(`Uploaded ${payload.localPath} to ${payload.remotePath}`);
      void loadFtpDirectory(parentRemotePath(ftpUploadRemotePath.trim()));
    } catch {
      setFtpStatus('Upload failed');
    } finally {
      setFtpBusy(false);
    }
  };

  const createFtpFolder = async () => {
    if (!ftpFolderName.trim()) {
      setFtpStatus('Enter a folder name first.');
      return;
    }

    const remotePath = joinRemotePath(ftpPath, ftpFolderName.trim());
    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpPayload(),
          remotePath,
        }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Folder creation failed');
        return;
      }

      setFtpFolderName('');
      setFtpStatus(`Created ${payload.remotePath}`);
      void loadFtpDirectory(ftpPath);
    } catch {
      setFtpStatus('Folder creation failed');
    } finally {
      setFtpBusy(false);
    }
  };

  if (!authChecked) {
    return <div style={styles.loading} role="status" aria-live="polite">Loading…</div>;
  }

  if (!isAuthed) {
    return (
      <main id="app-main" style={styles.loginShell}>
        <form style={styles.loginCard} onSubmit={login} noValidate>
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Dashboard Login</h1>
          <p style={{ marginTop: 0, color: THEME.muted, fontSize: 13 }}>Sign in to access the server dashboard.</p>
          <TextField
            id="login-username"
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={setUsername}
          />
          <TextField
            id="login-password"
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
          <p
            style={authError ? styles.errorText : styles.infoText}
            role={authError ? 'alert' : 'status'}
            aria-live="polite"
          >
            {authError || 'Use the account configured in server/.env.'}
          </p>
          <button className="ui-button ui-button--primary" style={styles.loginBtn} type="submit" disabled={authBusy}>
            {authBusy ? 'Signing In…' : 'Log In'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <div style={{ ...styles.app, ...(isPhone ? styles.appPhone : {}), ...(isTablet ? styles.appTablet : {}) }}>
      {!isPhone && (
        <aside style={{ ...styles.sidebar, ...(isTablet ? styles.sidebarTablet : {}) }}>
          <div style={styles.brand}>{isTablet ? 'HS' : 'Home Server'}</div>
          <nav aria-label="Dashboard Sections" style={{ ...styles.navGroup, ...(isTablet ? styles.navGroupTablet : {}) }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className="ui-button"
                aria-pressed={activeTab === tab.key}
                style={{ ...styles.navBtn, ...(activeTab === tab.key ? styles.navBtnActive : {}), ...(isTablet ? styles.navBtnTablet : {}) }}
                type="button"
                onClick={() => setActiveTab(tab.key)}
              >
                {navButtonLabel(tab.key)}
              </button>
            ))}
          </nav>
          <button
            className="ui-button"
            style={{ ...styles.navBtn, ...styles.logoutBtn, ...(isTablet ? styles.navBtnTablet : {}) }}
            type="button"
            onClick={() => clearSession()}
          >
            {isTablet ? 'Exit' : 'Log Out'}
          </button>
        </aside>
      )}

      <main id="app-main" style={{ ...styles.main, ...(isTablet ? styles.mainTablet : {}), ...(isPhone ? styles.mainPhone : {}) }}>
        {activeTab === 'home' && (
          <div>
            <div style={styles.headerBar}>
              <div>
                <h1 style={styles.title}>Server overview</h1>
              </div>
              <div style={styles.headerMeta}>
                <span style={styles.headerPill}>{lastUpdated ? `Updated ${lastUpdated}` : 'Waiting for telemetry'}</span>
                <span style={styles.headerPill}>{runningServices}/{totalServices} services</span>
                <span style={styles.headerPill}>{connections.length} clients</span>
              </div>
            </div>

            <section style={{ ...styles.homeLayout, ...(isCompact ? styles.homeLayoutCompact : {}) }}>
              <div style={styles.homePrimary}>
                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>System</h3>
                  <div style={styles.keyValueGrid}>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>CPU load</span><strong>{monitor ? `${monitor.cpuLoad.toFixed(1)}%` : '--'}</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Memory</span><strong>{usedMemPct.toFixed(1)}%</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Uptime</span><strong>{monitor ? `${(monitor.uptime / 3600).toFixed(1)}h` : '--'}</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>CPU cores</span><strong>{monitor ? monitor.cpuCores : '--'}</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Load average</span><strong>{monitor ? `${monitor.loadAvg1m.toFixed(2)} / ${monitor.loadAvg5m.toFixed(2)} / ${monitor.loadAvg15m.toFixed(2)}` : '--'}</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Event loop</span><strong>{monitor ? `${monitor.eventLoopP95Ms.toFixed(2)}ms p95` : '--'}</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Node RSS</span><strong>{monitor ? fmtBytes(monitor.processRss) : '--'}</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Network</span><strong>{monitor ? `↓ ${fmtRate(monitor.network.rxRate)} · ↑ ${fmtRate(monitor.network.txRate)}` : '--'}</strong></div>
                  </div>

                  <div style={styles.trendStack}>
                    <div>
                      <p style={styles.smallLabel}>CPU trend</p>
                      <canvas ref={cpuCanvas} width={460} height={144} style={styles.canvas} />
                    </div>
                    <div>
                      <p style={styles.smallLabel}>RAM trend</p>
                      <canvas ref={ramCanvas} width={460} height={144} style={styles.canvas} />
                    </div>
                  </div>
                </article>

                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>Storage</h3>
                  <Progress label="Storage free" value={Math.max(0, 100 - usedStoragePct)} />
                  <div style={styles.mountList}>
                    {storage.slice(0, 6).map((mount) => (
                      <div key={`${mount.filesystem}-${mount.mount}`} style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>{mount.mount}</strong>
                          <p style={styles.mountMeta}>{mount.filesystem} {mount.fsType ? `(${mount.fsType})` : ''} {mount.category ? `- ${mount.category}` : ''}</p>
                        </div>
                        <div style={styles.mountRight}>
                          <span>{mount.usePercent}%</span>
                          <span style={styles.mountMeta}>{fmtBytes(mount.used)} / {fmtBytes(mount.size)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <div style={styles.homeSecondary}>
                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>Service Controls</h3>
                  {Object.entries(services).map(([name, running]) => (
                    <div key={name} style={styles.serviceRow}>
                      <span style={styles.serviceName}>
                        {name}
                        <span style={{ ...styles.dot, background: running ? THEME.ok : THEME.crimsonRed }} />
                      </span>
                      <div style={styles.actionWrap}>
                        <button className="ui-button" disabled={!!controlBusy[`${name}:start`]} style={styles.actionBtn} type="button" onClick={() => openControlPopup(name, 'start')}>Start</button>
                        <button className="ui-button" disabled={!!controlBusy[`${name}:stop`]} style={styles.actionBtn} type="button" onClick={() => openControlPopup(name, 'stop')}>Stop</button>
                        <button className="ui-button" disabled={!!controlBusy[`${name}:restart`]} style={styles.actionBtn} type="button" onClick={() => openControlPopup(name, 'restart')}>Restart</button>
                      </div>
                    </div>
                  ))}
                  <p
                    style={{ ...styles.smallLabel, marginTop: 8, color: controlStatusColor }}
                    role="status"
                    aria-live="polite"
                  >
                    {controlStatus || 'Ready'}
                  </p>
                </article>

                <article style={styles.card}>
                  <h3 style={styles.cardTitle}>Connected Users</h3>
                  <div style={styles.tableWrapTight}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Username</th>
                          <th style={styles.th}>IP</th>
                          <th style={styles.th}>Protocol</th>
                          <th style={styles.th}>Last Seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {connections.length === 0 && (
                          <tr>
                            <td style={styles.td} colSpan={4}>No active users</td>
                          </tr>
                        )}
                        {connections.map((user, idx) => (
                          <tr key={`${user.ip}-${user.port}-${idx}`}>
                            <td style={styles.td}>{user.username}</td>
                            <td style={styles.td}>{user.ip}</td>
                            <td style={styles.td}>{user.protocol}</td>
                            <td style={styles.td}>{fmtTime(user.lastSeen)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>

                <article style={styles.card}>
                  <div style={styles.logControlRow}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Debug Log</h3>
                    <button className="ui-button" style={styles.linkBtn} type="button" onClick={() => toggleVerboseLogging(!verboseLogging)}>
                      {verboseLogging ? 'Disable Verbose' : 'Enable Verbose'}
                    </button>
                  </div>
                  <div style={styles.logBoxCompact}>
                    {debugLogs.length === 0 && <p style={styles.smallLabel}>No debug events yet.</p>}
                    {debugLogs.slice(0, 20).map((log, idx) => (
                      <p key={`${log.timestamp}-${idx}`} style={styles.logLine}>
                        <span style={styles.logTime}>{fmtTime(log.timestamp)}</span>
                        <span style={{ ...styles.logLevel, color: log.level === 'error' ? THEME.crimsonRed : log.level === 'warn' ? THEME.brightYellow : THEME.accent }}>
                          {log.level.toUpperCase()}
                        </span>
                        <span>
                          {log.message}
                          {log.meta ? ` ${JSON.stringify(log.meta)}` : ''}
                        </span>
                      </p>
                    ))}
                  </div>
                  <pre style={styles.markdownBoxCompact}>{logsMarkdown || '```log\n(no logs yet)\n```'}</pre>
                </article>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'terminal' && (
          <EmbeddedToolPanel
            title="Terminal"
            subtitle="Interactive shell via ttyd."
            frameTitle="Embedded Terminal"
            path="/term/"
            gatewayBase={gatewayBase}
            isCompact={isCompact}
          />
        )}

        {activeTab === 'filesystem' && (
          <Panel title="Filesystem" subtitle="Drive state, drive health, and a direct path into the full workspace.">
            <div style={{ ...styles.homeLayout, ...(isCompact ? styles.homeLayoutCompact : {}) }}>
              <div style={styles.homePrimary}>
                <article style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Drive Summary</h3>
                      <p style={styles.smallLabel}>{filesystemStatus}</p>
                    </div>
                    <div style={styles.actionWrap}>
                      <button className="ui-button" style={styles.actionBtn} type="button" disabled={driveBusy} onClick={() => void runDriveCheck()}>
                        {driveBusy ? 'Checking…' : 'Check Drives'}
                      </button>
                      {gatewayBase ? (
                        <a href={`${gatewayBase}/files`} className="ui-button ui-button--primary" style={styles.linkBtn}>
                          Open Full Filesystem
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div style={styles.mountList}>
                    <div style={styles.mountRow}>
                      <div style={styles.mountLeft}>
                        <strong>C</strong>
                        <p style={styles.mountMeta}>Internal storage</p>
                      </div>
                      <div style={styles.mountRight}>
                        <span>Always mounted</span>
                        <span style={styles.mountMeta}>Shared Android storage</span>
                      </div>
                    </div>
                    {driveState.manifest.drives.map((drive) => (
                      <div key={`${drive.device}-${drive.mountPoint}`} style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>{drive.dirName || `${drive.letter} (${drive.name})`}</strong>
                          <p style={styles.mountMeta}>{drive.mountPoint}</p>
                        </div>
                        <div style={styles.mountRight}>
                          <span>{drive.state}</span>
                          <span style={styles.mountMeta}>{drive.filesystem || 'drive'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {driveError ? <p style={{ ...styles.smallLabel, color: THEME.crimsonRed, marginTop: 12 }}>{driveError}</p> : null}
                </article>

                <article style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Quick Links</h3>
                      <p style={styles.smallLabel}>Jump straight into the full workspace at the share root you want.</p>
                    </div>
                  </div>
                  <div style={styles.mountList}>
                    {dashboardShares.length === 0 ? (
                      <p style={styles.smallLabel}>No share shortcuts available yet.</p>
                    ) : (
                      dashboardShares.slice(0, 8).map((share) => (
                        <a key={share.id} href={`${gatewayBase}/files`} style={styles.quickLink}>
                          <strong>{share.name}</strong>
                          <span>{share.sourceType} · {share.pathKey}</span>
                        </a>
                      ))
                    )}
                  </div>
                </article>
              </div>

              <div style={styles.homeSecondary}>
                <article style={styles.card}>
                  <div style={styles.logControlRow}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Drive Log</h3>
                    <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => setShowDriveLog((value) => !value)}>
                      {showDriveLog ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {!showDriveLog ? (
                    <p style={styles.smallLabel}>{latestDriveEvent ? `${latestDriveEvent.event} · ${fmtDateTime(latestDriveEvent.timestamp)}` : 'No drive events yet.'}</p>
                  ) : (
                    <div style={styles.logBoxCompact}>
                      {driveState.events.length === 0 && <p style={styles.smallLabel}>No drive events yet.</p>}
                      {driveState.events.map((event, idx) => (
                        <p key={`${event.timestamp}-${idx}`} style={styles.logLine}>
                          <span style={styles.logTime}>{fmtTime(event.timestamp)}</span>
                          <span style={{ ...styles.logLevel, color: event.level === 'error' ? THEME.crimsonRed : event.level === 'warn' ? THEME.brightYellow : THEME.accent }}>
                            {event.level.toUpperCase()}
                          </span>
                          <span>{event.event}{event.letter ? ` · ${event.letter}` : ''}{event.name ? ` · ${event.name}` : ''}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            </div>
          </Panel>
        )}

        {activeTab === 'ftp' && (
          <Panel title="FTP" subtitle="Save remotes, browse them directly, and mount them into ~/Drives when this host allows it.">
            <div style={{ ...styles.ftpWorkspace, ...(isCompact ? styles.ftpWorkspaceCompact : {}) }}>
              <div style={styles.ftpSidebar}>
                <div style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Saved Favourites</h3>
                    <div style={styles.actionWrap}>
                      <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => resetFtpFavouriteEditor()}>New</button>
                      <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpFavourites()}>Reload</button>
                    </div>
                  </div>
                  <p style={styles.smallLabel}>Saved remotes can be browsed live or mounted into a drive folder. Mount errors stay attached to the favourite so they are visible without opening logs.</p>
                  <div style={styles.ftpFavouriteList}>
                    {ftpFavourites.length === 0 && (
                      <p style={styles.smallLabel}>No favourites saved yet. The editor below is prefilled with the default PS4 connection.</p>
                    )}
                    {ftpFavourites.map((favourite) => {
                      const mountLabel = favourite.mount?.mounted
                        ? 'Mounted'
                        : favourite.mount?.state === 'starting'
                          ? 'Starting'
                          : favourite.mount?.error
                            ? 'Error'
                            : 'Saved';

                      const badgeStyle = favourite.mount?.mounted
                        ? styles.ftpBadgeMounted
                        : favourite.mount?.error
                          ? styles.ftpBadgeError
                          : styles.ftpBadgeIdle;

                      return (
                        <div
                          key={favourite.id}
                          style={{
                            ...styles.ftpFavouriteRow,
                            ...(ftpActiveFavouriteId === favourite.id ? styles.ftpFavouriteRowActive : {}),
                          }}
                        >
                          <div style={styles.ftpFavouriteMeta}>
                            <div style={styles.ftpFavouriteHeader}>
                              <strong>{favourite.name}</strong>
                              <span style={{ ...styles.ftpBadge, ...badgeStyle }}>{mountLabel}</span>
                            </div>
                            <p style={styles.mountMeta}>{favourite.host}:{favourite.port} · {favourite.remotePath || '/'}</p>
                            <p style={styles.mountMeta}>Drive target: ~/Drives/{favourite.mountName || favourite.name}</p>
                            <p style={styles.mountMeta}>{describeFtpMount(favourite.mount)}</p>
                          </div>
                          <div style={styles.actionWrap}>
                            <button className="ui-button" disabled={ftpBusy || ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void browseFtpFavourite(favourite)}>Browse</button>
                            <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void toggleFtpFavouriteMount(favourite)}>
                              {favourite.mount?.mounted ? 'Unmount' : 'Mount'}
                            </button>
                            <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => editFtpFavourite(favourite)}>Edit</button>
                            <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void deleteFtpFavourite(favourite)}>Delete</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>{ftpEditingFavouriteId === null ? 'New Favourite' : 'Edit Favourite'}</h3>
                    <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => resetFtpFavouriteEditor()}>
                      {ftpEditingFavouriteId === null ? 'Reset' : 'Clear'}
                    </button>
                  </div>
                  <div style={styles.ftpActionGroup}>
                    <TextField id="ftp-favourite-name" label="Display Name" name="ftpFavouriteName" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.name} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, name: value }))} />
                    <TextField id="ftp-favourite-host" label="Host" name="ftpFavouriteHost" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.host} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, host: value }))} />
                    <TextField id="ftp-favourite-port" label="Port" name="ftpFavouritePort" autoComplete="off" inputMode="numeric" spellCheck={false} value={ftpFavouriteDraft.port} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, port: value }))} />
                    <TextField id="ftp-favourite-user" label="Username" name="ftpFavouriteUser" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.username} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, username: value }))} />
                    <TextField id="ftp-favourite-password" label={ftpEditingFavouriteId === null ? 'Password' : 'Password Override'} name="ftpFavouritePassword" type="password" autoComplete="off" value={ftpFavouriteDraft.password} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, password: value }))} />
                    <TextField id="ftp-favourite-remote-path" label="Start Path" name="ftpFavouriteRemotePath" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.remotePath} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, remotePath: value }))} />
                    <TextField id="ftp-favourite-mount-name" label="Drive Folder Name" name="ftpFavouriteMountName" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.mountName} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, mountName: value }))} />
                  </div>
                  <label style={styles.checkboxRow}>
                    <input type="checkbox" checked={ftpFavouriteDraft.secure} onChange={(event) => setFtpFavouriteDraft((prev) => ({ ...prev, secure: event.target.checked }))} />
                    <span>Use FTPS/TLS for this favourite</span>
                  </label>
                  <p style={styles.smallLabel}>Leave the password blank while editing if you want to keep the stored secret unchanged.</p>
                  <div style={styles.actionWrap}>
                    <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void saveFtpFavourite()}>
                      {ftpEditingFavouriteId === null ? 'Save Favourite' : 'Update Favourite'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={styles.ftpMain}>
                <div style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Connection</h3>
                      <p style={styles.smallLabel}>Browse a saved favourite or detach and use the manual fields for one-off sessions.</p>
                    </div>
                    {activeFtpFavourite && <span style={styles.headerPill}>Using {activeFtpFavourite.name}</span>}
                  </div>
                  <div style={styles.ftpFormGrid}>
                    <TextField id="ftp-host" label="Host" name="ftpHost" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpHost} onChange={(value) => { setFtpActiveFavouriteId(null); setFtpHost(value); }} />
                    <TextField id="ftp-port" label="Port" name="ftpPort" autoComplete="off" inputMode="numeric" spellCheck={false} value={ftpPort} onChange={(value) => { setFtpActiveFavouriteId(null); setFtpPort(value); }} />
                    <TextField id="ftp-user" label="Username" name="ftpUser" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpUser} onChange={(value) => { setFtpActiveFavouriteId(null); setFtpUser(value); }} />
                    <TextField id="ftp-password" label="Password" name="ftpPassword" type="password" autoComplete="off" value={ftpPassword} onChange={(value) => { setFtpActiveFavouriteId(null); setFtpPassword(value); }} />
                  </div>
                  <label style={styles.checkboxRow}>
                    <input type="checkbox" checked={ftpSecure} onChange={(event) => { setFtpActiveFavouriteId(null); setFtpSecure(event.target.checked); }} />
                    <span>Use FTPS/TLS</span>
                  </label>
                  <div style={styles.actionWrap}>
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(activeFtpFavourite?.remotePath || '/')}>Connect</button>
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(ftpPath)}>Refresh</button>
                    <button className="ui-button" disabled={ftpBusy || ftpPath === '/'} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(parentRemotePath(ftpPath))}>Up One Level</button>
                    {ftpActiveFavouriteId !== null && (
                      <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => { setFtpActiveFavouriteId(null); setFtpStatus('Detached from saved favourite. Manual connection fields are active now.'); }}>
                        Manual Mode
                      </button>
                    )}
                  </div>
                  <p style={styles.codeLine}>Current remote path: <code>{ftpPath}</code></p>
                  <p style={styles.codeLine}>Downloads land under: <code>{ftpDownloadRoot || '~/Drives'}</code></p>
                  {activeFtpFavourite && (
                    <p style={styles.codeLine}>Drive target: <code>~/Drives/{activeFtpFavourite.mountName || activeFtpFavourite.name}</code></p>
                  )}
                  <p
                    style={{ ...styles.smallLabel, color: ftpStatusColor }}
                    role="status"
                    aria-live="polite"
                  >
                    {ftpStatus || 'Ready'}
                  </p>
                </div>

                <div style={styles.card}>
                  <h3 style={styles.cardTitle}>Transfer Actions</h3>
                  <div style={styles.ftpActionGroup}>
                    <TextField
                      id="ftp-upload-local-path"
                      label="Local File Path"
                      name="ftpUploadLocalPath"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="/data/data/com.termux/files/home/Drives/C/patch.pkg"
                      value={ftpUploadLocalPath}
                      onChange={setFtpUploadLocalPath}
                    />
                    <TextField
                      id="ftp-upload-remote-path"
                      label="Remote Upload Path"
                      name="ftpUploadRemotePath"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="/data/patch.pkg"
                      value={ftpUploadRemotePath}
                      onChange={setFtpUploadRemotePath}
                    />
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void uploadToFtp()}>Upload Local File</button>
                  </div>
                  <div style={styles.ftpActionGroup}>
                    <TextField
                      id="ftp-folder-name"
                      label="New Remote Folder"
                      name="ftpFolderName"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="new-folder"
                      value={ftpFolderName}
                      onChange={setFtpFolderName}
                    />
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void createFtpFolder()}>Create Folder</button>
                  </div>
                  <p style={styles.smallLabel}>The row menu in the listing can prefill the upload target for the folder or file you choose.</p>
                </div>

                <div style={styles.card}>
                  <div className="fs-topbar fs-topbar--path">
                    <div className="fs-pathbar-shell">
                      <div className="fs-pathbar" aria-label="Remote path">
                        <button className="fs-crumb fs-crumb--path" type="button" onClick={() => void loadFtpDirectory('/')}>
                          <span>/</span>
                          {ftpBreadcrumbs.length > 0 ? <span className="fs-crumb__divider">/</span> : null}
                        </button>
                        {ftpBreadcrumbs.map((segment, index) => {
                          const crumbPath = `/${ftpBreadcrumbs.slice(0, index + 1).join('/')}`;
                          return (
                            <button key={crumbPath} className="fs-crumb fs-crumb--path" type="button" onClick={() => void loadFtpDirectory(crumbPath)}>
                              <span>{segment}</span>
                              {index < ftpBreadcrumbs.length - 1 ? <span className="fs-crumb__divider">/</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="fs-topbar__actions">
                      <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(ftpPath)}>Refresh</button>
                      <button className="ui-button" disabled={ftpBusy || ftpPath === '/'} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(parentRemotePath(ftpPath))}>Up</button>
                    </div>
                  </div>
                  <div className="fs-topbar fs-topbar--details">
                    <div className="fs-titlebar">
                      <h2>Remote entries</h2>
                      <div className="fs-titlebar__meta">
                        <span>{activeFtpFavourite?.name || ftpHost || 'Manual session'}</span>
                        <span>{filteredFtpEntries.filter((entry) => entry.type === 'directory').length} folders</span>
                        <span>{filteredFtpEntries.filter((entry) => entry.type !== 'directory').length} files</span>
                      </div>
                    </div>
                    <div className="fs-actions fs-actions--rail">
                      <input
                        className="ui-input fs-search"
                        type="search"
                        placeholder="Filter remote entries"
                        value={ftpSearch}
                        onChange={(event) => setFtpSearch(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="fs-meta">
                    <span>{activeFtpFavourite ? `${activeFtpFavourite.host}:${activeFtpFavourite.port}` : `${ftpHost || 'No host'}:${ftpPort}`}</span>
                    <span>{ftpPath}</span>
                    <span style={{ color: ftpStatusColor }}>{ftpStatus || 'Ready'}</span>
                  </div>
                  <div className="fs-browser-list">
                    {filteredFtpEntries.length === 0 ? (
                      <div className="tool-empty fs-empty">
                        {ftpBusy ? 'Loading remote folder…' : 'No listing loaded yet.'}
                      </div>
                    ) : (
                      filteredFtpEntries.map((entry) => {
                        const menuKey = `${entry.type}:${entry.name}`;
                        const isDirectory = entry.type === 'directory';

                        return (
                          <article key={menuKey} className="fs-browser-item fs-browser-item--no-check">
                            <button className="fs-browser-main" type="button" onClick={() => isDirectory ? void loadFtpDirectory(joinRemotePath(ftpPath, entry.name)) : void downloadFtpEntry(entry)}>
                              <span className={`fs-entry-icon fs-entry-icon--${isDirectory ? 'directory' : 'file'} fs-entry-icon--tile`} aria-hidden="true" />
                              <span className="fs-browser-copy">
                                <strong>{entry.name}</strong>
                                <span>{isDirectory ? 'Folder' : 'File'} · {entry.modifiedAt ? fmtTime(entry.modifiedAt) : entry.rawModifiedAt || '--'}</span>
                              </span>
                            </button>

                            <div className="fs-browser-meta">
                              <span>{isDirectory ? '—' : fmtBytes(entry.size)}</span>
                              <span>{entry.permissions || (isDirectory ? 'remote folder' : 'remote file')}</span>
                            </div>

                            <div className="fs-browser-actions">
                              {isDirectory ? (
                                <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(joinRemotePath(ftpPath, entry.name))}>Open</button>
                              ) : (
                                <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void downloadFtpEntry(entry)}>Pull</button>
                              )}
                              <div className="fs-row-menu">
                                <button
                                  className="ui-button fs-row-menu__trigger"
                                  disabled={ftpBusy}
                                  ref={(node) => {
                                    ftpMenuButtonRefs.current[menuKey] = node;
                                  }}
                                  type="button"
                                  onClick={() => openFtpEntryMenu(menuKey)}
                                >
                                  ⋯
                                </button>
                                {ftpEntryMenuState?.key === menuKey && (
                                  <div className={`fs-row-menu__panel ${ftpEntryMenuState.upward ? 'fs-row-menu__panel--upward' : ''}`}>
                                    {isDirectory ? (
                                      <button className="ui-button fs-row-menu__item" type="button" onClick={() => void loadFtpDirectory(joinRemotePath(ftpPath, entry.name))}>Open folder</button>
                                    ) : null}
                                    <button className="ui-button fs-row-menu__item" type="button" onClick={() => void downloadFtpEntry(entry, { recursive: isDirectory })}>
                                      {isDirectory ? 'Pull folder' : 'Pull file'}
                                    </button>
                                    <button className="ui-button fs-row-menu__item" type="button" onClick={() => setUploadTargetFromEntry(entry)}>
                                      {isDirectory ? 'Use for uploads' : 'Use path'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        )}

        {activeTab === 'settings' && (
          <Panel title="Settings" subtitle="Session, logging, and diagnostics controls.">
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Session</h3>
              <p style={styles.smallLabel}>Signed in as <strong>{sessionUser?.username || 'unknown'}</strong> with role <strong>{sessionUser?.role || 'user'}</strong>. Session access is cookie-based and invalidates on logout or timeout.</p>
              <div style={styles.actionWrap}>
                <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => clearSession()}>Log Out Everywhere Here</button>
              </div>

              <h3 style={{ ...styles.cardTitle, marginTop: 16 }}>Logging</h3>
              <div style={styles.actionWrap}>
                <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleVerboseLogging(true)}>Enable Verbose</button>
                <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleVerboseLogging(false)}>Disable Verbose</button>
              </div>

              {sessionUser?.role === 'admin' ? (
                <>
                  <h3 style={{ ...styles.cardTitle, marginTop: 16 }}>Users</h3>
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Username</th>
                          <th style={styles.th}>Role</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managedUsers.length === 0 && (
                          <tr>
                            <td style={styles.td} colSpan={4}>{usersBusy ? 'Loading users…' : 'No users found.'}</td>
                          </tr>
                        )}
                        {managedUsers.map((user) => (
                          <tr key={user.id}>
                            <td style={styles.td}>{user.username}</td>
                            <td style={styles.td}>{user.role}</td>
                            <td style={styles.td}>{user.isDisabled ? 'disabled' : 'active'}</td>
                            <td style={styles.td}>
                              <div style={styles.ftpRowActions}>
                                <button
                                  className="ui-button"
                                  style={styles.actionBtn}
                                  type="button"
                                  disabled={usersBusy || user.username === sessionUser?.username}
                                  onClick={() => void updateManagedUser(user, { role: user.role === 'admin' ? 'user' : 'admin' })}
                                >
                                  {user.role === 'admin' ? 'Make User' : 'Make Admin'}
                                </button>
                                <button
                                  className="ui-button"
                                  style={styles.actionBtn}
                                  type="button"
                                  disabled={usersBusy || user.username === sessionUser?.username}
                                  onClick={() => void updateManagedUser(user, { isDisabled: !user.isDisabled })}
                                >
                                  {user.isDisabled ? 'Enable' : 'Disable'}
                                </button>
                                <button
                                  className="ui-button"
                                  style={styles.actionBtn}
                                  type="button"
                                  disabled={usersBusy}
                                  onClick={() => {
                                    const nextPassword = window.prompt(`Set a new password for ${user.username}`);
                                    if (!nextPassword) {
                                      return;
                                    }
                                    void updateManagedUser(user, { password: nextPassword });
                                  }}
                                >
                                  Reset Password
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ ...styles.sectionHeader, marginTop: 16 }}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Create User</h3>
                    <span style={styles.smallLabel}>Use this for per-user share grants and controlled read-only access.</span>
                  </div>
                  <div style={styles.ftpActionGroup}>
                    <TextField
                      id="user-create-name"
                      label="Username"
                      name="userCreateName"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      spellCheck={false}
                      placeholder="guest-user"
                      value={userDraft.username}
                      onChange={(value) => setUserDraft((current) => ({ ...current, username: value }))}
                    />
                    <TextField
                      id="user-create-password"
                      label="Password"
                      name="userCreatePassword"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder="at least 8 characters"
                      value={userDraft.password}
                      onChange={(value) => setUserDraft((current) => ({ ...current, password: value }))}
                    />
                    <label style={styles.field}>
                      <span style={styles.fieldLabel}>Role</span>
                      <select
                        className="ui-input"
                        value={userDraft.role}
                        onChange={(event) => setUserDraft((current) => ({ ...current, role: event.target.value === 'admin' ? 'admin' : 'user' }))}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <button className="ui-button" style={styles.actionBtn} type="button" disabled={usersBusy} onClick={() => void createManagedUser()}>
                      {usersBusy ? 'Saving…' : 'Create User'}
                    </button>
                  </div>
                  {userStatus ? <p style={{ ...styles.smallLabel, color: userStatus.toLowerCase().includes('unable') || userStatus.toLowerCase().includes('error') ? THEME.crimsonRed : THEME.ok }}>{userStatus}</p> : null}
                </>
              ) : null}
            </div>
          </Panel>
        )}

        {controlTarget && (
          <div
            style={styles.modalOverlay}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeControlPopup();
              }
            }}
          >
            <div
              style={styles.modalCard}
              role="dialog"
              aria-modal="true"
              aria-labelledby="control-dialog-title"
              aria-describedby="control-dialog-copy"
            >
              <h3 id="control-dialog-title" style={{ marginTop: 0 }}>Confirm Service Action</h3>
              <p id="control-dialog-copy" style={styles.smallLabel}>
                Confirm you want to <strong>{controlTarget.action}</strong> <strong>{controlTarget.service}</strong>. Admin session access is required. The password field is optional step-up confirmation.
              </p>
              <TextField
                id="control-password"
                label="Admin Password"
                name="controlPassword"
                type="password"
                autoComplete="current-password"
                value={controlPassword}
                onChange={setControlPassword}
              />
              <div style={styles.actionWrap}>
                <button className="ui-button ui-button--primary" style={styles.actionBtn} type="button" onClick={executeControl}>Confirm</button>
                <button className="ui-button" style={styles.actionBtn} type="button" onClick={closeControlPopup}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </main>

      {isPhone && (
        <nav aria-label="Dashboard Sections" style={styles.bottomNav}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className="ui-button"
              aria-pressed={activeTab === tab.key}
              style={{ ...styles.bottomNavBtn, ...(activeTab === tab.key ? styles.bottomNavBtnActive : {}) }}
              type="button"
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

type TextFieldProps = {
  autoComplete?: string;
  autoCapitalize?: InputHTMLAttributes<HTMLInputElement>['autoCapitalize'];
  autoCorrect?: InputHTMLAttributes<HTMLInputElement>['autoCorrect'];
  id: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder?: string;
  spellCheck?: boolean;
  type?: InputHTMLAttributes<HTMLInputElement>['type'];
  value: string;
};

function TextField({
  autoComplete = 'off',
  autoCapitalize,
  autoCorrect,
  id,
  inputMode,
  label,
  name,
  onChange,
  placeholder,
  spellCheck = false,
  type = 'text',
  value,
}: TextFieldProps) {
  return (
    <label htmlFor={id} style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <input
        className="ui-input"
        id={id}
        inputMode={inputMode}
        name={name}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        placeholder={placeholder}
        spellCheck={spellCheck}
        style={styles.input}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(value, 100));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={styles.progressLabel}>
        <span>{label}</span>
        <span>{safeValue.toFixed(0)}%</span>
      </div>
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function EmbeddedToolPanel({
  title,
  subtitle,
  frameTitle,
  path,
  gatewayBase,
  isCompact,
}: {
  title: string;
  subtitle: string;
  frameTitle: string;
  path: string;
  gatewayBase: string;
  isCompact: boolean;
}) {
  const frameSrc = gatewayBase ? `${gatewayBase}${path}` : '';

  return (
    <Panel title={title} subtitle={subtitle}>
      <div style={styles.panelActions}>
        {gatewayBase ? (
          <a href={frameSrc} target="_blank" rel="noreferrer" className="ui-button" style={styles.linkBtn}>
            Open In New Tab
          </a>
        ) : (
          <span style={styles.smallLabel}>Resolving gateway…</span>
        )}
      </div>
      {gatewayBase ? (
        <iframe title={frameTitle} src={frameSrc} style={{ ...styles.frame, ...(isCompact ? styles.frameCompact : {}) }} />
      ) : (
        <div style={styles.framePlaceholder} role="status" aria-live="polite">
          Gateway is still resolving. This view will load automatically.
        </div>
      )}
    </Panel>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div>
      <h1 style={styles.title}>{title}</h1>
      <p style={styles.panelSubtitle}>{subtitle}</p>
      {children}
    </div>
  );
}

function drawTrend(canvas: HTMLCanvasElement | null, data: number[], stroke: string, fill: string) {
  if (!canvas || data.length === 0) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  const max = 100;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i += 1) {
    const y = (h / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();

  data.forEach((val, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - (val / max) * (h - 12) - 6;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  ctx.fillStyle = stroke;
  data.forEach((val, i) => {
    if (i % 5 !== 0 && i !== data.length - 1) {
      return;
    }

    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - (val / max) * (h - 12) - 6;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

const styles: Record<string, CSSProperties> = {
  loading: {
    minHeight: '100dvh',
    display: 'grid',
    placeItems: 'center',
    background: THEME.bg,
    color: THEME.text,
  },
  loginShell: {
    minHeight: '100dvh',
    background: THEME.bg,
    display: 'grid',
    placeItems: 'center',
    padding: 24,
  },
  loginCard: {
    width: '100%',
    maxWidth: 360,
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 24,
  },
  field: {
    display: 'grid',
    gap: 6,
    marginBottom: 12,
  },
  fieldLabel: {
    color: THEME.muted,
    fontSize: 13,
  },
  input: {
    width: '100%',
    marginBottom: 0,
  },
  infoText: {
    color: THEME.muted,
    fontSize: 12,
    marginTop: 0,
    marginBottom: 12,
  },
  errorText: {
    color: THEME.crimsonRed,
    fontSize: 12,
    marginTop: 0,
    marginBottom: 12,
  },
  loginBtn: {
    width: '100%',
    fontWeight: 600,
  },
  app: {
    minHeight: '100dvh',
    display: 'flex',
    background: THEME.bg,
    color: THEME.text,
    overflowX: 'hidden',
    fontFamily: 'var(--font-geist-sans), sans-serif',
  },
  appTablet: { minHeight: '100dvh' },
  appPhone: {
    minHeight: '100dvh',
    paddingBottom: 76,
  },
  sidebar: {
    width: 248,
    minHeight: '100dvh',
    borderRight: `1px solid ${THEME.border}`,
    padding: 16,
    background: '#15181c',
    overflowY: 'auto',
  },
  sidebarTablet: {
    width: 72,
    padding: 12,
  },
  brand: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 18,
    color: THEME.text,
    whiteSpace: 'nowrap',
  },
  navGroup: { display: 'flex', flexDirection: 'column', gap: 8 },
  navGroupTablet: { gap: 6 },
  navBtn: {
    padding: '10px 12px',
    textAlign: 'left',
    fontWeight: 500,
    justifyContent: 'flex-start',
  },
  navBtnTablet: {
    width: '100%',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '10px 6px',
    fontSize: 12,
  },
  navBtnActive: {
    background: THEME.panelRaised,
    color: THEME.text,
    borderColor: THEME.border,
  },
  logoutBtn: { marginTop: 14 },
  main: { flex: 1, minHeight: 0, padding: 24, overflowY: 'auto' },
  mainTablet: { padding: 18 },
  mainPhone: { padding: 16, overflowY: 'visible' },
  title: { margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: THEME.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  panelSubtitle: { margin: '0 0 16px', color: THEME.muted, fontSize: 12, maxWidth: 680, overflowWrap: 'anywhere' },
  headerBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  headerMeta: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  headerPill: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: THEME.panel,
    color: THEME.muted,
    fontSize: 12,
    padding: '6px 10px',
  },
  homeLayout: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 16,
    minHeight: 'calc(100dvh - 168px)',
  },
  homeLayoutCompact: {
    flexDirection: 'column',
    minHeight: 'auto',
  },
  homePrimary: {
    flex: '1 1 58%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  homeSecondary: {
    flex: '1 1 42%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  card: {
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 16,
  },
  cardTitle: { margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: THEME.text },
  smallLabel: { margin: '0 0 8px', color: THEME.muted, fontSize: 12, overflowWrap: 'anywhere' },
  codeLine: {
    margin: '0 0 8px',
    color: THEME.muted,
    fontSize: 12,
    overflowWrap: 'anywhere',
  },
  keyValueGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
    marginBottom: 16,
  },
  keyValueRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
  },
  keyLabel: {
    color: THEME.muted,
    fontSize: 13,
  },
  trendStack: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
  },
  canvas: {
    width: '100%',
    height: 156,
    borderRadius: 8,
    border: `1px solid ${THEME.border}`,
    background: '#121519',
  },
  progressLabel: { display: 'flex', justifyContent: 'space-between', color: THEME.muted, fontSize: 12, marginBottom: 6 },
  progressTrack: { height: 8, borderRadius: 999, background: '#242930', overflow: 'hidden' },
  progressFill: { height: '100%', background: THEME.accent },
  serviceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottom: `1px solid ${THEME.border}`,
    gap: 8,
  },
  serviceName: { textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  actionWrap: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  actionBtn: {
    padding: '7px 10px',
    fontSize: 12,
  },
  mountList: { display: 'grid', gap: 8 },
  mountLeft: { minWidth: 0, flex: '1 1 220px' },
  mountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: '10px 12px',
    gap: 10,
  },
  mountRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  mountMeta: { margin: 0, fontSize: 12, color: THEME.muted, overflowWrap: 'anywhere' },
  logControlRow: { marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  logBoxCompact: {
    maxHeight: 220,
    overflow: 'auto',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: '10px 12px',
    background: '#121519',
    fontFamily: 'monospace',
  },
  markdownBoxCompact: {
    margin: '10px 0 0',
    maxHeight: 180,
    overflow: 'auto',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: '10px 12px',
    background: '#121519',
    color: '#d6dbd0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  logLine: { margin: '0 0 6px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' },
  logTime: { color: THEME.muted, minWidth: 72 },
  logLevel: { fontWeight: 700, minWidth: 42 },
  tableWrap: { width: '100%', overflowX: 'auto' },
  tableWrapTight: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    color: THEME.muted,
    fontWeight: 500,
    textAlign: 'left',
    padding: '0 10px 10px',
    borderBottom: `1px solid ${THEME.border}`,
    whiteSpace: 'nowrap',
  },
  td: {
    background: 'transparent',
    borderBottom: `1px solid ${THEME.border}`,
    padding: '10px',
    color: THEME.text,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  frame: {
    width: '100%',
    minHeight: 480,
    height: 'calc(100dvh - 184px)',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: '#121519',
  },
  frameCompact: {
    minHeight: 520,
    height: '70dvh',
  },
  framePlaceholder: {
    minHeight: 320,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: '#121519',
    color: THEME.muted,
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    textAlign: 'center',
  },
  panelActions: { marginBottom: 10 },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  ftpWorkspace: {
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)',
    gap: 16,
    alignItems: 'start',
  },
  ftpWorkspaceCompact: {
    gridTemplateColumns: '1fr',
  },
  ftpSidebar: {
    display: 'grid',
    gap: 16,
    minWidth: 0,
  },
  ftpMain: {
    display: 'grid',
    gap: 16,
    minWidth: 0,
  },
  ftpGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
  ftpFormGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  ftpActionGroup: { display: 'grid', gap: 10, marginTop: 12 },
  ftpFavouriteList: {
    display: 'grid',
    gap: 10,
  },
  ftpFavouriteRow: {
    display: 'grid',
    gap: 10,
    padding: '10px 12px',
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
  },
  ftpFavouriteRowActive: {
    borderColor: THEME.accent,
  },
  ftpFavouriteMeta: {
    minWidth: 0,
  },
  ftpFavouriteHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  ftpBadge: {
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 11,
    border: `1px solid ${THEME.border}`,
    whiteSpace: 'nowrap',
  },
  ftpBadgeMounted: {
    color: THEME.ok,
    background: 'rgba(111, 159, 112, 0.12)',
    borderColor: 'rgba(111, 159, 112, 0.32)',
  },
  ftpBadgeError: {
    color: THEME.crimsonRed,
    background: 'rgba(196, 91, 91, 0.12)',
    borderColor: 'rgba(196, 91, 91, 0.32)',
  },
  ftpBadgeIdle: {
    color: THEME.muted,
    background: '#15181c',
  },
  ftpRowActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  ftpMenuCell: {
    position: 'relative',
  },
  ftpMenuButton: {
    minWidth: 36,
    padding: '7px 10px',
    fontSize: 12,
    letterSpacing: 1,
  },
  ftpMenu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    minWidth: 160,
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: 6,
    display: 'grid',
    gap: 4,
    zIndex: 20,
    boxShadow: '0 8px 24px rgba(0,0,0,0.24)',
  },
  ftpMenuItem: {
    justifyContent: 'flex-start',
    width: '100%',
    padding: '8px 10px',
    fontSize: 12,
  },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: THEME.text, fontSize: 13 },
  linkBtn: {
    display: 'inline-block',
    padding: '8px 12px',
    fontSize: 13,
    textDecoration: 'none',
  },
  quickLink: {
    display: 'grid',
    gap: 3,
    padding: '10px 12px',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: THEME.panelRaised,
    color: THEME.text,
    textDecoration: 'none',
  },
  bottomNav: {
    position: 'fixed',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    display: 'grid',
    gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))`,
    gap: 8,
    padding: '10px 12px 12px',
    borderTop: `1px solid ${THEME.border}`,
    background: '#15181c',
  },
  bottomNavBtn: {
    padding: '10px 8px',
    justifyContent: 'center',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  bottomNavBtnActive: {
    background: THEME.panelRaised,
    borderColor: THEME.border,
    color: THEME.text,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(7, 8, 10, 0.72)',
    display: 'grid',
    placeItems: 'center',
    zIndex: 90,
    padding: 16,
    overscrollBehavior: 'contain',
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 16,
  },
};
