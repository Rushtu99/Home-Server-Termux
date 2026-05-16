'use client';

import { useEffect, useState } from 'react';
import { checkDrives, disconnectConnection } from '../api';
import { EmptyState, KeyValueList, MetricGrid, MetricTile, SectionCard, StatusBadge } from '../components';
import { toErrorMessage } from '../errors';
import {
  asArray,
  asRecord,
  compactPathSummary,
  dedupeDrives,
  formatBytes,
  formatUptime,
  LegacyTrendGraph,
  mountRole,
  NormalizedDrive,
  normalizeDriveState,
  toHistoryPoint,
  toneFromStatus,
  toPercent,
  WorkspaceActions,
} from './shared';

export function OverviewWorkspace({
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
  const storageProtection = asRecord(payload.storageProtection);
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
  const storageProtectionState = String(storageProtection.state || 'unknown');
  const storageProtectionSummary = String(
    storageProtection.reasonCompact
    || storageProtection.reason
    || `${mountedDrives.length} mounted drive(s) detected.`
  );

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
      setMountStatus(response.success === false ? String(response.error || 'Drive check failed') : 'Drive check requested.');
      workspaceActions?.onRefresh();
    } catch (error) {
      setMountStatus(toErrorMessage(error, 'Drive check failed'));
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
        <MetricTile
          label="Mount availability"
          value={<StatusBadge tone={toneFromStatus(storageProtectionState)}>{storageProtectionState}</StatusBadge>}
          helper={storageProtectionSummary}
        />
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
            { label: 'Limited', value: `Event loop ${Number(monitor.eventLoopP95Ms || 0).toFixed(2)} ms p95 · ${device.batteryPct != null ? `${Number(device.batteryPct || 0)}%` : 'n/a'}` },
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
            {mountBusy ? 'Checking…' : 'Check drives (manual)'}
          </button>
        )}
      >
        <p className="dash2-admin-note">Storage status: {storageProtectionState} · {storageProtectionSummary}</p>
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
              const disableDisconnect = !sessionId || sessionBusy === sessionId;
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
                      disabled={disableDisconnect}
                      onClick={() => void handleDisconnect(sessionId)}
                    >
                      {sessionBusy === sessionId ? 'Disconnecting…' : !sessionId ? 'Unavailable' : 'Disconnect'}
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
