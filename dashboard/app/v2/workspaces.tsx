'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  checkDrives,
  deleteLlmConversation,
  disconnectConnection,
  getLlmConversationMessages,
  listLlmConversations,
  mountFtpFavourite,
  recheckStorageProtection,
  refreshOnlineModels,
  resumeStorageProtection,
  sendLlmChat,
  selectLlmModel,
  selectOnlineModel,
  unmountFtpFavourite,
} from './api';
import { EmptyState, KeyValueList, MetricGrid, MetricTile, SectionCard, ServiceList, StatusBadge } from './components';
import { toErrorMessage } from './errors';
import type { WorkspaceKey } from './types';

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});
const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);
const toServiceListItems = (entries: Array<Record<string, unknown>>) =>
  entries.map((entry) => ({
    key: String(entry.key || ''),
    label: String(entry.label || entry.key || 'Service'),
    status: String(entry.status || 'unknown'),
    available: Boolean(entry.available),
    summary: String(entry.description || entry.blocker || ''),
  }));
type ServiceControlAction = 'start' | 'stop' | 'restart';
type WorkspaceActions = {
  onRefresh: () => void;
  currentUsername?: string;
};
type AdminActions = {
  adminPassword: string;
  controlBusyKey: string;
  controlStatus: string;
  lockBusy: boolean;
  onAdminPasswordChange: (value: string) => void;
  onControl: (serviceKey: string, action: ServiceControlAction) => void;
  onUnlock: () => void;
  onLock: () => void;
};

const toPercent = (value: unknown) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return '0%';
  }
  return `${Math.round(num)}%`;
};

const formatBytes = (value: unknown) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / (1024 ** power);
  return `${scaled.toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
};

const mountRole = (entry: Record<string, unknown>) => {
  const token = String(entry.category || entry.mountRole || '').toLowerCase();
  if (token.includes('vault')) {
    return 'vault';
  }
  if (token.includes('scratch')) {
    return 'scratch';
  }
  return 'none';
};

const compactPathSummary = (value: unknown) => {
  const text = String(value || '').trim();
  if (!text) {
    return 'Not configured';
  }
  if (text.length <= 92) {
    return text;
  }
  const parts = text.split('/');
  if (parts.length < 4) {
    return `${text.slice(0, 56)}…${text.slice(-20)}`;
  }
  return `${parts.slice(0, 3).join('/')}/…/${parts.slice(-2).join('/')}`;
};

const toHistoryPoint = (value: unknown) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, num));
};

function TinySparkline({
  points,
  label,
}: {
  points: number[];
  label: string;
}) {
  const width = 320;
  const height = 96;
  const prepared = points.length > 1 ? points : [0, ...(points.length === 1 ? points : [0])];
  const path = prepared
    .map((point, index) => {
      const x = (index / Math.max(prepared.length - 1, 1)) * width;
      const y = height - (toHistoryPoint(point) / 100) * height;
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  const areaPath = `${path} L ${width},${height} L 0,${height} Z`;
  const latest = prepared[prepared.length - 1] || 0;
  return (
    <article className="dash2-graph-card">
      <header>
        <strong>{label}</strong>
        <span>{Math.round(latest)}%</span>
      </header>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} trend`}>
        <path d={areaPath} className="dash2-graph-card__area" />
        <path d={path} className="dash2-graph-card__line" />
      </svg>
    </article>
  );
}

function OverviewWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const telemetry = asRecord(payload.telemetry);
  const lifecycle = asRecord(telemetry.lifecycle);
  const monitor = asRecord(telemetry.monitor);
  const lifecycleCounts = asRecord(lifecycle.counts);
  const network = asRecord(monitor.network);
  const device = asRecord(monitor.device);
  const connections = asRecord(payload.connections);
  const users = asArray<Record<string, unknown>>(connections.users);
  const storage = asRecord(payload.storage);
  const mounts = asArray<Record<string, unknown>>(storage.mounts);
  const [sessionBusy, setSessionBusy] = useState('');
  const [sessionStatus, setSessionStatus] = useState('');
  const [mountBusy, setMountBusy] = useState(false);
  const [mountStatus, setMountStatus] = useState('');
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const memoryUsedPercent = Number(monitor.totalMem || 0) > 0
    ? Math.round((Number(monitor.usedMem || 0) / Number(monitor.totalMem || 1)) * 100)
    : 0;
  const riskyMounts = mounts.filter((entry) => Number(entry.usePercent || 0) >= 80).length;
  const degradedServices = Number(lifecycleCounts.degraded || 0) + Number(lifecycleCounts.blocked || 0) + Number(lifecycleCounts.crashed || 0);

  useEffect(() => {
    setCpuHistory((current) => [...current.slice(-39), toHistoryPoint(monitor.cpuLoad)]);
    setRamHistory((current) => [...current.slice(-39), toHistoryPoint(memoryUsedPercent)]);
  }, [memoryUsedPercent, monitor.cpuLoad]);

  const handleDisconnect = async (sessionId: string) => {
    if (!sessionId) {
      return;
    }
    setSessionBusy(sessionId);
    try {
      const response = await disconnectConnection(sessionId);
      setSessionStatus(response.success === false ? String(response.error || 'Disconnect failed') : 'Session disconnected.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setSessionStatus(toErrorMessage(error, 'Disconnect failed'));
    } finally {
      setSessionBusy('');
    }
  };

  const handleRecheckMounts = async () => {
    setMountBusy(true);
    try {
      const response = await checkDrives();
      setMountStatus(response.success === false ? String(response.error || 'Mount recheck failed') : 'Mount recheck requested.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setMountStatus(toErrorMessage(error, 'Mount recheck failed'));
    } finally {
      setMountBusy(false);
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="Stack state" value={<StatusBadge tone={String(lifecycle.state || '').toLowerCase() === 'healthy' ? 'ok' : 'warn'}>{String(lifecycle.state || 'unknown')}</StatusBadge>} />
        <MetricTile label="CPU load" value={toPercent(monitor.cpuLoad)} helper="Average process load" />
        <MetricTile label="RAM used" value={`${memoryUsedPercent}%`} helper="From telemetry snapshot" />
        <MetricTile label="Live sessions" value={users.length} helper="Connected dashboard users" />
      </MetricGrid>

      <SectionCard title="Performance graphs" subtitle="Live CPU and memory trend history from recent overview snapshots.">
        <div className="dash2-graph-grid">
          <TinySparkline label="CPU load" points={cpuHistory} />
          <TinySparkline label="Memory usage" points={ramHistory} />
        </div>
      </SectionCard>

      <div className="dash2-overview-layout">
        <div className="dash2-overview-layout__main">
          <SectionCard title="Lifecycle health" subtitle="Service state distribution across the host.">
            <KeyValueList
              rows={[
                { label: 'Healthy', value: Number(lifecycleCounts.healthy || 0) },
                { label: 'Degraded', value: Number(lifecycleCounts.degraded || 0) },
                { label: 'Blocked', value: Number(lifecycleCounts.blocked || 0) },
                { label: 'Stopped', value: Number(lifecycleCounts.stopped || 0) },
                { label: 'Crashed', value: Number(lifecycleCounts.crashed || 0) },
              ]}
            />
          </SectionCard>

          <SectionCard
            title="Storage mounts"
            subtitle="Current mount inventory from the backend."
            actions={(
              <button className="ui-button" type="button" disabled={mountBusy} onClick={() => void handleRecheckMounts()}>
                {mountBusy ? 'Rechecking…' : 'Recheck mounts'}
              </button>
            )}
          >
            {mountStatus ? <p className="dash2-admin-note">{mountStatus}</p> : null}
            {mounts.length === 0 ? <EmptyState title="No mounts" message="Storage telemetry is currently unavailable." /> : (
              <ul className="dash2-list">
                {mounts.map((entry, index) => {
                  const role = mountRole(entry);
                  return (
                    <li key={`${String(entry.mount || entry.filesystem || 'mount')}-${index}`}>
                      <div>
                        <strong>{String(entry.mount || entry.filesystem || 'mount')}</strong>
                        <p>{String(entry.category || entry.fsType || 'storage')}</p>
                      </div>
                      <div className="dash2-list__actions">
                        <StatusBadge tone="muted">{role}</StatusBadge>
                        <StatusBadge tone="muted">{toPercent(entry.usePercent)}</StatusBadge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="dash2-overview-layout__side">
          <SectionCard title="Operational todo metrics" subtitle="Quick counts for what needs operator attention next.">
            <KeyValueList
              rows={[
                { label: 'Services needing attention', value: degradedServices },
                { label: 'Mounts over 80%', value: riskyMounts },
                { label: 'Connected sessions', value: users.length },
                { label: 'CPU cores', value: Number(monitor.cpuCores || 0) || 'n/a' },
                { label: 'Node RSS', value: formatBytes(monitor.processRss) },
              ]}
            />
          </SectionCard>

          <SectionCard title="System telemetry detail" subtitle="Legacy-style host metrics restored next to lifecycle operations.">
            <KeyValueList
              rows={[
                { label: 'Load average', value: `${Number(monitor.loadAvg1m || 0).toFixed(2)} / ${Number(monitor.loadAvg5m || 0).toFixed(2)} / ${Number(monitor.loadAvg15m || 0).toFixed(2)}` },
                { label: 'Event loop p95', value: `${Number(monitor.eventLoopP95Ms || 0).toFixed(2)} ms` },
                { label: 'Heap used', value: formatBytes(monitor.processHeapUsed) },
                { label: 'Network RX/TX', value: `${formatBytes(network.rxRate)}ps / ${formatBytes(network.txRate)}ps` },
                { label: 'Battery', value: device.batteryPct != null ? `${Number(device.batteryPct || 0)}%` : 'n/a' },
                { label: 'Wi-Fi', value: device.wifiDbm != null ? `${Number(device.wifiDbm || 0)} dBm` : 'n/a' },
              ]}
            />
          </SectionCard>

          <SectionCard title="Active sessions" subtitle="Current connected dashboard users and remote endpoints.">
            {sessionStatus ? <p className="dash2-admin-note">{sessionStatus}</p> : null}
            {users.length === 0 ? <EmptyState title="No sessions" message="No active sessions are currently reported." /> : (
              <ul className="dash2-list">
                {users.map((entry, index) => {
                  const sessionId = String(entry.sessionId || '');
                  const username = String(entry.username || 'user');
                  const isCurrentUser = workspaceActions?.currentUsername && workspaceActions.currentUsername === username;
                  return (
                    <li key={`${sessionId || username}-${index}`}>
                      <div>
                        <strong>{username}</strong>
                        <p>{String(entry.ip || 'ip')} · {String(entry.protocol || 'protocol')}:{String(entry.port || 'n/a')}</p>
                      </div>
                      <div className="dash2-list__actions">
                        <StatusBadge tone={String(entry.status || '').toLowerCase() === 'active' ? 'ok' : 'muted'}>
                          {String(entry.status || 'unknown')}
                        </StatusBadge>
                        <button
                          className="ui-button"
                          type="button"
                          disabled={isCurrentUser || sessionBusy === sessionId}
                          onClick={() => void handleDisconnect(sessionId)}
                        >
                          {sessionBusy === sessionId ? 'Disconnecting…' : isCurrentUser ? 'Current session' : 'Disconnect'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}

function MediaWorkspace({ payload }: { payload: Record<string, unknown> }) {
  const mediaWorkflow = asRecord(payload.mediaWorkflow);
  const watch = asRecord(mediaWorkflow.watch);
  const requests = asRecord(mediaWorkflow.requests);
  const automation = asRecord(mediaWorkflow.automation);
  const support = asRecord(mediaWorkflow.support);
  const liveTv = asRecord(mediaWorkflow.liveTv);
  const mediaHealth = asRecord(payload.mediaHealth);
  const mediaHealthTotals = asRecord(mediaHealth.totals);
  const libraries = asArray<Record<string, unknown>>(mediaHealth.libraries);
  const activeSessions = asArray<Record<string, unknown>>(mediaHealth.activeSessions);
  const services = asArray<Record<string, unknown>>(payload.services);
  const workflowReady = Number(automation.healthy || 0) + (String(requests.status || '') === 'working' ? 1 : 0) + (String(watch.status || '') === 'working' ? 1 : 0);
  const workflowTotal = Number(automation.total || 0) + 2;
  const mediaHealthAvailable = Boolean(mediaHealth.available);
  const mediaHealthStatus = String(mediaHealth.status || (mediaHealthAvailable ? 'working' : 'unavailable'));

  return (
    <>
      <MetricGrid>
        <MetricTile label="Watch surface" value={String(watch.label || 'Jellyfin')} helper={String(watch.summary || 'Primary playback surface')} />
        <MetricTile label="Workflow health" value={`${Math.max(workflowReady, 0)}/${Math.max(workflowTotal, 0)}`} helper={String(automation.summary || 'Automation lane status')} />
        <MetricTile label="Library list" value={libraries.length} helper={mediaHealthAvailable ? 'Live Jellyfin library roots' : 'Jellyfin health API unavailable'} />
        <MetricTile label="Live TV" value={`${Number(liveTv.channelCount || 0)} channels`} helper={String(liveTv.summary || 'Live TV readiness')} />
      </MetricGrid>

      <SectionCard title="Media workflow" subtitle="Unified watch → request → automate flow.">
        <KeyValueList
          rows={[
            { label: 'Watch', value: <span className="dash2-small-copy">{String(watch.summary || 'N/A')}</span> },
            { label: 'Requests', value: String(requests.summary || 'N/A') },
            { label: 'Automation', value: String(automation.summary || 'N/A') },
            { label: 'Support', value: String(support.summary || 'N/A') },
          ]}
        />
      </SectionCard>

      <SectionCard title="Media health dashboard" subtitle="Jellyfin-backed libraries, totals, and currently watching sessions.">
        {mediaHealthAvailable ? (
          <>
            <MetricGrid>
              <MetricTile label="Health state" value={<StatusBadge tone={mediaHealthStatus === 'working' ? 'ok' : mediaHealthStatus === 'degraded' ? 'warn' : 'danger'}>{mediaHealthStatus}</StatusBadge>} helper={String(mediaHealth.error || 'Live API snapshot')} />
              <MetricTile label="Movies" value={Number(mediaHealthTotals.movieCount || 0)} />
              <MetricTile label="Series" value={Number(mediaHealthTotals.seriesCount || 0)} />
              <MetricTile label="Watching now" value={activeSessions.length} helper={String(mediaHealth.lastUpdated || 'live')} />
            </MetricGrid>
            <div className="dash2-media-health-grid">
              <article className="dash2-media-health-card">
                <h3>Libraries</h3>
                {libraries.length === 0 ? <p className="dash2-admin-note">No library metadata was returned.</p> : (
                  <ul className="dash2-list">
                    {libraries.map((entry, index) => (
                      <li key={`${String(entry.id || entry.name || 'library')}-${index}`}>
                        <div>
                          <strong>{String(entry.name || 'Library')}</strong>
                          <p className="dash2-small-copy">{compactPathSummary(entry.path)}</p>
                        </div>
                        <StatusBadge tone="muted">{Number(entry.itemCount || 0)}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
              <article className="dash2-media-health-card">
                <h3>Currently watching</h3>
                {activeSessions.length === 0 ? <p className="dash2-admin-note">No active Jellyfin playback sessions.</p> : (
                  <ul className="dash2-list">
                    {activeSessions.map((entry, index) => (
                      <li key={`${String(entry.id || entry.userName || 'session')}-${index}`}>
                        <div>
                          <strong>{String(entry.userName || 'Unknown user')}</strong>
                          <p className="dash2-small-copy">{String(entry.itemName || 'Playback item unavailable')}</p>
                        </div>
                        <StatusBadge tone="muted">{String(entry.client || 'client')}</StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          </>
        ) : (
          <EmptyState
            title="Media health unavailable"
            message={String(mediaHealth.error || 'Jellyfin API health metrics could not be loaded. Configure Jellyfin API key for live media dashboard data.')}
          />
        )}
      </SectionCard>

      <SectionCard title="IPTV support" subtitle="Playlist, guide, and mapping status used by Jellyfin Live TV.">
        <KeyValueList
          rows={[
            { label: 'Status', value: String(liveTv.status || 'unknown') },
            { label: 'Playlist source', value: <span className="dash2-small-copy">{compactPathSummary(liveTv.playlistSource)}</span> },
            { label: 'Guide source', value: <span className="dash2-small-copy">{compactPathSummary(liveTv.guideSource)}</span> },
            { label: 'Channels mapped', value: liveTv.channelsMapped === true ? 'yes' : liveTv.channelsMapped === false ? 'no' : 'unknown' },
            { label: 'Summary', value: <span className="dash2-small-copy">{String(liveTv.summary || 'No IPTV summary available')}</span> },
          ]}
        />
      </SectionCard>

      <SectionCard title="Media inventory" subtitle="Card-based status + quick links with duplicate surfaces merged into one list.">
        <div className="dash2-service-admin-grid">
          {services.map((entry, index) => {
            const route = String(entry.route || '');
            const status = String(entry.status || 'unknown');
            return (
              <article key={`${String(entry.key || 'service')}-${index}`} className="dash2-service-admin-card">
                <div className="dash2-service-admin-card__header">
                  <strong>{String(entry.label || entry.key || 'Service')}</strong>
                  <StatusBadge tone={status === 'working' ? 'ok' : status === 'stalled' || status === 'blocked' ? 'warn' : 'muted'}>
                    {status}
                  </StatusBadge>
                </div>
                <p className="dash2-small-copy">{String(entry.description || entry.blocker || 'No summary available.')}</p>
                <div className="dash2-service-admin-card__meta">
                  <span>key: {String(entry.key || 'n/a')}</span>
                  <span>{Boolean(entry.available) ? 'available' : 'unavailable'}</span>
                </div>
                {route ? (
                  <div className="dash2-service-admin-card__actions">
                    <a className="ui-button ui-button--primary" href={route} target="_blank" rel="noreferrer">Open</a>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

function FilesWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const drivesPayload = asRecord(payload.drives);
  const manifest = asRecord(drivesPayload.manifest);
  const drives = asArray<Record<string, unknown>>(manifest.drives);
  const shares = asArray<Record<string, unknown>>(payload.shares);
  const users = asArray<Record<string, unknown>>(payload.users);
  const protection = asRecord(payload.storageProtection);
  const [actionBusy, setActionBusy] = useState<'drives' | 'recheck' | 'resume' | ''>('');
  const [actionStatus, setActionStatus] = useState('');

  const runDriveCheck = async () => {
    setActionBusy('drives');
    try {
      const response = await checkDrives();
      setActionStatus(response.success === false ? String(response.error || 'Drive check failed') : 'Drive check requested.');
    } catch (error) {
      setActionStatus(toErrorMessage(error, 'Drive check failed'));
    } finally {
      setActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  const runStorageRecheck = async () => {
    setActionBusy('recheck');
    try {
      const response = await recheckStorageProtection();
      setActionStatus(response.success === false ? String(response.error || 'Storage recheck failed') : 'Storage recheck requested.');
    } catch (error) {
      setActionStatus(toErrorMessage(error, 'Storage recheck failed'));
    } finally {
      setActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  const runStorageResume = async () => {
    setActionBusy('resume');
    try {
      const response = await resumeStorageProtection();
      if (Array.isArray(response.failed) && response.failed.length > 0) {
        setActionStatus(`Resume partial: ${response.failed.length} service(s) failed.`);
      } else if (response.success === false) {
        setActionStatus(String(response.error || 'Storage resume failed'));
      } else {
        setActionStatus('Storage resume requested.');
      }
    } catch (error) {
      setActionStatus(toErrorMessage(error, 'Storage resume failed'));
    } finally {
      setActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="Drives detected" value={drives.length} helper="Includes removable and internal roots" />
        <MetricTile label="Shares" value={shares.length} helper="Managed shares available to dashboard users" />
        <MetricTile label="Users" value={users.length} helper="Account inventory for permission policy" />
        <MetricTile label="Protection" value={String(protection.state || 'unknown')} helper={String(protection.reason || 'Storage watchdog state')} />
      </MetricGrid>

      <SectionCard
        title="Filesystem workspace"
        subtitle="Use the dedicated Files route for full browser + operations tools."
        actions={(
          <>
            <button className="ui-button" type="button" onClick={runDriveCheck} disabled={actionBusy !== ''}>
              {actionBusy === 'drives' ? 'Checking…' : 'Check drives'}
            </button>
            <button className="ui-button" type="button" onClick={runStorageRecheck} disabled={actionBusy !== ''}>
              {actionBusy === 'recheck' ? 'Rechecking…' : 'Recheck storage'}
            </button>
            <button className="ui-button" type="button" onClick={runStorageResume} disabled={actionBusy !== ''}>
              {actionBusy === 'resume' ? 'Resuming…' : 'Resume blocked'}
            </button>
            <Link className="ui-button ui-button--primary" href="/files">Open /files workspace</Link>
          </>
        )}
      >
        {actionStatus ? <p className="dash2-admin-note">{actionStatus}</p> : null}
        <ul className="dash2-list">
          {drives.map((drive, index) => (
            <li key={`${String(drive.device || drive.mountPoint || 'drive')}-${index}`}>
              <div>
                <strong>{String(drive.dirName || drive.name || drive.letter || 'Drive')}</strong>
                <p>{String(drive.mountPoint || 'mount unavailable')}</p>
              </div>
              <StatusBadge tone={String(drive.state || '').toLowerCase() === 'mounted' ? 'ok' : 'warn'}>
                {String(drive.state || 'unknown')}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </SectionCard>
    </>
  );
}

function TransfersWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const defaults = asRecord(payload.ftpDefaults);
  const favourites = asArray<Record<string, unknown>>(payload.favourites);
  const services = asArray<Record<string, unknown>>(payload.services);
  const [favouriteBusyId, setFavouriteBusyId] = useState<number>(0);
  const [favouriteStatus, setFavouriteStatus] = useState('');

  const handleToggleMount = async (favourite: Record<string, unknown>) => {
    const favouriteId = Number(favourite.id || 0);
    const mount = asRecord(favourite.mount);
    if (favouriteId <= 0) {
      return;
    }

    setFavouriteBusyId(favouriteId);
    try {
      if (Boolean(mount.mounted)) {
        const response = await unmountFtpFavourite(favouriteId);
        setFavouriteStatus(response.success === false ? String(response.error || 'Unmount failed') : 'Favourite unmounted.');
      } else {
        const response = await mountFtpFavourite(favouriteId);
        setFavouriteStatus(response.success === false ? String(response.error || 'Mount failed') : 'Favourite mounted.');
      }
      workspaceActions?.onRefresh();
    } catch (error) {
      setFavouriteStatus(toErrorMessage(error, 'Unable to toggle mount'));
    } finally {
      setFavouriteBusyId(0);
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="FTP host" value={String(defaults.host || 'n/a')} helper={`Port ${String(defaults.port || '21')}`} />
        <MetricTile label="Secure mode" value={Boolean(defaults.secure) ? 'Enabled' : 'Disabled'} helper="Client defaults" />
        <MetricTile label="Saved remotes" value={favourites.length} helper="Configured favourite connections" />
        <MetricTile label="Download root" value={String(defaults.downloadRoot || 'n/a')} />
      </MetricGrid>

      <SectionCard title="FTP favourites" subtitle="Saved remote mounts and transfer targets.">
        {favouriteStatus ? <p className="dash2-admin-note">{favouriteStatus}</p> : null}
        {favourites.length === 0 ? <EmptyState title="No favourites" message="Create an FTP favourite from the transfer tools." /> : (
          <ul className="dash2-list">
            {favourites.map((item, index) => {
              const mount = asRecord(item.mount);
              const itemId = Number(item.id || 0);
              return (
                <li key={`${String(item.id || item.name || 'favourite')}-${index}`}>
                  <div>
                    <strong>{String(item.name || 'Remote')}</strong>
                    <p>{String(item.host || 'host')}:{String(item.port || 21)} · {String(item.remotePath || '/')}</p>
                  </div>
                  <div className="dash2-list__actions">
                    <StatusBadge tone={Boolean(mount.mounted) ? 'ok' : 'muted'}>{String(mount.state || 'unmounted')}</StatusBadge>
                    <button className="ui-button" type="button" disabled={favouriteBusyId === itemId} onClick={() => void handleToggleMount(item)}>
                      {favouriteBusyId === itemId ? 'Working…' : Boolean(mount.mounted) ? 'Unmount' : 'Mount'}
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
  );
}

function AiWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const llm = asRecord(payload.llmState);
  const models = asArray<Record<string, unknown>>(llm.models);
  const online = asRecord(llm.online);
  const onlineModels = asArray<Record<string, unknown>>(online.models);
  const firstOnlineModelId = String(onlineModels[0]?.id || '');
  const [modelId, setModelId] = useState(String(llm.activeModelId || ''));
  const [onlineModelId, setOnlineModelId] = useState(String(online.activeModelId || firstOnlineModelId || ''));
  const [llmBusy, setLlmBusy] = useState<'local' | 'online-refresh' | 'online' | ''>('');
  const [llmStatus, setLlmStatus] = useState('');
  const [chatMode, setChatMode] = useState<'local' | 'online'>('local');
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStatus, setChatStatus] = useState('');
  const [chatConversationId, setChatConversationId] = useState<number | null>(null);
  const [chatTranscript, setChatTranscript] = useState<Array<{ id?: number; role: string; content: string; createdAt?: string }>>([]);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversations, setConversations] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    setModelId(String(llm.activeModelId || ''));
  }, [llm.activeModelId]);

  useEffect(() => {
    setOnlineModelId(String(online.activeModelId || firstOnlineModelId || ''));
  }, [online.activeModelId, firstOnlineModelId]);

  const loadConversations = useCallback(async () => {
    setConversationBusy(true);
    try {
      const response = await listLlmConversations();
      const items = asArray<Record<string, unknown>>(response.conversations)
        .slice()
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      setConversations(items);
    } catch (error) {
      setChatStatus(toErrorMessage(error, 'Unable to load conversation history'));
    } finally {
      setConversationBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const applyLocalModel = async () => {
    if (!modelId.trim()) {
      return;
    }
    setLlmBusy('local');
    try {
      const response = await selectLlmModel(modelId.trim());
      setLlmStatus(response.success === false ? String(response.error || 'Unable to select local model') : 'Local model updated.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to select local model'));
    } finally {
      setLlmBusy('');
    }
  };

  const refreshOnline = async () => {
    setLlmBusy('online-refresh');
    try {
      const response = await refreshOnlineModels();
      setLlmStatus(response.success === false ? String(response.error || 'Unable to refresh online models') : 'Online models refreshed.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to refresh online models'));
    } finally {
      setLlmBusy('');
    }
  };

  const applyOnlineModel = async () => {
    if (!onlineModelId.trim()) {
      return;
    }
    setLlmBusy('online');
    try {
      const response = await selectOnlineModel(onlineModelId.trim());
      setLlmStatus(response.success === false ? String(response.error || 'Unable to select online model') : 'Online model updated.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setLlmStatus(toErrorMessage(error, 'Unable to select online model'));
    } finally {
      setLlmBusy('');
    }
  };

  const sendQuickPrompt = async () => {
    const message = chatInput.trim();
    if (!message) {
      return;
    }

    setChatBusy(true);
    setChatStatus('');
    setChatTranscript((current) => [...current, { role: 'user', content: message, createdAt: new Date().toISOString() }]);
    setChatInput('');

    try {
      const response = await sendLlmChat({
        message,
        mode: chatMode,
        conversationId: chatConversationId,
        onlineModelId: chatMode === 'online' ? onlineModelId || undefined : undefined,
      });

      if (response.success === false || response.error) {
        const errorMessage = String(response.error || 'Chat request failed');
        setChatStatus(errorMessage);
        setChatTranscript((current) => [...current, { role: 'assistant', content: `Error: ${errorMessage}`, createdAt: new Date().toISOString() }]);
      } else {
        const assistantText = String(response.assistantMessage?.content || '').trim() || 'No response text returned.';
        setChatTranscript((current) => [...current, {
          id: Number(response.assistantMessage?.id || 0) || undefined,
          role: String(response.assistantMessage?.role || 'assistant'),
          content: assistantText,
          createdAt: String(response.assistantMessage?.createdAt || new Date().toISOString()),
        }]);
        if (Number.isInteger(response.conversationId) && Number(response.conversationId) > 0) {
          setChatConversationId(Number(response.conversationId));
        }
        void loadConversations();
      }
    } catch (error) {
      const errorMessage = toErrorMessage(error, 'Chat request failed');
      setChatStatus(errorMessage);
      setChatTranscript((current) => [...current, { role: 'assistant', content: `Error: ${errorMessage}`, createdAt: new Date().toISOString() }]);
    } finally {
      setChatBusy(false);
      workspaceActions?.onRefresh();
    }
  };

  const loadConversationMessages = async (conversationId: number) => {
    if (!conversationId) {
      return;
    }
    setConversationBusy(true);
    try {
      const response = await getLlmConversationMessages(conversationId);
      const messages = asArray<Record<string, unknown>>(response.messages).map((entry) => ({
        id: Number(entry.id || 0) || undefined,
        role: String(entry.role || 'assistant'),
        content: String(entry.content || ''),
        createdAt: String(entry.createdAt || ''),
      }));
      setChatConversationId(conversationId);
      setChatTranscript(messages);
      setChatStatus('');
    } catch (error) {
      setChatStatus(toErrorMessage(error, 'Unable to load conversation'));
    } finally {
      setConversationBusy(false);
    }
  };

  const removeConversation = async (conversationId: number) => {
    if (!conversationId) {
      return;
    }
    setConversationBusy(true);
    try {
      await deleteLlmConversation(conversationId);
      if (chatConversationId === conversationId) {
        setChatConversationId(null);
        setChatTranscript([]);
      }
      await loadConversations();
      setChatStatus('Conversation deleted.');
    } catch (error) {
      setChatStatus(toErrorMessage(error, 'Unable to delete conversation'));
    } finally {
      setConversationBusy(false);
    }
  };

  const lastUserMessage = [...chatTranscript].reverse().find((entry) => entry.role === 'user')?.content || '';

  return (
    <>
      <MetricGrid>
        <MetricTile label="Runtime" value={Boolean(llm.running) ? 'Running' : 'Stopped'} helper={String(llm.blocker || 'Local LLM service state')} />
        <MetricTile label="Active model" value={String(llm.activeModelId || 'none')} helper="Selected local or online model" />
        <MetricTile label="Installed models" value={models.filter((entry) => Boolean(entry.installed)).length} helper={`${models.length} total configured`} />
        <MetricTile label="Online provider" value={Boolean(online.available) ? 'Available' : 'Unavailable'} helper={String(online.error || 'Online model provider status')} />
      </MetricGrid>

      <SectionCard title="Legacy chatbox" subtitle="Conversation history, full threaded chat, and local/online routing controls.">
        <div className="dash2-chat-controls">
          <div className="dash2-chat-actions">
            <label>
              <span>Chat mode</span>
              <select className="ui-input" value={chatMode} onChange={(event) => setChatMode(event.target.value === 'online' ? 'online' : 'local')}>
                <option value="local">Local</option>
                <option value="online">Online</option>
              </select>
            </label>
            {chatMode === 'online' ? (
              <label>
                <span>Online model</span>
                <select className="ui-input" value={onlineModelId} onChange={(event) => setOnlineModelId(event.target.value)}>
                  {onlineModels.length === 0 ? <option value="">No models</option> : null}
                  {onlineModels.map((entry, index) => (
                    <option key={`${String(entry.id || 'online')}-${index}`} value={String(entry.id || '')}>
                      {String(entry.label || entry.id || 'Model')}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button className="ui-button" type="button" onClick={() => { setChatConversationId(null); setChatTranscript([]); setChatStatus(''); }}>
              New chat
            </button>
            <button className="ui-button" type="button" disabled={conversationBusy} onClick={() => void loadConversations()}>
              {conversationBusy ? 'Loading…' : 'Refresh history'}
            </button>
          </div>
        </div>

        <div className="dash2-chatbox-layout">
          <aside className="dash2-chatbox-rail">
            <h3>Conversation history</h3>
            {conversations.length === 0 ? <p className="dash2-admin-note">No conversations yet.</p> : (
              <ul className="dash2-list">
                {conversations.map((entry) => {
                  const conversationId = Number(entry.id || 0);
                  const selected = chatConversationId === conversationId;
                  return (
                    <li key={`history-${conversationId}`} className={selected ? 'dash2-chat-history-item dash2-chat-history-item--active' : 'dash2-chat-history-item'}>
                      <button className="ui-button" type="button" onClick={() => void loadConversationMessages(conversationId)}>
                        <strong>{String(entry.title || `Conversation ${conversationId}`)}</strong>
                        <p className="dash2-small-copy">{String(entry.updatedAt || '')}</p>
                      </button>
                      <button className="ui-button dash2-ui-button--danger" type="button" disabled={conversationBusy} onClick={() => void removeConversation(conversationId)}>
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="dash2-chatbox-thread">
            {chatTranscript.length > 0 ? (
              <div className="dash2-chat-log" aria-live="polite">
                {chatTranscript.map((entry, index) => (
                  <article key={`${entry.id || index}-${entry.role}`} className={`dash2-chat-log__entry dash2-chat-log__entry--${entry.role === 'user' ? 'user' : 'assistant'}`}>
                    <strong>{entry.role === 'user' ? 'You' : 'Assistant'}</strong>
                    <p>{entry.content}</p>
                    <div className="dash2-chat-log__meta">
                      <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</span>
                      {entry.role !== 'user' ? (
                        <button className="ui-button" type="button" onClick={() => navigator.clipboard?.writeText(entry.content).catch(() => {})}>
                          Copy
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No conversation yet" message="Send a prompt to start a new chat thread." />
            )}
            <label>
              <span>Prompt</span>
              <textarea
                className="ui-input dash2-chat-input"
                rows={4}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Ask a question…"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (!chatBusy && chatInput.trim()) {
                      void sendQuickPrompt();
                    }
                  }
                }}
              />
            </label>
            <div className="dash2-chat-actions">
              <button className="ui-button" type="button" disabled={chatBusy || !lastUserMessage} onClick={() => setChatInput(lastUserMessage)}>
                Retry last
              </button>
              <button className="ui-button ui-button--primary" type="button" disabled={chatBusy || !chatInput.trim()} onClick={() => void sendQuickPrompt()}>
                {chatBusy ? 'Sending…' : 'Send'}
              </button>
              {chatConversationId ? <StatusBadge tone="muted">Conversation #{chatConversationId}</StatusBadge> : null}
            </div>
          </section>
        </div>
        {chatStatus ? <p className="dash2-admin-note">{chatStatus}</p> : null}
      </SectionCard>

      <SectionCard title="Model inventory" subtitle="Local and online model status snapshots.">
        <div className="dash2-llm-controls">
          <label>
            <span>Local model</span>
            <select className="ui-input" value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {models.map((entry, index) => (
                <option key={`${String(entry.id || 'model')}-${index}`} value={String(entry.id || '')}>
                  {String(entry.label || entry.id || 'Model')}
                </option>
              ))}
            </select>
          </label>
          <button className="ui-button" type="button" disabled={llmBusy !== ''} onClick={() => void applyLocalModel()}>
            {llmBusy === 'local' ? 'Applying…' : 'Use local model'}
          </button>
          <button className="ui-button" type="button" disabled={llmBusy !== ''} onClick={() => void refreshOnline()}>
            {llmBusy === 'online-refresh' ? 'Refreshing…' : 'Refresh online models'}
          </button>
          <label>
            <span>Online model</span>
            <select className="ui-input" value={onlineModelId} onChange={(event) => setOnlineModelId(event.target.value)}>
              {onlineModels.length === 0 ? <option value="">No models</option> : null}
              {onlineModels.map((entry, index) => (
                <option key={`${String(entry.id || 'online')}-${index}`} value={String(entry.id || '')}>
                  {String(entry.label || entry.id || 'Model')}
                </option>
              ))}
            </select>
          </label>
          <button className="ui-button" type="button" disabled={llmBusy !== '' || !onlineModelId} onClick={() => void applyOnlineModel()}>
            {llmBusy === 'online' ? 'Applying…' : 'Use online model'}
          </button>
        </div>
        {llmStatus ? <p className="dash2-admin-note">{llmStatus}</p> : null}
        {models.length === 0 ? <EmptyState title="No models" message="No local models are configured." /> : (
          <ul className="dash2-list">
            {models.map((entry, index) => (
              <li key={`${String(entry.id || 'model')}-${index}`}>
                <div>
                  <strong>{String(entry.label || entry.id || 'Model')}</strong>
                  <p>{String(entry.path || 'No path')}</p>
                </div>
                <StatusBadge tone={Boolean(entry.installed) ? 'ok' : 'warn'}>{Boolean(entry.installed) ? 'installed' : 'missing'}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function TerminalWorkspace({ payload }: { payload: Record<string, unknown> }) {
  const terminal = asRecord(payload.terminal);
  const terminalRoute = String(terminal.route || '/term/');
  const terminalAvailable = String(terminal.status || '').toLowerCase() !== 'unavailable';

  return (
    <SectionCard
      title="Terminal workspace"
      subtitle="Shell access health and mini embedded terminal view."
      actions={<Link href={terminalRoute} className="ui-button ui-button--primary">Open terminal route</Link>}
    >
      <div className="dash2-terminal-layout">
        <KeyValueList
          rows={[
            { label: 'Service', value: String(terminal.label || terminal.key || 'ttyd') },
            { label: 'Status', value: String(terminal.status || 'unknown') },
            { label: 'Route', value: terminalRoute },
            { label: 'Notes', value: String(terminal.description || terminal.blocker || 'Terminal route served through gateway') },
          ]}
        />
        {terminalAvailable ? (
          <iframe
            title="Mini terminal"
            src={terminalRoute}
            className="dash2-terminal-mini"
          />
        ) : (
          <EmptyState title="Terminal unavailable" message="ttyd service is unavailable. Start it from service controls first." />
        )}
      </div>
    </SectionCard>
  );
}

function AdminWorkspace({
  payload,
  adminActions,
}: {
  payload: Record<string, unknown>;
  adminActions?: AdminActions;
}) {
  const dashboard = asRecord(payload.dashboard);
  const serviceCatalog = asArray<Record<string, unknown>>(dashboard.serviceCatalog);
  const controller = asRecord(dashboard.serviceController);
  const optionalControls = new Set(asArray<string>(controller.optionalServices));
  const locked = Boolean(controller.locked);

  return (
    <>
      <MetricGrid>
        <MetricTile label="Service catalog" value={serviceCatalog.length} helper="Entries in controller inventory" />
        <MetricTile label="Controller lock" value={Boolean(controller.locked) ? 'Locked' : 'Unlocked'} helper="Admin action safety gate" />
        <MetricTile label="Optional controls" value={asArray<string>(controller.optionalServices).length} helper="User-controllable optional services" />
        <MetricTile label="Generated" value={String(dashboard.generatedAt || 'unknown')} helper="Snapshot timestamp" />
      </MetricGrid>

      {adminActions ? (
        <SectionCard title="Controller access" subtitle="Unlock service controls and run start/stop/restart actions.">
          <div className="dash2-admin-controls">
            <label>
              <span>Admin password</span>
              <input
                className="ui-input"
                type="password"
                autoComplete="current-password"
                value={adminActions.adminPassword}
                onChange={(event) => adminActions.onAdminPasswordChange(event.target.value)}
                placeholder="Required when controller is locked"
              />
            </label>
            <div className="dash2-admin-controls__actions">
              <button className="ui-button ui-button--primary" type="button" disabled={adminActions.lockBusy} onClick={adminActions.onUnlock}>
                {adminActions.lockBusy ? 'Working…' : locked ? 'Unlock controller' : 'Refresh unlock'}
              </button>
              <button className="ui-button" type="button" disabled={adminActions.lockBusy} onClick={adminActions.onLock}>
                Lock controller
              </button>
              <StatusBadge tone={locked ? 'warn' : 'ok'}>{locked ? 'locked' : 'unlocked'}</StatusBadge>
            </div>
            {adminActions.controlStatus ? <p className="dash2-admin-controls__status">{adminActions.controlStatus}</p> : null}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Admin service inventory" subtitle="Operational state for all registered services.">
        <div className="dash2-service-admin-grid">
          {serviceCatalog.map((entry, index) => {
            const key = String(entry.key || `service-${index}`);
            const label = String(entry.label || key || 'Service');
            const status = String(entry.status || 'unknown');
            const available = Boolean(entry.available);
            const controlMode = String(entry.controlMode || 'always_on');
            const canUseControls = Boolean(adminActions && !locked && adminActions.adminPassword.trim());
            const controllable = adminActions ? optionalControls.has(key) && canUseControls : false;
            const actionBusy = adminActions?.controlBusyKey === key;

            return (
              <article key={`${key}-${index}`} className="dash2-service-admin-card">
                <div className="dash2-service-admin-card__header">
                  <strong>{label}</strong>
                  <StatusBadge tone={status === 'working' ? 'ok' : status === 'unavailable' ? 'danger' : 'warn'}>
                    {status}
                  </StatusBadge>
                </div>
                <p>{String(entry.description || entry.blocker || 'No summary available.')}</p>
                <div className="dash2-service-admin-card__meta">
                  <span>key: {key}</span>
                  <span>mode: {controlMode}</span>
                  <span>{available ? 'available' : 'unavailable'}</span>
                </div>
                {controllable && adminActions ? (
                  <div className="dash2-service-admin-card__actions dash2-service-admin-card__actions--compact">
                    <button className="ui-button dash2-ui-button--small" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'start')}>
                      Start
                    </button>
                    <button className="ui-button dash2-ui-button--small" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'stop')}>
                      Stop
                    </button>
                    <button className="ui-button dash2-ui-button--small" type="button" disabled={actionBusy} onClick={() => adminActions.onControl(key, 'restart')}>
                      Restart
                    </button>
                  </div>
                ) : (
                  <p className="dash2-admin-note">
                    {optionalControls.has(key)
                      ? locked
                        ? 'Unlock controller and provide admin password to show controls.'
                        : 'Provide admin password to show controls.'
                      : 'No direct controller action exposed for this service.'}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

export function WorkspaceViewport({
  workspace,
  payload,
  adminActions,
  workspaceActions,
}: {
  workspace: WorkspaceKey;
  payload: Record<string, unknown>;
  adminActions?: AdminActions;
  workspaceActions?: WorkspaceActions;
}) {
  if (workspace === 'overview') {
    return <OverviewWorkspace payload={payload} workspaceActions={workspaceActions} />;
  }
  if (workspace === 'media') {
    return <MediaWorkspace payload={payload} />;
  }
  if (workspace === 'files') {
    return <FilesWorkspace payload={payload} workspaceActions={workspaceActions} />;
  }
  if (workspace === 'transfers') {
    return <TransfersWorkspace payload={payload} workspaceActions={workspaceActions} />;
  }
  if (workspace === 'ai') {
    return <AiWorkspace payload={payload} workspaceActions={workspaceActions} />;
  }
  if (workspace === 'terminal') {
    return <TerminalWorkspace payload={payload} />;
  }
  return <AdminWorkspace payload={payload} adminActions={adminActions} />;
}
