'use client';

import type { CSSProperties, FormEvent, InputHTMLAttributes, ReactNode } from 'react';
import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { appFetch, getDemoTerminalLines } from './demo-api';
import { isDemoMode } from './demo-mode';
import { useGatewayBase } from './useGatewayBase';

const API = process.env.NEXT_PUBLIC_API || '/api';

const THEME = {
  accent: 'var(--accent)',
  accentFill: 'var(--accent-soft)',
  brightYellow: 'var(--warning)',
  crimsonRed: 'var(--danger)',
  darkPurple: 'var(--panel-raised)',
  bg: 'var(--background)',
  panel: 'var(--panel)',
  panelRaised: 'var(--panel-raised)',
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  ok: 'var(--ok)',
  border: 'var(--border)',
};

type TabKey = 'home' | 'media' | 'arr' | 'terminal' | 'filesystem' | 'ftp' | 'settings';
type Services = Record<string, boolean>;
type ServiceGroupKey = 'platform' | 'media' | 'arr' | 'data' | 'access';
type ServiceSurface = 'home' | 'media' | 'arr' | 'terminal' | 'settings' | 'ftp';

type ServiceCatalogEntry = {
  available: boolean;
  avgLatencyMs?: number | null;
  blocker?: string;
  controlMode: 'always_on' | 'optional';
  description: string;
  group: ServiceGroupKey;
  key: string;
  lastCheckedAt?: string | null;
  lastTransitionAt?: string | null;
  label: string;
  latencyMs?: number | null;
  placeholder: boolean;
  route?: string;
  status: 'working' | 'stopped' | 'stalled' | 'unavailable' | string;
  statusReason?: string | null;
  surface: ServiceSurface;
  uptimePct?: number | null;
};

type Monitor = {
  cpuCores: number;
  cpuLoad: number;
  device?: {
    androidVersion?: string | null;
    batteryPct?: number | null;
    charging?: boolean | null;
    wifiDbm?: number | null;
  };
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
  durationMs?: number;
  username: string;
  ip: string;
  port: string;
  protocol: string;
  sessionId?: string;
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
  id?: string;
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
  serviceCatalog?: ServiceCatalogEntry[];
  serviceGroups?: Partial<Record<ServiceGroupKey, string[]>>;
  serviceController?: {
    locked?: boolean;
    optionalServices?: string[];
  };
  monitor: Monitor;
  connections: {
    users: ConnectedUser[];
  };
  storage: {
    mounts: StorageMount[];
  };
  logs: {
    entries?: DebugLog[];
    logs: DebugLog[];
    markdown: string;
    verboseLoggingEnabled: boolean;
  };
};

type TelemetryPayload = {
  generatedAt: string;
  logs: {
    entries?: DebugLog[];
    logs?: DebugLog[];
    markdown?: string;
    verboseLoggingEnabled?: boolean;
  };
  monitor: Monitor;
  serviceCatalog?: ServiceCatalogEntry[];
  serviceController?: {
    locked?: boolean;
    optionalServices?: string[];
  };
  serviceGroups?: Partial<Record<ServiceGroupKey, string[]>>;
  services: Services;
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

type LayoutMode = 'desktop' | 'tablet' | 'mobile';
type ThemeMode = 'dark' | 'light' | 'contrast';
type BatteryManagerLike = {
  charging: boolean;
  level: number;
  addEventListener: (event: 'chargingchange' | 'levelchange', listener: () => void) => void;
  removeEventListener: (event: 'chargingchange' | 'levelchange', listener: () => void) => void;
};

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
  { key: 'home', label: 'Home' },
  { key: 'media', label: 'Media' },
  { key: 'arr', label: 'ARR' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'filesystem', label: 'Filesystem' },
  { key: 'ftp', label: 'FTP' },
  { key: 'settings', label: 'Settings' },
];

const TAB_KEYS = new Set<TabKey>(TABS.map(({ key }) => key));

const SERVICE_GROUP_LABELS: Record<ServiceGroupKey, string> = {
  access: 'Access',
  arr: 'ARR',
  data: 'Data',
  media: 'Media',
  platform: 'Platform',
};

const WORKFLOW_STEPS: Record<'media' | 'arr', string[]> = {
  media: ['Requests', 'Downloads', 'Library', 'Streaming'],
  arr: ['Indexer', 'Discovery', 'Download', 'Subtitle'],
};

const THEME_STORAGE_KEY = 'hmstx-theme';
const LOW_POWER_STORAGE_KEY = 'hmstx-low-power';
const ONBOARDING_STORAGE_KEY = 'hmstx-onboarded';
const DEMO_BANNER_STORAGE_KEY = 'hmstx-demo-banner-dismissed';
const COLLAPSE_STORAGE_KEY = 'hmstx-collapsed-sections';

const COMMAND_DOCS = [
  {
    id: 'docs-readme',
    label: 'Open project README',
    subtitle: 'Docs',
    value: 'https://github.com/Rushtu99/Home-Server-Termux/blob/main/README.md',
  },
  {
    id: 'docs-media',
    label: 'Open media stack status',
    subtitle: 'Docs',
    value: 'https://github.com/Rushtu99/Home-Server-Termux/blob/main/docs/media-stack-status.md',
  },
];

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

const fmtDuration = (durationMs = 0) => {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
};

const storageTone = (usePercent: number) => {
  if (usePercent >= 80) {
    return THEME.crimsonRed;
  }
  if (usePercent >= 60) {
    return THEME.brightYellow;
  }
  return THEME.accent;
};

