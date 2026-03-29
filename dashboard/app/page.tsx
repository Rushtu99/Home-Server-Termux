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

type FtpEntry = {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt?: string;
  rawModifiedAt?: string;
  permissions?: string;
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

type ControlTarget = {
  service: string;
  action: string;
} | null;

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

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [isCompact, setIsCompact] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
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

  const cpuCanvas = useRef<HTMLCanvasElement>(null);
  const ramCanvas = useRef<HTMLCanvasElement>(null);
  const fetchInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const tabSyncReadyRef = useRef(false);
  const gatewayBase = useGatewayBase();

  const clearSession = (message = '') => {
    if (typeof window !== 'undefined') {
      void fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }

    if (!mountedRef.current) {
      return;
    }

    setIsAuthed(false);
    setAuthBusy(false);
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
          setIsAuthed(true);
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
      setIsCompact(window.innerWidth < 980);
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
    if (!isAuthed) {
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
  }, [activeTab, isAuthed]);

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
    if (!isAuthed) {
      return;
    }

    const bootstrapFtp = async () => {
      try {
        const res = await authFetch(`${API}/ftp/defaults`);
        if (!res.ok) {
          return;
        }

        const payload = await res.json();
        if (!mountedRef.current) {
          return;
        }

        setFtpHost(payload.host || '');
        setFtpPort(String(payload.port || 2121));
        setFtpUser(payload.user || 'anonymous');
        setFtpSecure(Boolean(payload.secure));
        setFtpDownloadRoot(payload.downloadRoot || '');
      } catch {
        // Ignore FTP defaults bootstrap failures.
      }
    };

    void bootstrapFtp();
  }, [isAuthed]);

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

    if (!controlPassword.trim()) {
      setControlStatus('Enter admin password to continue');
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
        body: JSON.stringify({ service, action, adminPassword: controlPassword }),
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

  const ftpPayload = (pathOverride?: string) => ({
    host: ftpHost.trim(),
    port: Number(ftpPort || 21),
    user: ftpUser.trim() || 'anonymous',
    password: ftpPassword,
    secure: ftpSecure,
    path: pathOverride || ftpPath,
  });

  const loadFtpDirectory = async (pathOverride?: string) => {
    if (!ftpHost.trim()) {
      setFtpStatus('Enter the PS4 FTP host first.');
      return;
    }

    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ftpPayload(pathOverride)),
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

      setFtpPath(payload.path || '/');
      setFtpEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setFtpStatus(`Connected to ${payload.connection?.host || ftpHost.trim()} at ${payload.path || '/'}`);
    } catch {
      setFtpStatus('Unable to reach FTP endpoint');
    } finally {
      setFtpBusy(false);
    }
  };

  const downloadFtpEntry = async (entry: FtpEntry) => {
    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpPayload(),
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

      setFtpStatus(`Saved to ${payload.localPath}`);
    } catch {
      setFtpStatus('Download failed');
    } finally {
      setFtpBusy(false);
    }
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
    <div style={{ ...styles.app, ...(isCompact ? styles.appCompact : {}) }}>
      <aside style={{ ...styles.sidebar, ...(isCompact ? styles.sidebarCompact : {}) }}>
        <div style={styles.brand}>HmSTx</div>
        <nav aria-label="Dashboard Sections" style={{ ...styles.navGroup, ...(isCompact ? styles.navGroupCompact : {}) }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className="ui-button"
              aria-pressed={activeTab === tab.key}
              style={{ ...styles.navBtn, ...(activeTab === tab.key ? styles.navBtnActive : {}), ...(isCompact ? styles.navBtnCompact : {}) }}
              type="button"
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <button
          className="ui-button"
          style={{ ...styles.navBtn, ...styles.logoutBtn, ...(isCompact ? styles.navBtnCompact : {}) }}
          type="button"
          onClick={() => clearSession()}
        >
          Log Out
        </button>
      </aside>

      <main id="app-main" style={{ ...styles.main, ...(isCompact ? styles.mainCompact : {}) }}>
        {activeTab === 'home' && (
          <div>
            <div style={styles.headerBar}>
              <div>
                <h1 style={styles.title}>Server</h1>
                <p style={styles.smallLabel}>Runtime, drives, services, and live telemetry.</p>
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
          <EmbeddedToolPanel
            title="Filesystem"
            subtitle="Embedded FileBrowser instance."
            frameTitle="Embedded File Manager"
            path="/files/"
            gatewayBase={gatewayBase}
            isCompact={isCompact}
          />
        )}

        {activeTab === 'ftp' && (
          <Panel title="FTP Client" subtitle="Connect to your PS4 GoldHEN FTP server, browse it, and pull files into this Termux host.">
              <div style={styles.ftpGrid}>
                <div style={styles.card}>
                  <h3 style={styles.cardTitle}>Connection</h3>
                  <div style={styles.ftpFormGrid}>
                    <TextField id="ftp-host" label="PS4 Host" name="ftpHost" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpHost} onChange={setFtpHost} />
                    <TextField id="ftp-port" label="Port" name="ftpPort" autoComplete="off" inputMode="numeric" spellCheck={false} value={ftpPort} onChange={setFtpPort} />
                    <TextField id="ftp-user" label="Username" name="ftpUser" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpUser} onChange={setFtpUser} />
                    <TextField id="ftp-password" label="Password" name="ftpPassword" type="password" autoComplete="off" value={ftpPassword} onChange={setFtpPassword} />
                  </div>
                  <label style={styles.checkboxRow}>
                    <input type="checkbox" checked={ftpSecure} onChange={(event) => setFtpSecure(event.target.checked)} />
                    <span>Use FTPS/TLS</span>
                  </label>
                  <div style={styles.actionWrap}>
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => loadFtpDirectory('/')}>Connect</button>
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => loadFtpDirectory(ftpPath)}>Refresh</button>
                    <button className="ui-button" disabled={ftpBusy || ftpPath === '/'} style={styles.actionBtn} type="button" onClick={() => loadFtpDirectory(parentRemotePath(ftpPath))}>Up One Level</button>
                  </div>
                  <p style={styles.codeLine}>Current remote path: <code>{ftpPath}</code></p>
                  <p style={styles.codeLine}>PS4 mirror on this server: <code>{ftpDownloadRoot || '~/Drives/PS4'}</code></p>
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
                      placeholder="/data/data/com.termux/files/home/Drives/C/PS4UPDATE.PUP…"
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
                      placeholder="/data/PS4UPDATE.PUP…"
                      value={ftpUploadRemotePath}
                      onChange={setFtpUploadRemotePath}
                    />
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={uploadToFtp}>Upload Local File</button>
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
                      placeholder="NEW_FOLDER…"
                      value={ftpFolderName}
                      onChange={setFtpFolderName}
                    />
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={createFtpFolder}>Create Folder</button>
                  </div>
                  <p style={styles.smallLabel}>GoldHEN usually exposes a plain FTP endpoint, so leave FTPS disabled unless you intentionally front it with TLS.</p>
                  <p style={styles.smallLabel}>The local FTP server controls remain available separately in service control if you install an FTP provider later.</p>
              </div>
            </div>

            <div style={{ ...styles.card, marginTop: 16 }}>
              <h3 style={styles.cardTitle}>Remote Listing</h3>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Size</th>
                      <th style={styles.th}>Modified</th>
                      <th style={styles.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ftpEntries.length === 0 && (
                      <tr>
                        <td style={styles.td} colSpan={5}>No listing loaded yet.</td>
                      </tr>
                    )}
                    {ftpEntries.map((entry) => (
                      <tr key={`${entry.type}-${entry.name}`}>
                        <td style={styles.td}>{entry.name}</td>
                        <td style={styles.td}>{entry.type}</td>
                        <td style={styles.td}>{entry.type === 'file' ? fmtBytes(entry.size) : '--'}</td>
                        <td style={styles.td}>{entry.modifiedAt ? fmtTime(entry.modifiedAt) : entry.rawModifiedAt || '--'}</td>
                        <td style={styles.td}>
                          <div style={styles.actionWrap}>
                            {entry.type === 'directory' ? (
                              <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => loadFtpDirectory(joinRemotePath(ftpPath, entry.name))}>Open</button>
                            ) : (
                              <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => downloadFtpEntry(entry)}>Pull To Server</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        )}

        {activeTab === 'settings' && (
          <Panel title="Settings" subtitle="Session, logging, and diagnostics controls.">
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Session</h3>
              <p style={styles.smallLabel}>Theme switching is fixed to a single stable palette now. Session access is cookie-based and invalidates on logout or timeout.</p>
              <div style={styles.actionWrap}>
                <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => clearSession()}>Log Out Everywhere Here</button>
              </div>

              <h3 style={{ ...styles.cardTitle, marginTop: 16 }}>Logging</h3>
              <div style={styles.actionWrap}>
                <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleVerboseLogging(true)}>Enable Verbose</button>
                <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleVerboseLogging(false)}>Disable Verbose</button>
              </div>
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
                Enter admin password to <strong>{controlTarget.action}</strong> <strong>{controlTarget.service}</strong>.
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
  appCompact: { flexDirection: 'column', minHeight: 'auto' },
  sidebar: {
    width: 248,
    minHeight: '100dvh',
    borderRight: `1px solid ${THEME.border}`,
    padding: 20,
    background: '#15181c',
    overflowY: 'auto',
  },
  sidebarCompact: {
    width: '100%',
    minHeight: 'auto',
    borderRight: 'none',
    borderBottom: `1px solid ${THEME.border}`,
    padding: 14,
    overflowY: 'visible',
  },
  brand: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 18,
    color: THEME.text,
  },
  navGroup: { display: 'flex', flexDirection: 'column', gap: 8 },
  navGroupCompact: { flexDirection: 'row', flexWrap: 'wrap' },
  navBtn: {
    padding: '10px 12px',
    textAlign: 'left',
    fontWeight: 500,
    justifyContent: 'flex-start',
  },
  navBtnCompact: { flex: '1 1 118px' },
  navBtnActive: {
    background: THEME.panelRaised,
    color: THEME.text,
    borderColor: THEME.border,
  },
  logoutBtn: { marginTop: 14 },
  main: { flex: 1, minHeight: 0, padding: 24, overflowY: 'auto' },
  mainCompact: { padding: 16, overflowY: 'visible' },
  title: { margin: '0 0 6px', fontSize: 28, fontWeight: 700, color: THEME.text },
  panelSubtitle: { margin: '0 0 18px', color: THEME.muted, fontSize: 13, maxWidth: 680 },
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
  ftpGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
  ftpFormGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  ftpActionGroup: { display: 'grid', gap: 10, marginTop: 12 },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: THEME.text, fontSize: 13 },
  linkBtn: {
    display: 'inline-block',
    padding: '8px 12px',
    fontSize: 13,
    textDecoration: 'none',
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
