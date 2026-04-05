'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addMediaTorrent,
  checkDrives,
  deleteLlmConversation,
  disconnectConnection,
  getLlmConversationMessages,
  listLlmConversations,
  mountFtpFavourite,
  recheckStorageProtection,
  refreshOnlineModels,
  resumeStorageProtection,
  sendLlmChatStream,
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

const formatUptime = (value: unknown) => {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0) || 0));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
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

const compactWorkflowSummary = (value: unknown, fallback: string) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return fallback;
  }
  if (/^library roots ready at /i.test(text)) {
    const list = text.replace(/^library roots ready at /i, '');
    const locations = list.split(/\sand\s/i).map((entry) => entry.trim()).filter(Boolean);
    return `Library roots ready (${locations.length} location${locations.length === 1 ? '' : 's'}).`;
  }
  if (text.length > 120) {
    return `${text.slice(0, 117)}…`;
  }
  return text;
};

const toHistoryPoint = (value: unknown) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(0, Math.min(100, num));
};

const driveIdentityKey = (entry: Record<string, unknown>) => {
  const dirName = String(entry.dirName || '').trim().toLowerCase();
  if (dirName) {
    return `dir:${dirName}`;
  }
  const letter = String(entry.letter || '').trim().toUpperCase();
  if (letter) {
    return `letter:${letter}`;
  }
  const mountPoint = String(entry.mountPoint || '').trim().toLowerCase();
  if (mountPoint) {
    return `mount:${mountPoint}`;
  }
  return 'unknown';
};

const driveStatePriority = (stateValue: unknown) => {
  const state = String(stateValue || '').trim().toLowerCase();
  if (state === 'mounted' || state === 'working' || state === 'ready') {
    return 4;
  }
  if (state === 'starting' || state === 'pending') {
    return 3;
  }
  if (state === 'error' || state === 'stalled') {
    return 2;
  }
  if (state === 'unmounted' || state === 'stopped') {
    return 1;
  }
  return 0;
};

const normalizeDriveState = (entry: Record<string, unknown>) => {
  const raw = String(entry.state || '').trim().toLowerCase();
  if (raw === 'mounted' || raw === 'starting' || raw === 'error' || raw === 'unmounted') {
    return raw;
  }
  if (raw.includes('mount') && !raw.includes('unmount')) {
    return 'mounted';
  }
  if (raw.includes('start') || raw.includes('pending') || raw.includes('running')) {
    return 'starting';
  }
  if (raw.includes('error') || raw.includes('fail')) {
    return 'error';
  }
  if (raw.includes('unmount') || raw.includes('stopped')) {
    return 'unmounted';
  }
  return 'unmounted';
};

const dedupeDrives = (entries: Array<Record<string, unknown>>) => {
  const map = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const key = driveIdentityKey(entry);
    const current = map.get(key);
    if (!current) {
      map.set(key, entry);
      continue;
    }
    const currentPriority = driveStatePriority(current.state);
    const candidatePriority = driveStatePriority(entry.state);
    if (candidatePriority > currentPriority) {
      map.set(key, entry);
      continue;
    }
    if (candidatePriority < currentPriority) {
      continue;
    }
    const currentMount = String(current.mountPoint || '');
    const candidateMount = String(entry.mountPoint || '');
    if (candidateMount && (!currentMount || candidateMount.length < currentMount.length)) {
      map.set(key, entry);
    }
  }
  return Array.from(map.values());
};

const toneFromStatus = (statusValue: unknown): 'ok' | 'warn' | 'danger' | 'muted' => {
  const status = String(statusValue || '').trim().toLowerCase();
  if (status === 'working' || status === 'ready' || status === 'mounted' || status === 'healthy') {
    return 'ok';
  }
  if (status === 'stalled' || status === 'blocked' || status === 'starting' || status === 'degraded' || status === 'setup') {
    return 'warn';
  }
  if (status === 'error' || status === 'failed' || status === 'unavailable' || status === 'crashed') {
    return 'danger';
  }
  return 'muted';
};

type NormalizedDrive = Record<string, unknown> & { state: string };

