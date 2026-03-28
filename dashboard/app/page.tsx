'use client';
// Bot guidance:
// - This file is the integration surface for auth + telemetry + service control APIs.
// - Keep endpoint usage synced with server/index.js.
// - Any UI refactor must preserve control popup flow (admin password required).

import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API || '/api';
const FRONTEND_TOKEN_COOKIE = 'dashboard_token';

const THEME = {
  neonCyan: '#00f5ff',
  brightYellow: '#ffe44d',
  crimsonRed: '#ff3b5f',
  darkPurple: '#26163d',
  bg: '#0c0d14',
  panel: '#141622',
  text: '#f1f4ff',
  muted: '#96a0b8',
  ok: '#3de39f',
};

const AUTO_THEME_FILTERS = [
  'none',
  'hue-rotate(35deg) saturate(1.15)',
  'hue-rotate(150deg) saturate(1.18)',
  'hue-rotate(260deg) saturate(1.08)',
];

type TabKey = 'home' | 'terminal' | 'filesystem' | 'ftp' | 'settings';
type Services = Record<string, boolean>;

type Monitor = {
  cpuLoad: number;
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

const fmtBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx < 2 ? 0 : 1)} ${units[idx]}`;
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [isCompact, setIsCompact] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
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
  const [themePreset, setThemePreset] = useState('neon');
  const [themeFxIndex, setThemeFxIndex] = useState(0);
  const [controlTarget, setControlTarget] = useState<ControlTarget>(null);
  const [controlPassword, setControlPassword] = useState('');

  const cpuCanvas = useRef<HTMLCanvasElement>(null);
  const ramCanvas = useRef<HTMLCanvasElement>(null);
  // Bot note: avoid overlapping telemetry requests under high latency.
  const fetchInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const clearSession = (message = '') => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('dashboard-token');
      document.cookie = `${FRONTEND_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      // Bot note: keep cookie + local storage logout in sync for iframe auth.
      void fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }
    setToken(null);
    setIsAuthed(false);
    setPassword('');
    if (message) setAuthError(message);
  };

  const authFetch = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(path, { ...init, headers, credentials: init.credentials || 'include' });
  };

  useEffect(() => {
    const bootstrap = async () => {
      const savedToken = typeof window !== 'undefined' ? window.localStorage.getItem('dashboard-token') : null;

      try {
        const headers = savedToken ? { Authorization: `Bearer ${savedToken}` } : undefined;
        const res = await fetch(`${API}/auth/me`, { headers, credentials: 'include' });
        if (res.ok) {
          if (savedToken) {
            setToken(savedToken);
            document.cookie = `${FRONTEND_TOKEN_COOKIE}=${encodeURIComponent(savedToken)}; Path=/; SameSite=Lax`;
          }
          setIsAuthed(true);
        } else if (typeof window !== 'undefined') {
          window.localStorage.removeItem('dashboard-token');
          document.cookie = `${FRONTEND_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
        }
      } catch {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('dashboard-token');
          document.cookie = `${FRONTEND_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
        }
      } finally {
        setAuthChecked(true);
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    const updateLayout = () => setIsCompact(window.innerWidth < 980);
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
    if (typeof window === 'undefined') return;
    const savedTheme = window.localStorage.getItem('dashboard-theme-preset');
    if (savedTheme) setThemePreset(savedTheme);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setThemeFxIndex((prev) => (prev + 1) % AUTO_THEME_FILTERS.length);
    }, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    void fetchAll();
    const interval = setInterval(() => {
      void fetchAll();
    }, 3000);
    return () => clearInterval(interval);
  }, [isAuthed, token]);

  useEffect(() => {
    drawTrend(cpuCanvas.current, cpuHistory, THEME.neonCyan, 'rgba(0,245,255,0.14)');
  }, [cpuHistory]);

  useEffect(() => {
    drawTrend(ramCanvas.current, ramHistory, THEME.brightYellow, 'rgba(255,228,77,0.14)');
  }, [ramHistory]);

  const gatewayBase = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8088`;
  }, []);

  const fetchAll = async () => {
    if (fetchInFlightRef.current) {
      return;
    }
    fetchInFlightRef.current = true;

    try {
      const [svcRes, monitorRes, connRes, storageRes, logRes] = await Promise.all([
        authFetch(`${API}/services`),
        authFetch(`${API}/monitor`),
        authFetch(`${API}/connections`),
        authFetch(`${API}/storage`),
        authFetch(`${API}/logs`),
      ]);

      if (!mountedRef.current) {
        return;
      }

      const resList = [svcRes, monitorRes, connRes, storageRes, logRes];
      if (resList.some((r) => r.status === 401)) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (svcRes.ok) {
        const svc = await svcRes.json();
        setServices(svc);
      }

      if (monitorRes.ok) {
        const m = await monitorRes.json();
        const ramPercent = m.totalMem > 0 ? (m.usedMem / m.totalMem) * 100 : 0;
        setMonitor(m);
        setCpuHistory((prev) => [...prev.slice(-39), m.cpuLoad]);
        setRamHistory((prev) => [...prev.slice(-39), ramPercent]);
      }

      if (connRes.ok) {
        const c = await connRes.json();
        setConnections(Array.isArray(c.users) ? c.users : []);
      }

      if (storageRes.ok) {
        const s = await storageRes.json();
        setStorage(Array.isArray(s.mounts) ? s.mounts : []);
      }

      if (logRes.ok) {
        const l = await logRes.json();
        setDebugLogs(Array.isArray(l.logs) ? l.logs : []);
        setLogsMarkdown(typeof l.markdown === 'string' ? l.markdown : '');
        setVerboseLogging(Boolean(l.verboseLoggingEnabled));
      }

      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
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
    if (!controlTarget) return;
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
        const msg = payload?.error || `Failed to ${action} ${service}`;
        setControlStatus(msg);
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

  const totalStorage = storage.reduce((sum, m) => sum + m.size, 0);
  const usedStorage = storage.reduce((sum, m) => sum + m.used, 0);
  const usedStoragePct = totalStorage > 0 ? Math.min((usedStorage / totalStorage) * 100, 100) : 0;

  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.token) {
        setAuthError(payload?.error || 'Login failed');
        return;
      }

      if (typeof window !== 'undefined') {
        window.localStorage.setItem('dashboard-token', payload.token);
        document.cookie = `${FRONTEND_TOKEN_COOKIE}=${encodeURIComponent(payload.token)}; Path=/; SameSite=Lax`;
      }

      setToken(payload.token);
      setIsAuthed(true);
      setPassword('');
    } catch {
      setAuthError('Unable to reach auth service');
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

  const applyThemePreset = (preset: string) => {
    setThemePreset(preset);
    const presetMap: Record<string, number> = { neon: 0, sunset: 1, midnight: 2, crimson: 3 };
    setThemeFxIndex(presetMap[preset] ?? 0);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dashboard-theme-preset', preset);
    }
  };

  if (!authChecked) {
    return <div style={styles.loading}>Loading...</div>;
  }

  if (!isAuthed) {
    return (
      <div style={styles.loginShell}>
        <form style={styles.loginCard} onSubmit={login}>
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Dashboard Login</h1>
          <p style={{ marginTop: 0, color: THEME.muted, fontSize: 13 }}>Sign in to access the server dashboard.</p>
          <input style={styles.input} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input style={styles.input} placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {authError && <p style={styles.errorText}>{authError}</p>}
          <button style={styles.loginBtn} type="submit">Login</button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ ...styles.app, ...(isCompact ? styles.appCompact : {}), filter: AUTO_THEME_FILTERS[themeFxIndex] }}>
      <aside style={{ ...styles.sidebar, ...(isCompact ? styles.sidebarCompact : {}) }}>
        <div style={styles.brand}>HmSTx</div>
        <div style={{ ...styles.navGroup, ...(isCompact ? styles.navGroupCompact : {}) }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              style={{ ...styles.navBtn, ...(activeTab === tab.key ? styles.navBtnActive : {}), ...(isCompact ? styles.navBtnCompact : {}) }}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button style={{ ...styles.navBtn, ...styles.logoutBtn, ...(isCompact ? styles.navBtnCompact : {}) }} onClick={() => clearSession()}>
          Log Out
        </button>
      </aside>

      <main style={{ ...styles.main, ...(isCompact ? styles.mainCompact : {}) }}>
        {activeTab === 'home' && (
          <div>
            <div style={styles.headerRow}>
              <p style={styles.breadcrumb}>Pages / Dashboard</p>
              <p style={styles.updatedLabel}>{lastUpdated ? `Updated: ${lastUpdated}` : 'Waiting for telemetry...'}</p>
            </div>
            <h1 style={styles.title}>Main Dashboard</h1>

            <section style={styles.kpiRow}>
              <StatCard title="CPU Load" value={`${monitor ? monitor.cpuLoad.toFixed(1) : '0.0'}%`} />
              <StatCard title="Memory Used" value={`${usedMemPct.toFixed(1)}%`} />
              <StatCard title="Services Running" value={`${runningServices}/${totalServices}`} />
              <StatCard title="Uptime" value={`${monitor ? (monitor.uptime / 3600).toFixed(1) : '0.0'}h`} />
              <StatCard title="Connected Users" value={`${connections.length}`} />
            </section>

            <section style={styles.grid}>
              <article style={{ ...styles.card, ...(isCompact ? {} : { gridColumn: 'span 2' }) }}>
                <h3 style={styles.cardTitle}>System Trends</h3>
                <div style={styles.trendLegendRow}>
                  <span style={styles.legend}><span style={{ ...styles.legendDot, background: THEME.neonCyan }} />CPU % (neon cyan)</span>
                  <span style={styles.legend}><span style={{ ...styles.legendDot, background: THEME.brightYellow }} />RAM % (bright yellow)</span>
                  <span style={styles.legend}>Markers show sampled points</span>
                </div>
                <div style={styles.dualCanvas}>
                  <div>
                    <p style={styles.smallLabel}>CPU Trend</p>
                    <canvas ref={cpuCanvas} width={460} height={170} style={styles.canvas} />
                  </div>
                  <div>
                    <p style={styles.smallLabel}>RAM Trend</p>
                    <canvas ref={ramCanvas} width={460} height={170} style={styles.canvas} />
                  </div>
                </div>
              </article>

              <article style={styles.card}>
                <h3 style={styles.cardTitle}>Performance Headroom</h3>
                <Progress label="CPU headroom" value={Math.max(0, 100 - (monitor?.cpuLoad || 0))} />
                <Progress label="Memory headroom" value={Math.max(0, 100 - usedMemPct)} />
                <Progress label="Service availability" value={totalServices > 0 ? (runningServices / totalServices) * 100 : 0} />
                <Progress label="Storage free" value={Math.max(0, 100 - usedStoragePct)} />
              </article>

              <article style={styles.card}>
                <h3 style={styles.cardTitle}>Service Controls</h3>
                {Object.entries(services).map(([name, running]) => (
                  <div key={name} style={styles.serviceRow}>
                    <span style={styles.serviceName}>
                      {name}
                      <span style={{ ...styles.dot, background: running ? THEME.ok : THEME.crimsonRed }} />
                    </span>
                    <div style={styles.actionWrap}>
                      <button disabled={!!controlBusy[`${name}:start`]} style={styles.actionBtn} onClick={() => openControlPopup(name, 'start')}>Start</button>
                      <button disabled={!!controlBusy[`${name}:stop`]} style={styles.actionBtn} onClick={() => openControlPopup(name, 'stop')}>Stop</button>
                      <button disabled={!!controlBusy[`${name}:restart`]} style={styles.actionBtn} onClick={() => openControlPopup(name, 'restart')}>Restart</button>
                    </div>
                  </div>
                ))}
                <p style={{ ...styles.smallLabel, marginTop: 8, color: controlStatus.includes('succeeded') ? THEME.ok : THEME.crimsonRed }}>
                  {controlStatus || 'Ready'}
                </p>
              </article>

              <article style={styles.card}>
                <h3 style={styles.cardTitle}>Storage Split (Detailed)</h3>
                <div style={styles.donutWrap}>
                  <div
                    style={{
                      ...styles.donut,
                      background: `conic-gradient(${THEME.neonCyan} 0deg ${(usedStoragePct / 100) * 360}deg, ${THEME.darkPurple} ${(usedStoragePct / 100) * 360}deg 360deg)`,
                    }}
                  />
                  <div>
                    <p style={styles.legend}><span style={{ ...styles.legendDot, background: THEME.neonCyan }} />Used</p>
                    <p style={styles.legend}><span style={{ ...styles.legendDot, background: THEME.darkPurple }} />Free</p>
                    <p style={styles.legendValue}>{usedStoragePct.toFixed(1)}% used</p>
                    <p style={styles.smallLabel}>{fmtBytes(usedStorage)} / {fmtBytes(totalStorage)}</p>
                  </div>
                </div>
                <div style={styles.mountList}>
                  {storage.slice(0, 6).map((mount) => (
                    <div key={`${mount.filesystem}-${mount.mount}`} style={styles.mountRow}>
                      <div>
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

              <article style={styles.card}>
                <h3 style={styles.cardTitle}>Live Debug Log</h3>
                <div style={styles.logControlRow}>
                  <button style={styles.linkBtn} onClick={() => toggleVerboseLogging(!verboseLogging)}>
                    {verboseLogging ? 'Disable Verbose Logging' : 'Enable Verbose Logging'}
                  </button>
                </div>
                <div style={styles.logBox}>
                  {debugLogs.length === 0 && <p style={styles.smallLabel}>No debug events yet.</p>}
                  {debugLogs.slice(0, 40).map((log, idx) => (
                    <p key={`${log.timestamp}-${idx}`} style={styles.logLine}>
                      <span style={styles.logTime}>{fmtTime(log.timestamp)}</span>
                      <span style={{ ...styles.logLevel, color: log.level === 'error' ? THEME.crimsonRed : log.level === 'warn' ? THEME.brightYellow : THEME.neonCyan }}>
                        {log.level.toUpperCase()}
                      </span>
                      <span>
                        {log.message}
                        {log.meta ? ` ${JSON.stringify(log.meta)}` : ''}
                      </span>
                    </p>
                  ))}
                </div>
                <p style={{ ...styles.smallLabel, marginTop: 10 }}>Markdown Debug Box</p>
                <pre style={styles.markdownBox}>{logsMarkdown || '```log\n(no logs yet)\n```'}</pre>
              </article>
            </section>

            <section style={{ ...styles.card, marginTop: 16 }}>
              <h3 style={styles.cardTitle}>Connected Users</h3>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Username</th>
                    <th style={styles.th}>IP</th>
                    <th style={styles.th}>Port</th>
                    <th style={styles.th}>Protocol</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Last Seen</th>
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
                      <td style={styles.td}>{user.port || '--'}</td>
                      <td style={styles.td}>{user.protocol}</td>
                      <td style={styles.td}><span style={styles.statusDone}>{user.status}</span></td>
                      <td style={styles.td}>{fmtTime(user.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {activeTab === 'terminal' && (
          <Panel title="Terminal" subtitle="Interactive shell via ttyd.">
            <div style={styles.panelActions}>
              <a href={`${gatewayBase}/term/`} target="_blank" rel="noreferrer" style={styles.linkBtn}>Open Terminal In New Tab</a>
            </div>
            <iframe title="Embedded Terminal" src={`${gatewayBase}/term/`} style={styles.frame} />
          </Panel>
        )}

        {activeTab === 'filesystem' && (
          <Panel title="Filesystem" subtitle="Embedded FileBrowser instance.">
            <div style={styles.panelActions}>
              <a href={`${gatewayBase}/files/`} target="_blank" rel="noreferrer" style={styles.linkBtn}>Open File Manager In New Tab</a>
            </div>
            <iframe title="Embedded File Manager" src={`${gatewayBase}/files/`} style={styles.frame} />
          </Panel>
        )}

        {activeTab === 'ftp' && (
          <Panel title="FTP" subtitle="Use SFTP for reliable transfer on this stack.">
            <div style={styles.card}>
              <div style={styles.actionWrap}>
                <button disabled={!!controlBusy['ftp:start']} style={styles.actionBtn} onClick={() => openControlPopup('ftp', 'start')}>Start FTP Server</button>
                <button disabled={!!controlBusy['ftp:stop']} style={styles.actionBtn} onClick={() => openControlPopup('ftp', 'stop')}>Stop FTP Server</button>
                <button disabled={!!controlBusy['ftp:restart']} style={styles.actionBtn} onClick={() => openControlPopup('ftp', 'restart')}>Restart FTP Server</button>
              </div>
              <p>Host: <code>your-server-ip</code></p>
              <p>FTP Port: <code>2121</code></p>
              <p>User: your Termux/WSL user</p>
              <p>Client: FileZilla (FTP) or WinSCP (SFTP)</p>
              <p>SSH Status: <strong>{services.sshd ? 'Running' : 'Stopped'}</strong></p>
              <p>FTP Status: <strong>{services.ftp ? 'Running' : 'Stopped'}</strong></p>
              <p style={styles.smallLabel}>For Python FTP mode, install <code>pyftpdlib</code>: <code>pip install pyftpdlib</code></p>
            </div>
          </Panel>
        )}

        {activeTab === 'settings' && (
          <Panel title="Settings" subtitle="Theme presets and diagnostics preferences.">
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Theme Presets</h3>
              <div style={styles.actionWrap}>
                {['neon', 'sunset', 'midnight', 'crimson'].map((preset) => (
                  <button
                    key={preset}
                    style={{ ...styles.actionBtn, ...(themePreset === preset ? styles.navBtnActive : {}) }}
                    onClick={() => applyThemePreset(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <p style={{ ...styles.smallLabel, marginTop: 10 }}>
                Selected preset: <strong>{themePreset}</strong>. Reload after plugin UI update to apply full palette.
              </p>
              <p style={styles.smallLabel}>Auto theme rotation is enabled (cycles every 20s).</p>

              <h3 style={{ ...styles.cardTitle, marginTop: 16 }}>Logging</h3>
              <div style={styles.actionWrap}>
                <button style={styles.actionBtn} onClick={() => toggleVerboseLogging(true)}>Enable Verbose</button>
                <button style={styles.actionBtn} onClick={() => toggleVerboseLogging(false)}>Disable Verbose</button>
              </div>
            </div>
          </Panel>
        )}

        {controlTarget && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalCard}>
              <h3 style={{ marginTop: 0 }}>Confirm Service Action</h3>
              <p style={styles.smallLabel}>
                Enter admin password to <strong>{controlTarget.action}</strong> <strong>{controlTarget.service}</strong>.
              </p>
              <input
                type="password"
                style={styles.input}
                placeholder="Admin password"
                value={controlPassword}
                onChange={(e) => setControlPassword(e.target.value)}
              />
              <div style={styles.actionWrap}>
                <button style={styles.actionBtn} onClick={executeControl}>Confirm</button>
                <button style={styles.actionBtn} onClick={closeControlPopup}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={styles.statCard}>
      <p style={styles.statTitle}>{title}</p>
      <p style={styles.statValue}>{value}</p>
    </div>
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

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div>
      <p style={styles.breadcrumb}>Pages / Dashboard</p>
      <h1 style={styles.title}>{title}</h1>
      <p style={{ ...styles.smallLabel, marginBottom: 16 }}>{subtitle}</p>
      {children}
    </div>
  );
}

function drawTrend(canvas: HTMLCanvasElement | null, data: number[], stroke: string, fill: string) {
  if (!canvas || data.length === 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

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
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  // Draw sampled point markers after the line path so they do not reset it.
  ctx.fillStyle = stroke;
  data.forEach((val, i) => {
    if (i % 5 !== 0 && i !== data.length - 1) return;
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - (val / max) * (h - 12) - 6;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

const styles: Record<string, CSSProperties> = {
  loading: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: '#0b0c10',
    color: '#d8dbe3',
  },
  loginShell: {
    minHeight: '100vh',
    background: `radial-gradient(circle at top, ${THEME.darkPurple} 0%, ${THEME.bg} 55%)`,
    display: 'grid',
    placeItems: 'center',
    padding: 16,
  },
  loginCard: {
    width: '100%',
    maxWidth: 380,
    background: '#11131b',
    border: `1px solid ${THEME.darkPurple}`,
    borderRadius: 14,
    padding: 20,
  },
  input: {
    width: '100%',
    marginBottom: 10,
    background: '#0f1118',
    border: `1px solid ${THEME.darkPurple}`,
    borderRadius: 9,
    padding: '10px 12px',
    color: '#eff1f7',
  },
  errorText: {
    color: THEME.crimsonRed,
    fontSize: 12,
    marginTop: 0,
  },
  loginBtn: {
    width: '100%',
    border: 'none',
    borderRadius: 9,
    padding: '10px 12px',
    background: THEME.neonCyan,
    color: '#04101f',
    fontWeight: 700,
    cursor: 'pointer',
  },
  app: {
    height: '100vh',
    display: 'flex',
    background: `radial-gradient(120% 100% at 10% 0%, ${THEME.darkPurple} 0%, ${THEME.bg} 55%, #08090f 100%)`,
    color: THEME.text,
    overflow: 'hidden',
  },
  appCompact: { flexDirection: 'column' },
  sidebar: {
    width: 220,
    height: '100%',
    borderRight: `1px solid ${THEME.darkPurple}`,
    padding: 20,
    background: 'linear-gradient(180deg, #14111f 0%, #0d1018 100%)',
    overflowY: 'auto',
  },
  sidebarCompact: {
    width: '100%',
    borderRight: 'none',
    borderBottom: `1px solid ${THEME.darkPurple}`,
    padding: 14,
  },
  brand: {
    fontSize: 21,
    fontWeight: 800,
    marginBottom: 18,
    color: '#f7f0ff',
    textShadow: `0 8px 22px ${THEME.darkPurple}`,
  },
  navGroup: { display: 'flex', flexDirection: 'column', gap: 8 },
  navGroupCompact: { flexDirection: 'row', flexWrap: 'wrap' },
  navBtn: {
    border: '1px solid #36334f',
    borderRadius: 10,
    background: '#17172a',
    color: '#c3c7d5',
    padding: '10px 12px',
    textAlign: 'left',
    cursor: 'pointer',
    fontWeight: 600,
  },
  navBtnCompact: { flex: '1 1 150px' },
  navBtnActive: {
    background: `linear-gradient(135deg, ${THEME.darkPurple} 0%, #1f2941 48%, #1a2d3f 100%)`,
    color: '#fff',
    borderColor: '#4a4c74',
    boxShadow: `0 10px 20px ${THEME.darkPurple}`,
  },
  logoutBtn: { marginTop: 14 },
  main: { flex: 1, height: '100%', padding: 28, overflowY: 'auto' },
  mainCompact: { padding: 16 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  breadcrumb: { margin: 0, color: THEME.muted, fontSize: 12 },
  updatedLabel: { margin: 0, color: THEME.neonCyan, fontSize: 12 },
  title: { margin: '4px 0 16px', fontSize: 36, fontWeight: 800 },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 },
  statCard: {
    background: 'linear-gradient(180deg, #171b2a 0%, #131827 100%)',
    border: `1px solid ${THEME.darkPurple}`,
    borderRadius: 12,
    padding: 12,
  },
  statTitle: { margin: 0, color: THEME.muted, fontSize: 12 },
  statValue: { margin: '6px 0 0', fontSize: 22, fontWeight: 700, color: '#fff' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 },
  card: {
    background: 'linear-gradient(180deg, #151a2a 0%, #121827 100%)',
    border: `1px solid ${THEME.darkPurple}`,
    borderRadius: 14,
    padding: 14,
  },
  cardTitle: { margin: '0 0 10px', fontSize: 15, color: '#f2f2f5' },
  trendLegendRow: { display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 },
  dualCanvas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 },
  smallLabel: { margin: '0 0 8px', color: THEME.muted, fontSize: 12 },
  canvas: { width: '100%', height: 170, borderRadius: 10, border: `1px solid ${THEME.darkPurple}` },
  progressLabel: { display: 'flex', justifyContent: 'space-between', color: '#c8c9ce', fontSize: 12, marginBottom: 4 },
  progressTrack: { height: 7, borderRadius: 999, background: '#2a2e3d', overflow: 'hidden' },
  progressFill: { height: '100%', background: `linear-gradient(90deg, ${THEME.neonCyan} 0%, ${THEME.brightYellow} 55%, ${THEME.crimsonRed} 100%)` },
  serviceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottom: '1px dashed #32374a',
    gap: 8,
  },
  serviceName: { textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  actionWrap: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  actionBtn: {
    border: '1px solid #4f5674',
    background: '#22283b',
    color: '#f3f3f4',
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 12,
    cursor: 'pointer',
  },
  donutWrap: { display: 'flex', alignItems: 'center', gap: 18, marginBottom: 10 },
  donut: { width: 120, height: 120, borderRadius: '50%', position: 'relative' },
  legend: { margin: '0 0 8px', color: '#b7bac7', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 },
  legendDot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block' },
  legendValue: { margin: 0, color: '#fff', fontWeight: 700 },
  mountList: { display: 'grid', gap: 8 },
  mountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: THEME.panel,
    border: `1px solid ${THEME.darkPurple}`,
    borderRadius: 10,
    padding: '8px 10px',
    gap: 10,
  },
  mountRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  mountMeta: { margin: 0, fontSize: 12, color: THEME.muted },
  logBox: {
    maxHeight: 220,
    overflow: 'auto',
    border: `1px solid ${THEME.darkPurple}`,
    borderRadius: 10,
    padding: '8px 10px',
    background: '#101524',
    fontFamily: 'var(--font-geist-mono)',
  },
  logControlRow: { marginBottom: 8 },
  markdownBox: {
    margin: 0,
    maxHeight: 170,
    overflow: 'auto',
    border: `1px solid ${THEME.darkPurple}`,
    borderRadius: 10,
    padding: '10px',
    background: '#0d1320',
    color: '#c4dcff',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 12,
    fontFamily: 'var(--font-geist-mono)',
  },
  logLine: { margin: '0 0 6px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' },
  logTime: { color: '#a9b0c8', minWidth: 72 },
  logLevel: { fontWeight: 700, minWidth: 42 },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px', fontSize: 13 },
  th: { color: '#b5bad0', fontWeight: 500, textAlign: 'left', padding: '0 10px 6px' },
  td: {
    background: '#1a2135',
    borderTop: '1px solid #343c55',
    borderBottom: '1px solid #343c55',
    padding: '10px',
    color: '#e2e4ec',
  },
  statusDone: {
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 12,
    fontWeight: 600,
    color: '#cde8db',
    background: 'rgba(48, 181, 118, 0.2)',
    border: '1px solid rgba(48, 181, 118, 0.4)',
  },
  frame: { width: '100%', height: '78vh', border: '1px solid #2d3142', borderRadius: 12, background: '#111420' },
  panelActions: { marginBottom: 10 },
  linkBtn: {
    display: 'inline-block',
    border: '1px solid #3f4458',
    background: '#1d2130',
    color: '#f0f1f5',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    textDecoration: 'none',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(4, 7, 14, 0.66)',
    display: 'grid',
    placeItems: 'center',
    zIndex: 90,
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    background: '#141a2a',
    border: `1px solid ${THEME.darkPurple}`,
    borderRadius: 12,
    padding: 16,
  },
};
