'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { appFetch } from '../demo-api';
import { ErrorState, LoadingState, StatusBadge } from './components';
import { toErrorMessage } from './errors';
import { controlService, lockServiceController, unlockServiceController } from './api';
import { useWorkspaceData } from './useWorkspaceData';
import { WorkspaceViewport } from './workspaces';
import type { UiNavItem, WorkspaceKey } from './types';

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
    bootstrap,
    bootstrapError,
    loadingBootstrap,
    reloadBootstrap,
    setActiveWorkspace,
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

  const nav = bootstrap?.nav && bootstrap.nav.length > 0 ? bootstrap.nav : fallbackNav;
  const userLabel = bootstrap?.user?.username || 'operator';
  const lifecycleState = String(bootstrap?.lifecycle?.state || 'unknown');
  const authRequired = useMemo(
    () => /login required|session expired|unauthorized|401/i.test(bootstrapError),
    [bootstrapError]
  );

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

      window.location.reload();
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
      await appFetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      window.location.reload();
    } finally {
      setHeaderBusy(false);
    }
  };

  return (
    <div className="dash2-shell">
      <aside className="dash2-sidebar" aria-label="Dashboard workspaces">
        <div className="dash2-brand">
          <strong>HmSTx v2</strong>
          <span>Neon operations console</span>
        </div>

        <nav className="dash2-nav">
          {nav.map((item) => {
            const isActive = item.key === activeWorkspace;
            return (
              <button
                key={item.key}
                type="button"
                className={`dash2-nav__item ${isActive ? 'dash2-nav__item--active' : ''}`}
                onClick={() => setActiveWorkspace(item.key as WorkspaceKey)}
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

      <main className="dash2-main" id="app-main">
        <header className="dash2-header">
          <div>
            <h1>{nav.find((entry) => entry.key === activeWorkspace)?.label || 'Dashboard'}</h1>
            <p>{nav.find((entry) => entry.key === activeWorkspace)?.summary || 'Home server control workspace'}</p>
          </div>
          <div className="dash2-header__meta">
            <StatusBadge tone={statusTone(lifecycleState)}>{lifecycleState}</StatusBadge>
            <span>{bootstrap?.generatedAt ? new Date(bootstrap.generatedAt).toLocaleString() : 'Waiting for snapshot'}</span>
            <button className="ui-button" type="button" onClick={handleRefresh} disabled={headerBusy}>
              {headerBusy ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="ui-button" type="button" onClick={handleLogout} disabled={headerBusy}>
              Log out
            </button>
          </div>
        </header>

        {loadingBootstrap ? <LoadingState label="Loading dashboard bootstrap…" /> : null}
        {authRequired ? (
          <section className="dash2-login-card">
            <h2>Sign in to continue</h2>
            <p>Dashboard v2 reads protected admin workspace snapshots.</p>
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
          </section>
        ) : null}
        {bootstrapError && !authRequired ? <ErrorState message={bootstrapError} /> : null}
        {!authRequired && loadingWorkspace ? <LoadingState /> : null}
        {!authRequired && workspaceError ? <ErrorState message={workspaceError} /> : null}

        {!authRequired && !loadingWorkspace && !workspaceError && workspaceData ? (
          <section className="dash2-content">
            <WorkspaceViewport
              workspace={activeWorkspace}
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