const readCollapsedSections = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch {
    return {};
  }
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
  const demoMode = isDemoMode();
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('desktop');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [lowPowerMode, setLowPowerMode] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [services, setServices] = useState<Services>({});
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogEntry[]>([]);
  const [serviceGroups, setServiceGroups] = useState<Partial<Record<ServiceGroupKey, string[]>>>({});
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [connections, setConnections] = useState<ConnectedUser[]>([]);
  const [storage, setStorage] = useState<StorageMount[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const [lastTelemetryAt, setLastTelemetryAt] = useState(0);
  const [controlStatus, setControlStatus] = useState('');
  const [controlBusy, setControlBusy] = useState<Record<string, boolean>>({});
  const [serviceControllerLocked, setServiceControllerLocked] = useState(true);
  const [serviceUnlockBusy, setServiceUnlockBusy] = useState(false);
  const [serviceUnlockPassword, setServiceUnlockPassword] = useState('');
  const [verboseLogging, setVerboseLogging] = useState(false);
  const [logsMarkdown, setLogsMarkdown] = useState('');
  const [optionalServices, setOptionalServices] = useState<string[]>(['ftp', 'copyparty', 'syncthing', 'samba', 'sshd']);
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
  const [alertMessage, setAlertMessage] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showDemoBanner, setShowDemoBanner] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [connectionBusyId, setConnectionBusyId] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedUser | null>(null);

  const cpuCanvas = useRef<HTMLCanvasElement>(null);
  const ramCanvas = useRef<HTMLCanvasElement>(null);
  const ftpMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const fetchInFlightRef = useRef(false);
  const telemetryInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const tabSyncReadyRef = useRef(false);
  const previousStatusesRef = useRef<Record<string, string>>({});
  const gatewayBase = useGatewayBase();
  const isCompact = layoutMode !== 'desktop';
  const isPhone = layoutMode === 'mobile';
  const isTablet = layoutMode === 'tablet';
  const deferredCommandQuery = useDeferredValue(commandQuery);
  const deferredLogSearch = useDeferredValue(logSearch);

  const clearSession = (message = '') => {
    if (typeof window !== 'undefined') {
      void appFetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }

    if (!mountedRef.current) {
      return;
    }

    setIsAuthed(false);
    setAuthBusy(false);
    setSessionUser(null);
    setPassword('');
    setServices({});
    setServiceCatalog([]);
    setServiceGroups({});
    setMonitor(null);
    setConnections([]);
    setStorage([]);
    setDebugLogs([]);
    setCpuHistory([]);
    setRamHistory([]);
    setLastUpdated('');
    setControlStatus('');
    setControlBusy({});
    setServiceControllerLocked(true);
    setServiceUnlockBusy(false);
    setServiceUnlockPassword('');
    setOptionalServices(['ftp', 'copyparty', 'syncthing', 'samba', 'sshd']);
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
    appFetch(path, { ...init, credentials: init.credentials || 'include' });

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const res = await appFetch(`${API}/auth/me`, { credentials: 'include' });

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
    if (typeof window === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = storedTheme === 'light' || storedTheme === 'contrast' || storedTheme === 'dark'
      ? storedTheme
      : 'dark';
    const storedLowPower = window.localStorage.getItem(LOW_POWER_STORAGE_KEY) === 'true';
    const dismissedDemoBanner = window.localStorage.getItem(DEMO_BANNER_STORAGE_KEY) === 'true';
    const onboardingSeen = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
    const params = new URLSearchParams(window.location.search);

    root.dataset.theme = nextTheme;
    setThemeMode(nextTheme);
    setLowPowerMode(storedLowPower);
    setCollapsedSections(readCollapsedSections());
    setShowOnboarding(!onboardingSeen);
    setShowDemoBanner(demoMode && params.get('demo') !== 'false' && !dismissedDemoBanner);

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/service-worker.js`).catch(() => {});
    }
  }, [demoMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LOW_POWER_STORAGE_KEY, String(lowPowerMode));
    document.documentElement.dataset.lowPower = lowPowerMode ? 'true' : 'false';
  }, [lowPowerMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedSections));
  }, [collapsedSections]);

  useEffect(() => {
    const batteryNavigator = typeof navigator === 'undefined'
      ? null
      : navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

    if (!batteryNavigator || typeof batteryNavigator.getBattery !== 'function') {
      return;
    }

    let cleanup = () => {};

    batteryNavigator.getBattery().then((battery) => {
      const updatePowerMode = () => {
        if (battery.level < 0.2 && !battery.charging) {
          setLowPowerMode(true);
        }
      };

      updatePowerMode();
      battery.addEventListener('levelchange', updatePowerMode);
      battery.addEventListener('chargingchange', updatePowerMode);
      cleanup = () => {
        battery.removeEventListener('levelchange', updatePowerMode);
        battery.removeEventListener('chargingchange', updatePowerMode);
      };
    }).catch(() => {});

    return () => cleanup();
  }, []);

  useEffect(() => {
    if (!isAuthed || sessionUser?.role !== 'admin') {
      return;
    }

    const refreshTelemetry = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void fetchTelemetry();
    };

    void fetchDashboard();
    refreshTelemetry();

    const telemetryInterval = window.setInterval(
      refreshTelemetry,
      lowPowerMode ? 25000 : activeTab === 'home' ? 5000 : 9000
    );
    const dashboardInterval = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') {
          void fetchDashboard();
        }
      },
      lowPowerMode ? 90000 : 30000
    );
    document.addEventListener('visibilitychange', refreshTelemetry);

    return () => {
      window.clearInterval(telemetryInterval);
      window.clearInterval(dashboardInterval);
      document.removeEventListener('visibilitychange', refreshTelemetry);
    };
  }, [activeTab, isAuthed, lowPowerMode, sessionUser?.role]);

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
    if (lowPowerMode) {
      return;
    }
    drawTrend(cpuCanvas.current, cpuHistory, THEME.accent, THEME.accentFill);
  }, [cpuHistory, lowPowerMode]);

  useEffect(() => {
    if (lowPowerMode) {
      return;
    }
    drawTrend(ramCanvas.current, ramHistory, THEME.brightYellow, 'rgba(255,228,77,0.14)');
  }, [lowPowerMode, ramHistory]);

  useEffect(() => {
    if (!isAuthed || activeTab !== 'filesystem') {
      return;
    }

    void loadDriveConsole();
  }, [activeTab, isAuthed, sessionUser?.role]);

  const syncStatusTransitions = (entries: ServiceCatalogEntry[]) => {
    const previous = previousStatusesRef.current;
    const next = { ...previous };

    for (const entry of entries) {
      const priorStatus = previous[entry.key];
      next[entry.key] = entry.status;

      if (priorStatus === 'working' && entry.status !== 'working') {
        setAlertMessage(`${entry.label} needs attention`);
      }
    }

    previousStatusesRef.current = next;
  };

  const applyTelemetryPayload = (payload: TelemetryPayload | DashboardPayload) => {
    if (payload?.services && typeof payload.services === 'object') {
      setServices(payload.services || {});
    }

    const nextCatalog = Array.isArray(payload.serviceCatalog) ? payload.serviceCatalog : [];
    if (nextCatalog.length > 0) {
      setServiceCatalog(nextCatalog);
      syncStatusTransitions(nextCatalog);
    }
    if (payload.serviceGroups && typeof payload.serviceGroups === 'object') {
      setServiceGroups(payload.serviceGroups);
    }
    if (Array.isArray(payload.serviceController?.optionalServices)) {
      setOptionalServices(payload.serviceController.optionalServices);
    }
    if (typeof payload.serviceController?.locked === 'boolean') {
      setServiceControllerLocked(payload.serviceController.locked);
    }
    if (payload.monitor) {
      setMonitor(payload.monitor || null);
      const ramPercent = payload.monitor.totalMem > 0 ? (payload.monitor.usedMem / payload.monitor.totalMem) * 100 : 0;
      setCpuHistory((prev) => [...prev.slice(-39), payload.monitor.cpuLoad]);
      setRamHistory((prev) => [...prev.slice(-39), ramPercent]);
    }

    const nextLogs = Array.isArray(payload.logs?.entries)
      ? payload.logs.entries
      : Array.isArray(payload.logs?.logs)
        ? payload.logs.logs
        : [];
    setDebugLogs(nextLogs);
    setLogsMarkdown(typeof payload.logs?.markdown === 'string' ? payload.logs.markdown : '');
    setVerboseLogging(Boolean(payload.logs?.verboseLoggingEnabled));
    setLastTelemetryAt(Date.now());

    if (payload.generatedAt) {
      setLastUpdated(new Date(payload.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  };

  const applyDashboardPayload = (payload: DashboardPayload) => {
    applyTelemetryPayload(payload);
    setConnections(Array.isArray(payload.connections?.users) ? payload.connections.users : []);
    setStorage(Array.isArray(payload.storage?.mounts) ? payload.storage.mounts : []);
  };

  const syncServiceControllerState = async () => {
    if (sessionUser?.role !== 'admin') {
      return;
    }

    try {
      const res = await authFetch(`${API}/services`);
      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }
      if (!res.ok) {
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (payload?.services && typeof payload.services === 'object') {
        setServices(payload.services as Services);
      }
      setServiceCatalog(Array.isArray(payload?.serviceCatalog) ? payload.serviceCatalog : []);
      setServiceGroups(payload?.serviceGroups && typeof payload.serviceGroups === 'object' ? payload.serviceGroups : {});
      setServiceControllerLocked(payload?.controller?.locked !== false);
      if (Array.isArray(payload?.controller?.optionalServices) && payload.controller.optionalServices.length > 0) {
        setOptionalServices(payload.controller.optionalServices);
      }
    } catch {
      // Ignore controller state refresh failures.
    }
  };

  const fetchDashboard = async () => {
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

  const fetchTelemetry = async () => {
    if (sessionUser?.role !== 'admin') {
      return;
    }
    if (telemetryInFlightRef.current) {
      return;
    }

    telemetryInFlightRef.current = true;
    try {
      const res = await authFetch(`${API}/telemetry`);

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setControlStatus('Unable to refresh live telemetry');
        return;
      }

      const payload = await res.json().catch(() => null);
      if (payload) {
        startTransition(() => {
          applyTelemetryPayload(payload as TelemetryPayload);
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setControlStatus(`Telemetry fetch error: ${String(err)}`);
      }
    } finally {
      telemetryInFlightRef.current = false;
    }
  };

  const unlockServiceController = async () => {
    if (!serviceUnlockPassword.trim()) {
      setControlStatus('Enter the admin action password to unlock service controls');
      return;
    }

    setServiceUnlockBusy(true);
    setControlStatus('');
    try {
      const res = await authFetch(`${API}/control/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: serviceUnlockPassword }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setControlStatus(String(payload?.error || 'Unable to unlock service controls'));
        return;
      }

      setServiceControllerLocked(false);
      setServiceUnlockPassword('');
      setControlStatus('Service controls unlocked');
    } catch {
      setControlStatus('Unable to unlock service controls');
    } finally {
      if (mountedRef.current) {
        setServiceUnlockBusy(false);
      }
    }
  };

  const lockServiceController = async () => {
    setServiceUnlockBusy(true);
    setControlStatus('');
    try {
      const res = await authFetch(`${API}/control/lock`, {
        method: 'POST',
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setControlStatus(String(payload?.error || 'Unable to lock service controls'));
        return;
      }

      setServiceControllerLocked(true);
      setServiceUnlockPassword('');
      setControlStatus('Service controls locked');
    } catch {
      setControlStatus('Unable to lock service controls');
    } finally {
      if (mountedRef.current) {
        setServiceUnlockBusy(false);
      }
    }
  };

  const executeControl = async (service: string, action: string) => {
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
      }
    } catch {
      setControlStatus(`Unable to ${action} ${service}`);
    } finally {
      setControlBusy((prev) => ({ ...prev, [key]: false }));
      void syncServiceControllerState();
    }
  };

  const toggleTheme = () => {
    setThemeMode((current) => current === 'dark' ? 'light' : current === 'light' ? 'contrast' : 'dark');
  };

  const dismissOnboarding = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    }
    setShowOnboarding(false);
  };

  const dismissDemoBanner = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DEMO_BANNER_STORAGE_KEY, 'true');
    }
    setShowDemoBanner(false);
  };

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  const exportLogs = () => {
    if (typeof window === 'undefined') {
      return;
    }

    const filtered = debugLogs.filter((entry) => {
      const matchesLevel = logFilter === 'all' || entry.level === logFilter;
      const haystack = `${entry.message} ${entry.meta ? JSON.stringify(entry.meta) : ''}`.toLowerCase();
      const matchesQuery = !deferredLogSearch.trim() || haystack.includes(deferredLogSearch.trim().toLowerCase());
      return matchesLevel && matchesQuery;
    });
    const blob = new Blob(
      [
        filtered.map((entry) => {
          const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
          return `[${entry.timestamp}] ${String(entry.level).toUpperCase()} ${entry.message}${meta}`;
        }).join('\n'),
      ],
      { type: 'text/plain;charset=utf-8' }
    );
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hmstx-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const disconnectConnection = async (user: ConnectedUser) => {
    if (!user.sessionId) {
      setDisconnectTarget(null);
      return;
    }

    setConnectionBusyId(user.sessionId);
    try {
      const res = await authFetch(`${API}/connections/${user.sessionId}/disconnect`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setUserStatus(String(payload?.error || 'Unable to disconnect session'));
        return;
      }

      setConnections((current) => current.filter((entry) => entry.sessionId !== user.sessionId));
      setUserStatus(`Disconnected ${payload?.username || user.username}`);
    } catch {
      setUserStatus('Unable to disconnect session');
    } finally {
      setConnectionBusyId(null);
      setDisconnectTarget(null);
    }
  };

  const statusToneStyle = (status: string): CSSProperties => {
    if (status === 'working') {
      return styles.serviceStatusOk;
    }
    if (status === 'stopped') {
      return styles.serviceStatusIdle;
    }
    if (status === 'unavailable') {
      return styles.serviceStatusUnavailable;
    }
    return styles.serviceStatusWarn;
  };

  const renderServiceCard = (entry: ServiceCatalogEntry) => {
    const linkHref = buildServiceHref(entry.route);
    const statusLabel = entry.status === 'working'
      ? 'Working'
      : entry.status === 'stopped'
        ? 'Stopped'
        : entry.status === 'unavailable'
          ? 'Unavailable'
          : 'Needs attention';
    const canOperate = sessionUser?.role === 'admin' && entry.available;
    const isRunning = entry.status === 'working';
    const startBusy = Boolean(controlBusy[`${entry.key}:start`]);
    const restartBusy = Boolean(controlBusy[`${entry.key}:restart`]);
    const statsLine = entry.uptimePct != null || entry.avgLatencyMs != null
      ? `${entry.uptimePct != null ? `${entry.uptimePct.toFixed(1)}% uptime` : 'No uptime history'} · ${entry.avgLatencyMs != null ? `${entry.avgLatencyMs}ms avg` : 'No latency'}`
      : 'Waiting for service history';
    const tooltip = `${entry.label}\n${entry.statusReason || statusLabel}${entry.lastCheckedAt ? `\nLast checked: ${fmtDateTime(entry.lastCheckedAt)}` : ''}${entry.lastTransitionAt ? `\nLast transition: ${fmtDateTime(entry.lastTransitionAt)}` : ''}`;

    return (
      <article key={entry.key} style={styles.serviceCard} title={tooltip}>
        <div style={styles.serviceCardHead}>
          <div>
            <h3 style={styles.serviceCardTitle}>{entry.label}</h3>
            <p style={styles.serviceCardDescription}>{entry.description}</p>
          </div>
          <span style={{ ...styles.serviceStatusBadge, ...statusToneStyle(entry.status) }}>{statusLabel}</span>
        </div>
        <p style={styles.serviceCardMeta}>
          {SERVICE_GROUP_LABELS[entry.group]} · {entry.controlMode === 'optional' ? 'Optional service' : 'Core service'}
        </p>
        <p style={styles.serviceCardStats}>{statsLine}</p>
        {entry.statusReason ? <p style={styles.serviceCardReason}>{entry.statusReason}</p> : null}
        {entry.blocker ? <p style={{ ...styles.smallLabel, color: entry.status === 'unavailable' ? THEME.brightYellow : THEME.muted }}>{entry.blocker}</p> : null}
        <div style={styles.serviceCardActions}>
          {linkHref ? (
            <a href={linkHref} target="_blank" rel="noreferrer" className="ui-button" style={styles.linkBtn}>
              Open
            </a>
          ) : null}
          {canOperate && entry.controlMode === 'always_on' ? (
            <>
              {!isRunning ? (
                <button className="ui-button" style={styles.actionBtn} type="button" disabled={startBusy} aria-label={`Start ${entry.label}`} onClick={() => void executeControl(entry.key, 'start')}>
                  {startBusy ? 'Starting…' : 'Start'}
                </button>
              ) : null}
              <button className="ui-button" style={styles.actionBtn} type="button" disabled={restartBusy} aria-label={`Restart ${entry.label}`} onClick={() => void executeControl(entry.key, 'restart')}>
                {restartBusy ? 'Restarting…' : 'Restart'}
              </button>
            </>
          ) : null}
        </div>
      </article>
    );
  };

  const renderWorkflowStrip = (surface: 'media' | 'arr') => (
    <div style={styles.workflowStrip} aria-label={`${surface} workflow`}>
      {WORKFLOW_STEPS[surface].map((step, index) => (
        <div key={step} style={styles.workflowStep}>
          <span style={styles.workflowIndex}>{index + 1}</span>
          <span>{step}</span>
        </div>
      ))}
    </div>
  );

  const serviceCatalogByKey = new Map(serviceCatalog.map((entry) => [entry.key, entry]));
  const serviceSurfaceEntries = (surface: ServiceSurface) => serviceCatalog.filter((entry) => entry.surface === surface);
  const homeGroups = (['platform', 'data', 'access'] as const)
    .map((group) => ({
      group,
      items: (serviceGroups[group] || [])
        .map((key) => serviceCatalogByKey.get(key))
        .filter((entry): entry is ServiceCatalogEntry => Boolean(entry))
        .filter((entry) => entry.surface === 'home'),
    }))
    .filter((entry) => entry.items.length > 0);
  const mediaServices = serviceSurfaceEntries('media');
  const arrServices = serviceSurfaceEntries('arr');
  const mediaHealthyCount = mediaServices.filter((entry) => entry.status === 'working').length;
  const arrHealthyCount = arrServices.filter((entry) => entry.status === 'working').length;
  const optionalServiceEntries = optionalServices
    .map((name) => serviceCatalogByKey.get(name))
    .filter((entry): entry is ServiceCatalogEntry => Boolean(entry));
  const controllableServices = optionalServiceEntries.filter((entry) => entry.available);
  const buildServiceHref = (route?: string) => (route && gatewayBase ? `${gatewayBase}${route}` : '');
  const catalogRunningServices = serviceCatalog.filter((entry) => entry.status === 'working').length;
  const usedMemPct = monitor ? Math.min((monitor.totalMem > 0 ? (monitor.usedMem / monitor.totalMem) * 100 : 0), 100) : 0;
  const runningServices = catalogRunningServices || Object.values(services).filter(Boolean).length;
  const totalServices = serviceCatalog.length || Object.keys(services).length || 4;
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
  const mountedFtpFavourites = ftpFavourites.filter((favourite) => favourite.mount?.mounted).length;
  const terminalService = serviceCatalogByKey.get('ttyd') || null;
  const telemetryStale = lastTelemetryAt > 0 && Date.now() - lastTelemetryAt > (lowPowerMode ? 60000 : 20000);
  const filteredLogs = debugLogs.filter((entry) => {
    const matchesLevel = logFilter === 'all' || entry.level === logFilter;
    const haystack = `${entry.message} ${entry.meta ? JSON.stringify(entry.meta) : ''}`.toLowerCase();
    const matchesQuery = !deferredLogSearch.trim() || haystack.includes(deferredLogSearch.trim().toLowerCase());
    return matchesLevel && matchesQuery;
  });
  const paletteItems = [
    ...serviceCatalog.map((entry) => ({
      id: `service:${entry.key}`,
      kind: 'service' as const,
      label: entry.label,
      subtitle: SERVICE_GROUP_LABELS[entry.group],
      run: () => {
        if (entry.surface === 'media' || entry.surface === 'arr' || entry.surface === 'terminal' || entry.surface === 'ftp') {
          setActiveTab(entry.surface);
        } else {
          setActiveTab('home');
        }
        setCommandPaletteOpen(false);
      },
    })),
    {
      id: 'action:theme',
      kind: 'action' as const,
      label: 'Toggle theme',
      subtitle: 'Action',
      run: () => {
        toggleTheme();
        setCommandPaletteOpen(false);
      },
    },
    {
      id: 'action:telemetry',
      kind: 'action' as const,
      label: 'Refresh telemetry',
      subtitle: 'Action',
      run: () => {
        void fetchTelemetry();
        setCommandPaletteOpen(false);
      },
    },
    {
      id: 'action:logs',
      kind: 'action' as const,
      label: 'Download filtered logs',
      subtitle: 'Action',
      run: () => {
        exportLogs();
        setCommandPaletteOpen(false);
      },
    },
    ...COMMAND_DOCS.map((item) => ({
      id: item.id,
      kind: 'docs' as const,
      label: item.label,
      subtitle: item.subtitle,
      run: () => {
        if (typeof window !== 'undefined') {
          window.open(item.value, '_blank', 'noreferrer');
        }
        setCommandPaletteOpen(false);
      },
    })),
  ].filter((item) => {
    const query = deferredCommandQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    if (query.startsWith('>') && item.kind !== 'action') {
      return false;
    }
    if (query.startsWith('/') && item.kind !== 'docs') {
      return false;
    }
    const cleanQuery = query.replace(/^[>/]\s*/, '');
    return `${item.label} ${item.subtitle}`.toLowerCase().includes(cleanQuery);
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (!commandPaletteOpen) {
        if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && isPhone) {
          event.preventDefault();
          const currentIndex = TABS.findIndex((entry) => entry.key === activeTab);
          const nextIndex = event.key === 'ArrowRight'
            ? (currentIndex + 1) % TABS.length
            : (currentIndex - 1 + TABS.length) % TABS.length;
          setActiveTab(TABS[nextIndex].key);
        }
        return;
      }

      if (event.key === 'Escape') {
        setCommandPaletteOpen(false);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPaletteIndex((current) => Math.min(current + 1, Math.max(0, paletteItems.length - 1)));
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPaletteIndex((current) => Math.max(current - 1, 0));
      }

      if (event.key === 'Enter') {
        const current = paletteItems[paletteIndex];
        if (current) {
          event.preventDefault();
          current.run();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, commandPaletteOpen, isPhone, paletteIndex, paletteItems]);

  useEffect(() => {
    if (paletteIndex >= paletteItems.length) {
      setPaletteIndex(0);
    }
  }, [paletteIndex, paletteItems.length]);

  const navButtonLabel = (tab: TabKey) => {
    if (!isTablet) {
      return TABS.find((entry) => entry.key === tab)?.label || tab;
    }

    switch (tab) {
      case 'home':
        return 'Home';
      case 'media':
        return 'Media';
      case 'arr':
        return 'ARR';
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
      const res = await appFetch(`${API}/auth/login`, {
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
      void fetchDashboard();
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
      void fetchTelemetry();
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
    return (
      <div style={styles.loading} role="status" aria-live="polite">
        <div style={styles.skeletonShell}>
          <div style={styles.skeletonHeader} />
          <div style={styles.skeletonGrid}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`metric-${index}`} style={styles.skeletonCard} />
            ))}
          </div>
          <div style={styles.skeletonSplit}>
            <div style={{ ...styles.skeletonCard, minHeight: 220 }} />
            <div style={{ ...styles.skeletonCard, minHeight: 220 }} />
          </div>
          <div style={styles.skeletonGrid}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`service-${index}`} style={{ ...styles.skeletonCard, minHeight: 96 }} />
            ))}
          </div>
        </div>
      </div>
    );
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
        <div style={styles.utilityBar}>
          <div style={styles.utilityMeta}>
            <span style={styles.headerPill}>{themeMode}</span>
            <span style={styles.headerPill}>{lowPowerMode ? 'Low-power on' : 'Live polling'}</span>
            <span style={{ ...styles.headerPill, ...(telemetryStale ? styles.headerPillWarn : {}) }}>
              {telemetryStale ? 'Telemetry stale' : 'Telemetry live'}
            </span>
          </div>
          <div style={styles.utilityActions}>
            <button className="ui-button" type="button" style={styles.actionBtn} onClick={toggleTheme} aria-label="Toggle theme">
              Theme
            </button>
            <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => setLowPowerMode((current) => !current)} aria-label="Toggle low power mode">
              {lowPowerMode ? 'Normal' : 'Low-Power'}
            </button>
            <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => setCommandPaletteOpen(true)} aria-label="Open command palette">
              Search
            </button>
            <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => setShowOnboarding(true)} aria-label="Open onboarding help">
              Help
            </button>
          </div>
        </div>

        {showDemoBanner ? (
          <div style={styles.bannerWarn} role="status" aria-live="polite">
            <div>
              <strong>Demo mode active.</strong> Service controls, telemetry, and file actions are simulated for the Pages preview.
            </div>
            <button className="ui-button" type="button" style={styles.actionBtn} onClick={dismissDemoBanner}>
              Dismiss
            </button>
          </div>
        ) : null}

        {alertMessage ? (
          <div style={styles.bannerAlert} role="alert" aria-live="assertive">
            <div>{alertMessage}</div>
            <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => setAlertMessage('')}>
              Dismiss
            </button>
          </div>
        ) : null}

        {activeTab === 'home' && (
          <div>
            <div style={styles.headerBar}>
              <div>
                <h1 style={styles.title}>Home</h1>
              </div>
              <div style={styles.headerMeta}>
                <span style={styles.headerPill}>{lastUpdated ? `Updated ${lastUpdated}` : 'Waiting for telemetry'}</span>
                <span style={styles.headerPill}>{runningServices}/{totalServices} services</span>
                <span style={styles.headerPill}>{connections.length} clients</span>
                {monitor?.device?.batteryPct != null ? <span style={styles.headerPill}>Battery {monitor.device.batteryPct}%{monitor.device.charging ? ' charging' : ''}</span> : null}
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
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Wi-Fi</span><strong>{monitor?.device?.wifiDbm != null ? `${monitor.device.wifiDbm} dBm` : '--'}</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Battery</span><strong>{monitor?.device?.batteryPct != null ? `${monitor.device.batteryPct}%${monitor.device.charging ? ' ⚡' : ''}` : '--'}</strong></div>
                    <div style={styles.keyValueRow}><span style={styles.keyLabel}>Android</span><strong>{monitor?.device?.androidVersion || '--'}</strong></div>
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
                  <Progress label="Storage used" value={usedStoragePct} />
                  <div style={styles.mountList}>
                    {storage.slice(0, 6).map((mount) => (
                      <div key={`${mount.filesystem}-${mount.mount}`} style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>{mount.mount}</strong>
                          <p style={styles.mountMeta}>{mount.filesystem} {mount.fsType ? `(${mount.fsType})` : ''} {mount.category ? `- ${mount.category}` : ''}</p>
                        </div>
                        <div style={styles.mountRight}>
                          <span style={{ color: storageTone(mount.usePercent) }}>{mount.usePercent}%</span>
                          <span style={styles.mountMeta}>{fmtBytes(mount.used)} / {fmtBytes(mount.size)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>All Services</h3>
                      <p style={styles.smallLabel}>Grouped service health and maintenance access for the running stack.</p>
                    </div>
                    <span style={styles.headerPill}>{serviceCatalog.length} listed</span>
                  </div>
                  <div style={styles.serviceGroupStack}>
                    {homeGroups.map(({ group, items }) => (
                      <section key={group} style={styles.serviceGroupSection}>
                        <div style={styles.serviceGroupHeader}>
                          <button className="ui-button" style={styles.groupToggle} type="button" onClick={() => toggleSection(`home:${group}`)}>
                            {SERVICE_GROUP_LABELS[group]}
                          </button>
                          <span style={styles.smallLabel}>{items.length} services</span>
                        </div>
                        <div style={{ ...styles.serviceCardGrid, ...(collapsedSections[`home:${group}`] ? styles.collapsedSection : {}) }}>
                          {items.map((entry) => renderServiceCard(entry))}
                        </div>
                      </section>
                    ))}
                  </div>
                </article>
              </div>

              <div style={styles.homeSecondary}>
                <article style={styles.card}>
                  <div style={styles.logControlRow}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Optional Services</h3>
                    <button className="ui-button" style={styles.linkBtn} type="button" onClick={() => void (serviceControllerLocked ? unlockServiceController() : lockServiceController())} disabled={serviceUnlockBusy}>
                      {serviceControllerLocked ? 'Unlock' : 'Lock'}
                    </button>
                  </div>
                  <div style={styles.serviceControllerCard}>
                    {serviceControllerLocked ? (
                      <div style={styles.serviceLockOverlay} aria-hidden={false}>
                        <div style={styles.serviceLockBadge}>Locked</div>
                        <p style={{ ...styles.smallLabel, marginBottom: 10 }}>Enter the admin action password once to unlock optional services for this session.</p>
                        <TextField
                          id="service-unlock-password"
                          label="Admin Action Password"
                          name="serviceUnlockPassword"
                          type="password"
                          autoComplete="current-password"
                          value={serviceUnlockPassword}
                          onChange={setServiceUnlockPassword}
                        />
                        <button className="ui-button ui-button--primary" style={styles.actionBtn} type="button" onClick={() => void unlockServiceController()} disabled={serviceUnlockBusy}>
                          {serviceUnlockBusy ? 'Unlocking…' : 'Unlock Controls'}
                        </button>
                      </div>
                    ) : null}
                    {controllableServices.length === 0 ? (
                      <p style={styles.smallLabel}>No optional services are available on this host.</p>
                    ) : controllableServices.map((entry) => (
                      <div key={entry.key} style={{ ...styles.serviceRow, opacity: serviceControllerLocked ? 0.35 : 1 }}>
                        <div style={styles.serviceRowCopy}>
                          <span style={styles.serviceName}>
                            {entry.label}
                            <span style={{ ...styles.dot, background: entry.status === 'working' ? THEME.ok : THEME.crimsonRed }} />
                          </span>
                          <span style={styles.serviceRowMeta}>{entry.description}</span>
                        </div>
                        <div style={styles.actionWrap}>
                          <button className="ui-button" disabled={serviceControllerLocked || !!controlBusy[`${entry.key}:start`]} style={styles.actionBtn} type="button" onClick={() => void executeControl(entry.key, 'start')}>Start</button>
                          <button className="ui-button" disabled={serviceControllerLocked || !!controlBusy[`${entry.key}:stop`]} style={styles.actionBtn} type="button" onClick={() => void executeControl(entry.key, 'stop')}>Stop</button>
                          <button className="ui-button" disabled={serviceControllerLocked || !!controlBusy[`${entry.key}:restart`]} style={styles.actionBtn} type="button" onClick={() => void executeControl(entry.key, 'restart')}>Restart</button>
                        </div>
                      </div>
                    ))}
                  </div>
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
                          <th style={styles.th}>Duration</th>
                          <th style={styles.th}>Last Seen</th>
                          <th style={styles.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {connections.length === 0 && (
                          <tr>
                            <td style={styles.td} colSpan={6}>No active users</td>
                          </tr>
                        )}
                        {connections.map((user, idx) => (
                          <tr key={`${user.ip}-${user.port}-${idx}`}>
                            <td style={styles.td}>{user.username}</td>
                            <td style={styles.td}>{user.ip}</td>
                            <td style={styles.td}>{user.protocol}</td>
                            <td style={styles.td}>{fmtDuration(user.durationMs)}</td>
                            <td style={styles.td}>{fmtTime(user.lastSeen)}</td>
                            <td style={styles.td}>
                              {user.sessionId ? (
                                <button
                                  className="ui-button"
                                  style={styles.actionBtn}
                                  type="button"
                                  disabled={connectionBusyId === user.sessionId}
                                  onClick={() => setDisconnectTarget(user)}
                                >
                                  {connectionBusyId === user.sessionId ? 'Disconnecting…' : 'Disconnect'}
                                </button>
                              ) : (
                                <span style={styles.smallLabel}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>

                <article style={styles.card}>
                  <div style={styles.logControlRow}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Debug Log</h3>
                    <div style={styles.actionWrap}>
                      <button className="ui-button" style={styles.linkBtn} type="button" onClick={() => toggleVerboseLogging(!verboseLogging)}>
                        {verboseLogging ? 'Disable Verbose' : 'Enable Verbose'}
                      </button>
                      <button className="ui-button" style={styles.actionBtn} type="button" onClick={exportLogs}>
                        Download
                      </button>
                    </div>
                  </div>
                  <div style={styles.logFilters}>
                    <input
                      className="ui-input"
                      type="search"
                      placeholder="Filter logs"
                      value={logSearch}
                      onChange={(event) => setLogSearch(event.target.value)}
                    />
                    {(['all', 'info', 'warn', 'error'] as const).map((level) => (
                      <button
                        key={level}
                        className="ui-button"
                        type="button"
                        style={{ ...styles.actionBtn, ...(logFilter === level ? styles.navBtnActive : {}) }}
                        onClick={() => setLogFilter(level)}
                      >
                        {level.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div style={styles.logBoxCompact}>
                    {filteredLogs.length === 0 && <p style={styles.smallLabel}>No debug events yet.</p>}
                    {filteredLogs.slice(0, 60).map((log, idx) => (
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
            meta={[terminalService ? `ttyd ${terminalService.status}` : 'ttyd status unknown']}
            frameTitle="Embedded Terminal"
            path="/term/"
            gatewayBase={gatewayBase}
            isCompact={isCompact}
            demoMode={demoMode}
          />
        )}

        {activeTab === 'filesystem' && (
          <Panel
            title="Filesystem"
            subtitle="Drive state, drive health, and a direct path into the full workspace."
            meta={[filesystemStatus, `${dashboardShares.length} shortcuts`]}
          >
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

        {activeTab === 'media' && (
          <Panel
            title="Media"
            subtitle="Streaming, downloads, requests, and media-side infrastructure."
            meta={[`${mediaHealthyCount}/${mediaServices.length} healthy`, `${storage.find((entry) => entry.category === 'media') ? 'Media storage online' : 'Media storage unknown'}`]}
          >
            <div style={styles.surfaceStack}>
              <article style={styles.card}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Workflow</h3>
                    <p style={styles.smallLabel}>Requests move through downloads into the library and then into playback clients.</p>
                  </div>
                  <span style={styles.headerPill}>{mediaHealthyCount}/{mediaServices.length} healthy</span>
                </div>
                {renderWorkflowStrip('media')}
              </article>

              <article style={styles.card}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Media Services</h3>
                    <p style={styles.smallLabel}>Streaming, downloads, and requests stay grouped here so the stack reads like one workflow.</p>
                  </div>
                  <button className="ui-button" style={styles.groupToggle} type="button" onClick={() => toggleSection('media:stack')}>
                    {collapsedSections['media:stack'] ? 'Expand' : 'Collapse'}
                  </button>
                </div>
                <div style={{ ...styles.serviceCardGrid, ...(collapsedSections['media:stack'] ? styles.collapsedSection : {}) }}>
                  {mediaServices.map((entry) => renderServiceCard(entry))}
                </div>
              </article>
            </div>
          </Panel>
        )}

        {activeTab === 'arr' && (
          <Panel
            title="ARR"
            subtitle="Indexer, discovery, and automation services for the media pipeline."
            meta={[`${arrHealthyCount}/${arrServices.length} healthy`, `${arrServices.filter((entry) => entry.placeholder).length} placeholders`]}
          >
            <div style={styles.surfaceStack}>
              <article style={styles.card}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Workflow</h3>
                    <p style={styles.smallLabel}>Indexer management, discovery, and download handoff stay visible in one strip.</p>
                  </div>
                  <span style={styles.headerPill}>{arrHealthyCount}/{arrServices.length} healthy</span>
                </div>
                {renderWorkflowStrip('arr')}
              </article>

              <article style={styles.card}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>ARR Services</h3>
                    <p style={styles.smallLabel}>These services are expected to stay up. Restart them here without putting them in the generic controller.</p>
                  </div>
                  <button className="ui-button" style={styles.groupToggle} type="button" onClick={() => toggleSection('arr:stack')}>
                    {collapsedSections['arr:stack'] ? 'Expand' : 'Collapse'}
                  </button>
                </div>
                <div style={{ ...styles.serviceCardGrid, ...(collapsedSections['arr:stack'] ? styles.collapsedSection : {}) }}>
                  {arrServices.map((entry) => renderServiceCard(entry))}
                </div>
              </article>
            </div>
          </Panel>
        )}

        {activeTab === 'ftp' && (
          <Panel
            title="FTP"
            subtitle="Save remotes, browse them directly, and mount them into ~/Drives when this host allows it."
            meta={[`${ftpFavourites.length} favourites`, `${mountedFtpFavourites} mounted`]}
          >
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
          <Panel
            title="Settings"
            subtitle="Session, logging, and diagnostics controls."
            meta={[`Signed in as ${sessionUser?.username || 'unknown'}`, `Role: ${sessionUser?.role || 'user'}`]}
          >
            <div style={styles.surfaceStack}>
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Session</h3>
                <p style={styles.smallLabel}>Session access is cookie-based and invalidates on logout or timeout.</p>
                <div style={styles.actionWrap}>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={toggleTheme}>Cycle Theme</button>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => setLowPowerMode((current) => !current)}>
                    {lowPowerMode ? 'Disable Low-Power' : 'Enable Low-Power'}
                  </button>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => clearSession()}>Log Out Everywhere Here</button>
                </div>
              </div>

              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Logging</h3>
                <p style={styles.smallLabel}>Verbose mode keeps richer audit and service transition entries in the dashboard log.</p>
                <div style={styles.actionWrap}>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleVerboseLogging(true)}>Enable Verbose</button>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleVerboseLogging(false)}>Disable Verbose</button>
                </div>
              </div>

              {sessionUser?.role === 'admin' ? (
                <div style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Users</h3>
                    <span style={styles.smallLabel}>{managedUsers.length} managed users</span>
                  </div>
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
                </div>
              ) : null}
            </div>
          </Panel>
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

      {commandPaletteOpen && (
        <div style={styles.modalOverlay} onClick={() => setCommandPaletteOpen(false)}>
          <div style={{ ...styles.modalCard, maxWidth: 640 }} onClick={(event) => event.stopPropagation()}>
            <div style={styles.sectionHeader}>
              <div>
                <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Command Palette</h3>
                <p style={styles.smallLabel}>Search services, actions, and docs. Use <code>Ctrl/Cmd+K</code>, <code>&gt;</code>, or <code>/</code>.</p>
              </div>
              <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => setCommandPaletteOpen(false)}>
                Close
              </button>
            </div>
            <input
              autoFocus
              className="ui-input"
              type="search"
              placeholder="Search services, actions, and docs"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
            />
            <div style={styles.paletteList}>
              {paletteItems.length === 0 ? (
                <p style={styles.smallLabel}>No matches.</p>
              ) : paletteItems.map((item, index) => (
                <button
                  key={item.id}
                  className="ui-button"
                  type="button"
                  style={{ ...styles.paletteItem, ...(paletteIndex === index ? styles.paletteItemActive : {}) }}
                  onClick={item.run}
                >
                  <span>{item.label}</span>
                  <span style={styles.smallLabel}>{item.subtitle}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showOnboarding && (
        <div style={styles.modalOverlay} onClick={dismissOnboarding}>
          <div style={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 style={styles.cardTitle}>Welcome to HmSTx</h3>
            <div style={styles.surfaceStack}>
              <div style={styles.quickLink}>
                <strong>Monitor the host</strong>
                <span>Track CPU, memory, storage, and Android-side device health from one screen.</span>
              </div>
              <div style={styles.quickLink}>
                <strong>Operate optional services</strong>
                <span>Unlock the controller once per session, then start, stop, or restart optional services safely.</span>
              </div>
              <div style={styles.quickLink}>
                <strong>Search quickly</strong>
                <span>Use Ctrl/Cmd+K to jump to services, run actions, and open docs without hunting through tabs.</span>
              </div>
            </div>
            <div style={{ ...styles.actionWrap, marginTop: 16 }}>
              <button className="ui-button ui-button--primary" type="button" style={styles.actionBtn} onClick={dismissOnboarding}>
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}

      {disconnectTarget && (
        <div style={styles.modalOverlay} onClick={() => setDisconnectTarget(null)}>
          <div style={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <h3 style={styles.cardTitle}>Disconnect session</h3>
            <p style={styles.smallLabel}>
              Disconnect {disconnectTarget.username} at {disconnectTarget.ip} from the dashboard session list?
            </p>
            <div style={styles.actionWrap}>
              <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => setDisconnectTarget(null)}>
                Cancel
              </button>
              <button className="ui-button ui-button--primary" type="button" style={styles.actionBtn} onClick={() => void disconnectConnection(disconnectTarget)}>
                Confirm
              </button>
            </div>
          </div>
        </div>
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
  const fill = safeValue >= 85 ? THEME.crimsonRed : safeValue >= 70 ? THEME.brightYellow : THEME.accent;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={styles.progressLabel}>
        <span>{label}</span>
        <span>{safeValue.toFixed(0)}%</span>
      </div>
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, background: fill, width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function EmbeddedToolPanel({
  title,
  subtitle,
  meta = [],
  frameTitle,
  path,
  gatewayBase,
  isCompact,
  demoMode,
}: {
  title: string;
  subtitle?: string;
  meta?: string[];
  frameTitle: string;
  path: string;
  gatewayBase: string;
  isCompact: boolean;
  demoMode: boolean;
}) {
  const frameSrc = gatewayBase ? `${gatewayBase}${path}` : '';

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      meta={meta}
      action={gatewayBase ? (
        <a href={frameSrc} target="_blank" rel="noreferrer" className="ui-button" style={styles.linkBtn}>
          Open In New Tab
        </a>
      ) : (
        <span style={styles.smallLabel}>Resolving gateway…</span>
      )}
    >
      {demoMode ? (
        <div style={{ ...styles.framePlaceholder, ...(isCompact ? styles.frameCompact : {}) }} role="img" aria-label="Demo terminal output">
          <pre style={styles.demoTerminal}>{getDemoTerminalLines().join('\n')}</pre>
        </div>
      ) : gatewayBase ? (
        <iframe title={frameTitle} src={frameSrc} style={{ ...styles.frame, ...(isCompact ? styles.frameCompact : {}) }} />
      ) : (
        <div style={styles.framePlaceholder} role="status" aria-live="polite">
          Gateway is still resolving. This view will load automatically.
        </div>
      )}
    </Panel>
  );
}

function Panel({
  title,
  subtitle,
  meta = [],
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: string[];
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div style={styles.pageHeader}>
        <div style={styles.pageHeaderCopy}>
          <h1 style={styles.title}>{title}</h1>
          {subtitle ? <p style={styles.panelSubtitle}>{subtitle}</p> : null}
        </div>
        {(meta.length > 0 || action) ? (
          <div style={styles.pageHeaderSide}>
            {meta.length > 0 ? (
              <div style={styles.headerMeta}>
                {meta.map((item) => (
                  <span key={item} style={styles.headerPill}>{item}</span>
                ))}
              </div>
            ) : null}
            {action ? <div style={styles.pageHeaderAction}>{action}</div> : null}
          </div>
        ) : null}
      </div>
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
  ctx.fillStyle = '#121519';
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

  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(184,139,69,0.45)';
  ctx.beginPath();
  ctx.moveTo(0, h - (70 / max) * (h - 12) - 6);
  ctx.lineTo(w, h - (70 / max) * (h - 12) - 6);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '11px var(--font-geist-mono), monospace';
  ctx.fillText('100%', 8, 14);
  ctx.fillText('50%', 8, h / 2);
  ctx.fillText('0%', 8, h - 8);

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

  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.28;
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

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
    padding: 24,
  },
  skeletonShell: {
    width: 'min(1120px, 100%)',
    display: 'grid',
    gap: 16,
  },
  skeletonHeader: {
    height: 44,
    borderRadius: 10,
    border: `1px solid ${THEME.border}`,
    background: THEME.panel,
    animation: 'hmstx-pulse 1.4s ease-in-out infinite',
  },
  skeletonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16,
  },
  skeletonSplit: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 16,
  },
  skeletonCard: {
    minHeight: 88,
    borderRadius: 10,
    border: `1px solid ${THEME.border}`,
    background: THEME.panel,
    animation: 'hmstx-pulse 1.4s ease-in-out infinite',
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
  utilityBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  utilityMeta: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  utilityActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: { margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: THEME.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  panelSubtitle: { margin: '0 0 16px', color: THEME.muted, fontSize: 12, maxWidth: 680, overflowWrap: 'anywhere' },
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  pageHeaderCopy: {
    minWidth: 0,
    flex: '1 1 420px',
  },
  pageHeaderSide: {
    display: 'grid',
    justifyItems: 'end',
    gap: 10,
    minWidth: 0,
  },
  pageHeaderAction: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
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
  headerPillWarn: {
    color: THEME.brightYellow,
    borderColor: 'rgba(184, 139, 69, 0.32)',
  },
  bannerWarn: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    padding: '10px 12px',
    border: `1px solid rgba(184, 139, 69, 0.32)`,
    borderRadius: 10,
    background: 'rgba(184, 139, 69, 0.12)',
    color: THEME.text,
  },
  bannerAlert: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    padding: '10px 12px',
    border: `1px solid rgba(196, 91, 91, 0.32)`,
    borderRadius: 10,
    background: 'rgba(196, 91, 91, 0.12)',
    color: THEME.text,
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
  serviceRowCopy: {
    display: 'grid',
    gap: 4,
    minWidth: 0,
    flex: '1 1 auto',
  },
  serviceRowMeta: {
    color: THEME.muted,
    fontSize: 12,
    overflowWrap: 'anywhere',
  },
  serviceName: { textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 8 },
  serviceControllerCard: {
    position: 'relative',
    display: 'grid',
    gap: 10,
  },
  serviceLockOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    display: 'grid',
    alignContent: 'center',
    gap: 10,
    padding: 16,
    background: 'rgba(17, 19, 21, 0.86)',
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
  },
  serviceLockBadge: {
    width: 'fit-content',
    padding: '4px 8px',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: THEME.panelRaised,
    color: THEME.text,
    fontSize: 12,
    fontWeight: 600,
  },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  actionWrap: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  actionBtn: {
    padding: '7px 10px',
    fontSize: 12,
  },
  surfaceStack: {
    display: 'grid',
    gap: 16,
  },
  serviceGroupStack: {
    display: 'grid',
    gap: 14,
  },
  serviceGroupSection: {
    display: 'grid',
    gap: 10,
  },
  serviceGroupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  serviceGroupTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: THEME.text,
  },
  groupToggle: {
    padding: '8px 10px',
    fontSize: 12,
  },
  serviceCardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
  },
  collapsedSection: {
    display: 'none',
  },
  serviceCard: {
    display: 'grid',
    gap: 10,
    padding: 14,
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
  },
  serviceCardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  serviceCardTitle: {
    margin: '0 0 4px',
    fontSize: 14,
    fontWeight: 600,
    color: THEME.text,
  },
  serviceCardDescription: {
    margin: 0,
    color: THEME.muted,
    fontSize: 12,
    lineHeight: 1.5,
  },
  serviceCardMeta: {
    margin: 0,
    color: THEME.muted,
    fontSize: 12,
  },
  serviceCardStats: {
    margin: 0,
    color: THEME.text,
    fontSize: 12,
    fontFamily: 'var(--font-geist-mono), monospace',
  },
  serviceCardReason: {
    margin: 0,
    color: THEME.muted,
    fontSize: 12,
    lineHeight: 1.45,
  },
  serviceCardActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  serviceStatusBadge: {
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    border: `1px solid ${THEME.border}`,
  },
  serviceStatusOk: {
    color: THEME.ok,
    background: 'rgba(111, 159, 112, 0.12)',
    borderColor: 'rgba(111, 159, 112, 0.32)',
  },
  serviceStatusIdle: {
    color: THEME.muted,
    background: '#15181c',
  },
  serviceStatusWarn: {
    color: THEME.brightYellow,
    background: 'rgba(184, 139, 69, 0.12)',
    borderColor: 'rgba(184, 139, 69, 0.32)',
  },
  serviceStatusUnavailable: {
    color: THEME.crimsonRed,
    background: 'rgba(196, 91, 91, 0.12)',
    borderColor: 'rgba(196, 91, 91, 0.32)',
  },
  workflowStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
  },
  workflowStep: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: THEME.panelRaised,
    fontSize: 13,
  },
  workflowIndex: {
    width: 20,
    height: 20,
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#15181c',
    color: THEME.text,
    fontSize: 11,
    fontWeight: 700,
    border: `1px solid ${THEME.border}`,
    flexShrink: 0,
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
  logFilters: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
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
  demoTerminal: {
    margin: 0,
    width: '100%',
    minHeight: 300,
    padding: 20,
    overflowX: 'auto',
    borderRadius: 8,
    background: '#101314',
    color: '#dfe7d7',
    fontFamily: 'var(--font-geist-mono), monospace',
    fontSize: 13,
    lineHeight: 1.6,
    textAlign: 'left',
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
  paletteList: {
    display: 'grid',
    gap: 8,
    marginTop: 12,
    maxHeight: 360,
    overflowY: 'auto',
  },
  paletteItem: {
    justifyContent: 'space-between',
    width: '100%',
    padding: '10px 12px',
  },
  paletteItemActive: {
    background: THEME.panelRaised,
    borderColor: THEME.accent,
  },
};
