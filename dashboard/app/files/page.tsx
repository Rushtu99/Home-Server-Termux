'use client';

import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';

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

type FsEntry = {
  accessLevel?: 'deny' | 'read' | 'write' | string;
  editable: boolean;
  modifiedAt: string;
  name: string;
  path: string;
  shareId?: number;
  shareSourceType?: string;
  size: number;
  type: string;
};

type FsBreadcrumb = {
  label: string;
  path: string;
};

type FsPayload = {
  breadcrumbs: FsBreadcrumb[];
  entries: FsEntry[];
  path: string;
  root: string;
  share: null | {
    accessLevel: 'deny' | 'read' | 'write' | string;
    id: number;
    isReadOnly: boolean;
    name: string;
    pathKey: string;
    sourceType: string;
  };
};

type FsClipboard = {
  mode: 'copy' | 'move';
  name: string;
  path: string;
  type: string;
} | null;

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

const EMPTY_FS: FsPayload = {
  breadcrumbs: [{ label: 'Drives', path: '' }],
  entries: [],
  path: '',
  root: '',
  share: null,
};

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return 'Waiting for first scan';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Waiting for first scan' : parsed.toLocaleString();
};

const formatEntryTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Unknown' : parsed.toLocaleString();
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
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

const normalizeFsPayload = (payload: Partial<FsPayload> | null | undefined): FsPayload => ({
  breadcrumbs: Array.isArray(payload?.breadcrumbs) && payload.breadcrumbs.length > 0
    ? payload.breadcrumbs.map((crumb) => ({
        label: String(crumb?.label || 'Drives'),
        path: String(crumb?.path || ''),
      }))
    : [{ label: 'Drives', path: '' }],
  entries: Array.isArray(payload?.entries)
    ? payload.entries.map((entry) => ({
        accessLevel: String(entry?.accessLevel || ''),
        editable: entry?.editable !== false,
        modifiedAt: String(entry?.modifiedAt || ''),
        name: String(entry?.name || ''),
        path: String(entry?.path || ''),
        shareId: entry?.shareId ? Number(entry.shareId) : undefined,
        shareSourceType: entry?.shareSourceType ? String(entry.shareSourceType) : undefined,
        size: Number(entry?.size || 0),
        type: String(entry?.type || 'file'),
      }))
    : [],
  path: String(payload?.path || ''),
  root: String(payload?.root || ''),
  share: payload?.share ? {
    accessLevel: String(payload.share.accessLevel || ''),
    id: Number(payload.share.id || 0),
    isReadOnly: Boolean(payload.share.isReadOnly),
    name: String(payload.share.name || ''),
    pathKey: String(payload.share.pathKey || ''),
    sourceType: String(payload.share.sourceType || 'folder'),
  } : null,
});

const topLevelName = (value: string) => value.split('/').filter(Boolean)[0] || value;

