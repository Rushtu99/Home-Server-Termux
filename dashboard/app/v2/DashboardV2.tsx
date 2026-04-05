'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { appFetch } from '../demo-api';
import { ErrorState, LoadingState, StatusBadge } from './components';
import { toErrorMessage } from './errors';
import { controlService, lockServiceController, unlockServiceController } from './api';
import { useWorkspaceData } from './useWorkspaceData';
import { normalizeSafeNextPath } from './workspaceMap';
import { WorkspaceViewport } from './workspaces';
import type { UiNavItem, WorkspaceKey } from './types';

const THEME_STORAGE_KEY = 'hmstx-theme';
const STYLE_STORAGE_KEY = 'hmstx-style';
const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'contrast', label: 'Contrast' },
  { value: 'forest-green', label: 'Forest Green' },
  { value: 'crimson-red', label: 'Crimson Red' },
  { value: 'neon-orange', label: 'Neon Orange' },
  { value: 'radiant-yellow', label: 'Radiant Yellow' },
  { value: 'puffy-pink', label: 'Puffy Pink' },
  { value: 'purple-haze', label: 'Purple Haze' },
] as const;

const STYLE_OPTIONS = [
  { value: 'classic-v2', label: 'Style 1' },
  { value: 'filesystem', label: 'Style 2 (Filesystem)' },
] as const;

const statusTone = (status: string) => {
  const token = String(status || '').toLowerCase();
  if (token === 'working' || token === 'healthy') {
    return 'ok' as const;
  }
  if (token === 'blocked' || token === 'stalled' || token === 'degraded') {
    return 'warn' as const;
  }
  if (token === 'unavailable' || token === 'failed' || token === 'crashed') {
    return 'danger' as const;
  }
  return 'muted' as const;
};

const fallbackNav: UiNavItem[] = [
  { key: 'overview', label: 'Overview', summary: 'System health and telemetry', available: true, status: 'working', legacyTabs: ['home'] },
  { key: 'media', label: 'Media', summary: 'Jellyfin + automation flow', available: true, status: 'working', legacyTabs: ['media', 'downloads', 'arr'] },
  { key: 'files', label: 'Files', summary: 'Filesystem and share management', available: true, status: 'working', legacyTabs: ['filesystem'] },
  { key: 'transfers', label: 'Transfers', summary: 'FTP and remote transfer tools', available: true, status: 'working', legacyTabs: ['ftp'] },
  { key: 'ai', label: 'AI', summary: 'LLM runtime management', available: true, status: 'working', legacyTabs: ['ai'] },
  { key: 'terminal', label: 'Terminal', summary: 'Shell access route', available: true, status: 'working', legacyTabs: ['terminal'] },
  { key: 'admin', label: 'Admin', summary: 'Service controls and operations', available: true, status: 'working', legacyTabs: ['settings'] },
];

