'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addMediaTorrent,
  createFtpDirectory,
  createFtpFavourite,
  deleteFtpFavourite as removeFtpFavourite,
  listFtpDefaults,
  listFtpDirectory,
  listFtpFavourites,
  mountFtpFavourite,
  unmountFtpFavourite,
  updateFtpFavourite,
  uploadToFtp,
} from '../api';
import { EmptyState, KeyValueList, MetricGrid, MetricTile, SectionCard, ServiceList, StatusBadge } from '../components';
import { toErrorMessage } from '../errors';
import {
  asArray,
  asRecord,
  compactPathSummary,
  createTransferDraft,
  formatBytes,
  LocalTabBar,
  resolveGatewayHref,
  toServiceListItems,
  toneFromStatus,
  WorkspaceActions,
} from './shared';

export function TransfersWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const controlPlane = asRecord(payload.controlPlane);
  const controlPlaneCatalog = asRecord(controlPlane.catalog);
  const catalogServices = asArray<Record<string, unknown>>(controlPlaneCatalog.services);
  const defaults = asRecord(payload.ftpDefaults);
  const favourites = asArray<Record<string, unknown>>(payload.favourites);
  const services = asArray<Record<string, unknown>>(payload.services);
  const torrent = asRecord(payload.torrent);
  const qbDiagnostics = asRecord(payload.qbDiagnostics);
  const qbCategoryPaths = asRecord(qbDiagnostics.categories);
  const arrDiagnostics = asRecord(payload.arrDiagnostics);
  const laneSummary = asRecord(torrent.laneSummary);
  const standaloneLane = asRecord(laneSummary.standalone);
  const serviceInventory = catalogServices.length > 0 ? catalogServices : services;
  const qbitServiceFromPayload = asRecord(torrent.service);
  const qbitService = (qbitServiceFromPayload.key
    ? qbitServiceFromPayload
    : serviceInventory.find((entry) => String(entry.key || '') === 'qbittorrent')) || null;
  const qbitStatus = String(qbitService?.status || torrent.status || 'unknown');
  const qbitRoute = String(qbitService?.route || torrent.route || '');
  const qbitSummary = String(
    qbitService?.description
    || qbitService?.blocker
    || torrent.summary
    || 'Dedicated torrent queue status'
  );
  const standaloneDestination = String(
    torrent.standaloneDestination
    || standaloneLane.savePath
    || torrent.destinationPath
    || torrent.defaultDestinationPath
    || defaults.downloadRoot
    || ''
  );
  const torrentServices = serviceInventory.filter((entry) => {
    const key = String(entry.key || '').toLowerCase();
    const surface = String(entry.surface || '').toLowerCase();
    const group = String(entry.group || '').toLowerCase();
    return key === String(qbitService?.key || '').toLowerCase() || surface === 'downloads' || group === 'downloads';
  });
  const [activeTab, setActiveTab] = useState<'connect' | 'favourites' | 'torrent'>('connect');
  const [favouriteBusyId, setFavouriteBusyId] = useState<number>(0);
  const [favouriteStatus, setFavouriteStatus] = useState('');
  const [ftpDefaultsState, setFtpDefaultsState] = useState<Record<string, unknown>>(defaults);
  const [ftpFavouritesState, setFtpFavouritesState] = useState<Array<Record<string, unknown>>>(favourites);
  const [ftpDraft, setFtpDraft] = useState(() => createTransferDraft(defaults));
  const [ftpEditingId, setFtpEditingId] = useState<number | null>(null);
  const [ftpBusy, setFtpBusy] = useState(false);
  const [ftpStatus, setFtpStatus] = useState('');
  const [ftpEntries, setFtpEntries] = useState<Array<Record<string, unknown>>>([]);
  const [ftpPath, setFtpPath] = useState('/');
  const [ftpUploadLocalPath, setFtpUploadLocalPath] = useState('');
  const [ftpUploadRemotePath, setFtpUploadRemotePath] = useState('');
  const [ftpFolderName, setFtpFolderName] = useState('');
  const [activeFavouriteId, setActiveFavouriteId] = useState<number | null>(null);
  const [torrentSource, setTorrentSource] = useState('');
  const [torrentBusy, setTorrentBusy] = useState(false);
  const [torrentStatus, setTorrentStatus] = useState('');

  useEffect(() => {
    setFtpDefaultsState(defaults);
    setFtpFavouritesState(favourites);
    if (!ftpEditingId) {
      setFtpDraft((current) => ({
        ...current,
        host: String(defaults.host || current.host || ''),
        port: String(defaults.port || current.port || 21),
        username: String(defaults.user || current.username || 'anonymous'),
        secure: Boolean(defaults.secure),
        name: String(defaults.defaultName || current.name || ''),
        mountName: String(defaults.defaultName || current.mountName || ''),
      }));
    }
  }, [defaults, favourites, ftpEditingId]);

  const reloadTransferState = useCallback(async () => {
    try {
      const [nextDefaults, nextFavourites] = await Promise.all([
        listFtpDefaults(),
        listFtpFavourites(),
      ]);
      setFtpDefaultsState(asRecord(nextDefaults));
      setFtpFavouritesState(asArray<Record<string, unknown>>(nextFavourites.favourites));
    } catch (error) {
      setFtpStatus(toErrorMessage(error, 'Unable to refresh transfer state'));
    }
  }, []);

  const ftpPayload = useCallback((pathOverride?: string, favouriteIdOverride?: number | null) => ({
    favouriteId: favouriteIdOverride ?? activeFavouriteId ?? undefined,
    host: ftpDraft.host.trim(),
    password: ftpDraft.password,
    port: Number(ftpDraft.port || 21) || 21,
    remotePath: pathOverride || ftpPath || '/',
    secure: ftpDraft.secure,
    username: ftpDraft.username.trim() || 'anonymous',
  }), [activeFavouriteId, ftpDraft, ftpPath]);

  const loadDirectory = useCallback(async (pathOverride?: string, favouriteIdOverride?: number | null) => {
    if (!ftpDraft.host.trim() && !favouriteIdOverride && !activeFavouriteId) {
      setFtpStatus('Enter a host or choose a saved favourite first.');
      return;
    }
    setFtpBusy(true);
    try {
      const response = await listFtpDirectory(ftpPayload(pathOverride, favouriteIdOverride));
      const entries = asArray<Record<string, unknown>>(response.entries);
      const nextPath = String(response.path || pathOverride || ftpPath || '/');
      setFtpEntries(entries);
      setFtpPath(nextPath);
      setFtpStatus(`Connected to ${ftpDraft.host || 'remote host'} at ${nextPath}`);
      if (favouriteIdOverride !== undefined) {
        setActiveFavouriteId(favouriteIdOverride ?? null);
      }
    } catch (error) {
      setFtpStatus(toErrorMessage(error, 'Unable to browse remote path'));
    } finally {
      setFtpBusy(false);
    }
  }, [activeFavouriteId, ftpDraft.host, ftpPath, ftpPayload]);

  const resetDraft = useCallback(() => {
    setFtpEditingId(null);
    setActiveFavouriteId(null);
    setFtpDraft(createTransferDraft(ftpDefaultsState));
  }, [ftpDefaultsState]);

  const applyFavourite = useCallback((favourite: Record<string, unknown>) => {
    setActiveFavouriteId(Number(favourite.id || 0) || null);
    setFtpDraft({
      host: String(favourite.host || ''),
      mountName: String(favourite.mountName || favourite.name || ''),
      name: String(favourite.name || ''),
      password: '',
      port: String(favourite.port || 21),
      remotePath: String(favourite.remotePath || '/'),
      secure: Boolean(favourite.secure),
      username: String(favourite.username || 'anonymous'),
    });
    setFtpPath(String(favourite.remotePath || '/'));
  }, []);

  const saveFavourite = async () => {
    if (!ftpDraft.name.trim() || !ftpDraft.host.trim()) {
      setFtpStatus('Display name and host are required.');
      return;
    }
    setFtpBusy(true);
    try {
      const payload = {
        host: ftpDraft.host.trim(),
        mountName: ftpDraft.mountName.trim() || ftpDraft.name.trim(),
        name: ftpDraft.name.trim(),
        password: ftpDraft.password,
        port: Number(ftpDraft.port || 21) || 21,
        remotePath: ftpDraft.remotePath.trim() || '/',
        secure: ftpDraft.secure,
        username: ftpDraft.username.trim() || 'anonymous',
      };
      const response = ftpEditingId
        ? await updateFtpFavourite(ftpEditingId, payload)
        : await createFtpFavourite(payload);
      if (response.success === false) {
        setFtpStatus(String(response.error || 'Unable to save favourite'));
        return;
      }
      setFtpStatus(ftpEditingId ? 'Favourite updated.' : 'Favourite saved.');
      setFtpEditingId(null);
      setFtpDraft((current) => ({ ...current, password: '' }));
      await reloadTransferState();
    } catch (error) {
      setFtpStatus(toErrorMessage(error, 'Unable to save favourite'));
    } finally {
      setFtpBusy(false);
    }
  };

  const deleteFavourite = async (item: Record<string, unknown>) => {
    const itemId = Number(item.id || 0);
    if (itemId <= 0) {
      return;
    }
    setFavouriteBusyId(itemId);
    try {
      const response = await removeFtpFavourite(itemId);
      setFavouriteStatus(response.success === false ? String(response.error || 'Delete failed') : 'Favourite deleted.');
      if (activeFavouriteId === itemId) {
        resetDraft();
      }
      await reloadTransferState();
    } catch (error) {
      setFavouriteStatus(toErrorMessage(error, 'Unable to delete favourite'));
    } finally {
      setFavouriteBusyId(0);
    }
  };

  const createFolder = async () => {
    if (!ftpFolderName.trim()) {
      setFtpStatus('Enter a folder name first.');
      return;
    }
    setFtpBusy(true);
    try {
      const remotePath = `${ftpPath.replace(/\/$/, '')}/${ftpFolderName.trim()}`.replace(/\/+/g, '/');
      const response = await createFtpDirectory(ftpPayload(remotePath));
      setFtpStatus(`Created ${String(response.remotePath || remotePath)}`);
      setFtpFolderName('');
      await loadDirectory(ftpPath);
    } catch (error) {
      setFtpStatus(toErrorMessage(error, 'Unable to create remote folder'));
    } finally {
      setFtpBusy(false);
    }
  };

  const uploadFile = async () => {
    if (!ftpUploadLocalPath.trim() || !ftpUploadRemotePath.trim()) {
      setFtpStatus('Set both local and remote upload paths.');
      return;
    }
    setFtpBusy(true);
    try {
      const response = await uploadToFtp({
        ...ftpPayload(),
        localPath: ftpUploadLocalPath.trim(),
        remotePath: ftpUploadRemotePath.trim(),
      });
      setFtpStatus(`Uploaded ${String(response.localPath || ftpUploadLocalPath)} to ${String(response.remotePath || ftpUploadRemotePath)}`);
      await loadDirectory(ftpPath);
    } catch (error) {
      setFtpStatus(toErrorMessage(error, 'Unable to upload file'));
    } finally {
      setFtpBusy(false);
    }
  };

  const handleToggleMount = async (favourite: Record<string, unknown>) => {
    const favouriteId = Number(favourite.id || 0);
    const mount = asRecord(favourite.mount);
    if (favouriteId <= 0) {
      return;
    }

    setFavouriteBusyId(favouriteId);
    try {
      const mountName = String(mount.mountName || favourite.mountName || favourite.name || 'Remote');
      if (Boolean(mount.mounted)) {
        const response = await unmountFtpFavourite(favouriteId);
        setFavouriteStatus(response.success === false ? String(response.error || 'Unmount failed') : 'Favourite unmounted.');
      } else {
        const response = await mountFtpFavourite(favouriteId);
        setFavouriteStatus(
          response.success === false
            ? String(response.error || 'Mount failed')
            : `Favourite mounted at ~/Drives/${mountName} and /mnt/termux-drives/${mountName}.`
        );
      }
      workspaceActions?.onRefresh();
    } catch (error) {
      setFavouriteStatus(toErrorMessage(error, 'Unable to toggle mount'));
    } finally {
      setFavouriteBusyId(0);
    }
  };

  const handleAddStandaloneTorrent = async () => {
    const source = torrentSource.trim();
    if (!source) {
      setTorrentStatus('Enter a torrent source (magnet URL, .torrent URL, or local path).');
      return;
    }

    setTorrentBusy(true);
    try {
      const response = await addMediaTorrent({
        source,
        lane: 'standalone',
        destinationPath: standaloneDestination || undefined,
      });
      if (response.success === false) {
        setTorrentStatus(String(response.error || 'Unable to add standalone torrent.'));
        return;
      }
      setTorrentSource('');
      setTorrentStatus(String(response.message || `Standalone torrent queued for ${standaloneDestination || 'configured destination'}.`));
      workspaceActions?.onRefresh();
    } catch (error) {
      setTorrentStatus(toErrorMessage(error, 'Unable to add standalone torrent'));
    } finally {
      setTorrentBusy(false);
    }
  };

  return (
    <>
      <LocalTabBar
        label="Transfers workspace tabs"
        items={[
          { key: 'connect', label: 'Connect' },
          { key: 'favourites', label: 'Favourites' },
          { key: 'torrent', label: 'Torrent' },
        ]}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'connect' | 'favourites' | 'torrent')}
      />

      {activeTab === 'connect' ? (
        <>
          <MetricGrid>
            <MetricTile label="FTP host" value={String(ftpDraft.host || ftpDefaultsState.host || 'n/a')} helper={`Port ${String(ftpDraft.port || ftpDefaultsState.port || '21')}`} />
            <MetricTile label="Secure mode" value={ftpDraft.secure ? 'Enabled' : 'Disabled'} helper="Connection mode" />
            <MetricTile label="Saved remotes" value={ftpFavouritesState.length} helper="Configured favourite connections" />
            <MetricTile label="Download root" value={String(ftpDefaultsState.downloadRoot || 'n/a')} />
          </MetricGrid>

          <SectionCard title="Connection" subtitle="Bring back the V1 manual connection card for one-off FTP sessions and favourite editing.">
            {ftpStatus ? <p className="dash2-admin-note">{ftpStatus}</p> : null}
            <div className="dash2-form-grid">
              <label><span>Display name</span><input className="ui-input" value={ftpDraft.name} onChange={(event) => setFtpDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label><span>Host</span><input className="ui-input" value={ftpDraft.host} onChange={(event) => { setActiveFavouriteId(null); setFtpDraft((current) => ({ ...current, host: event.target.value })); }} /></label>
              <label><span>Port</span><input className="ui-input" value={ftpDraft.port} onChange={(event) => { setActiveFavouriteId(null); setFtpDraft((current) => ({ ...current, port: event.target.value })); }} /></label>
              <label><span>Username</span><input className="ui-input" value={ftpDraft.username} onChange={(event) => { setActiveFavouriteId(null); setFtpDraft((current) => ({ ...current, username: event.target.value })); }} /></label>
              <label><span>Password</span><input className="ui-input" type="password" value={ftpDraft.password} onChange={(event) => { setActiveFavouriteId(null); setFtpDraft((current) => ({ ...current, password: event.target.value })); }} /></label>
              <label><span>Start path</span><input className="ui-input" value={ftpDraft.remotePath} onChange={(event) => setFtpDraft((current) => ({ ...current, remotePath: event.target.value }))} /></label>
              <label><span>Drive folder</span><input className="ui-input" value={ftpDraft.mountName} onChange={(event) => setFtpDraft((current) => ({ ...current, mountName: event.target.value }))} /></label>
              <label className="dash2-checkbox-row"><input type="checkbox" checked={ftpDraft.secure} onChange={(event) => setFtpDraft((current) => ({ ...current, secure: event.target.checked }))} /><span>Use FTPS/TLS</span></label>
            </div>
            <div className="dash2-wrap-row">
              <button className="ui-button ui-button--primary" type="button" disabled={ftpBusy} onClick={() => void loadDirectory(ftpDraft.remotePath || '/', activeFavouriteId)}>
                {ftpBusy ? 'Connecting…' : 'Connect'}
              </button>
              <button className="ui-button" type="button" disabled={ftpBusy} onClick={() => void loadDirectory(ftpPath, activeFavouriteId)}>Refresh</button>
              <button className="ui-button" type="button" disabled={ftpBusy} onClick={() => void saveFavourite()}>{ftpEditingId ? 'Update favourite' : 'Save favourite'}</button>
              <button className="ui-button" type="button" disabled={ftpBusy} onClick={resetDraft}>Reset</button>
            </div>
            <p className="dash2-small-copy">Current remote path: {ftpPath}</p>
          </SectionCard>

          <SectionCard title="Transfer actions" subtitle="Upload and mkdir controls from the V1 FTP workspace.">
            <div className="dash2-form-grid">
              <label><span>Local file path</span><input className="ui-input" value={ftpUploadLocalPath} onChange={(event) => setFtpUploadLocalPath(event.target.value)} placeholder="/data/data/com.termux/files/home/Downloads/file.pkg" /></label>
              <label><span>Remote upload path</span><input className="ui-input" value={ftpUploadRemotePath} onChange={(event) => setFtpUploadRemotePath(event.target.value)} placeholder="/data/file.pkg" /></label>
              <label><span>New remote folder</span><input className="ui-input" value={ftpFolderName} onChange={(event) => setFtpFolderName(event.target.value)} placeholder="new-folder" /></label>
            </div>
            <div className="dash2-wrap-row">
              <button className="ui-button" type="button" disabled={ftpBusy} onClick={() => void uploadFile()}>Upload local file</button>
              <button className="ui-button" type="button" disabled={ftpBusy} onClick={() => void createFolder()}>Create folder</button>
            </div>
            {ftpEntries.length > 0 ? (
              <ul className="dash2-list">
                {ftpEntries.slice(0, 12).map((entry, index) => (
                  <li key={`${String(entry.name || 'entry')}-${index}`}>
                    <div>
                      <strong>{String(entry.name || 'Remote entry')}</strong>
                      <p>{String(entry.type || 'item')} · {formatBytes(entry.size)}</p>
                    </div>
                    <button className="ui-button" type="button" disabled={ftpBusy || String(entry.type || '') !== 'directory'} onClick={() => void loadDirectory(`${ftpPath.replace(/\/$/, '')}/${String(entry.name || '')}`.replace(/\/+/g, '/'), activeFavouriteId)}>
                      Open
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No remote listing yet" message="Connect to a remote host to browse entries here." />
            )}
          </SectionCard>
        </>
      ) : activeTab === 'favourites' ? (
        <>
          <SectionCard title="Saved FTP remotes" subtitle="Browse, mount, edit, and delete connection presets.">
            {favouriteStatus ? <p className="dash2-admin-note">{favouriteStatus}</p> : null}
            {ftpFavouritesState.length === 0 ? <EmptyState title="No favourites" message="Create an FTP favourite from the Connect tab." /> : (
              <ul className="dash2-list">
                {ftpFavouritesState.map((item, index) => {
                  const mount = asRecord(item.mount);
                  const itemId = Number(item.id || 0);
                  return (
                    <li key={`${String(item.id || item.name || 'favourite')}-${index}`}>
                      <div>
                        <strong>{String(item.name || 'Remote')}</strong>
                        <p>{String(item.host || 'host')}:{String(item.port || 21)} · {String(item.remotePath || '/')}</p>
                        <p>Drive target · ~/Drives/{String(mount.mountName || item.mountName || item.name || 'Remote')}</p>
                        <p>Host mirror · {String(mount.mirrorMountPoint || `/mnt/termux-drives/${String(mount.mountName || item.mountName || item.name || 'Remote')}`)}</p>
                      </div>
                      <div className="dash2-list__actions">
                        <StatusBadge tone={Boolean(mount.mounted) ? 'ok' : 'muted'}>{String(mount.state || 'unmounted')}</StatusBadge>
                        <button className="ui-button" type="button" disabled={favouriteBusyId === itemId} onClick={() => { applyFavourite(item); setActiveTab('connect'); void loadDirectory(String(item.remotePath || '/'), itemId); }}>
                          Browse
                        </button>
                        <button className="ui-button" type="button" disabled={favouriteBusyId === itemId} onClick={() => void handleToggleMount(item)}>
                          {favouriteBusyId === itemId ? 'Working…' : Boolean(mount.mounted) ? 'Unmount' : 'Mount'}
                        </button>
                        <button className="ui-button" type="button" disabled={favouriteBusyId === itemId} onClick={() => {
                          setFtpEditingId(itemId);
                          applyFavourite(item);
                          setActiveTab('connect');
                        }}>
                          Edit
                        </button>
                        <button className="ui-button" type="button" disabled={favouriteBusyId === itemId} onClick={() => void deleteFavourite(item)}>
                          Delete
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Transfer-related services" subtitle="Access and download surface status.">
            <ServiceList items={toServiceListItems(services)} />
          </SectionCard>
        </>
      ) : (
        <>
          <MetricGrid>
            <MetricTile label="qB status" value={<StatusBadge tone={toneFromStatus(qbitStatus)}>{qbitStatus}</StatusBadge>} helper={qbitSummary} />
            <MetricTile label="Standalone destination" value={<span className="dash2-small-copy">{compactPathSummary(standaloneDestination)}</span>} helper="Manual torrent destination" />
            <MetricTile label="Client" value={String(qbitService?.label || 'qBittorrent')} helper={qbitRoute || 'No route configured'} />
            <MetricTile label="WebUI" value={qbDiagnostics.webUiReachable ? 'reachable' : 'offline'} helper={String(qbDiagnostics.error || qbDiagnostics.baseUrl || 'Diagnostic pending')} />
            <MetricTile label="ARR lane" value={`${Number(arrDiagnostics.healthy || 0)}/${Number(arrDiagnostics.total || 0)}`} helper="Automation services working" />
            <MetricTile label="Queue source" value="/api/media/torrents/add" helper="Standalone add-torrent endpoint" />
          </MetricGrid>

          <SectionCard
            title="Standalone add-torrent"
            subtitle="Submit one-off torrents to qBittorrent using an explicit destination path."
            actions={qbitRoute ? <a className="ui-button" href={resolveGatewayHref(qbitRoute)} target="_blank" rel="noreferrer">Open qBittorrent</a> : null}
          >
            {torrentStatus ? <p className="dash2-admin-note">{torrentStatus}</p> : null}
            <form
              className="dash2-torrent-controls"
              onSubmit={(event) => {
                event.preventDefault();
                void handleAddStandaloneTorrent();
              }}
            >
              <label>
                <span>Torrent source</span>
                <input
                  className="ui-input"
                  type="text"
                  value={torrentSource}
                  onChange={(event) => setTorrentSource(event.target.value)}
                  placeholder="magnet:?xt=... or .torrent URL/path"
                />
              </label>
              <p className="dash2-small-copy">Destination path: {standaloneDestination || 'Not configured'}</p>
              <div className="dash2-card__actions">
                <button className="ui-button ui-button--primary" type="submit" disabled={torrentBusy || !torrentSource.trim()}>
                  {torrentBusy ? 'Submitting…' : 'Add torrent'}
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="qB diagnostics" subtitle="WebUI reachability and download path routing.">
            <KeyValueList
              rows={[
                { label: 'WebUI', value: qbDiagnostics.webUiReachable ? `reachable${qbDiagnostics.version ? ` · ${String(qbDiagnostics.version)}` : ''}` : String(qbDiagnostics.error || 'unreachable') },
                { label: 'Default save path', value: <span className="dash2-small-copy">{compactPathSummary(qbDiagnostics.defaultSavePath)}</span> },
                { label: 'Standalone category', value: <span className="dash2-small-copy">{compactPathSummary(qbCategoryPaths.standalone || standaloneDestination)}</span> },
                { label: 'ARR categories', value: <span className="dash2-small-copy">{`movies -> ${compactPathSummary(qbCategoryPaths.movies)} · series -> ${compactPathSummary(qbCategoryPaths.series)}`}</span> },
              ]}
            />
          </SectionCard>

          <SectionCard title="Torrent services" subtitle="Standalone transfer service status.">
            <ServiceList items={toServiceListItems(torrentServices)} />
          </SectionCard>
        </>
      )}
    </>
  );
}