export default function FilesPage() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [driveState, setDriveState] = useState<DrivePayload>(EMPTY_PAYLOAD);
  const [browser, setBrowser] = useState<FsPayload>(EMPTY_FS);
  const [loadError, setLoadError] = useState('');
  const [browserError, setBrowserError] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [driveAccessDenied, setDriveAccessDenied] = useState(false);
  const [showDriveLog, setShowDriveLog] = useState(false);
  const [selectedPath, setSelectedPath] = useState('');
  const [search, setSearch] = useState('');
  const [clipboard, setClipboard] = useState<FsClipboard>(null);
  const [menuPath, setMenuPath] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const loadDriveState = async () => {
    const res = await fetch(`${API}/drives`, { credentials: 'include' });
    if (res.status === 403) {
      setDriveAccessDenied(true);
      return EMPTY_PAYLOAD;
    }
    if (!res.ok) {
      throw new Error(res.status === 401 ? 'Login required to read drive state' : 'Unable to read drive state');
    }

    setDriveAccessDenied(false);
    return normalizeDrivePayload(await res.json());
  };

  const loadDirectory = async (targetPath = '', options?: { preserveSelection?: boolean }) => {
    setBrowserBusy(true);
    try {
      const query = new URLSearchParams();
      if (targetPath) {
        query.set('path', targetPath);
      }

      const suffix = query.toString() ? `?${query.toString()}` : '';
      const res = await fetch(`${API}/fs/list${suffix}`, { credentials: 'include' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(payload?.error || (res.status === 401 ? 'Login required to read files' : 'Unable to load files')));
      }

      const normalizedPayload = normalizeFsPayload(payload);
      startTransition(() => {
        setBrowser(normalizedPayload);
        setBrowserError('');
        if (!options?.preserveSelection || !normalizedPayload.entries.some((entry) => entry.path === selectedPath)) {
          setSelectedPath('');
        }
      });
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Unable to load files'));
    } finally {
      setBrowserBusy(false);
    }
  };

  useEffect(() => {
    let active = true;

    const syncState = async () => {
      try {
        const payload = await loadDriveState();
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

  useEffect(() => {
    void loadDirectory('');
  }, []);

  useEffect(() => {
    setMenuPath('');
  }, [browser.path]);

  const runManualCheck = async () => {
    setManualBusy(true);
    try {
      const res = await fetch(`${API}/drives/check`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.status === 403) {
        setDriveAccessDenied(true);
        setLoadError('Drive management is available to admins only.');
        return;
      }
      if (!res.ok) {
        throw new Error(res.status === 401 ? 'Login required to run a drive check' : 'Drive check failed');
      }

      const payload = normalizeDrivePayload(await res.json());
      startTransition(() => {
        setDriveState(payload);
        setLoadError('');
      });
      await loadDirectory(browser.path, { preserveSelection: true });
    } catch (error) {
      setLoadError(String(error instanceof Error ? error.message : error || 'Drive check failed'));
    } finally {
      setManualBusy(false);
    }
  };

  const runFsCommand = async (endpoint: string, body: Record<string, string>) => {
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(String(payload?.error || 'Filesystem action failed'));
    }
    return payload;
  };

  const createFolder = async () => {
    const label = browser.path === '' ? 'Share name' : 'Folder name';
    const name = window.prompt(label);
    if (!name) {
      return;
    }

    try {
      if (browser.path === '') {
        const res = await fetch(`${API}/shares`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String(payload?.error || 'Unable to create share'));
        }
      } else {
        await runFsCommand('/fs/mkdir', { name, path: browser.path });
      }
      await loadDirectory(browser.path, { preserveSelection: true });
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || `Unable to create ${browser.path === '' ? 'share' : 'folder'}`));
    }
  };

  const renameSelected = async () => {
    const entry = browser.entries.find((item) => item.path === selectedPath);
    if (!entry) {
      return;
    }

    const name = window.prompt('Rename entry', entry.name);
    if (!name || name === entry.name) {
      return;
    }

    try {
      const payload = await runFsCommand('/fs/rename', { path: entry.path, name });
      await loadDirectory(browser.path);
      setSelectedPath(String(payload?.path || ''));
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Unable to rename entry'));
    }
  };

  const deleteSelected = async () => {
    const entry = browser.entries.find((item) => item.path === selectedPath);
    if (!entry) {
      return;
    }
    if (!window.confirm(`Delete ${entry.name}?`)) {
      return;
    }

    try {
      await runFsCommand('/fs/delete', { path: entry.path });
      setSelectedPath('');
      await loadDirectory(browser.path);
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Unable to delete entry'));
    }
  };

  const openEntry = async (entry: FsEntry) => {
    if (entry.type === 'directory' || entry.type === 'symlink') {
      await loadDirectory(entry.path);
      return;
    }

    window.open(`${API}/fs/download?path=${encodeURIComponent(entry.path)}`, '_blank', 'noopener,noreferrer');
  };

  const setClipboardFromEntry = (entry: FsEntry, mode: 'copy' | 'move') => {
    if (!entry.editable) {
      setBrowserError(`This ${entry.type} cannot be ${mode === 'move' ? 'moved' : 'copied'}.`);
      return;
    }

    setClipboard({
      mode,
      name: entry.name,
      path: entry.path,
      type: entry.type,
    });
    setBrowserError('');
  };

  const pasteClipboard = async () => {
    if (!clipboard) {
      return;
    }

    try {
      const payload = await runFsCommand('/fs/paste', {
        sourcePath: clipboard.path,
        destinationPath: browser.path,
        mode: clipboard.mode,
      });
      await loadDirectory(browser.path, { preserveSelection: true });
      setSelectedPath(String(payload?.path || ''));
      if (clipboard.mode === 'move') {
        setClipboard(null);
      }
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Paste failed'));
    }
  };

  const handleUploadTrigger = () => {
    uploadInputRef.current?.click();
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploadBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const params = new URLSearchParams({
        name: file.name,
        path: browser.path,
      });
      const res = await fetch(`${API}/fs/upload?${params.toString()}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': file.name,
        },
        body: bytes,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(payload?.error || 'Upload failed'));
      }

      await loadDirectory(browser.path, { preserveSelection: true });
    } catch (error) {
      setBrowserError(String(error instanceof Error ? error.message : error || 'Upload failed'));
    } finally {
      event.target.value = '';
      setUploadBusy(false);
    }
  };

  const drives = driveState.manifest.drives;
  const statusText = driveAccessDenied
    ? 'Drive management is admin-only. Share browsing remains available for accounts with share access.'
    : !driveState.agentInstalled
    ? 'termux-drive-agent is not installed yet. Only C will appear until the agent is available.'
    : drives.length > 0
      ? `${drives.length} removable drive${drives.length === 1 ? '' : 's'} detected.`
      : 'Only C is currently present. Connect a removable drive or run Check Drives.';

  const selectedEntry = browser.entries.find((entry) => entry.path === selectedPath) || null;
  const filteredEntries = deferredSearch
    ? browser.entries.filter((entry) => entry.name.toLowerCase().includes(deferredSearch))
    : browser.entries;
  const directoryCount = filteredEntries.filter((entry) => entry.type === 'directory' || entry.type === 'symlink').length;
  const fileCount = filteredEntries.length - directoryCount;
  const canWriteCurrentFolder = browser.path === ''
    ? false
    : browser.share?.accessLevel === 'write' && browser.share?.isReadOnly !== true;
  const quickLinks = browser.path === ''
    ? browser.entries.filter((entry) => entry.type === 'directory' || entry.type === 'symlink')
    : browser.entries
        .filter((entry) => entry.type === 'directory' || entry.type === 'symlink')
        .slice(0, 10);

  return (
    <main id="app-main" className="tool-page tool-page--filesystem">
      <header className="tool-toolbar">
        <div className="tool-toolbar__title">
          <h1>Filesystem</h1>
          <p>Custom explorer over `~/Drives`, with drive-state controls, direct uploads, and local file actions instead of the embedded FileBrowser UI.</p>
        </div>
        <div className="tool-toolbar__actions">
          {!driveAccessDenied ? (
            <button className="ui-button ui-button--primary" type="button" onClick={runManualCheck} disabled={manualBusy}>
              {manualBusy ? 'Checking…' : 'Check Drives'}
            </button>
          ) : null}
          <button className="ui-button" type="button" onClick={() => void loadDirectory(browser.path, { preserveSelection: true })} disabled={browserBusy}>
            {browserBusy ? 'Refreshing…' : 'Refresh Folder'}
          </button>
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
            {!driveAccessDenied ? (
              <div className="tool-inline-actions">
                <button className="ui-button" type="button" onClick={() => setShowDriveLog((value) => !value)}>
                  {showDriveLog ? 'Hide Drive Log' : 'Show Drive Log'}
                </button>
              </div>
            ) : null}
          </div>
          {loadError ? <p className="status-message status-message--error">{loadError}</p> : null}
        </div>

        {!driveAccessDenied ? (
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
        ) : null}

        {showDriveLog && !driveAccessDenied ? (
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

        <section className="fs-shell">
          <aside className="fs-sidebar">
            <div className="fs-sidebar__section">
              <div className="fs-sidebar__header">
                <strong>Locations</strong>
              </div>
              <button
                className={`fs-shortcut ${browser.path === '' ? 'fs-shortcut--active' : ''}`}
                type="button"
                onClick={() => void loadDirectory('')}
              >
                Drives Root
              </button>
              {quickLinks.map((entry) => (
                <button
                  key={entry.path}
                  className={`fs-shortcut ${topLevelName(browser.path) === topLevelName(entry.path) ? 'fs-shortcut--active' : ''}`}
                  type="button"
                  onClick={() => void loadDirectory(entry.path)}
                >
                  <span>{entry.name}</span>
                  <small>{browser.path === '' ? (entry.shareSourceType || 'share') : (entry.type === 'directory' || entry.type === 'symlink' ? 'folder' : 'file')}</small>
                </button>
              ))}
            </div>

            <div className="fs-sidebar__section">
              <div className="fs-sidebar__header">
                <strong>Selection</strong>
              </div>
              {selectedEntry ? (
                <div className="fs-selection">
                  <p>{selectedEntry.name}</p>
                  <span>{selectedEntry.type}</span>
                  <span>{selectedEntry.type === 'file' ? formatBytes(selectedEntry.size) : 'directory'}</span>
                  <span>{formatEntryTime(selectedEntry.modifiedAt)}</span>
                </div>
              ) : (
                <p className="tool-banner__meta">Pick a file or folder to act on it.</p>
              )}
            </div>
          </aside>

          <div className="fs-main">
            <div className="fs-overview-strip">
              <div className="fs-overview-pill">
                <span>Current folder</span>
                <strong>{browser.breadcrumbs[browser.breadcrumbs.length - 1]?.label || 'Drives'}</strong>
              </div>
              <div className="fs-overview-pill">
                <span>Folders</span>
                <strong>{directoryCount}</strong>
              </div>
              <div className="fs-overview-pill">
                <span>Files</span>
                <strong>{fileCount}</strong>
              </div>
              <div className="fs-overview-pill">
                <span>Selection</span>
                <strong>{selectedEntry ? selectedEntry.name : 'None'}</strong>
              </div>
            </div>

            <div className="fs-toolbar">
              <div className="fs-breadcrumbs" aria-label="Filesystem breadcrumbs">
                {browser.breadcrumbs.map((crumb) => (
                  <button key={`${crumb.label}-${crumb.path}`} className="fs-crumb" type="button" onClick={() => void loadDirectory(crumb.path)}>
                    {crumb.label}
                  </button>
                ))}
              </div>
              <div className="fs-actions fs-actions--rail">
                <input
                  className="ui-input fs-search"
                  type="search"
                  placeholder="Filter current folder"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button className="ui-button" type="button" onClick={createFolder} disabled={browser.path !== '' && !canWriteCurrentFolder}>
                  {browser.path === '' ? 'New Share' : 'New Folder'}
                </button>
                <button className="ui-button" type="button" onClick={handleUploadTrigger} disabled={uploadBusy || !canWriteCurrentFolder}>
                  {uploadBusy ? 'Uploading…' : 'Upload File'}
                </button>
                <button className="ui-button" type="button" onClick={renameSelected} disabled={!selectedEntry || !selectedEntry.editable}>
                  Rename
                </button>
                <button className="ui-button" type="button" onClick={deleteSelected} disabled={!selectedEntry || !selectedEntry.editable}>
                  Delete
                </button>
                <button className="ui-button" type="button" onClick={() => selectedEntry && setClipboardFromEntry(selectedEntry, 'copy')} disabled={!selectedEntry || !selectedEntry.editable}>
                  Copy
                </button>
                <button className="ui-button" type="button" onClick={() => selectedEntry && setClipboardFromEntry(selectedEntry, 'move')} disabled={!selectedEntry || !selectedEntry.editable}>
                  Cut
                </button>
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => selectedEntry && void openEntry(selectedEntry)}
                  disabled={!selectedEntry}
                >
                  {selectedEntry?.type === 'file' ? 'Download' : 'Open'}
                </button>
                <input ref={uploadInputRef} type="file" hidden onChange={handleUpload} />
              </div>
            </div>

            <div className="fs-meta">
              <span>{browser.root || 'Resolving root…'}</span>
              {browser.share ? <span>{browser.share.name} · {browser.share.accessLevel}{browser.share.isReadOnly ? ' · read-only share' : ''}</span> : <span>Shared folders</span>}
              <span>{filteredEntries.length} visible entr{filteredEntries.length === 1 ? 'y' : 'ies'}</span>
            </div>

            {browserError ? <p className="status-message status-message--error">{browserError}</p> : null}

            {clipboard ? (
              <div className="fs-clipboard-bar">
                <div className="fs-clipboard-copy">
                  <span>{clipboard.mode === 'move' ? 'Cut' : 'Copy'} queued</span>
                  <strong>{clipboard.name}</strong>
                  <small>Paste into {browser.breadcrumbs[browser.breadcrumbs.length - 1]?.label || 'current folder'}</small>
                </div>
                <div className="fs-browser-actions">
                  <button className="ui-button ui-button--primary" type="button" onClick={() => void pasteClipboard()} disabled={!canWriteCurrentFolder}>
                    Paste Here
                  </button>
                  <button className="ui-button" type="button" onClick={() => setClipboard(null)}>
                    Clear
                  </button>
                </div>
              </div>
            ) : null}

            <div className="fs-browser-list">
              {filteredEntries.length === 0 ? (
                <div className="tool-empty fs-empty">
                  {browserBusy ? 'Loading folder…' : 'This folder is empty.'}
                </div>
              ) : (
                filteredEntries.map((entry) => {
                  const isDirectory = entry.type === 'directory' || entry.type === 'symlink';
                  const isSelected = selectedPath === entry.path;

                  return (
                    <article
                      key={entry.path}
                      className={`fs-browser-item ${isSelected ? 'fs-browser-item--selected' : ''}`}
                      onClick={() => setSelectedPath(entry.path)}
                      onDoubleClick={() => void openEntry(entry)}
                    >
                      <button className="fs-browser-main" type="button" onClick={() => void openEntry(entry)}>
                        <span className={`fs-entry-icon fs-entry-icon--${isDirectory ? 'directory' : 'file'} fs-entry-icon--tile`} aria-hidden="true" />
                        <span className="fs-browser-copy">
                          <strong>{entry.name}</strong>
                          <span>{isDirectory ? 'Folder' : 'File'} · {formatEntryTime(entry.modifiedAt)}</span>
                        </span>
                      </button>

                      <div className="fs-browser-meta">
                        <span>{isDirectory ? '—' : formatBytes(entry.size)}</span>
                        <span>{browser.path === '' ? `${entry.shareSourceType || 'share'} · ${entry.accessLevel || 'read'}` : entry.editable ? 'editable' : 'protected'}</span>
                      </div>

                      <div className="fs-browser-actions">
                        <button className="ui-button" type="button" onClick={() => void openEntry(entry)}>
                          {isDirectory ? 'Open' : 'Download'}
                        </button>
                        <div className="fs-row-menu">
                          <button
                            className="ui-button fs-row-menu__trigger"
                            type="button"
                            onClick={() => setMenuPath((current) => current === entry.path ? '' : entry.path)}
                          >
                            ⋯
                          </button>
                          {menuPath === entry.path ? (
                            <div className="fs-row-menu__panel">
                              <button className="ui-button fs-row-menu__item" type="button" onClick={() => { setSelectedPath(entry.path); setMenuPath(''); }}>
                                Select
                              </button>
                              <button className="ui-button fs-row-menu__item" type="button" onClick={() => { setClipboardFromEntry(entry, 'copy'); setMenuPath(''); }} disabled={!entry.editable}>
                                Copy
                              </button>
                              <button className="ui-button fs-row-menu__item" type="button" onClick={() => { setClipboardFromEntry(entry, 'move'); setMenuPath(''); }} disabled={!entry.editable}>
                                Cut
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
              <input ref={uploadInputRef} type="file" hidden onChange={handleUpload} />
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
