'use client';

import { useEffect, useMemo, useRef } from 'react';
import { KeyValueList, SectionCard } from '../components';
import type { WorkspaceKey } from '../types';
import { resolveGatewayBase } from '../../gateway-base';

export const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});
export const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);
export const toServiceListItems = (entries: Array<Record<string, unknown>>) =>
  entries.map((entry) => ({
    key: String(entry.key || ''),
    label: String(entry.label || entry.key || 'Service'),
    status: String(entry.status || 'unknown'),
    available: Boolean(entry.available),
    summary: String(entry.description || entry.blocker || ''),
  }));

export type ServiceControlAction = 'start' | 'stop' | 'restart';

export type WorkspaceActions = {
  onRefresh: () => void;
  currentUsername?: string;
};

export type AdminActions = {
  adminPassword: string;
  controlBusyKey: string;
  controlStatus: string;
  lockBusy: boolean;
  onAdminPasswordChange: (value: string) => void;
  onControl: (serviceKey: string, action: ServiceControlAction) => void;
  onUnlock: () => void;
  onLock: () => void;
};

export type NormalizedDrive = Record<string, unknown> & { state: string };

export const toPercent = (value: unknown) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return '0%';
  }
  return `${Math.round(num)}%`;
};

export const formatBytes = (value: unknown) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const scaled = bytes / (1024 ** power);
  return `${scaled.toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
};

export const formatUptime = (value: unknown) => {
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

export const mountRole = (entry: Record<string, unknown>) => {
  const token = String(entry.category || entry.mountRole || '').toLowerCase();
  if (token.includes('vault')) {
    return 'vault';
  }
  if (token.includes('scratch')) {
    return 'scratch';
  }
  return 'none';
};

export const compactPathSummary = (value: unknown) => {
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

export const compactWorkflowSummary = (value: unknown, fallback: string) => {
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

export const compactProtectionSummary = (value: unknown) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return 'Storage watchdog state';
  }
  if (text.length <= 180) {
    return text;
  }
  return `${text.slice(0, 177)}…`;
};

export const resolveGatewayHref = (routeValue: unknown) => {
  const route = String(routeValue || '').trim();
  if (!route) {
    return '';
  }
  if (/^https?:\/\//i.test(route)) {
    return route;
  }
  if (typeof window === 'undefined') {
    return route;
  }
  const base = resolveGatewayBase(window.location);
  return `${base}${route.startsWith('/') ? route : `/${route}`}`;
};

export const toHistoryPoint = (value: unknown) => {
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

export const normalizeDriveState = (entry: Record<string, unknown>) => {
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

export const isFallbackDrive = (entry: Record<string, unknown>) => {
  const token = [
    String(entry.mountRole || ''),
    String(entry.role || ''),
    String(entry.name || ''),
    String(entry.dirName || ''),
  ].join(' ').toLowerCase();
  return token.includes('fallback');
};

export const driveStatusLabel = (entry: Record<string, unknown>) =>
  `${String(entry.state || 'unmounted')} (${isFallbackDrive(entry) ? 'fallback' : 'real'})`;

export const dedupeDrives = (entries: Array<Record<string, unknown>>) => {
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

export const toneFromStatus = (statusValue: unknown): 'ok' | 'warn' | 'danger' | 'muted' => {
  const status = String(statusValue || '').trim().toLowerCase();
  if (status === 'working' || status === 'ready' || status === 'mounted' || status === 'healthy') {
    return 'ok';
  }
  if (status === 'stalled' || status === 'blocked' || status === 'starting' || status === 'degraded' || status === 'setup') {
    return 'warn';
  }
  if (status === 'deferred') {
    return 'muted';
  }
  if (status === 'error' || status === 'failed' || status === 'unavailable' || status === 'crashed') {
    return 'danger';
  }
  return 'muted';
};

export function LegacyTrendGraph({
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

export const renderAnimatedAssistantText = (content: string) => {
  const parts = String(content || '').split(/(\s+)/);
  return (
    <span className="dash2-chat-log__message">
      {parts.map((part, index) => (
        <span key={`${index}-${part}`} className={part.trim() ? 'dash2-chat-log__chunk' : undefined}>{part}</span>
      ))}
    </span>
  );
};

export function LocalTabBar({
  label,
  items,
  activeKey,
  onChange,
}: {
  label: string;
  items: Array<{ key: string; label: string }>;
  activeKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="dash2-tab-switcher" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          className={`ui-button ${activeKey === item.key ? 'dash2-tab-switcher__button--active' : ''}`}
          type="button"
          role="tab"
          aria-selected={activeKey === item.key}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export const createTransferDraft = (defaults: Record<string, unknown> = {}) => ({
  host: String(defaults.host || ''),
  mountName: String(defaults.mountName || defaults.defaultName || ''),
  name: String(defaults.name || defaults.defaultName || ''),
  password: '',
  port: String(defaults.port || 21),
  remotePath: String(defaults.remotePath || '/'),
  secure: Boolean(defaults.secure),
  username: String(defaults.username || defaults.user || 'anonymous'),
});

export function WorkspaceDesignTelemetry({
  workspace,
  payload,
}: {
  workspace: WorkspaceKey;
  payload: Record<string, unknown>;
}) {
  const telemetry = asRecord(payload.designTelemetry);
  if (Object.keys(telemetry).length === 0) {
    return null;
  }

  const rows: Array<{ label: string; value: string }> = [];
  if (workspace === 'overview') {
    rows.push(
      { label: 'Integrity index', value: `${Math.round(Number(telemetry.integrityIndexPct || 0))}%` },
      { label: 'Drive cluster', value: `${Number(telemetry.mountedDriveCount || 0)} mounted` }
    );
  } else if (workspace === 'media') {
    const sessions = asArray<Record<string, unknown>>(telemetry.activeSessions);
    const totals = asRecord(telemetry.libraryTotals);
    rows.push(
      { label: 'Live sessions', value: `${sessions.length}` },
      { label: 'Library totals', value: `${Number(totals.movieCount || 0)} movies · ${Number(totals.seriesCount || 0)} series` }
    );
  } else if (workspace === 'files') {
    const capacity = asRecord(telemetry.clusterCapacity);
    rows.push(
      { label: 'Cluster usage', value: `${Number(capacity.usePercent || 0)}%` },
      { label: 'Parity', value: String(asRecord(telemetry.parity).state || 'unknown') }
    );
  } else if (workspace === 'transfers') {
    const throughput = asRecord(telemetry.globalThroughput);
    rows.push(
      { label: 'Total throughput', value: `${Number(throughput.totalGbps || 0)} Gbps` },
      { label: 'Pipelines', value: `${Number(telemetry.activePipelines || 0)}` }
    );
  } else if (workspace === 'ai') {
    rows.push(
      { label: 'Node ID', value: String(telemetry.nodeId || 'n/a') },
      { label: 'Model cards', value: `${asArray(telemetry.models).length}` }
    );
  } else if (workspace === 'terminal') {
    rows.push(
      { label: 'Access mode', value: String(telemetry.accessMode || 'shell') },
      { label: 'Route', value: String(telemetry.route || 'n/a') }
    );
  } else {
    rows.push(
      { label: 'Compute core analysis', value: `${Number(telemetry.computeCoreAnalysisPct || 0)}%` },
      { label: 'Kernel log lines', value: `${asArray(telemetry.kernelLogTail).length}` }
    );
  }

  return (
    <SectionCard
      title="Stitch parity telemetry"
      subtitle="Additive telemetry projection for Obsidian screen parity."
    >
      <KeyValueList rows={rows} />
    </SectionCard>
  );
}