function LegacyTrendGraph({
  points,
  label,
  tone = 'var(--accent-strong)',
  fill = 'color-mix(in srgb, var(--accent-soft) 88%, transparent)',
}: {
  points: number[];
  label: string;
  tone?: string;
  fill?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prepared = useMemo(() => (points.length > 1 ? points : [0, ...(points.length === 1 ? points : [0])]), [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = 'rgba(255,255,255,0.08)';
    context.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((ratio) => {
      const y = height * ratio;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    });
    context.beginPath();
    prepared.forEach((point, index) => {
      const x = (index / Math.max(prepared.length - 1, 1)) * width;
      const y = height - (toHistoryPoint(point) / 100) * height;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.lineTo(width, height);
    context.lineTo(0, height);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    context.beginPath();
    prepared.forEach((point, index) => {
      const x = (index / Math.max(prepared.length - 1, 1)) * width;
      const y = height - (toHistoryPoint(point) / 100) * height;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.strokeStyle = tone;
    context.lineWidth = 2;
    context.stroke();
  }, [fill, prepared, tone]);

  return (
    <article className="dash2-graph-card--legacy">
      <header>
        <strong>{label}</strong>
        <span>{Math.round(prepared[prepared.length - 1] || 0)}%</span>
      </header>
      <canvas ref={canvasRef} width={460} height={144} aria-label={`${label} trend`} />
    </article>
  );
}

const renderAnimatedAssistantText = (content: string) => {
  const parts = String(content || '').split(/(\s+)/);
  return (
    <span className="dash2-chat-log__message">
      {parts.map((part, index) => (
        <span key={`${index}-${part}`} className={part.trim() ? 'dash2-chat-log__chunk' : undefined}>{part}</span>
      ))}
    </span>
  );
};

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
  const drivesPayload = asRecord(payload.drives);
  const driveManifest = asRecord(drivesPayload.manifest);
  const drives = dedupeDrives(asArray<Record<string, unknown>>(driveManifest.drives)).map((entry) => ({ ...entry, state: normalizeDriveState(entry) })) as NormalizedDrive[];
  const mountedDrives = drives.filter((entry) => entry.state === 'mounted' || entry.state === 'starting' || entry.mountPoint);
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
        <MetricTile label="CPU load" value={toPercent(monitor.cpuLoad)} helper={`Load avg ${Number(monitor.loadAvg1m || 0).toFixed(2)}`} />
        <MetricTile label="RAM used" value={`${memoryUsedPercent}%`} helper={`${formatBytes(monitor.usedMem)} / ${formatBytes(monitor.totalMem)}`} />
        <MetricTile label="Uptime" value={formatUptime(monitor.uptime)} helper={`Node RSS ${formatBytes(monitor.processRss)}`} />
        <MetricTile label="Live sessions" value={users.length} helper="Connected dashboard users" />
        <MetricTile label="Mounted drives" value={mountedDrives.length} helper={`${riskyMounts} mount(s) over 80%`} />
      </MetricGrid>

      <SectionCard title="Performance graphs" subtitle="Legacy-style CPU and memory trend history from recent overview snapshots.">
        <div className="dash2-graph-grid">
          <LegacyTrendGraph label="CPU load" points={cpuHistory} />
          <LegacyTrendGraph label="Memory usage" points={ramHistory} tone="#f0c96a" fill="rgba(240, 201, 106, 0.14)" />
        </div>
      </SectionCard>

      <SectionCard title="Lifecycle health" subtitle="Row 1: Health, watchlist, limited, and action signals for service lifecycle.">
        <KeyValueList
          rows={[
            { label: 'Health', value: String(lifecycle.state || 'unknown') },
            { label: 'Watchlist', value: `Healthy ${Number(lifecycleCounts.healthy || 0)} / Stopped ${Number(lifecycleCounts.stopped || 0)}` },
            { label: 'Limited', value: `Blocked ${Number(lifecycleCounts.blocked || 0)} / Crashed ${Number(lifecycleCounts.crashed || 0)}` },
            { label: 'Action', value: `${degradedServices} service(s) need operator attention` },
          ]}
        />
      </SectionCard>

      <SectionCard title="System telemetry detail" subtitle="Row 2: Legacy-style host telemetry in compact row form.">
        <KeyValueList
          rows={[
            { label: 'Health', value: `CPU ${toPercent(monitor.cpuLoad)} · RAM ${memoryUsedPercent}% · Uptime ${formatUptime(monitor.uptime)}` },
            { label: 'Watchlist', value: `Load ${Number(monitor.loadAvg1m || 0).toFixed(2)} / ${Number(monitor.loadAvg5m || 0).toFixed(2)} / ${Number(monitor.loadAvg15m || 0).toFixed(2)} · ${Number(monitor.cpuCores || 0)} cores` },
            { label: 'Limited', value: `Event loop ${Number(monitor.eventLoopP95Ms || 0).toFixed(2)} ms p95 · Battery ${device.batteryPct != null ? `${Number(device.batteryPct || 0)}%${device.charging ? ' ⚡' : ''}` : 'n/a'}` },
            { label: 'Action', value: `RX/TX ${formatBytes(network.rxRate)}ps / ${formatBytes(network.txRate)}ps · Android ${String(device.androidVersion || 'n/a')}` },
          ]}
        />
      </SectionCard>

      <SectionCard title="Operational todo metrics" subtitle="Row 3: Operational rollup for sessions, storage risk, and host pressure.">
        <KeyValueList
          rows={[
            { label: 'Health', value: `${users.length} live session(s) · ${mountedDrives.length} active drive(s)` },
            { label: 'Watchlist', value: `${riskyMounts} mount(s) over 80% · Wi-Fi ${device.wifiDbm != null ? `${Number(device.wifiDbm || 0)} dBm` : 'n/a'}` },
            { label: 'Limited', value: `Node RSS ${formatBytes(monitor.processRss)} · Heap ${formatBytes(monitor.processHeapUsed)} / ${formatBytes(monitor.processHeapTotal)}` },
            { label: 'Action', value: `Network ${formatBytes(network.rxRate)}ps down / ${formatBytes(network.txRate)}ps up` },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Mounted drives"
        subtitle="Normalized removable drive inventory shared with the Files workspace."
        actions={(
          <button className="ui-button" type="button" disabled={mountBusy} onClick={() => void handleRecheckMounts()}>
            {mountBusy ? 'Rechecking…' : 'Recheck mounts'}
          </button>
        )}
      >
        {mountStatus ? <p className="dash2-admin-note">{mountStatus}</p> : null}
        {mountedDrives.length === 0 ? <EmptyState title="No drives" message="Drive telemetry is currently unavailable." /> : (
          <div className="dash2-drive-grid">
            {mountedDrives.map((entry, index) => (
              <article className="dash2-drive-card" key={`${String(entry.dirName || entry.letter || entry.mountPoint || 'drive')}-${index}`}>
                <div>
                  <strong>{String(entry.name || entry.dirName || entry.letter || 'Drive')}</strong>
                  <p>{compactPathSummary(entry.mountPoint || entry.rawMountPoint || 'Not mounted')}</p>
                </div>
                <div className="dash2-chip-row">
                  <StatusBadge tone={toneFromStatus(entry.state)}>{entry.state}</StatusBadge>
                  <StatusBadge tone="muted">{mountRole(entry)}</StatusBadge>
                  {entry.letter ? <StatusBadge tone="muted">{String(entry.letter)}</StatusBadge> : null}
                </div>
                <p>{String(entry.filesystem || entry.device || 'filesystem unavailable')}</p>
                {entry.error ? <p>{String(entry.error)}</p> : null}
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Storage mounts"
        subtitle="Capacity inventory from the backend snapshot."
      >
        {mounts.length === 0 ? <EmptyState title="No mounts" message="Storage telemetry is currently unavailable." /> : (
          <ul className="dash2-list">
            {mounts.map((entry, index) => {
              const role = mountRole(entry);
              return (
                <li key={`${String(entry.mount || entry.filesystem || 'mount')}-${index}`}>
                  <div>
                    <strong>{compactPathSummary(entry.mount || entry.filesystem || 'mount')}</strong>
                    <p>{String(entry.category || entry.fsType || 'storage')}</p>
                  </div>
                  <div className="dash2-list__actions">
                    <StatusBadge tone="muted">{role}</StatusBadge>
                    <StatusBadge tone={Number(entry.usePercent || 0) >= 80 ? 'warn' : 'muted'}>{toPercent(entry.usePercent)}</StatusBadge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
  const arrDiagnostics = asRecord(payload.arrDiagnostics);
  const qbDiagnostics = asRecord(payload.qbDiagnostics);
  const qbCategoryPaths = asRecord(qbDiagnostics.categories);
  const mediaHealthTotals = asRecord(mediaHealth.totals);
  const libraries = asArray<Record<string, unknown>>(mediaHealth.libraries);
  const activeSessions = asArray<Record<string, unknown>>(mediaHealth.activeSessions);
  const services = asArray<Record<string, unknown>>(payload.services);
  const workflowReady = Number(automation.healthy || 0) + (String(requests.status || '') === 'working' ? 1 : 0) + (String(watch.status || '') === 'working' ? 1 : 0);
  const workflowTotal = Number(automation.total || 0) + 2;
  const mediaHealthAvailable = Boolean(mediaHealth.available);
  const mediaHealthStatus = String(mediaHealth.status || (mediaHealthAvailable ? 'working' : 'unavailable'));
  const watchServiceKeys = asArray<unknown>(watch.serviceKeys).map((entry) => String(entry || '')).filter(Boolean);
  const requestServiceKeys = asArray<unknown>(requests.serviceKeys).map((entry) => String(entry || '')).filter(Boolean);
  const automationServiceKeys = asArray<unknown>(automation.serviceKeys).map((entry) => String(entry || '')).filter(Boolean);
  const supportServiceKeys = asArray<unknown>(support.serviceKeys).map((entry) => String(entry || '')).filter(Boolean);
  const subtitles = asRecord(mediaWorkflow.subtitles);
  const servicesByKey = new Map(services.map((entry) => [String(entry.key || ''), entry]));
  const arrServices = (['sonarr', 'radarr', 'prowlarr', 'bazarr'] as const).map((serviceKey) => {
    const entry = servicesByKey.get(serviceKey);
    const fallbackStatus = serviceKey === 'bazarr'
      ? String(subtitles.status || 'unknown')
      : String(automation.status || 'unknown');
    return {
      available: Boolean(entry?.available),
      description: String(entry?.description || entry?.blocker || `${serviceKey} automation surface`),
      key: serviceKey,
      label: String(entry?.label || `${serviceKey.slice(0, 1).toUpperCase()}${serviceKey.slice(1)}`),
      route: String(entry?.route || ''),
      status: String(entry?.status || fallbackStatus || 'unknown'),
    };
  });
  const watchLibraryRoots = asArray<unknown>(watch.libraryRoots);
  const [arrSource, setArrSource] = useState('');
  const [arrMediaType, setArrMediaType] = useState<'movies' | 'series'>('movies');
  const [arrBusy, setArrBusy] = useState(false);
  const [arrStatus, setArrStatus] = useState('');
  const workflowCards = [
    {
      key: 'watch',
      title: String(watch.label || 'Watch'),
      status: String(watch.status || 'unknown'),
      summary: compactWorkflowSummary(watch.summary, 'Primary playback and library surface.'),
      bullets: [
        `Services: ${watchServiceKeys.join(', ') || 'jellyfin'}`,
        `Library roots: ${watchLibraryRoots.length}`,
        `Roots ready: ${watch.libraryRootReady === true ? 'yes' : watch.libraryRootReady === false ? 'no' : 'unknown'}`,
        `Sample root: ${compactPathSummary(watchLibraryRoots[0])}`,
      ],
    },
    {
      key: 'requests',
      title: String(requests.label || 'Requests'),
      status: String(requests.status || 'unknown'),
      summary: compactWorkflowSummary(requests.summary, 'Request intake before automation lanes.'),
      bullets: [
        `Services: ${requestServiceKeys.join(', ') || 'none'}`,
        `Portal ready: ${requests.blocker ? 'no' : 'yes'}`,
        'Route: user request -> sonarr/radarr',
        `Blocker: ${String(requests.blocker || 'none')}`,
      ],
    },
    {
      key: 'automation',
      title: String(automation.label || 'Automation'),
      status: String(automation.status || 'unknown'),
      summary: compactWorkflowSummary(automation.summary, 'Indexer and automation orchestration lane.'),
      bullets: [
        `Healthy: ${Number(automation.healthy || 0)}/${Math.max(Number(automation.total || 0), 0)}`,
        `Services: ${automationServiceKeys.join(', ') || 'none'}`,
        'Flow: indexers -> arr -> importer',
        `Last state: ${String(automation.status || 'unknown')}`,
      ],
    },
    {
      key: 'support',
      title: String(support.label || 'Support'),
      status: String(support.status || 'unknown'),
      summary: compactWorkflowSummary(support.summary, 'Backing services for media metadata and jobs.'),
      bullets: [
        `Services: ${supportServiceKeys.join(', ') || 'none'}`,
        `Telemetry status: ${String(support.status || 'unknown')}`,
        'Role: queue + metadata persistence',
        `Coverage: ${supportServiceKeys.length > 0 ? 'active backing lane' : 'missing support lane'}`,
      ],
    },
    {
      key: 'livetv',
      title: 'Live TV',
      status: String(liveTv.status || 'unknown'),
      summary: compactWorkflowSummary(liveTv.summary, 'Playlist + guide feed readiness for Jellyfin.'),
      bullets: [
        `Channels: ${Number(liveTv.channelCount || 0)}`,
        `Playlist: ${liveTv.playlistConfigured ? compactPathSummary(liveTv.playlistSource) : 'not configured'}`,
        `Guide: ${liveTv.guideConfigured ? compactPathSummary(liveTv.guideSource) : 'not configured'}`,
        `Mapped in Jellyfin: ${liveTv.channelsMapped === true ? 'yes' : liveTv.channelsMapped === false ? 'no' : 'unknown'}`,
      ],
    },
  ];

  const handleAddArrTorrent = async () => {
    const source = arrSource.trim();
    if (!source) {
      setArrStatus('Enter a torrent source (magnet URL, .torrent URL, or local path).');
      return;
    }

    setArrBusy(true);
    try {
      const response = await addMediaTorrent({
        source,
        lane: 'arr',
        mediaType: arrMediaType,
      });
      if (response.success === false) {
        setArrStatus(String(response.error || 'Unable to queue ARR torrent.'));
        return;
      }
      setArrSource('');
      setArrStatus(String(response.message || `ARR queue request submitted (${arrMediaType}).`));
    } catch (error) {
      setArrStatus(toErrorMessage(error, 'Unable to queue ARR torrent'));
    } finally {
      setArrBusy(false);
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="Watch surface" value={String(watch.label || 'Jellyfin')} helper={compactWorkflowSummary(watch.summary, 'Primary playback surface')} />
        <MetricTile label="Workflow health" value={`${Math.max(workflowReady, 0)}/${Math.max(workflowTotal, 0)}`} helper={compactWorkflowSummary(automation.summary, 'Automation lane status')} />
        <MetricTile label="Library list" value={libraries.length} helper={mediaHealthAvailable ? 'Live Jellyfin library roots' : 'Jellyfin health API unavailable'} />
        <MetricTile label="ARR healthy" value={`${Number(arrDiagnostics.healthy || 0)}/${Number(arrDiagnostics.total || arrServices.length)}`} helper="Automation services" />
        <MetricTile label="qB WebUI" value={qbDiagnostics.webUiReachable ? 'reachable' : 'offline'} helper={String(qbDiagnostics.error || qbDiagnostics.baseUrl || 'Torrent client diagnostic')} />
        <MetricTile label="Live TV" value={`${Number(liveTv.channelCount || 0)} channels`} helper={compactWorkflowSummary(liveTv.summary, 'Live TV readiness')} />
      </MetricGrid>

      <SectionCard title="Media workflow" subtitle="Playback, requests, automation, support, and live TV readiness in one lane view.">
        <div className="dash2-workflow-carousel" role="list" aria-label="Media workflow cards">
          {workflowCards.map((entry, index) => (
            <article key={entry.key} className="dash2-workflow-card" role="listitem">
              <header className="dash2-workflow-card__header">
                <div>
                  <p className="dash2-workflow-card__step">Stage {index + 1}</p>
                  <h3>{entry.title}</h3>
                </div>
                <StatusBadge tone={toneFromStatus(entry.status)}>{entry.status}</StatusBadge>
              </header>
              <p className="dash2-workflow-card__summary">{entry.summary}</p>
              <ul className="dash2-workflow-card__bullets">
                {entry.bullets.map((bullet) => (
                  <li key={`${entry.key}-${bullet}`}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
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
            { label: 'Summary', value: <span className="dash2-small-copy">{compactWorkflowSummary(liveTv.summary, 'No IPTV summary available')}</span> },
          ]}
        />
      </SectionCard>

      <SectionCard title="ARR + qB diagnostics" subtitle="Torrent-routing readiness and automation service health.">
        <KeyValueList
          rows={[
            { label: 'ARR health', value: `${Number(arrDiagnostics.healthy || 0)}/${Number(arrDiagnostics.total || arrServices.length)} services working` },
            { label: 'qB WebUI', value: qbDiagnostics.webUiReachable ? `reachable${qbDiagnostics.version ? ` · ${String(qbDiagnostics.version)}` : ''}` : String(qbDiagnostics.error || 'unreachable') },
            { label: 'ARR route', value: `movies -> ${compactPathSummary(qbCategoryPaths.movies)} · series -> ${compactPathSummary(qbCategoryPaths.series)}` },
            { label: 'Standalone route', value: compactPathSummary(qbCategoryPaths.standalone || qbDiagnostics.defaultSavePath) },
          ]}
        />
      </SectionCard>

      <SectionCard title="ARR services" subtitle="Automation service status, quick links, and direct ARR torrent intake.">
        {arrStatus ? <p className="dash2-admin-note">{arrStatus}</p> : null}
        <div className="dash2-service-admin-grid">
          {arrServices.map((entry) => (
            <article key={entry.key} className="dash2-service-admin-card">
              <div className="dash2-service-admin-card__header">
                <strong>{entry.label}</strong>
                <StatusBadge tone={toneFromStatus(entry.status)}>{entry.status}</StatusBadge>
              </div>
              <p className="dash2-small-copy">{entry.description}</p>
              <div className="dash2-service-admin-card__meta">
                <span>key: {entry.key}</span>
                <span>{entry.available ? 'available' : 'unavailable'}</span>
              </div>
              {entry.route ? (
                <div className="dash2-service-admin-card__actions dash2-service-admin-card__actions--compact">
                  <a className="ui-button ui-button--primary" href={entry.route} target="_blank" rel="noreferrer">Open</a>
                </div>
              ) : null}
            </article>
          ))}
        </div>
        <form
          className="dash2-torrent-controls"
          onSubmit={(event) => {
            event.preventDefault();
            void handleAddArrTorrent();
          }}
        >
          <div className="dash2-torrent-controls__row">
            <label>
              <span>Torrent source</span>
              <input
                className="ui-input"
                type="text"
                value={arrSource}
                onChange={(event) => setArrSource(event.target.value)}
                placeholder="magnet:?xt=... or .torrent URL/path"
              />
            </label>
            <label>
              <span>Media type</span>
              <select className="ui-input" value={arrMediaType} onChange={(event) => setArrMediaType(event.target.value === 'series' ? 'series' : 'movies')}>
                <option value="movies">Movies</option>
                <option value="series">Series</option>
              </select>
            </label>
          </div>
          <div className="dash2-card__actions">
            <button className="ui-button ui-button--primary" type="submit" disabled={arrBusy || !arrSource.trim()}>
              {arrBusy ? 'Submitting…' : 'Add to ARR queue'}
            </button>
          </div>
        </form>
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
  const drives: NormalizedDrive[] = dedupeDrives(asArray<Record<string, unknown>>(manifest.drives)).map((entry) => ({
    ...entry,
    state: normalizeDriveState(entry),
  } as NormalizedDrive));
  const mountedDriveCount = drives.filter((entry) => String(entry.state || '') === 'mounted').length;
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
        <MetricTile label="Mounted drives" value={mountedDriveCount} helper="Derived from manifest drive states" />
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
                <p>{compactPathSummary(drive.mountPoint || 'mount unavailable')}</p>
              </div>
              <StatusBadge tone={toneFromStatus(drive.state)}>
                {String(drive.state || 'unmounted')}
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
  const mediaWorkflow = asRecord(payload.mediaWorkflow);
  const downloads = asRecord(mediaWorkflow.downloads);
  const categoryPaths = asRecord(downloads.categoryPaths);
  const torrent = asRecord(payload.torrent);
  const qbDiagnostics = asRecord(payload.qbDiagnostics);
  const qbCategoryPaths = asRecord(qbDiagnostics.categories);
  const arrDiagnostics = asRecord(payload.arrDiagnostics);
  const laneSummary = asRecord(torrent.laneSummary);
  const standaloneLane = asRecord(laneSummary.standalone);
  const qbitService = services.find((entry) => String(entry.key || '') === 'qbittorrent') || null;
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
    || categoryPaths.manual
    || downloads.defaultSavePath
    || defaults.downloadRoot
    || ''
  );
  const torrentServices = services.filter((entry) => {
    const key = String(entry.key || '').toLowerCase();
    const group = String(entry.group || '').toLowerCase();
    return key === 'qbittorrent' || group === 'downloads';
  });
  const [activeTab, setActiveTab] = useState<'ftp' | 'torrent'>('ftp');
  const [favouriteBusyId, setFavouriteBusyId] = useState<number>(0);
  const [favouriteStatus, setFavouriteStatus] = useState('');
  const [torrentSource, setTorrentSource] = useState('');
  const [torrentBusy, setTorrentBusy] = useState(false);
  const [torrentStatus, setTorrentStatus] = useState('');

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
      <div className="dash2-tab-switcher" role="tablist" aria-label="Transfers workspace tabs">
        <button
          className={`ui-button ${activeTab === 'ftp' ? 'dash2-tab-switcher__button--active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'ftp'}
          onClick={() => setActiveTab('ftp')}
        >
          FTP
        </button>
        <button
          className={`ui-button ${activeTab === 'torrent' ? 'dash2-tab-switcher__button--active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeTab === 'torrent'}
          onClick={() => setActiveTab('torrent')}
        >
          Torrent
        </button>
      </div>

      {activeTab === 'ftp' ? (
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
            actions={qbitRoute ? <a className="ui-button" href={qbitRoute} target="_blank" rel="noreferrer">Open qBittorrent</a> : null}
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

function AiWorkspace({
  payload,
  workspaceActions,
}: {
  payload: Record<string, unknown>;
  workspaceActions?: WorkspaceActions;
}) {
  const llm = asRecord(payload.llmState);
  const monitor = asRecord(payload.monitor);
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
    const createdAt = new Date().toISOString();
    const pendingAssistantId = -Date.now();
    setChatTranscript((current) => [
      ...current,
      { role: 'user', content: message, createdAt },
      { id: pendingAssistantId, role: 'assistant', content: '', createdAt },
    ]);
    setChatInput('');

    try {
      await sendLlmChatStream({
        message,
        mode: chatMode,
        conversationId: chatConversationId,
        onlineModelId: chatMode === 'online' ? onlineModelId || undefined : undefined,
      }, {
        onMeta: (meta) => {
          if (Number.isInteger(meta.conversationId) && Number(meta.conversationId) > 0) {
            setChatConversationId(Number(meta.conversationId));
          }
        },
        onDelta: (delta) => {
          if (!delta.text) {
            return;
          }
          setChatTranscript((current) => current.map((entry) => (
            entry.id === pendingAssistantId
              ? { ...entry, content: `${entry.content}${delta.text}` }
              : entry
          )));
        },
        onDone: (done) => {
          setChatTranscript((current) => current.map((entry) => (
            entry.id === pendingAssistantId
              ? {
                  id: Number(done.assistantMessage?.id || 0) || undefined,
                  role: String(done.assistantMessage?.role || 'assistant'),
                  content: String(done.assistantMessage?.content || entry.content || 'No response text returned.'),
                  createdAt: String(done.assistantMessage?.createdAt || entry.createdAt || new Date().toISOString()),
                }
              : entry
          )));
          if (Number.isInteger(done.conversationId) && Number(done.conversationId) > 0) {
            setChatConversationId(Number(done.conversationId));
          }
        },
        onError: (streamErr) => {
          const errorMessage = String(streamErr.message || 'Chat request failed');
          setChatStatus(errorMessage);
          setChatTranscript((current) => current.map((entry) => (
            entry.id === pendingAssistantId
              ? {
                  ...entry,
                  content: `Error: ${errorMessage}`,
                }
              : entry
          )));
        },
      });
      void loadConversations();
    } catch (error) {
      const errorMessage = toErrorMessage(error, 'Chat request failed');
      setChatStatus(errorMessage);
      setChatTranscript((current) => current.map((entry) => (
        entry.id === pendingAssistantId
          ? {
              ...entry,
              content: `Error: ${errorMessage}`,
            }
          : entry
      )));
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
        <MetricTile label="Host CPU load" value={toPercent(monitor.cpuLoad)} helper={String(monitor.timestamp || 'Latest AI workspace sample')} />
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
                    {entry.role === 'assistant' ? renderAnimatedAssistantText(entry.content) : <p>{entry.content}</p>}
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
  const networkExposure = asRecord(dashboard.networkExposure);
  const tailscale = asRecord(dashboard.tailscale);
  const remoteAccess = asRecord(dashboard.remoteAccess);
  const remoteGateway = asRecord(remoteAccess.gateway);
  const remoteSsh = asRecord(remoteAccess.ssh);
  const coreEntries = asArray<Record<string, unknown>>(networkExposure.core);
  const exposureServices = asArray<Record<string, unknown>>(networkExposure.services);
  const exposureCount = coreEntries.length + exposureServices.length;

  return (
    <>
      <MetricGrid>
        <MetricTile label="Service catalog" value={serviceCatalog.length} helper="Entries in controller inventory" />
        <MetricTile label="Controller lock" value={Boolean(controller.locked) ? 'Locked' : 'Unlocked'} helper="Admin action safety gate" />
        <MetricTile label="Optional controls" value={asArray<string>(controller.optionalServices).length} helper="User-controllable optional services" />
        <MetricTile label="Port audit" value={exposureCount} helper={String(networkExposure.overall || 'unknown')} />
        <MetricTile label="Tailscale" value={String(tailscale.status || tailscale.mode || 'disabled')} helper={String(tailscale.mode || 'disabled')} />
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

      <SectionCard title="Network & ports" subtitle="Core gateway routes, service bindings, and unauthenticated exposure checks.">
        {exposureCount === 0 ? <EmptyState title="No audit data" message="Network exposure data is currently unavailable." /> : (
          <div className="dash2-service-admin-grid">
            {[...coreEntries, ...exposureServices].map((entry, index) => {
              const status = String(entry.status || 'unknown');
              const label = String(entry.label || entry.key || `entry-${index}`);
              const routePath = String(entry.routePath || '');
              const observed = Number(entry.observedUnauthenticatedStatus || 0);
              const notes = asArray<string>(entry.notes).filter(Boolean);
              return (
                <article key={`${String(entry.key || label)}-${index}`} className="dash2-service-admin-card">
                  <div className="dash2-service-admin-card__header">
                    <strong>{label}</strong>
                    <StatusBadge tone={toneFromStatus(status)}>{status}</StatusBadge>
                  </div>
                  <div className="dash2-service-admin-card__meta">
                    <span>{String(entry.protocol || 'tcp')}:{String(entry.port || 'n/a')}</span>
                    <span>{String(entry.bindHost || '127.0.0.1')}</span>
                    <span>{String(entry.remoteSurface || 'none')}</span>
                  </div>
                  <p>{routePath ? `Route ${routePath} · auth ${String(entry.authMode || 'none')} · unauth ${observed || 'n/a'}` : 'No gateway route.'}</p>
                  <div className="dash2-chip-row">
                    <StatusBadge tone={Boolean(entry.pidHealthy) ? 'ok' : 'muted'}>{Boolean(entry.pidHealthy) ? 'pid ok' : 'pid no'}</StatusBadge>
                    <StatusBadge tone={Boolean(entry.tcpReachable) ? 'ok' : 'warn'}>{Boolean(entry.tcpReachable) ? 'tcp up' : 'tcp down'}</StatusBadge>
                    {entry.startupMode ? <StatusBadge tone="muted">{String(entry.startupMode)}</StatusBadge> : null}
                  </div>
                  {notes.length > 0 ? <p className="dash2-admin-note">{notes.join(' ')}</p> : null}
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Remote access" subtitle="Preferred tailnet entrypoints for the gateway and SSH.">
        <KeyValueList
          rows={[
            { label: 'Tailscale mode', value: String(tailscale.mode || 'disabled') },
            { label: 'Tailscale status', value: String(tailscale.status || 'unknown') },
            { label: 'Gateway', value: remoteGateway.url ? <a href={String(remoteGateway.url)} target="_blank" rel="noreferrer">{String(remoteGateway.url)}</a> : 'Not configured' },
            { label: 'SSH', value: String(remoteSsh.target || tailscale.sshTarget || 'Not configured') },
            { label: 'Notes', value: asArray<string>(tailscale.notes).filter(Boolean).join(' ') || 'Gateway + SSH over tailnet only; no public funnel configured.' },
          ]}
        />
      </SectionCard>

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
                  <StatusBadge tone={toneFromStatus(status)}>{status}</StatusBadge>
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