export default function DashboardV2() {
  const {
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
    workspaceData,
    workspaceError,
    loadingWorkspace,
  } = useWorkspaceData();
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginUsername, setLoginUsername] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [controllerBusy, setControllerBusy] = useState(false);
  const [controlBusyKey, setControlBusyKey] = useState('');
  const [controlStatus, setControlStatus] = useState('');
  const [headerBusy, setHeaderBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [styleVariant, setStyleVariant] = useState('classic-v2');
  const [loginNextPath, setLoginNextPath] = useState<string | null>(null);

  const nav = bootstrap?.nav && bootstrap.nav.length > 0 ? bootstrap.nav : fallbackNav;
  const userLabel = bootstrap?.user?.username || 'operator';
  const lifecycleState = String(bootstrap?.lifecycle?.state || 'unknown');
  const authRequired = useMemo(
    () => /login required|session expired|unauthorized|401/i.test(bootstrapError),
    [bootstrapError]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial = THEME_OPTIONS.some((entry) => entry.value === stored)
      ? String(stored)
      : 'dark';
    const storedStyle = window.localStorage.getItem(STYLE_STORAGE_KEY);
    const initialStyle = STYLE_OPTIONS.some((entry) => entry.value === storedStyle) ? String(storedStyle) : 'classic-v2';
    setTheme(initial);
    setStyleVariant(initialStyle);
    document.documentElement.dataset.theme = initial;
    document.documentElement.dataset.style = initialStyle;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    document.documentElement.dataset.style = styleVariant;
    window.localStorage.setItem(STYLE_STORAGE_KEY, styleVariant);
  }, [styleVariant]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const media = window.matchMedia('(max-width: 980px)');
    const applyState = () => {
      const narrow = media.matches;
      setIsNarrowScreen(narrow);
      if (!narrow) {
        setSidebarOpen(false);
      }
    };
    applyState();
    media.addEventListener('change', applyState);
    return () => media.removeEventListener('change', applyState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    setLoginNextPath(normalizeSafeNextPath(params.get('next')));
  }, []);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');

    try {
      const response = await appFetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({} as Record<string, unknown>));
        throw new Error(String(payload.error || 'Login failed'));
      }
      setLoginPassword('');
      setLoginError('');
      if (loginNextPath && typeof window !== 'undefined') {
        window.location.assign(loginNextPath);
        return;
      }
      await Promise.all([reloadBootstrap(), reloadWorkspace()]);
    } catch (error) {
      setLoginError(toErrorMessage(error, 'Login failed'));
    } finally {
      setLoginBusy(false);
    }
  };

  const handleUnlockController = async () => {
    if (!adminPassword.trim()) {
      setControlStatus('Admin password is required to unlock controls.');
      return;
    }

    setControllerBusy(true);
    try {
      await unlockServiceController(adminPassword.trim());
      setControlStatus('Service controller unlocked.');
      reloadBootstrap();
      reloadWorkspace();
    } catch (error) {
      setControlStatus(toErrorMessage(error, 'Unable to unlock service controller'));
    } finally {
      setControllerBusy(false);
    }
  };

  const handleLockController = async () => {
    setControllerBusy(true);
    try {
      await lockServiceController();
      setControlStatus('Service controller locked.');
      reloadBootstrap();
      reloadWorkspace();
    } catch (error) {
      setControlStatus(toErrorMessage(error, 'Unable to lock service controller'));
    } finally {
      setControllerBusy(false);
    }
  };

  const handleServiceControl = async (serviceKey: string, action: 'start' | 'stop' | 'restart') => {
    setControlBusyKey(serviceKey);
    try {
      const payload = await controlService(serviceKey, action, adminPassword.trim() || undefined);
      setControlStatus(
        payload.success
          ? `${serviceKey} ${action} requested successfully.`
          : `${serviceKey} ${action} completed with a warning.`
      );
      reloadBootstrap();
      reloadWorkspace();
    } catch (error) {
      setControlStatus(toErrorMessage(error, `Unable to ${action} ${serviceKey}`));
    } finally {
      setControlBusyKey('');
    }
  };

  const handleRefresh = async () => {
    setHeaderBusy(true);
    try {
      reloadBootstrap();
      reloadWorkspace();
    } finally {
      window.setTimeout(() => setHeaderBusy(false), 300);
    }
  };

  const handleLogout = async () => {
    setHeaderBusy(true);
    try {
      const response = await appFetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({} as Record<string, unknown>));
        throw new Error(String(payload.error || 'Logout failed'));
      }
      markLoggedOut();
    } catch (error) {
      setLoginError(toErrorMessage(error, 'Logout failed'));
    } finally {
      setHeaderBusy(false);
    }
  };

  const hasDisplayedWorkspaceData = Boolean(workspaceData && workspaceData.workspaceKey === displayedWorkspace);
  const activeWorkspaceTitle = nav.find((entry) => entry.key === activeWorkspace)?.label || 'Dashboard';
  const activeWorkspaceSummary = nav.find((entry) => entry.key === activeWorkspace)?.summary || 'Home server control workspace';

  return (
    <div className="dash2-shell">
      <aside className={`dash2-sidebar ${sidebarOpen ? 'dash2-sidebar--open' : ''}`} aria-label="Dashboard workspaces">
        <div className="dash2-brand">
          <strong>HmSTx v2</strong>
          <span>Operations dashboard</span>
        </div>

        <nav className="dash2-nav">
          {nav.map((item) => {
            const isActive = item.key === activeWorkspace;
            return (
              <button
                key={item.key}
                type="button"
                className={`dash2-nav__item ${isActive ? 'dash2-nav__item--active' : ''}`}
                onClick={() => {
                  setActiveWorkspace(item.key as WorkspaceKey);
                  if (isNarrowScreen) {
                    setSidebarOpen(false);
                  }
                }}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="dash2-nav__row">
                  <strong>{item.label}</strong>
                  <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
                </span>
                <small>{item.summary}</small>
              </button>
            );
          })}
        </nav>

        <div className="dash2-sidebar__footer">
          <p>
            Signed in as <strong>{userLabel}</strong>
          </p>
          <div className="dash2-sidebar__links">
            <Link href="/files" className="ui-button">Files</Link>
            <Link href="/term" className="ui-button">Terminal</Link>
            <Link href="/legacy" className="ui-button">Classic</Link>
          </div>
        </div>
      </aside>

      {isNarrowScreen && sidebarOpen ? (
        <button
          className="dash2-sidebar-backdrop"
          type="button"
          aria-label="Close workspace navigation"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <main className="dash2-main" id="app-main">
        <header className={`dash2-header ${authRequired ? 'dash2-header--auth' : ''}`}>
          <div className="dash2-header__lead">
            {isNarrowScreen ? (
              <button
                className="ui-button dash2-sidebar-toggle"
                type="button"
                aria-expanded={sidebarOpen}
                aria-controls="app-main"
                onClick={() => setSidebarOpen((current) => !current)}
                aria-label={sidebarOpen ? 'Close workspace menu' : 'Open workspace menu'}
              >
                <span className="dash2-sidebar-toggle__icon" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </button>
            ) : null}
            <div className="dash2-header__copy">
              <h1>{authRequired ? 'HmSTx Dashboard' : activeWorkspaceTitle}</h1>
              <p>{authRequired ? 'Admin workspace sign-in is required.' : activeWorkspaceSummary}</p>
            </div>
          </div>
          <div className="dash2-header__meta">
            {authRequired ? (
              <StatusBadge tone="warn">sign in required</StatusBadge>
            ) : (
              <>
                <StatusBadge tone={statusTone(lifecycleState)}>{lifecycleState}</StatusBadge>
                <span>{bootstrap?.generatedAt ? new Date(bootstrap.generatedAt).toLocaleString() : 'Waiting for snapshot'}</span>
                <label className="dash2-theme-picker">
                  <span>Theme</span>
                  <select className="ui-input" value={theme} onChange={(event) => setTheme(event.target.value)}>
                    {THEME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="dash2-theme-picker">
                  <span>Style</span>
                  <select className="ui-input" value={styleVariant} onChange={(event) => setStyleVariant(event.target.value)}>
                    {STYLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <button className="ui-button" type="button" onClick={handleRefresh} disabled={headerBusy}>
                  {headerBusy ? 'Refreshing…' : 'Refresh'}
                </button>
                <button className="ui-button" type="button" onClick={handleLogout} disabled={headerBusy}>
                  Log out
                </button>
              </>
            )}
          </div>
        </header>

        {loadingBootstrap ? <LoadingState label="Loading dashboard bootstrap…" /> : null}
        {authRequired ? (
          <section className="dash2-login-wrap">
            <div className="dash2-login-card">
              <h2>Sign in to continue</h2>
              <p>
                {loginNextPath
                  ? `Sign in to continue to ${loginNextPath.replaceAll('/', '').replace(/^\w/, (char) => char.toUpperCase())}.`
                  : 'Dashboard v2 reads protected admin workspace snapshots.'}
              </p>
              <form className="dash2-login-form" onSubmit={handleLogin}>
                <label>
                  <span>Username</span>
                  <input
                    className="ui-input"
                    autoComplete="username"
                    value={loginUsername}
                    onChange={(event) => setLoginUsername(event.target.value)}
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    className="ui-input"
                    autoComplete="current-password"
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                  />
                </label>
                <button className="ui-button ui-button--primary" type="submit" disabled={loginBusy}>
                  {loginBusy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              {loginError ? <ErrorState message={loginError} /> : null}
            </div>
          </section>
        ) : null}
        {bootstrapError && !authRequired ? <ErrorState message={bootstrapError} /> : null}
        {!authRequired && loadingWorkspace && !hasDisplayedWorkspaceData ? <LoadingState /> : null}
        {!authRequired && workspaceError && !hasDisplayedWorkspaceData ? <ErrorState message={workspaceError} /> : null}

        {!authRequired && workspaceData && hasDisplayedWorkspaceData ? (
          <section className="dash2-content">
            {transitionLabel ? <p className="dash2-admin-note">{transitionLabel}…</p> : null}
            {!transitionLabel && loadingWorkspace ? <p className="dash2-admin-note">Refreshing workspace data…</p> : null}
            {isWorkspaceStale && activeWorkspace === displayedWorkspace ? (
              <p className="dash2-admin-note">Showing the last successful snapshot while the workspace refresh completes.</p>
            ) : null}
            {workspaceError ? <ErrorState message={workspaceError} /> : null}
            <WorkspaceViewport
              workspace={displayedWorkspace}
              payload={workspaceData}
              adminActions={{
                adminPassword,
                controlBusyKey,
                controlStatus,
                lockBusy: controllerBusy,
                onAdminPasswordChange: setAdminPassword,
                onControl: handleServiceControl,
                onUnlock: handleUnlockController,
                onLock: handleLockController,
              }}
              workspaceActions={{
                onRefresh: () => {
                  reloadBootstrap();
                  reloadWorkspace();
                },
                currentUsername: bootstrap?.user?.username || '',
              }}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
