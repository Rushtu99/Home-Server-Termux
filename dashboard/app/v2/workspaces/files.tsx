'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { checkDrives, recheckStorageProtection, repairDriveHelpers } from '../api';
import { MetricGrid, MetricTile, SectionCard, StatusBadge } from '../components';
import { toErrorMessage } from '../errors';
import {
  asArray,
  asRecord,
  compactPathSummary,
  compactProtectionSummary,
  dedupeDrives,
  driveStatusLabel,
  isFallbackDrive,
  LocalTabBar,
  NormalizedDrive,
  normalizeDriveState,
  toneFromStatus,
  WorkspaceActions,
} from './shared';

export function FilesWorkspace({
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
  const realDrives = drives.filter((entry) => !isFallbackDrive(entry));
  const fallbackDrives = drives.filter((entry) => isFallbackDrive(entry));
  const [driveTab, setDriveTab] = useState<'drives' | 'fallback'>('drives');
  const visibleDrives = driveTab === 'fallback' ? fallbackDrives : realDrives;
  const mountedDriveCount = realDrives.filter((entry) => String(entry.state || '') === 'mounted').length;
  const shares = asArray<Record<string, unknown>>(payload.shares);
  const users = asArray<Record<string, unknown>>(payload.users);
  const protection = asRecord(payload.storageProtection);
  const mountEvents = asArray<Record<string, unknown>>(drivesPayload.events).slice(0, 40);
  const warningEventCount = mountEvents.filter((entry) => {
    const level = String(entry.level || '').trim().toLowerCase();
    return level === 'warn' || level === 'warning' || level === 'error';
  }).length;
  const [eventTab, setEventTab] = useState<'all' | 'warnings'>('all');
  const [actionBusy, setActionBusy] = useState<'drives' | 'recheck' | ''>('');
  const [helperBusy, setHelperBusy] = useState(false);
  const [showMountLog, setShowMountLog] = useState(false);
  const [helperRepairNeeded, setHelperRepairNeeded] = useState(protection.available === false);
  const [actionStatus, setActionStatus] = useState('');

  const storageStatusSummary = (response: Record<string, unknown>) => {
    const responseProtection = asRecord(response.storageProtection);
    const state = String(responseProtection.state || protection.state || 'unknown').trim().toLowerCase() || 'unknown';
    const reason = String(responseProtection.reasonCompact || responseProtection.reason || 'watchdog state unknown').trim() || 'watchdog state unknown';
    return `Storage status: ${state}. ${reason}`;
  };

  const setMissingHelperStatus = (response: Record<string, unknown>, fallbackMessage: string) => {
    const hint = String(response.installHint || '').trim();
    const details = String(response.error || fallbackMessage).trim();
    setActionStatus(`${storageStatusSummary(response)} ${details}${hint ? ` ${hint}` : ''}`);
    setHelperRepairNeeded(true);
  };
  const visibleEvents = useMemo(() => {
    if (eventTab === 'warnings') {
      return mountEvents.filter((entry) => {
        const level = String(entry.level || '').trim().toLowerCase();
        return level === 'warn' || level === 'warning' || level === 'error';
      });
    }
    return mountEvents;
  }, [eventTab, mountEvents]);

  const runDriveCheck = async () => {
    setActionBusy('drives');
    try {
      const response = await checkDrives();
      if (response.success === false) {
        const code = String(response.code || '').toLowerCase();
        if (code === 'usb_mount_helper_missing' || code === 'watchdog_helper_missing') {
          setMissingHelperStatus(response, 'Storage helpers are not available.');
        } else {
          setActionStatus(`${storageStatusSummary(response)} ${String(response.error || 'Drive check failed')}`);
        }
      } else {
        setHelperRepairNeeded(false);
        const warning = String(response.warning || '').trim();
        setActionStatus(`${storageStatusSummary(response)} ${warning || 'Drive check completed.'}`);
      }
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
      if (response.success === false) {
        const code = String(response.code || '').toLowerCase();
        if (code === 'watchdog_helper_missing') {
          setMissingHelperStatus(response as Record<string, unknown>, 'Storage watchdog helper is not available.');
        } else {
          setActionStatus(`${storageStatusSummary(response as Record<string, unknown>)} ${String(response.error || 'Storage recheck failed')}`);
        }
      } else {
        setHelperRepairNeeded(false);
        setActionStatus(`${storageStatusSummary(response as Record<string, unknown>)} Storage recheck completed.`);
      }
    } catch (error) {
      setActionStatus(toErrorMessage(error, 'Storage recheck failed'));
    } finally {
      setActionBusy('');
      workspaceActions?.onRefresh();
    }
  };

  const runHelperRepair = async () => {
    setHelperBusy(true);
    try {
      const response = await repairDriveHelpers();
      const missing = Array.isArray(response.missing) ? response.missing.length : 0;
      const failed = Array.isArray(response.failed) ? response.failed.length : 0;
      if (response.success) {
        setActionStatus('Storage helper repair completed. Re-run Check drives (manual) to refresh mount state.');
        setHelperRepairNeeded(false);
      } else {
        setActionStatus(`Storage status: unknown. watchdog state unknown. Helper repair incomplete (${missing} missing, ${failed} failed).`);
        setHelperRepairNeeded(true);
      }
    } catch (error) {
      setActionStatus(toErrorMessage(error, 'Storage helper repair failed'));
      setHelperRepairNeeded(true);
    } finally {
      setHelperBusy(false);
      workspaceActions?.onRefresh();
    }
  };

  return (
    <>
      <MetricGrid>
        <MetricTile label="Drives detected" value={realDrives.length} helper="Real drives only (fallback excluded)" />
        <MetricTile label="Mounted drives" value={mountedDriveCount} helper="Mounted real drives from manifest state" />
        <MetricTile label="Fallback drives" value={fallbackDrives.length} helper="Compatibility roots shown in separate tab" />
        <MetricTile label="Shares" value={shares.length} helper="Managed shares available to dashboard users" />
        <MetricTile label="Users" value={users.length} helper="Account inventory for permission policy" />
        <MetricTile
          label="Protection"
          value={String(protection.state || 'unknown')}
          helper={compactProtectionSummary(protection.reasonCompact || protection.reason || 'Storage watchdog state')}
        />
      </MetricGrid>

      <SectionCard
        title="Filesystem workspace"
        subtitle="Use the dedicated Files route for browser tools, manual drive checks, and compatibility-link validation."
        actions={(
          <>
            <button className="ui-button" type="button" onClick={runDriveCheck} disabled={actionBusy !== ''}>
              {actionBusy === 'drives' ? 'Checking…' : 'Check drives (manual)'}
            </button>
            <button className="ui-button" type="button" onClick={runStorageRecheck} disabled={actionBusy !== ''}>
              {actionBusy === 'recheck' ? 'Rechecking…' : 'Recheck storage'}
            </button>
            {helperRepairNeeded ? (
              <button className="ui-button" type="button" onClick={runHelperRepair} disabled={actionBusy !== '' || helperBusy}>
                {helperBusy ? 'Repairing…' : 'Install/Repair helpers'}
              </button>
            ) : null}
            <Link className="ui-button ui-button--primary" href="/files">Open /files workspace</Link>
          </>
        )}
      >
        {actionStatus ? <p className="dash2-admin-note">{actionStatus}</p> : null}
        <p className="dash2-admin-note">Storage resume controls moved to Settings workspace.</p>
        <LocalTabBar
          label="Filesystem drive tabs"
          items={[
            { key: 'drives', label: `Drives (${realDrives.length})` },
            { key: 'fallback', label: `Fallback Drives (${fallbackDrives.length})` },
          ]}
          activeKey={driveTab}
          onChange={(key) => setDriveTab(key === 'fallback' ? 'fallback' : 'drives')}
        />
        <ul className="dash2-list">
          {visibleDrives.map((drive, index) => (
            <li key={`${String(drive.device || drive.mountPoint || 'drive')}-${index}`}>
              <div>
                <strong>{String(drive.dirName || drive.name || drive.letter || 'Drive')}</strong>
                <p>{compactPathSummary(drive.mountPoint || 'mount unavailable')}</p>
              </div>
              <StatusBadge tone={toneFromStatus(drive.state)}>
                {driveStatusLabel(drive)}
              </StatusBadge>
            </li>
          ))}
          {visibleDrives.length === 0 ? (
            <li>
              <div>
                <strong>{driveTab === 'fallback' ? 'No fallback drives' : 'No drives'}</strong>
                <p>{driveTab === 'fallback' ? 'Fallback compatibility roots are not available.' : 'No real drives detected.'}</p>
              </div>
              <StatusBadge tone="muted">empty</StatusBadge>
            </li>
          ) : null}
        </ul>
      </SectionCard>

      <SectionCard
        title="System mount log"
        subtitle="Recent events from the USB mount daemon and drive scan loop."
        actions={(
          <>
            <button className="ui-button" type="button" onClick={() => setShowMountLog((current) => !current)}>
              {showMountLog ? 'Collapse log' : 'Expand log'}
            </button>
            <button className="ui-button" type="button" onClick={runDriveCheck} disabled={actionBusy !== ''}>
              {actionBusy === 'drives' ? 'Refreshing…' : 'Refresh events'}
            </button>
          </>
        )}
      >
        {!showMountLog ? (
          <p className="dash2-admin-note">Log collapsed by default. {warningEventCount} warning/error event(s) in the current buffer.</p>
        ) : (
          <>
            <LocalTabBar
              label="Mount event filters"
              items={[
                { key: 'all', label: `All (${mountEvents.length})` },
                { key: 'warnings', label: `Warnings (${warningEventCount})` },
              ]}
              activeKey={eventTab}
              onChange={(key) => setEventTab(key === 'warnings' ? 'warnings' : 'all')}
            />
            <ul className="dash2-list dash2-mount-log-list">
              {visibleEvents.map((entry, index) => {
                const level = String(entry.level || 'info').trim().toLowerCase();
                const timestamp = String(entry.timestamp || entry.checkedAt || '');
                const eventName = String(entry.event || 'event');
                const message = String(entry.message || eventName);
                const tone = level === 'error'
                  ? 'danger'
                  : level === 'warn' || level === 'warning'
                    ? 'warn'
                    : 'muted';
                const meta = asRecord(entry.meta);
                const metaParts = [
                  meta.detected == null ? '' : `detected: ${Number(meta.detected || 0)}`,
                  meta.device == null ? '' : `device: ${String(meta.device)}`,
                  meta.mountPoint == null ? '' : `mount: ${compactPathSummary(meta.mountPoint)}`,
                ].filter(Boolean);

                return (
                  <li key={`${timestamp}-${eventName}-${index}`}>
                    <div>
                      <strong>{message}</strong>
                      <p className="dash2-small-copy">{eventName}{timestamp ? ` · ${timestamp}` : ''}</p>
                      {metaParts.length > 0 ? <p className="dash2-small-copy">{metaParts.join(' · ')}</p> : null}
                    </div>
                    <StatusBadge tone={tone}>{level || 'info'}</StatusBadge>
                  </li>
                );
              })}
              {visibleEvents.length === 0 ? (
                <li>
                  <div>
                    <strong>No events</strong>
                    <p>{eventTab === 'warnings' ? 'No warning/error mount events in the current buffer.' : 'Drive event stream is currently empty.'}</p>
                  </div>
                  <StatusBadge tone="muted">empty</StatusBadge>
                </li>
              ) : null}
            </ul>
          </>
        )}
      </SectionCard>
    </>
  );
}
