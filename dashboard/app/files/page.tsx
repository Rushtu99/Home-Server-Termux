'use client';

import { startTransition, useEffect, useState } from 'react';
import { useGatewayBase } from '../useGatewayBase';

const API = '/api';

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

const EMPTY_PAYLOAD: DrivePayload = {
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

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return 'Waiting for first scan';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Waiting for first scan' : parsed.toLocaleString();
};

const normalizePayload = (payload: Partial<DrivePayload> | null | undefined): DrivePayload => ({
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

export default function FilesPage() {
  const gatewayBase = useGatewayBase();
  const frameSrc = gatewayBase ? `${gatewayBase}/files/` : '';
  const [driveState, setDriveState] = useState<DrivePayload>(EMPTY_PAYLOAD);
  const [loadError, setLoadError] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [showDriveLog, setShowDriveLog] = useState(false);

  useEffect(() => {
    let active = true;

    const syncState = async () => {
      try {
        const res = await fetch(`${API}/drives`, { credentials: 'include' });
        if (!res.ok) {
          throw new Error(res.status === 401 ? 'Login required to read drive state' : 'Unable to read drive state');
        }

        const payload = normalizePayload(await res.json());
        if (!active) {
          return;
        }

        startTransition(() => {
          setDriveState(payload);
          setLoadError('');
        });
      } catch (error) {
        if (active) {
          setLoadError(String(error instanceof Error ? error.message : error || 'Unable to read drive state'));
        }
      }
    };

    void syncState();
    const timer = window.setInterval(() => {
      void syncState();
    }, driveState.refreshIntervalMs);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [driveState.refreshIntervalMs]);

  const runManualCheck = async () => {
    setManualBusy(true);
    try {
      const res = await fetch(`${API}/drives/check`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error(res.status === 401 ? 'Login required to run a drive check' : 'Drive check failed');
      }

      const payload = normalizePayload(await res.json());
      startTransition(() => {
        setDriveState(payload);
        setLoadError('');
      });
    } catch (error) {
      setLoadError(String(error instanceof Error ? error.message : error || 'Drive check failed'));
    } finally {
      setManualBusy(false);
    }
  };

  const drives = driveState.manifest.drives;
  const statusText = !driveState.agentInstalled
    ? 'termux-drive-agent is not installed yet. Only C will appear until the agent is available.'
    : drives.length > 0
      ? `${drives.length} removable drive${drives.length === 1 ? '' : 's'} detected.`
      : 'Only C is currently present. Connect a removable drive or run Check Drives.';

  return (
    <main id="app-main" className="tool-page">
      <header className="tool-toolbar">
        <div className="tool-toolbar__title">
          <h1>Filesystem</h1>
          <p>Drive state now comes from the Termux-level drive agent, with manual refresh and a live event log before the embedded browser.</p>
        </div>
        <div className="tool-toolbar__actions">
          <button className="ui-button ui-button--primary" type="button" onClick={runManualCheck} disabled={manualBusy}>
            {manualBusy ? 'Checking…' : 'Check Drives'}
          </button>
          {gatewayBase ? (
            <a href={frameSrc} target="_blank" rel="noreferrer" className="ui-button">
              Open In New Tab
            </a>
          ) : (
            <span className="status-message">Resolving gateway…</span>
          )}
        </div>
      </header>

      <section className="tool-stack">
        <div className="tool-banner">
          <div className="tool-banner__row">
            <div>
              <strong>{statusText}</strong>
              <p className="tool-banner__meta">Last agent scan: {formatTimestamp(driveState.manifest.generatedAt)}</p>
              <p className="tool-banner__meta">Last page refresh: {formatTimestamp(driveState.checkedAt)}</p>
            </div>
            <div className="tool-inline-actions">
              <button className="ui-button" type="button" onClick={() => setShowDriveLog((value) => !value)}>
                {showDriveLog ? 'Hide Drive Log' : 'Show Drive Log'}
              </button>
            </div>
          </div>
          {loadError ? <p className="status-message status-message--error">{loadError}</p> : null}
        </div>

        <div className="tool-card-grid">
          <article className="tool-card">
            <p className="tool-card__eyebrow">Internal</p>
            <h2 className="tool-card__title">C</h2>
            <p className="tool-card__meta">Always present through the shared Android storage bind.</p>
          </article>
          {drives.map((drive) => (
            <article key={`${drive.device}-${drive.mountPoint}`} className="tool-card">
              <div className="tool-inline-actions">
                <p className="tool-card__eyebrow">{drive.filesystem || 'drive'}</p>
                <span className={`tool-status-pill ${drive.state === 'mounted' ? 'tool-status-pill--ok' : 'tool-status-pill--error'}`}>
                  {drive.state}
                </span>
              </div>
              <h2 className="tool-card__title">{drive.dirName || `${drive.letter} (${drive.name})`}</h2>
              <p className="tool-card__meta">{drive.mountPoint}</p>
              <p className="tool-card__meta">Device: {drive.device}</p>
              {drive.uuid ? <p className="tool-card__meta">UUID: {drive.uuid}</p> : null}
              {drive.error ? <p className="status-message status-message--error">{drive.error}</p> : null}
            </article>
          ))}
        </div>

        {showDriveLog ? (
          <div className="tool-log-shell">
            {driveState.events.length === 0 ? (
              <p className="tool-banner__meta">No drive agent events yet.</p>
            ) : (
              <div className="tool-log-list">
                {driveState.events.map((event, index) => (
                  <article key={`${event.timestamp}-${event.event}-${index}`} className="tool-log-item">
                    <strong>{event.event}</strong>
                    <p className="tool-log-meta">
                      [{formatTimestamp(event.timestamp)}] {event.level}
                      {event.letter ? ` · ${event.letter}` : ''}
                      {event.name ? ` · ${event.name}` : ''}
                      {event.filesystem ? ` · ${event.filesystem}` : ''}
                    </p>
                    {event.mountPoint ? <p className="tool-log-meta">{event.mountPoint}</p> : null}
                    {event.error ? <p className="tool-log-meta">{event.error}</p> : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <section className="tool-frame-shell">
        {gatewayBase ? (
          <iframe title="File Manager" src={frameSrc} className="tool-frame" />
        ) : (
          <div className="tool-empty" role="status" aria-live="polite">
            Gateway is still resolving. The filesystem view will load automatically.
          </div>
        )}
        </section>
      </section>
    </main>
  );
}
