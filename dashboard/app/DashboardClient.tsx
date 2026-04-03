'use client';

import type { CSSProperties, FormEvent, InputHTMLAttributes, ReactNode } from 'react';
import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { appFetch, getDemoTerminalLines } from './demo-api';
import type { DrivePayload } from './dashboard-utils';
import { EMPTY_DRIVE_PAYLOAD, formatBytes as fmtBytes, formatDuration as fmtDuration, formatRate as fmtRate, normalizeDrivePayload } from './dashboard-utils';
import { isDemoMode } from './demo-mode';
import { DialogSurface, MenuButton } from './ui-primitives';
import { usePolling } from './usePolling';
import { useGatewayBase } from './useGatewayBase';

const API = process.env.NEXT_PUBLIC_API || '/api';

const THEME = {
  accent: 'var(--accent)',
  accentFill: 'var(--accent-soft)',
  accentStrong: 'var(--accent-strong)',
  brightYellow: 'var(--warning)',
  crimsonRed: 'var(--danger)',
  darkPurple: 'var(--panel-raised)',
  bg: 'var(--background)',
  panel: 'var(--panel)',
  panelRaised: 'var(--panel-raised)',
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  ok: 'var(--ok)',
  border: 'var(--border)',
};

type TabKey = 'home' | 'media' | 'downloads' | 'arr' | 'terminal' | 'filesystem' | 'ftp' | 'ai' | 'settings';
type Services = Record<string, boolean>;
type ServiceGroupKey = 'platform' | 'media' | 'arr' | 'data' | 'access' | 'filesystem' | 'downloads' | 'ai';
type ServiceSurface = 'home' | 'media' | 'downloads' | 'arr' | 'terminal' | 'settings' | 'ftp' | 'filesystem' | 'ai';

type ServiceCatalogEntry = {
  available: boolean;
  avgLatencyMs?: number | null;
  blockedBy?: 'storage_watchdog' | string;
  blockedReason?: string;
  blocker?: string;
  checkedAt?: string | null;
  controlMode: 'always_on' | 'optional';
  description: string;
  group: ServiceGroupKey;
  key: string;
  lastFailureAt?: string | null;
  lastCheckedAt?: string | null;
  lastTransitionAt?: string | null;
  label: string;
  latencyMs?: number | null;
  placeholder: boolean;
  reason?: string | null;
  restartRecommended?: boolean;
  route?: string;
  state?: string | null;
  status: 'working' | 'stopped' | 'stalled' | 'unavailable' | string;
  statusReason?: string | null;
  resumeRequired?: boolean;
  surface: ServiceSurface;
  uptimePct?: number | null;
};

type ServiceLifecycleSummary = {
  checkedAt?: string | null;
  counts?: {
    blocked?: number;
    crashed?: number;
    degraded?: number;
    healthy?: number;
    stopped?: number;
  };
  lastFailureAt?: string | null;
  reason?: string | null;
  restartRecommended?: boolean;
  state?: 'healthy' | 'degraded' | 'blocked' | 'crashed' | 'stopped' | string;
};

type Monitor = {
  cpuCores: number;
  cpuLoad: number;
  device?: {
    androidVersion?: string | null;
    batteryPct?: number | null;
    charging?: boolean | null;
    wifiDbm?: number | null;
  };
  eventLoopLagMs: number;
  eventLoopP95Ms: number;
  freeMem: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  network: {
    rxBytes: number;
    txBytes: number;
    rxRate: number;
    txRate: number;
  };
  processExternal: number;
  processHeapTotal: number;
  processHeapUsed: number;
  processRss: number;
  totalMem: number;
  usedMem: number;
  uptime: number;
};

type ConnectedUser = {
  durationMs?: number;
  username: string;
  ip: string;
  port: string;
  protocol: string;
  sessionId?: string;
  status: string;
  lastSeen: string;
};

type StorageMount = {
  filesystem: string;
  fsType?: string;
  size: number;
  used: number;
  available: number;
  usePercent: number;
  mount: string;
  category?: string;
};

type StorageProtectionState = {
  available?: boolean;
  blockedServices?: string[];
  enabled?: boolean;
  generatedAt?: string | null;
  healthyStreak?: number;
  lastDegradedAt?: string | null;
  lastHealthyAt?: string | null;
  lastTransitionAt?: string | null;
  manualResume?: boolean;
  overallHealthy?: boolean;
  reason?: string;
  resumeRequired?: boolean;
  state?: 'healthy' | 'degraded' | 'recovered' | string;
  stoppedByWatchdog?: string[];
  vault?: {
    healthy?: boolean;
    reason?: string;
    drives?: string[];
    roots?: string[];
  };
  scratch?: {
    healthy?: boolean;
    reason?: string;
    drives?: string[];
    roots?: string[];
  };
};

type DebugLog = {
  id?: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | string;
  message: string;
  meta?: unknown;
};

type FtpEntry = {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt?: string;
  rawModifiedAt?: string;
  permissions?: string;
};

type FtpMountState = {
  error?: string;
  mounted: boolean;
  mountName: string;
  mountPoint: string;
  pid?: number | null;
  remoteName: string;
  running: boolean;
  state: 'mounted' | 'starting' | 'error' | 'unmounted' | string;
};

type FtpFavourite = {
  id: number;
  name: string;
  protocol: string;
  host: string;
  port: number;
  username: string;
  secure: boolean;
  remotePath: string;
  mountName: string;
  createdAt: string;
  updatedAt: string;
  mount: FtpMountState;
};

type FtpFavouriteDraft = {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  secure: boolean;
  remotePath: string;
  mountName: string;
};

type FtpDefaults = {
  defaultName: string;
  host: string;
  port: number;
  user: string;
  secure: boolean;
  downloadRoot: string;
};

type DashboardPayload = {
  generatedAt: string;
  lifecycle?: ServiceLifecycleSummary;
  services: Services;
  serviceCatalog?: ServiceCatalogEntry[];
  serviceGroups?: Partial<Record<ServiceGroupKey, string[]>>;
  mediaWorkflow?: MediaWorkflowPayload;
  serviceController?: {
    locked?: boolean;
    optionalServices?: string[];
  };
  monitor: Monitor;
  connections: {
    users: ConnectedUser[];
  };
  storage: {
    mounts: StorageMount[];
  };
  logs: {
    entries?: DebugLog[];
    logs: DebugLog[];
    markdown: string;
    verboseLoggingEnabled: boolean;
  };
};

type TelemetryPayload = {
  generatedAt: string;
  lifecycle?: ServiceLifecycleSummary;
  logs: {
    entries?: DebugLog[];
    logs?: DebugLog[];
    markdown?: string;
    verboseLoggingEnabled?: boolean;
  };
  monitor: Monitor;
  mediaWorkflow?: MediaWorkflowPayload;
  serviceCatalog?: ServiceCatalogEntry[];
  serviceController?: {
    locked?: boolean;
    optionalServices?: string[];
  };
  serviceGroups?: Partial<Record<ServiceGroupKey, string[]>>;
  services: Services;
};

type SessionUser = {
  role: 'admin' | 'user' | string;
  username: string;
};

type ManagedUser = {
  createdAt: string;
  id: number;
  isDisabled: boolean;
  role: 'admin' | 'user' | string;
  updatedAt: string;
  username: string;
};

type UserDraft = {
  password: string;
  role: 'admin' | 'user';
  username: string;
};

type LayoutMode = 'desktop' | 'tablet' | 'mobile';
type ThemeMode = 'dark' | 'light' | 'contrast';
type MediaSectionKey = 'watch' | 'requests' | 'automation' | 'downloads' | 'subtitles' | 'live-tv' | 'support';
type MediaWorkflowPayload = {
  automation?: {
    healthy?: number;
    serviceKeys?: string[];
    status?: string;
    summary?: string;
    total?: number;
  };
  downloads?: {
    clientCount?: number;
    defaultSavePath?: string | null;
    downloadRoots?: string[];
    primaryServiceKey?: string | null;
    serviceKeys?: string[];
    status?: string;
    summary?: string;
    workspaceTab?: TabKey;
  };
  liveTv?: {
    channelCount?: number | null;
    channelsMapped?: boolean | null;
    guideConfigured?: boolean;
    guideSource?: string | null;
    playlistConfigured?: boolean;
    playlistSource?: string | null;
    status?: string;
    summary?: string;
    tunerType?: string;
  };
  requests?: {
    blocker?: string | null;
    serviceKeys?: string[];
    status?: string;
    summary?: string;
  };
  subtitles?: {
    blocker?: string | null;
    serviceKeys?: string[];
    status?: string;
    summary?: string;
  };
  support?: {
    serviceKeys?: string[];
    status?: string;
    summary?: string;
  };
  storage?: {
    protection?: StorageProtectionState;
  };
  watch?: {
    libraryRootReady?: boolean;
    libraryRoots?: string[];
    serviceKeys?: string[];
    status?: string;
    summary?: string;
  };
};
type BatteryManagerLike = {
  charging: boolean;
  level: number;
  addEventListener: (event: 'chargingchange' | 'levelchange', listener: () => void) => void;
  removeEventListener: (event: 'chargingchange' | 'levelchange', listener: () => void) => void;
};

type LlmModel = {
  id: string;
  label: string;
  source: 'preset' | 'custom' | 'auto' | string;
  path: string;
  installed: boolean;
  repo?: string;
  file?: string;
  url?: string;
};

type LlmOnlineModel = {
  id: string;
  label: string;
};

type LlmPullJob = {
  id: string;
  status: 'queued' | 'running' | 'success' | 'failed' | string;
  message?: string;
  modelId?: string;
  updatedAt?: string;
};

type LlmConversation = {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type LlmMessage = {
  id: number;
  conversationId: number;
  role: 'system' | 'user' | 'assistant' | 'tool' | string;
  content: string;
  modelId?: string;
  createdAt: string;
};

type LlmSubview = 'chat' | 'manage';

type LlmMessageSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language: string };

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'media', label: 'Media' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'filesystem', label: 'Filesystem' },
  { key: 'ftp', label: 'FTP' },
  { key: 'ai', label: 'LLM' },
  { key: 'settings', label: 'Settings' },
];

const TAB_KEYS = new Set<TabKey>(TABS.map(({ key }) => key));

const TAB_ICONS: Record<TabKey, { path: string; viewBox: string }> = {
  home: {
    viewBox: '0 0 20 20',
    path: 'M2.5 9.25 10 3l7.5 6.25V17a.75.75 0 0 1-.75.75H13v-5.25H7V17a.75.75 0 0 1-.75.75H3.25A.75.75 0 0 1 2.5 17V9.25Z',
  },
  media: {
    viewBox: '0 0 20 20',
    path: 'M4.5 4.75A.75.75 0 0 1 5.25 4h9.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-9.5a.75.75 0 0 1-.75-.75V4.75Zm2 1.5v7.5l6.5-3.75-6.5-3.75Z',
  },
  downloads: {
    viewBox: '0 0 20 20',
    path: 'M10 2.75a.75.75 0 0 1 .75.75v7.94l2.22-2.22 1.06 1.06L10 14.31l-4.03-4.03 1.06-1.06 2.22 2.22V3.5A.75.75 0 0 1 10 2.75Zm-5 12.5A.75.75 0 0 1 5.75 14.5h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 15.25Z',
  },
  arr: {
    viewBox: '0 0 20 20',
    path: 'M3 5.25A.75.75 0 0 1 3.75 4.5h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 5.25Zm0 4.75A.75.75 0 0 1 3.75 9.25h7.25a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 10ZM3 14.75a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75ZM14.25 7l2.25 3-2.25 3v-2H10a.75.75 0 0 1 0-1.5h4.25V7Z',
  },
  terminal: {
    viewBox: '0 0 20 20',
    path: 'M3 4.75A.75.75 0 0 1 3.75 4h12.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75V4.75Zm2.5 2.25 2.5 2.25-2.5 2.25 1 1.1 3.6-3.35-3.6-3.35-1 1.1Zm4.5 5.5h4v-1.5h-4v1.5Z',
  },
  filesystem: {
    viewBox: '0 0 20 20',
    path: 'M3.5 5.25A1.25 1.25 0 0 1 4.75 4h4.1c.33 0 .64.13.87.36l1.19 1.14H15.25a1.25 1.25 0 0 1 1.25 1.25v6.5a1.25 1.25 0 0 1-1.25 1.25H4.75A1.25 1.25 0 0 1 3.5 13.25v-8Zm1.5 0v8h10.75v-6.5H10.1L8.67 5.75H5Z',
  },
  ftp: {
    viewBox: '0 0 20 20',
    path: 'M4.25 15.5A4.25 4.25 0 0 1 5 7.06 5.75 5.75 0 0 1 15.66 8.5 3.5 3.5 0 0 1 15.25 15.5H4.25Zm5.25-6.5-2.5 2.5h1.65V14h1.7v-2.5H12l-2.5-2.5Z',
  },
  ai: {
    viewBox: '0 0 20 20',
    path: 'M10 2.5a2.25 2.25 0 0 1 2.25 2.25V5.5h1.5A2.25 2.25 0 0 1 16 7.75v1.5h.75a2.25 2.25 0 0 1 0 4.5H16v1.5a2.25 2.25 0 0 1-2.25 2.25h-1.5v.75a2.25 2.25 0 0 1-4.5 0v-.75h-1.5A2.25 2.25 0 0 1 4 15.25v-1.5h-.75a2.25 2.25 0 0 1 0-4.5H4v-1.5A2.25 2.25 0 0 1 6.25 5.5h1.5v-.75A2.25 2.25 0 0 1 10 2.5Zm-1.75 6.25a.75.75 0 0 0-.75.75v1h1.5v-1a.75.75 0 0 0-.75-.75Zm3.5 0a.75.75 0 0 0-.75.75v1h1.5v-1a.75.75 0 0 0-.75-.75Zm-3.5 3.25a.75.75 0 0 0-.75.75v1h1.5v-1a.75.75 0 0 0-.75-.75Zm3.5 0a.75.75 0 0 0-.75.75v1h1.5v-1a.75.75 0 0 0-.75-.75Z',
  },
  settings: {
    viewBox: '0 0 20 20',
    path: 'M8.25 2.75h3.5l.45 1.7c.38.13.74.31 1.08.53l1.67-.55 1.75 3.03-1.31 1.18c.04.19.06.39.06.59s-.02.4-.06.59l1.31 1.18-1.75 3.03-1.67-.55c-.34.22-.7.4-1.08.53l-.45 1.7h-3.5l-.45-1.7a5.7 5.7 0 0 1-1.08-.53l-1.67.55-1.75-3.03 1.31-1.18a4.2 4.2 0 0 1 0-1.18L3.3 7.46l1.75-3.03 1.67.55c.34-.22.7-.4 1.08-.53l.45-1.7Zm1.75 4A2.25 2.25 0 1 0 10 11.25 2.25 2.25 0 0 0 10 6.75Z',
  },
};

const SERVICE_GROUP_LABELS: Record<ServiceGroupKey, string> = {
  access: 'Access',
  ai: 'LLM',
  arr: 'Automation',
  data: 'Data',
  downloads: 'Downloads',
  filesystem: 'Files',
  media: 'Media',
  platform: 'Platform',
};

const THEME_STORAGE_KEY = 'hmstx-theme';
const LOW_POWER_STORAGE_KEY = 'hmstx-low-power';
const ONBOARDING_STORAGE_KEY = 'hmstx-onboarded';
const DEMO_BANNER_STORAGE_KEY = 'hmstx-demo-banner-dismissed';
const COLLAPSE_STORAGE_KEY = 'hmstx-collapsed-sections';
const REPO_BASE_URL = 'https://github.com/Rushtu99/Home-Server-Termux/blob/main';
const PROJECT_README_URL = `${REPO_BASE_URL}/README.md`;
const DOCS_HUB_URL = `${REPO_BASE_URL}/docs/README.md`;
const OPERATIONS_DOC_URL = `${REPO_BASE_URL}/docs/operations.md`;
const ROADMAP_DOC_URL = `${REPO_BASE_URL}/docs/roadmap.md`;
const MEDIA_STORAGE_DOC_URL = `${REPO_BASE_URL}/docs/media-storage.md`;

const COMMAND_DOCS = [
  {
    id: 'docs-hub',
    label: 'Open docs hub',
    subtitle: 'Docs',
    value: DOCS_HUB_URL,
  },
  {
    id: 'docs-operations',
    label: 'Open operations runbook',
    subtitle: 'Docs',
    value: OPERATIONS_DOC_URL,
  },
  {
    id: 'docs-roadmap',
    label: 'Open live NAS roadmap',
    subtitle: 'Docs',
    value: ROADMAP_DOC_URL,
  },
  {
    id: 'docs-media',
    label: 'Open media and storage guide',
    subtitle: 'Docs',
    value: MEDIA_STORAGE_DOC_URL,
  },
  {
    id: 'docs-readme',
    label: 'Open project README',
    subtitle: 'Docs',
    value: PROJECT_README_URL,
  },
];

type ServiceProfile = {
  focusLabel: string;
  quickLabels: string[];
};

const SERVICE_PROFILES: Record<string, ServiceProfile> = {
  nginx: { focusLabel: 'Gateway', quickLabels: ['Proxy', 'Ports', 'Headers'] },
  ttyd: { focusLabel: 'Terminal', quickLabels: ['Shell', 'Sessions', 'Clipboard'] },
  jellyfin: { focusLabel: 'Library', quickLabels: ['Playback', 'Clients', 'Activity'] },
  qbittorrent: { focusLabel: 'Downloads', quickLabels: ['Torrents', 'Queue', 'Peers'] },
  jellyseerr: { focusLabel: 'Requests', quickLabels: ['Library', 'Queue', 'Discovery'] },
  sonarr: { focusLabel: 'Series', quickLabels: ['Calendar', 'Queue', 'Wanted'] },
  radarr: { focusLabel: 'Movies', quickLabels: ['Calendar', 'Queue', 'Wanted'] },
  prowlarr: { focusLabel: 'Indexers', quickLabels: ['Search', 'Apps', 'Sync'] },
  bazarr: { focusLabel: 'Subtitles', quickLabels: ['Languages', 'Sync', 'History'] },
  postgres: { focusLabel: 'Databases', quickLabels: ['Connections', 'Queries', 'WAL'] },
  redis: { focusLabel: 'Cache', quickLabels: ['Keys', 'Memory', 'Workers'] },
  ftp: { focusLabel: 'Remotes', quickLabels: ['Favourites', 'Browse', 'Mounts'] },
  copyparty: { focusLabel: 'Drop zone', quickLabels: ['Uploads', 'Shares', 'Links'] },
  syncthing: { focusLabel: 'Devices', quickLabels: ['Folders', 'Peers', 'Versions'] },
  samba: { focusLabel: 'Shares', quickLabels: ['Clients', 'Exports', 'Auth'] },
  sshd: { focusLabel: 'Sessions', quickLabels: ['Keys', 'Hosts', 'Users'] },
  llm: { focusLabel: 'Inference', quickLabels: ['Models', 'Chat', 'Tokens'] },
};

const getServiceProfile = (entry: ServiceCatalogEntry): ServiceProfile => SERVICE_PROFILES[entry.key] || {
  focusLabel: 'Service',
  quickLabels: ['Status', 'History', 'Route'],
};

type LegacyServiceStatus = 'working' | 'stopped' | 'stalled' | 'unavailable' | 'blocked';

const LIFECYCLE_STATUS_ALIASES: Record<string, LegacyServiceStatus> = {
  active: 'working',
  blocked: 'blocked',
  crashed: 'stalled',
  degraded: 'stalled',
  down: 'stopped',
  error: 'stalled',
  failed: 'stalled',
  fatal: 'stalled',
  healthy: 'working',
  idle: 'stopped',
  inactive: 'stopped',
  missing: 'unavailable',
  off: 'stopped',
  paused: 'stopped',
  ready: 'working',
  restarting: 'stalled',
  running: 'working',
  setup: 'stopped',
  stalled: 'stalled',
  starting: 'stalled',
  stopped: 'stopped',
  unavailable: 'unavailable',
  unhealthy: 'stalled',
  unknown: 'unavailable',
  working: 'working',
};

const normalizeLifecycleStatus = (state?: string | null, status?: string | null): string => {
  const lifecycleValue = typeof state === 'string' && state.trim()
    ? state
    : typeof status === 'string'
      ? status
      : '';
  const token = lifecycleValue.trim().toLowerCase();
  if (token && LIFECYCLE_STATUS_ALIASES[token]) {
    return LIFECYCLE_STATUS_ALIASES[token];
  }
  if (typeof status === 'string' && status.trim()) {
    return status.trim().toLowerCase();
  }
  if (token) {
    return token;
  }
  return 'unavailable';
};

const normalizeIsoTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : value;
};

const normalizeServiceCatalogEntry = (entry: ServiceCatalogEntry): ServiceCatalogEntry => {
  const checkedAt = normalizeIsoTimestamp(entry.checkedAt ?? entry.lastCheckedAt ?? null);
  const reason = typeof entry.reason === 'string' && entry.reason.trim()
    ? entry.reason
    : typeof entry.statusReason === 'string' && entry.statusReason.trim()
      ? entry.statusReason
      : null;
  const restartRecommended = typeof entry.restartRecommended === 'boolean'
    ? entry.restartRecommended
    : Boolean(entry.resumeRequired);
  const status = normalizeLifecycleStatus(entry.state, entry.status);

  return {
    ...entry,
    checkedAt,
    lastCheckedAt: normalizeIsoTimestamp(entry.lastCheckedAt ?? checkedAt ?? null),
    lastFailureAt: normalizeIsoTimestamp(entry.lastFailureAt ?? null),
    reason,
    restartRecommended,
    resumeRequired: typeof entry.resumeRequired === 'boolean' ? entry.resumeRequired : restartRecommended,
    state: typeof entry.state === 'string' && entry.state.trim() ? entry.state : status,
    status,
    statusReason: typeof entry.statusReason === 'string' && entry.statusReason.trim() ? entry.statusReason : reason,
  };
};

const normalizeServiceCatalog = (entries: ServiceCatalogEntry[]) => entries.map(normalizeServiceCatalogEntry);

const normalizeServiceLifecycle = (value: unknown): ServiceLifecycleSummary | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const payload = value as Partial<ServiceLifecycleSummary>;
  const state = typeof payload.state === 'string' && payload.state.trim() ? payload.state.trim().toLowerCase() : undefined;
  const checkedAt = normalizeIsoTimestamp(payload.checkedAt ?? null);
  const lastFailureAt = normalizeIsoTimestamp(payload.lastFailureAt ?? null);
  const reason = typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : null;
  const restartRecommended = Boolean(payload.restartRecommended);
  const counts = payload.counts && typeof payload.counts === 'object'
    ? {
      blocked: Math.max(0, Number(payload.counts.blocked || 0) || 0),
      crashed: Math.max(0, Number(payload.counts.crashed || 0) || 0),
      degraded: Math.max(0, Number(payload.counts.degraded || 0) || 0),
      healthy: Math.max(0, Number(payload.counts.healthy || 0) || 0),
      stopped: Math.max(0, Number(payload.counts.stopped || 0) || 0),
    }
    : undefined;

  return {
    checkedAt,
    counts,
    lastFailureAt,
    reason,
    restartRecommended,
    state,
  };
};

const DOWNLOAD_WORKSPACE_BY_SERVICE: Partial<Record<string, TabKey>> = {
  qbittorrent: 'downloads',
};

const MEDIA_SECTION_BY_SERVICE: Partial<Record<string, MediaSectionKey>> = {
  jellyfin: 'watch',
  jellyseerr: 'requests',
  prowlarr: 'automation',
  sonarr: 'automation',
  radarr: 'automation',
  bazarr: 'subtitles',
  redis: 'support',
  postgres: 'support',
};

const MEDIA_WORKFLOW_ORDER: Array<{ id: MediaSectionKey; label: string; summary: string; bullets: string[] }> = [
  { id: 'watch', label: 'Watch', summary: 'Primary viewing surface', bullets: ['Jellyfin library', 'Playback surface', 'Final destination'] },
  { id: 'requests', label: 'Requests', summary: 'Collect new content demand', bullets: ['Intake portal', 'Movies and series', 'Feeds automation'] },
  { id: 'automation', label: 'Automation', summary: 'Turn requests into imports', bullets: ['Indexer pipeline', 'ARR orchestration', 'Import handoff'] },
  { id: 'downloads', label: 'Downloads', summary: 'Transfer operations workspace', bullets: ['Queue workspace', 'Transfer clients', 'Separate tab'] },
  { id: 'subtitles', label: 'Subtitles', summary: 'Post-import language workflow', bullets: ['Post-import sync', 'Language profiles', 'Quality upgrades'] },
  { id: 'live-tv', label: 'Live TV', summary: 'Guide and channel setup path', bullets: ['M3U source', 'XMLTV guide', 'Channel mapping'] },
];

const MEDIA_AUTOMATION_SERVICE_ORDER = ['prowlarr', 'sonarr', 'radarr'];
const MEDIA_SUBTITLE_SERVICE_KEYS = ['bazarr'];
const MEDIA_REQUEST_SERVICE_KEYS = ['jellyseerr'];
const MEDIA_SUPPORT_SERVICE_KEYS = ['redis', 'postgres'];

const loadAlertTone = (value: number, warnAt: number, dangerAt: number) => {
  if (!Number.isFinite(value)) {
    return THEME.text;
  }
  if (value >= dangerAt) {
    return THEME.crimsonRed;
  }
  if (value >= warnAt) {
    return THEME.brightYellow;
  }
  return THEME.text;
};

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '--';
  }

  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const fmtDateTime = (iso?: string | null) => {
  if (!iso) {
    return '--';
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '--';
  }

  return d.toLocaleString([], {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
};

const compactPathLabel = (value: string) => {
  const normalized = value.replace(/\\/g, '/');
  const slashParts = normalized.split('/').filter(Boolean);
  if (slashParts.length <= 3) {
    return value;
  }
  const prefix = normalized.startsWith('~/')
    ? '~/'
    : normalized.startsWith('/')
      ? '/'
      : '';
  return `${prefix}.../${slashParts.slice(-2).join('/')}`;
};

const compactMediaMeta = (value: string, maxLen = 78) => {
  if (!value) {
    return value;
  }
  const pathLikePattern = /(~?\/[^\s,;:]+(?:\/[^\s,;:]+){2,})/g;
  const compacted = value.replace(pathLikePattern, (match) => compactPathLabel(match));
  if (compacted.length <= maxLen) {
    return compacted;
  }
  return `${compacted.slice(0, maxLen - 3).trimEnd()}...`;
};

const storageTone = (usePercent: number) => {
  if (usePercent >= 80) {
    return THEME.crimsonRed;
  }
  if (usePercent >= 60) {
    return THEME.brightYellow;
  }
  return THEME.accent;
};

const readCollapsedSections = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch {
    return {};
  }
};

const joinRemotePath = (basePath: string, child: string) => {
  const parts = `${basePath === '/' ? '' : basePath}/${child}`
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');

  return `/${parts.join('/')}`;
};

const parentRemotePath = (targetPath: string) => {
  const parts = String(targetPath)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');

  parts.pop();
  return `/${parts.join('/')}` || '/';
};

const createFtpFavouriteDraft = (defaults: Partial<FtpFavouriteDraft> = {}): FtpFavouriteDraft => ({
  name: defaults.name || '',
  host: defaults.host || '',
  port: defaults.port || '2121',
  username: defaults.username || 'anonymous',
  password: defaults.password || '',
  secure: defaults.secure === true,
  remotePath: defaults.remotePath || '/',
  mountName: defaults.mountName || '',
});

const createUserDraft = (): UserDraft => ({
  password: '',
  role: 'user',
  username: '',
});

const parseLlmMessageSegments = (content: string): LlmMessageSegment[] => {
  const input = String(content || '');
  if (!input.includes('```')) {
    return [{ type: 'text', content: input }];
  }

  const segments: LlmMessageSegment[] = [];
  const fence = /```([a-zA-Z0-9._+-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = fence.exec(input)) !== null) {
    const [full, languageRaw, codeRaw] = match;
    if (match.index > cursor) {
      segments.push({ type: 'text', content: input.slice(cursor, match.index) });
    }

    segments.push({
      type: 'code',
      content: String(codeRaw || '').replace(/\n$/, ''),
      language: String(languageRaw || '').trim(),
    });
    cursor = match.index + full.length;
  }

  if (cursor < input.length) {
    segments.push({ type: 'text', content: input.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: input }];
};

const createFtpFavouriteDraftFromFavourite = (favourite: FtpFavourite): FtpFavouriteDraft =>
  createFtpFavouriteDraft({
    name: favourite.name,
    host: favourite.host,
    port: String(favourite.port || 21),
    username: favourite.username || 'anonymous',
    password: '',
    secure: favourite.secure,
    remotePath: favourite.remotePath || '/',
    mountName: favourite.mountName || favourite.name,
  });

const describeFtpMount = (mount?: FtpMountState | null) => {
  if (!mount) {
    return 'unmounted';
  }

  if (mount.mounted) {
    return `mounted at ${mount.mountPoint}`;
  }

  if (mount.state === 'starting' || mount.running) {
    return 'mount starting';
  }

  if (mount.error) {
    return mount.error;
  }

  return 'unmounted';
};

const DEMO_BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || '';
const DEMO_LAST_COMMIT_DATE = process.env.NEXT_PUBLIC_LAST_COMMIT_DATE || '';
const DEMO_LAST_COMMIT_ID = process.env.NEXT_PUBLIC_LAST_COMMIT_ID || '';
const DEMO_LAST_COMMIT_FULL = process.env.NEXT_PUBLIC_LAST_COMMIT_FULL || '';

export default function Dashboard() {
  const demoMode = isDemoMode();
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('desktop');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [lowPowerMode, setLowPowerMode] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [services, setServices] = useState<Services>({});
  const [serviceCatalog, setServiceCatalog] = useState<ServiceCatalogEntry[]>([]);
  const [serviceLifecycle, setServiceLifecycle] = useState<ServiceLifecycleSummary | null>(null);
  const [serviceGroups, setServiceGroups] = useState<Partial<Record<ServiceGroupKey, string[]>>>({});
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [connections, setConnections] = useState<ConnectedUser[]>([]);
  const [storage, setStorage] = useState<StorageMount[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const [lastTelemetryAt, setLastTelemetryAt] = useState(0);
  const [controlStatus, setControlStatus] = useState('');
  const [storageProtectionStatus, setStorageProtectionStatus] = useState('');
  const [storageProtectionBusy, setStorageProtectionBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState<Record<string, boolean>>({});
  const [serviceControllerLocked, setServiceControllerLocked] = useState(true);
  const [serviceUnlockBusy, setServiceUnlockBusy] = useState(false);
  const [serviceUnlockPassword, setServiceUnlockPassword] = useState('');
  const [verboseLogging, setVerboseLogging] = useState(false);
  const [logsMarkdown, setLogsMarkdown] = useState('');
  const [optionalServices, setOptionalServices] = useState<string[]>(['ftp', 'copyparty', 'syncthing', 'samba', 'sshd']);
  const [ftpDefaults, setFtpDefaults] = useState<FtpDefaults | null>(null);
  const [ftpHost, setFtpHost] = useState('');
  const [ftpPort, setFtpPort] = useState('2121');
  const [ftpUser, setFtpUser] = useState('anonymous');
  const [ftpPassword, setFtpPassword] = useState('anonymous@');
  const [ftpSecure, setFtpSecure] = useState(false);
  const [ftpPath, setFtpPath] = useState('/');
  const [ftpEntries, setFtpEntries] = useState<FtpEntry[]>([]);
  const [ftpBusy, setFtpBusy] = useState(false);
  const [ftpStatus, setFtpStatus] = useState('');
  const [ftpDownloadRoot, setFtpDownloadRoot] = useState('');
  const [ftpUploadLocalPath, setFtpUploadLocalPath] = useState('');
  const [ftpUploadRemotePath, setFtpUploadRemotePath] = useState('');
  const [ftpFolderName, setFtpFolderName] = useState('');
  const [ftpFavourites, setFtpFavourites] = useState<FtpFavourite[]>([]);
  const [ftpFavouritesBusy, setFtpFavouritesBusy] = useState(false);
  const [ftpFavouriteDraft, setFtpFavouriteDraft] = useState<FtpFavouriteDraft>(() => createFtpFavouriteDraft());
  const [ftpEditingFavouriteId, setFtpEditingFavouriteId] = useState<number | null>(null);
  const [ftpActiveFavouriteId, setFtpActiveFavouriteId] = useState<number | null>(null);
  const [ftpEntryMenuState, setFtpEntryMenuState] = useState<{ key: string; upward: boolean } | null>(null);
  const [ftpSearch, setFtpSearch] = useState('');
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [userStatus, setUserStatus] = useState('');
  const [userDraft, setUserDraft] = useState<UserDraft>(() => createUserDraft());
  const [driveState, setDriveState] = useState<DrivePayload>(EMPTY_DRIVE_PAYLOAD);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [showDriveLog, setShowDriveLog] = useState(false);
  const [dashboardShares, setDashboardShares] = useState<Array<{ id: number; name: string; pathKey: string; sourceType: string }>>([]);
  const [alertMessage, setAlertMessage] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showDemoBanner, setShowDemoBanner] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [searchHasFocus, setSearchHasFocus] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [connectionsExpanded, setConnectionsExpanded] = useState(false);
  const [connectionBusyId, setConnectionBusyId] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectedUser | null>(null);
  const [mediaWorkflow, setMediaWorkflow] = useState<MediaWorkflowPayload | null>(null);
  const [pendingMediaSection, setPendingMediaSection] = useState<MediaSectionKey | null>(null);
  const [llmModels, setLlmModels] = useState<LlmModel[]>([]);
  const [llmPullJobs, setLlmPullJobs] = useState<LlmPullJob[]>([]);
  const [llmActiveModelId, setLlmActiveModelId] = useState('');
  const [llmApiKeyConfigured, setLlmApiKeyConfigured] = useState(false);
  const [llmRunning, setLlmRunning] = useState(false);
  const [llmStatus, setLlmStatus] = useState('');
  const [llmConversations, setLlmConversations] = useState<LlmConversation[]>([]);
  const [llmConversationId, setLlmConversationId] = useState<number | null>(null);
  const [llmMessages, setLlmMessages] = useState<LlmMessage[]>([]);
  const [llmPrompt, setLlmPrompt] = useState('');
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmModelBusyId, setLlmModelBusyId] = useState('');
  const [llmLocalModelLabel, setLlmLocalModelLabel] = useState('');
  const [llmLocalModelPath, setLlmLocalModelPath] = useState('');
  const [llmMode, setLlmMode] = useState<'local' | 'online'>('local');
  const [llmOnlineConfigured, setLlmOnlineConfigured] = useState(false);
  const [llmOnlineAvailable, setLlmOnlineAvailable] = useState(false);
  const [llmOnlineError, setLlmOnlineError] = useState('');
  const [llmOnlineModels, setLlmOnlineModels] = useState<LlmOnlineModel[]>([]);
  const [llmOnlineModelId, setLlmOnlineModelId] = useState('');
  const [llmSubview, setLlmSubview] = useState<LlmSubview>('chat');
  const [llmHistoryOpen, setLlmHistoryOpen] = useState(false);

  const cpuCanvas = useRef<HTMLCanvasElement>(null);
  const ramCanvas = useRef<HTMLCanvasElement>(null);
  const ftpMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const mediaSectionRefs = useRef<Partial<Record<MediaSectionKey, HTMLElement | null>>>({});
  const fetchInFlightRef = useRef(false);
  const telemetryInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const tabSyncReadyRef = useRef(false);
  const previousStatusesRef = useRef<Record<string, string>>({});
  const gatewayBase = useGatewayBase();
  const isCompact = layoutMode !== 'desktop';
  const isPhone = layoutMode === 'mobile';
  const isTablet = layoutMode === 'tablet';
  const deferredCommandQuery = useDeferredValue(commandQuery);
  const deferredLogSearch = useDeferredValue(logSearch);
  const demoMetaItems = demoMode
    ? [
        'Demo preview',
        DEMO_LAST_COMMIT_ID ? `Commit ${DEMO_LAST_COMMIT_ID}` : 'Commit unknown',
        DEMO_LAST_COMMIT_DATE ? `Committed ${fmtDateTime(DEMO_LAST_COMMIT_DATE)}` : 'Commit time unknown',
        DEMO_BUILD_TIME ? `Built ${fmtDateTime(DEMO_BUILD_TIME)}` : 'Build time unknown',
        lastUpdated ? `Telemetry ${lastUpdated}` : 'Telemetry pending',
      ]
    : [];

  const clearSession = (message = '') => {
    if (typeof window !== 'undefined') {
      void appFetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    }

    if (!mountedRef.current) {
      return;
    }

    setIsAuthed(false);
    setAuthBusy(false);
    setSessionUser(null);
    setPassword('');
    setServices({});
    setServiceCatalog([]);
    setServiceGroups({});
    setMonitor(null);
    setConnections([]);
    setStorage([]);
    setDebugLogs([]);
    setCpuHistory([]);
    setRamHistory([]);
    setLastUpdated('');
    setControlStatus('');
    setControlBusy({});
    setServiceControllerLocked(true);
    setServiceUnlockBusy(false);
    setServiceUnlockPassword('');
    setOptionalServices(['ftp', 'copyparty', 'syncthing', 'samba', 'sshd']);
    setLogsMarkdown('');
    setFtpDefaults(null);
    setFtpFavourites([]);
    setFtpFavouriteDraft(createFtpFavouriteDraft());
    setFtpEditingFavouriteId(null);
    setFtpActiveFavouriteId(null);
    setFtpEntries([]);
    setFtpEntryMenuState(null);
    setFtpSearch('');
    setFtpPath('/');
    setFtpStatus('');
    setFtpHost('');
    setFtpPort('2121');
    setFtpUser('anonymous');
    setFtpPassword('anonymous@');
    setFtpSecure(false);
    setFtpDownloadRoot('');
    setFtpUploadLocalPath('');
    setFtpUploadRemotePath('');
    setFtpFolderName('');
    setManagedUsers([]);
    setUserStatus('');
    setUserDraft(createUserDraft());
    setDriveState(EMPTY_DRIVE_PAYLOAD);
    setDriveBusy(false);
    setDriveError('');
    setShowDriveLog(false);
    setDashboardShares([]);
    setMediaWorkflow(null);
    setLlmModels([]);
    setLlmPullJobs([]);
    setLlmActiveModelId('');
    setLlmApiKeyConfigured(false);
    setLlmRunning(false);
    setLlmStatus('');
    setLlmConversations([]);
    setLlmConversationId(null);
    setLlmMessages([]);
    setLlmPrompt('');
    setLlmBusy(false);
    setLlmModelBusyId('');
    setLlmLocalModelLabel('');
    setLlmLocalModelPath('');
    setLlmMode('local');
    setLlmOnlineConfigured(false);
    setLlmOnlineAvailable(false);
    setLlmOnlineError('');
    setLlmOnlineModels([]);
    setLlmOnlineModelId('');
    setLlmSubview('chat');
    setLlmHistoryOpen(false);
    setCommandPaletteOpen(false);
    setCommandQuery('');
    setSearchHasFocus(false);
    setAuthError(message);
  };

  const openExternalLink = (url: string) => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noreferrer');
    }
  };

  const authFetch = (path: string, init: RequestInit = {}) =>
    appFetch(path, { ...init, credentials: init.credentials || 'include' });

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const res = await appFetch(`${API}/auth/me`, { credentials: 'include' });

        if (!mountedRef.current) {
          return;
        }

        if (res.ok) {
          const payload = await res.json().catch(() => ({}));
          setIsAuthed(true);
          if (payload?.user?.username) {
            setSessionUser({
              role: String(payload.user.role || 'user'),
              username: String(payload.user.username || ''),
            });
          }
          setAuthError('');
        }
      } catch {
        if (!mountedRef.current) {
          return;
        }
      } finally {
        if (mountedRef.current) {
          setAuthChecked(true);
        }
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get('tab');
    if (requestedTab === 'arr') {
      setActiveTab('media');
      setPendingMediaSection('automation');
    } else if (requestedTab && TAB_KEYS.has(requestedTab as TabKey)) {
      setActiveTab(requestedTab as TabKey);
    }
    tabSyncReadyRef.current = true;
  }, []);

  useEffect(() => {
    const updateLayout = () => {
      const width = window.innerWidth;
      setLayoutMode(width < 760 ? 'mobile' : width < 1200 ? 'tablet' : 'desktop');
    };
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = storedTheme === 'light' || storedTheme === 'contrast' || storedTheme === 'dark'
      ? storedTheme
      : 'dark';
    const storedLowPower = window.localStorage.getItem(LOW_POWER_STORAGE_KEY) === 'true';
    const dismissedDemoBanner = window.localStorage.getItem(DEMO_BANNER_STORAGE_KEY) === 'true';
    const onboardingSeen = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
    const params = new URLSearchParams(window.location.search);

    root.dataset.theme = nextTheme;
    setThemeMode(nextTheme);
    setLowPowerMode(storedLowPower);
    setCollapsedSections(readCollapsedSections());
    setShowOnboarding(!onboardingSeen);
    setShowDemoBanner(demoMode && params.get('demo') !== 'false' && !dismissedDemoBanner);

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/service-worker.js`).catch(() => {});
    }
  }, [demoMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(LOW_POWER_STORAGE_KEY, String(lowPowerMode));
    document.documentElement.dataset.lowPower = lowPowerMode ? 'true' : 'false';
  }, [lowPowerMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsedSections));
  }, [collapsedSections]);

  useEffect(() => {
    const batteryNavigator = typeof navigator === 'undefined'
      ? null
      : navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

    if (!batteryNavigator || typeof batteryNavigator.getBattery !== 'function') {
      return;
    }

    let cleanup = () => {};

    batteryNavigator.getBattery().then((battery) => {
      const updatePowerMode = () => {
        if (battery.level < 0.2 && !battery.charging) {
          setLowPowerMode(true);
        }
      };

      updatePowerMode();
      battery.addEventListener('levelchange', updatePowerMode);
      battery.addEventListener('chargingchange', updatePowerMode);
      cleanup = () => {
        battery.removeEventListener('levelchange', updatePowerMode);
        battery.removeEventListener('chargingchange', updatePowerMode);
      };
    }).catch(() => {});

    return () => cleanup();
  }, []);

  useEffect(() => {
    if (!tabSyncReadyRef.current) {
      return;
    }

    const url = new URL(window.location.href);
    if (activeTab === 'home') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', activeTab);
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'media' || !pendingMediaSection) {
      return;
    }

    const target = mediaSectionRefs.current[pendingMediaSection];
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPendingMediaSection(null);
  }, [activeTab, pendingMediaSection]);

  useEffect(() => {
    if (!isAuthed || sessionUser?.role !== 'admin') {
      return;
    }

    const bootstrapFtp = async () => {
      try {
        if (!mountedRef.current) {
          return;
        }

        const [defaultsRes, favouritesRes] = await Promise.all([
          authFetch(`${API}/ftp/defaults`),
          authFetch(`${API}/ftp/favourites`),
        ]);

        const [defaultsPayload, favouritesPayload] = await Promise.all([
          defaultsRes.ok ? defaultsRes.json().catch(() => null) : Promise.resolve(null),
          favouritesRes.ok ? favouritesRes.json().catch(() => null) : Promise.resolve(null),
        ]);

        if (!mountedRef.current) {
          return;
        }

        if (defaultsPayload) {
          const nextDefaults = defaultsPayload as FtpDefaults;
          setFtpDefaults(nextDefaults);
          setFtpHost(nextDefaults.host || '');
          setFtpPort(String(nextDefaults.port || 2121));
          setFtpUser(nextDefaults.user || 'anonymous');
          setFtpPassword('');
          setFtpSecure(Boolean(nextDefaults.secure));
          setFtpDownloadRoot(nextDefaults.downloadRoot || '');
          setFtpFavouriteDraft(createFtpFavouriteDraft({
            name: nextDefaults.defaultName || 'PS4',
            host: nextDefaults.host || '',
            port: String(nextDefaults.port || 2121),
            username: nextDefaults.user || 'anonymous',
            password: '',
            secure: Boolean(nextDefaults.secure),
            remotePath: '/',
            mountName: nextDefaults.defaultName || 'PS4',
          }));
        }

        if (favouritesPayload) {
          setFtpFavourites(Array.isArray(favouritesPayload.favourites) ? favouritesPayload.favourites : []);
        }
      } catch {
        // Ignore FTP defaults bootstrap failures.
      }
    };

    void bootstrapFtp();
  }, [isAuthed, sessionUser?.role]);

  const loadManagedUsers = async () => {
    if (sessionUser?.role !== 'admin') {
      setManagedUsers([]);
      return;
    }

    setUsersBusy(true);
    try {
      const res = await authFetch(`${API}/users`);
      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setUserStatus('Unable to load users');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      setManagedUsers(Array.isArray(payload?.users) ? payload.users : []);
    } catch {
      setUserStatus('Unable to load users');
    } finally {
      if (mountedRef.current) {
        setUsersBusy(false);
      }
    }
  };

  const loadDriveConsole = async () => {
    if (!isAuthed) {
      return;
    }

    setDriveBusy(true);
    try {
      const [driveRes, shareRes] = await Promise.all([
        authFetch(`${API}/drives`),
        authFetch(`${API}/shares`),
      ]);

      if (driveRes.status === 401 || shareRes.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!driveRes.ok) {
        const payload = await driveRes.json().catch(() => ({}));
        setDriveError(String(payload?.error || 'Unable to load drive state'));
      } else {
        const payload = await driveRes.json().catch(() => ({}));
        setDriveState(normalizeDrivePayload(payload));
        setDriveError('');
      }

      if (shareRes.ok) {
        const sharePayload = await shareRes.json().catch(() => ({}));
        setDashboardShares(Array.isArray(sharePayload?.shares)
          ? sharePayload.shares.map((entry: { id?: number; name?: string; pathKey?: string; sourceType?: string }) => ({
              id: Number(entry?.id || 0),
              name: String(entry?.name || ''),
              pathKey: String(entry?.pathKey || ''),
              sourceType: String(entry?.sourceType || 'folder'),
            }))
          : []);
      } else {
        setDashboardShares([]);
      }
    } catch {
      setDriveError('Unable to load drive state');
    } finally {
      if (mountedRef.current) {
        setDriveBusy(false);
      }
    }
  };

  const runDriveCheck = async () => {
    setDriveBusy(true);
    setDriveError('');
    try {
      const res = await authFetch(`${API}/drives/check`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setDriveError(String(payload?.error || 'Drive check failed'));
        return;
      }

      setDriveState(normalizeDrivePayload(payload));
      await loadDriveConsole();
    } catch {
      setDriveError('Drive check failed');
    } finally {
      if (mountedRef.current) {
        setDriveBusy(false);
      }
    }
  };

  useEffect(() => {
    if (!isAuthed || activeTab !== 'settings' || sessionUser?.role !== 'admin') {
      return;
    }

    void loadManagedUsers();
  }, [activeTab, isAuthed, sessionUser?.role]);

  useEffect(() => {
    setFtpEntryMenuState(null);
  }, [ftpPath]);

  useEffect(() => {
    if (lowPowerMode) {
      return;
    }
    drawTrend(cpuCanvas.current, cpuHistory, THEME.accentStrong, 'rgba(145,166,127,0.18)');
  }, [cpuHistory, lowPowerMode]);

  useEffect(() => {
    if (lowPowerMode) {
      return;
    }
    drawTrend(ramCanvas.current, ramHistory, '#f0c96a', 'rgba(240,201,106,0.16)');
  }, [lowPowerMode, ramHistory]);

  useEffect(() => {
    if (!isAuthed || activeTab !== 'filesystem') {
      return;
    }

    void loadDriveConsole();
  }, [activeTab, isAuthed, sessionUser?.role]);

  const syncStatusTransitions = (entries: ServiceCatalogEntry[]) => {
    const previous = previousStatusesRef.current;
    const next = { ...previous };

    for (const entry of entries) {
      const priorStatus = previous[entry.key];
      next[entry.key] = entry.status;

      if (priorStatus === 'working' && entry.status !== 'working') {
        setAlertMessage(`${entry.label} needs attention`);
      }
    }

    previousStatusesRef.current = next;
  };

  const applyTelemetryPayload = (payload: TelemetryPayload | DashboardPayload) => {
    if (payload?.services && typeof payload.services === 'object') {
      setServices(payload.services || {});
    }

    const nextCatalog = normalizeServiceCatalog(Array.isArray(payload.serviceCatalog) ? payload.serviceCatalog : []);
    if (nextCatalog.length > 0) {
      setServiceCatalog(nextCatalog);
      syncStatusTransitions(nextCatalog);
    }
    if (payload.serviceGroups && typeof payload.serviceGroups === 'object') {
      setServiceGroups(payload.serviceGroups);
    }
    setServiceLifecycle(normalizeServiceLifecycle(payload.lifecycle));
    if (payload.mediaWorkflow && typeof payload.mediaWorkflow === 'object') {
      setMediaWorkflow(payload.mediaWorkflow);
    }
    if (Array.isArray(payload.serviceController?.optionalServices)) {
      setOptionalServices(payload.serviceController.optionalServices);
    }
    if (typeof payload.serviceController?.locked === 'boolean') {
      setServiceControllerLocked(payload.serviceController.locked);
    }
    if (payload.monitor) {
      setMonitor(payload.monitor || null);
      const ramPercent = payload.monitor.totalMem > 0 ? (payload.monitor.usedMem / payload.monitor.totalMem) * 100 : 0;
      setCpuHistory((prev) => [...prev.slice(-39), payload.monitor.cpuLoad]);
      setRamHistory((prev) => [...prev.slice(-39), ramPercent]);
    }

    const nextLogs = Array.isArray(payload.logs?.entries)
      ? payload.logs.entries
      : Array.isArray(payload.logs?.logs)
        ? payload.logs.logs
        : [];
    setDebugLogs(nextLogs);
    setLogsMarkdown(typeof payload.logs?.markdown === 'string' ? payload.logs.markdown : '');
    setVerboseLogging(Boolean(payload.logs?.verboseLoggingEnabled));
    setLastTelemetryAt(Date.now());

    if (payload.generatedAt) {
      setLastUpdated(new Date(payload.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  };

  const applyDashboardPayload = (payload: DashboardPayload) => {
    applyTelemetryPayload(payload);
    setConnections(Array.isArray(payload.connections?.users) ? payload.connections.users : []);
    setStorage(Array.isArray(payload.storage?.mounts) ? payload.storage.mounts : []);
  };

  const syncServiceControllerState = async () => {
    if (sessionUser?.role !== 'admin') {
      return;
    }

    try {
      const res = await authFetch(`${API}/services`);
      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }
      if (!res.ok) {
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (payload?.services && typeof payload.services === 'object') {
        setServices(payload.services as Services);
      }
      setServiceCatalog(normalizeServiceCatalog(Array.isArray(payload?.serviceCatalog) ? payload.serviceCatalog : []));
      setServiceLifecycle(normalizeServiceLifecycle(payload?.lifecycle));
      setServiceGroups(payload?.serviceGroups && typeof payload.serviceGroups === 'object' ? payload.serviceGroups : {});
      if (payload?.mediaWorkflow && typeof payload.mediaWorkflow === 'object') {
        setMediaWorkflow(payload.mediaWorkflow);
      }
      setServiceControllerLocked(payload?.controller?.locked !== false);
      if (Array.isArray(payload?.controller?.optionalServices) && payload.controller.optionalServices.length > 0) {
        setOptionalServices(payload.controller.optionalServices);
      }
    } catch {
      // Ignore controller state refresh failures.
    }
  };

  const fetchDashboard = async () => {
    if (sessionUser?.role !== 'admin') {
      return;
    }
    if (fetchInFlightRef.current) {
      return;
    }
    fetchInFlightRef.current = true;

    try {
      const res = await authFetch(`${API}/dashboard`);

      if (!mountedRef.current) {
        return;
      }

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setControlStatus('Unable to refresh dashboard telemetry');
        return;
      }

      const payload = await res.json().catch(() => null);
      if (payload) {
        startTransition(() => {
          applyDashboardPayload(payload as DashboardPayload);
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setControlStatus(`Telemetry fetch error: ${String(err)}`);
      }
    } finally {
      fetchInFlightRef.current = false;
    }
  };

  const fetchTelemetry = async () => {
    if (sessionUser?.role !== 'admin') {
      return;
    }
    if (telemetryInFlightRef.current) {
      return;
    }

    telemetryInFlightRef.current = true;
    try {
      const res = await authFetch(`${API}/telemetry`);

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setControlStatus('Unable to refresh live telemetry');
        return;
      }

      const payload = await res.json().catch(() => null);
      if (payload) {
        startTransition(() => {
          applyTelemetryPayload(payload as TelemetryPayload);
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setControlStatus(`Telemetry fetch error: ${String(err)}`);
      }
    } finally {
      telemetryInFlightRef.current = false;
    }
  };

  const loadLlmState = async () => {
    if (sessionUser?.role !== 'admin') {
      return;
    }
    try {
      const res = await authFetch(`${API}/llm/state`);
      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmStatus(String(payload?.error || 'Unable to load LLM state'));
        return;
      }
      setLlmModels(Array.isArray(payload?.models) ? payload.models : []);
      setLlmPullJobs(Array.isArray(payload?.pullJobs) ? payload.pullJobs : []);
      setLlmActiveModelId(String(payload?.activeModelId || ''));
      setLlmApiKeyConfigured(Boolean(payload?.apiKeyConfigured));
      setLlmRunning(Boolean(payload?.running));
      const online = payload?.online || {};
      const nextOnlineModels = Array.isArray(online?.models)
        ? online.models
          .map((entry: unknown) => ({
            id: String((entry as { id?: string })?.id || '').trim(),
            label: String((entry as { label?: string; id?: string })?.label || (entry as { id?: string })?.id || '').trim(),
          }))
          .filter((entry: LlmOnlineModel) => entry.id)
        : [];
      setLlmOnlineConfigured(Boolean(online?.configured));
      setLlmOnlineAvailable(Boolean(online?.available));
      setLlmOnlineError(String(online?.error || ''));
      setLlmOnlineModels(nextOnlineModels);
      setLlmOnlineModelId(String(online?.activeModelId || nextOnlineModels[0]?.id || ''));
      if (payload?.blocker) {
        setLlmStatus(String(payload.blocker));
      }
    } catch (err) {
      setLlmStatus(`Unable to load LLM state: ${String(err)}`);
    }
  };

  const loadLlmConversations = async () => {
    if (sessionUser?.role !== 'admin') {
      return;
    }
    try {
      const res = await authFetch(`${API}/llm/conversations`);
      if (!res.ok) {
        return;
      }
      const payload = await res.json().catch(() => ({}));
      const nextConversations = Array.isArray(payload?.conversations) ? payload.conversations : [];
      setLlmConversations(nextConversations);
      if (llmConversationId == null && nextConversations.length > 0) {
        setLlmConversationId(Number(nextConversations[0].id));
      }
    } catch {
      // Ignore LLM conversation fetch errors in background polling.
    }
  };

  const loadLlmMessages = async (conversationId: number) => {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      setLlmMessages([]);
      return;
    }
    try {
      const res = await authFetch(`${API}/llm/conversations/${conversationId}/messages`);
      if (!res.ok) {
        return;
      }
      const payload = await res.json().catch(() => ({}));
      setLlmMessages(Array.isArray(payload?.messages) ? payload.messages : []);
    } catch {
      // Ignore LLM message fetch errors in background polling.
    }
  };

  const selectLlmModel = async (modelId: string) => {
    setLlmModelBusyId(modelId);
    try {
      const res = await authFetch(`${API}/llm/models/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmStatus(String(payload?.error || 'Unable to select model'));
        return;
      }
      setLlmStatus(payload?.restartRequired ? 'Model selected. Restart Local LLM service to apply.' : 'Model selected.');
      await loadLlmState();
    } catch (err) {
      setLlmStatus(`Unable to select model: ${String(err)}`);
    } finally {
      setLlmModelBusyId('');
    }
  };

  const refreshOnlineLlmModels = async () => {
    setLlmModelBusyId('online-refresh');
    try {
      const res = await authFetch(`${API}/llm/online/models/refresh`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmStatus(String(payload?.error || 'Unable to refresh online models'));
        return;
      }
      const online = payload?.online || {};
      const nextOnlineModels = Array.isArray(online?.models)
        ? online.models
          .map((entry: unknown) => ({
            id: String((entry as { id?: string })?.id || '').trim(),
            label: String((entry as { label?: string; id?: string })?.label || (entry as { id?: string })?.id || '').trim(),
          }))
          .filter((entry: LlmOnlineModel) => entry.id)
        : [];
      setLlmOnlineConfigured(Boolean(online?.configured));
      setLlmOnlineAvailable(Boolean(online?.available));
      setLlmOnlineError(String(online?.error || ''));
      setLlmOnlineModels(nextOnlineModels);
      setLlmOnlineModelId(String(online?.activeModelId || nextOnlineModels[0]?.id || ''));
      setLlmStatus('Online models refreshed.');
    } catch (err) {
      setLlmStatus(`Unable to refresh online models: ${String(err)}`);
    } finally {
      setLlmModelBusyId('');
    }
  };

  const selectOnlineLlmModel = async () => {
    if (!llmOnlineModelId) {
      setLlmStatus('Select an online model first.');
      return;
    }
    setLlmModelBusyId('online-select');
    try {
      const res = await authFetch(`${API}/llm/online/models/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: llmOnlineModelId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmStatus(String(payload?.error || 'Unable to set online model'));
        return;
      }
      setLlmStatus('Online model saved.');
      await loadLlmState();
    } catch (err) {
      setLlmStatus(`Unable to set online model: ${String(err)}`);
    } finally {
      setLlmModelBusyId('');
    }
  };

  const pullLlmModel = async (modelId: string) => {
    setLlmModelBusyId(modelId);
    try {
      const res = await authFetch(`${API}/llm/models/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmStatus(String(payload?.error || 'Unable to start model pull'));
        return;
      }
      setLlmStatus(payload?.alreadyInstalled ? 'Model already installed.' : `Model pull job started: ${payload?.jobId || 'pending'}`);
      await loadLlmState();
    } catch (err) {
      setLlmStatus(`Unable to pull model: ${String(err)}`);
    } finally {
      setLlmModelBusyId('');
    }
  };

  const addLocalLlmModel = async () => {
    const modelPath = llmLocalModelPath.trim();
    if (!modelPath) {
      setLlmStatus('Local model path is required');
      return;
    }
    setLlmModelBusyId('add-local');
    try {
      const res = await authFetch(`${API}/llm/models/add-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: llmLocalModelLabel.trim(),
          path: modelPath,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmStatus(String(payload?.error || 'Unable to add local model'));
        return;
      }
      setLlmLocalModelLabel('');
      setLlmLocalModelPath('');
      setLlmStatus('Local model added.');
      await loadLlmState();
    } catch (err) {
      setLlmStatus(`Unable to add local model: ${String(err)}`);
    } finally {
      setLlmModelBusyId('');
    }
  };

  const sendLlmPrompt = async (promptOverride?: string) => {
    const text = String(promptOverride ?? llmPrompt).trim();
    if (!text || llmBusy) {
      return;
    }
    setLlmBusy(true);
    try {
      const res = await authFetch(`${API}/llm/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: llmConversationId || undefined,
          message: text,
          mode: llmMode,
          onlineModelId: llmMode === 'online' ? llmOnlineModelId : undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLlmStatus(String(payload?.error || 'Unable to send prompt'));
        return;
      }
      if (!promptOverride) {
        setLlmPrompt('');
      }
      setLlmStatus('');
      const nextConversationId = Number(payload?.conversationId || llmConversationId || 0) || null;
      if (nextConversationId) {
        setLlmConversationId(nextConversationId);
        await loadLlmConversations();
        await loadLlmMessages(nextConversationId);
      }
    } catch (err) {
      setLlmStatus(`Unable to send prompt: ${String(err)}`);
    } finally {
      setLlmBusy(false);
    }
  };

  const copyLlmMessage = async (content: string) => {
    const text = String(content || '').trim();
    if (!text) {
      return;
    }
    if (!navigator?.clipboard?.writeText) {
      setLlmStatus('Clipboard is unavailable in this browser context.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setLlmStatus('Assistant message copied.');
    } catch {
      setLlmStatus('Unable to copy assistant message.');
    }
  };

  const retryLastLlmPrompt = async () => {
    const latestUserMessage = [...llmMessages].reverse().find((entry) => entry.role === 'user');
    if (!latestUserMessage) {
      setLlmStatus('No user prompt found to retry.');
      return;
    }
    await sendLlmPrompt(latestUserMessage.content);
  };

  useEffect(() => {
    if (!isAuthed || sessionUser?.role !== 'admin') {
      return;
    }

    void fetchDashboard();
    void fetchTelemetry();
  }, [isAuthed, sessionUser?.role]);

  useEffect(() => {
    if (!isAuthed || sessionUser?.role !== 'admin') {
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchTelemetry();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isAuthed, sessionUser?.role]);

  usePolling(
    isAuthed && sessionUser?.role === 'admin',
    lowPowerMode ? 25000 : activeTab === 'home' ? 5000 : 9000,
    () => {
      if (document.visibilityState !== 'hidden') {
        void fetchTelemetry();
      }
    }
  );

  useEffect(() => {
    if (!isAuthed || sessionUser?.role !== 'admin') {
      return;
    }
    if (activeTab !== 'ai') {
      return;
    }
    void loadLlmState();
    void loadLlmConversations();
  }, [activeTab, isAuthed, sessionUser?.role]);

  useEffect(() => {
    if (!isAuthed || sessionUser?.role !== 'admin') {
      return;
    }
    if (activeTab !== 'ai') {
      return;
    }
    if (!llmConversationId) {
      setLlmMessages([]);
      return;
    }
    void loadLlmMessages(llmConversationId);
  }, [activeTab, isAuthed, llmConversationId, sessionUser?.role]);

  useEffect(() => {
    if (!isPhone || activeTab !== 'ai') {
      setLlmHistoryOpen(false);
    }
  }, [activeTab, isPhone]);

  useEffect(() => {
    if (activeTab !== 'ai' || llmMode !== 'online') {
      return;
    }
    if (!llmOnlineConfigured) {
      setLlmStatus('Online provider is not configured in server/.env.');
      return;
    }
    if (!llmOnlineAvailable) {
      setLlmStatus(llmOnlineError || 'Online provider is currently unavailable.');
      return;
    }
  }, [activeTab, llmMode, llmOnlineAvailable, llmOnlineConfigured, llmOnlineError]);

  usePolling(
    isAuthed && sessionUser?.role === 'admin',
    lowPowerMode ? 90000 : 30000,
    () => {
      if (document.visibilityState === 'visible') {
        void fetchDashboard();
      }
    }
  );

  const unlockServiceController = async () => {
    if (!serviceUnlockPassword.trim()) {
      setControlStatus('Enter the admin action password to unlock service controls');
      return;
    }

    setServiceUnlockBusy(true);
    setControlStatus('');
    try {
      const res = await authFetch(`${API}/control/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: serviceUnlockPassword }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setControlStatus(String(payload?.error || 'Unable to unlock service controls'));
        return;
      }

      setServiceControllerLocked(false);
      setServiceUnlockPassword('');
      setControlStatus('Service controls unlocked');
    } catch {
      setControlStatus('Unable to unlock service controls');
    } finally {
      if (mountedRef.current) {
        setServiceUnlockBusy(false);
      }
    }
  };

  const lockServiceController = async () => {
    setServiceUnlockBusy(true);
    setControlStatus('');
    try {
      const res = await authFetch(`${API}/control/lock`, {
        method: 'POST',
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setControlStatus(String(payload?.error || 'Unable to lock service controls'));
        return;
      }

      setServiceControllerLocked(true);
      setServiceUnlockPassword('');
      setControlStatus('Service controls locked');
    } catch {
      setControlStatus('Unable to lock service controls');
    } finally {
      if (mountedRef.current) {
        setServiceUnlockBusy(false);
      }
    }
  };

  const executeControl = async (service: string, action: string) => {
    const key = `${service}:${action}`;
    setControlStatus('');
    setControlBusy((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await authFetch(`${API}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service,
          action,
        }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        const message = payload?.error || `Failed to ${action} ${service}`;
        setControlStatus(message);
      } else {
        setControlStatus(`${service} ${action} succeeded`);
      }
    } catch {
      setControlStatus(`Unable to ${action} ${service}`);
    } finally {
      setControlBusy((prev) => ({ ...prev, [key]: false }));
      void syncServiceControllerState();
    }
  };

  const runStorageRecheck = async () => {
    setStorageProtectionBusy(true);
    setStorageProtectionStatus('');
    try {
      const res = await authFetch(`${API}/storage/protection/recheck`, {
        method: 'POST',
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStorageProtectionStatus(String(payload?.error || 'Unable to recheck storage'));
        return;
      }

      const blockedCount = Array.isArray(payload?.storageProtection?.blockedServices)
        ? payload.storageProtection.blockedServices.length
        : 0;
      setStorageProtectionStatus(blockedCount > 0 ? `Storage recheck complete: ${blockedCount} service block(s) active` : 'Storage recheck complete: healthy');
      await syncServiceControllerState();
      await fetchDashboard();
    } catch {
      setStorageProtectionStatus('Unable to recheck storage');
    } finally {
      if (mountedRef.current) {
        setStorageProtectionBusy(false);
      }
    }
  };

  const resumeStorageServices = async () => {
    setStorageProtectionBusy(true);
    setStorageProtectionStatus('');
    try {
      const res = await authFetch(`${API}/storage/protection/resume`, {
        method: 'POST',
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        setStorageProtectionStatus(String(payload?.error || 'Unable to resume storage-blocked services'));
        return;
      }

      const resumedCount = Array.isArray(payload?.resumed) ? payload.resumed.length : 0;
      const failedCount = Array.isArray(payload?.failed) ? payload.failed.length : 0;
      if (failedCount > 0) {
        setStorageProtectionStatus(`Resumed ${resumedCount} service(s), ${failedCount} failed`);
      } else if (resumedCount > 0) {
        setStorageProtectionStatus(`Resumed ${resumedCount} service(s)`);
      } else {
        setStorageProtectionStatus('No storage-blocked services were pending');
      }

      await syncServiceControllerState();
      await fetchDashboard();
    } catch {
      setStorageProtectionStatus('Unable to resume storage-blocked services');
    } finally {
      if (mountedRef.current) {
        setStorageProtectionBusy(false);
      }
    }
  };

  const toggleTheme = () => {
    setThemeMode((current) => current === 'dark' ? 'light' : current === 'light' ? 'contrast' : 'dark');
  };

  const dismissOnboarding = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    }
    setShowOnboarding(false);
  };

  const dismissDemoBanner = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DEMO_BANNER_STORAGE_KEY, 'true');
    }
    setShowDemoBanner(false);
  };

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  const exportLogs = () => {
    if (typeof window === 'undefined') {
      return;
    }

    const filtered = debugLogs.filter((entry) => {
      const matchesLevel = logFilter === 'all' || entry.level === logFilter;
      const haystack = `${entry.message} ${entry.meta ? JSON.stringify(entry.meta) : ''}`.toLowerCase();
      const matchesQuery = !deferredLogSearch.trim() || haystack.includes(deferredLogSearch.trim().toLowerCase());
      return matchesLevel && matchesQuery;
    });
    const blob = new Blob(
      [
        filtered.map((entry) => {
          const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
          return `[${entry.timestamp}] ${String(entry.level).toUpperCase()} ${entry.message}${meta}`;
        }).join('\n'),
      ],
      { type: 'text/plain;charset=utf-8' }
    );
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hmstx-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const disconnectConnection = async (user: ConnectedUser) => {
    if (!user.sessionId) {
      setDisconnectTarget(null);
      return;
    }

    setConnectionBusyId(user.sessionId);
    try {
      const res = await authFetch(`${API}/connections/${user.sessionId}/disconnect`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setUserStatus(String(payload?.error || 'Unable to kick session'));
        return;
      }

      setConnections((current) => current.filter((entry) => entry.sessionId !== user.sessionId));
      setUserStatus(`Kicked ${payload?.username || user.username}`);
    } catch {
      setUserStatus('Unable to kick session');
    } finally {
      setConnectionBusyId(null);
      setDisconnectTarget(null);
    }
  };

  const statusToneStyle = (status: string): CSSProperties => {
    const token = status.trim().toLowerCase();
    if (token === 'working' || token === 'running' || token === 'healthy' || token === 'ready' || token === 'active') {
      return styles.serviceStatusOk;
    }
    if (token === 'stopped' || token === 'inactive' || token === 'idle' || token === 'off' || token === 'setup' || token === 'down' || token === 'unmounted') {
      return styles.serviceStatusIdle;
    }
    if (token === 'unavailable' || token === 'failed' || token === 'error' || token === 'crashed' || token === 'fatal' || token === 'missing') {
      return styles.serviceStatusUnavailable;
    }
    return styles.serviceStatusWarn;
  };

  const renderServiceBadge = (label: string, tone: CSSProperties, key: string) => (
    <span key={key} style={{ ...styles.serviceMiniBadge, ...tone }}>{label}</span>
  );

  const serviceStatusLabel = (status: string, options: { readyLabel?: string; unknownLabel?: string } = {}) => {
    const token = status.trim().toLowerCase();
    if (token === 'working' || token === 'running' || token === 'healthy' || token === 'active') {
      return options.readyLabel || 'Healthy';
    }
    if (token === 'ready') {
      return options.readyLabel || 'Ready';
    }
    if (token === 'stopped' || token === 'inactive' || token === 'idle' || token === 'off' || token === 'down' || token === 'unmounted') {
      return 'Stopped';
    }
    if (token === 'stalled' || token === 'degraded' || token === 'warning') {
      return 'Degraded';
    }
    if (token === 'starting' || token === 'restarting' || token === 'pending') {
      return 'Starting';
    }
    if (token === 'unavailable' || token === 'missing') {
      return 'Unavailable';
    }
    if (token === 'failed' || token === 'error' || token === 'crashed' || token === 'fatal') {
      return 'Failed';
    }
    if (token === 'setup') {
      return 'Setup';
    }
    if (token === 'blocked') {
      return 'Blocked';
    }
    return options.unknownLabel || 'Needs attention';
  };

  const workflowToneStyle = (status: string): CSSProperties => {
    if (status === 'setup') {
      return styles.serviceStatusIdle;
    }
    if (status === 'blocked') {
      return styles.serviceStatusWarn;
    }
    return statusToneStyle(status);
  };

  const aggregateServiceStatus = (entries: ServiceCatalogEntry[]) => {
    if (entries.length === 0) {
      return 'unavailable';
    }
    if (entries.every((entry) => entry.status === 'working')) {
      return 'working';
    }
    if (entries.some((entry) => entry.status === 'working')) {
      return 'stalled';
    }
    if (entries.some((entry) => entry.status === 'stalled')) {
      return 'stalled';
    }
    if (entries.some((entry) => entry.status === 'blocked')) {
      return 'blocked';
    }
    if (entries.some((entry) => entry.status === 'stopped')) {
      return 'stopped';
    }
    return 'unavailable';
  };

  const closeSearch = () => {
    setCommandPaletteOpen(false);
    setSearchHasFocus(false);
  };

  const openTab = (tab: TabKey) => {
    setActiveTab(tab === 'arr' ? 'media' : tab);
    closeSearch();
  };

  const openMediaSection = (section: MediaSectionKey = 'watch') => {
    setPendingMediaSection(section);
    openTab('media');
  };

  const openServiceWorkspace = (entry: ServiceCatalogEntry) => {
    const downloadWorkspace = DOWNLOAD_WORKSPACE_BY_SERVICE[entry.key] || (entry.surface === 'downloads' ? 'downloads' : null);
    if (downloadWorkspace) {
      openTab(downloadWorkspace);
      return;
    }

    const mediaSection = MEDIA_SECTION_BY_SERVICE[entry.key];
    if (mediaSection) {
      openMediaSection(mediaSection);
      return;
    }

    if (entry.surface === 'arr') {
      openMediaSection('automation');
      return;
    }

    if (entry.surface === 'filesystem') {
      openTab('filesystem');
      return;
    }

    if (entry.surface === 'media') {
      openMediaSection('watch');
      return;
    }

    openTab(entry.surface === 'home' ? 'home' : entry.surface);
  };

  const renderServiceCard = (entry: ServiceCatalogEntry) => {
    const linkHref = buildServiceHref(entry.route);
    const lifecycleState = entry.state || entry.status;
    const statusLabel = serviceStatusLabel(lifecycleState);
    const statusTone = statusToneStyle(lifecycleState);
    const lifecycleReason = entry.reason || entry.statusReason || '';
    const checkedAt = entry.checkedAt || entry.lastCheckedAt || null;
    const restartRecommended = Boolean(entry.restartRecommended || entry.resumeRequired);
    const canOperate = sessionUser?.role === 'admin' && entry.available;
    const isRunning = entry.status === 'working';
    const startBusy = Boolean(controlBusy[`${entry.key}:start`]);
    const restartBusy = Boolean(controlBusy[`${entry.key}:restart`]);
    const stopBusy = Boolean(controlBusy[`${entry.key}:stop`]);
    const statsLine = entry.uptimePct != null || entry.avgLatencyMs != null
      ? `${entry.uptimePct != null ? `${entry.uptimePct.toFixed(1)}% uptime` : 'No uptime history'} · ${entry.avgLatencyMs != null ? `${entry.avgLatencyMs}ms avg` : 'No latency'}`
      : 'Waiting for service history';
    const quickFacts = [statsLine];
    if (checkedAt) {
      quickFacts.push(`Checked ${fmtDateTime(checkedAt)}`);
    }
    if (entry.lastFailureAt) {
      quickFacts.push(`Last failure ${fmtDateTime(entry.lastFailureAt)}`);
    }
    const badgeItems = [
      renderServiceBadge(SERVICE_GROUP_LABELS[entry.group], styles.serviceMiniBadgeMuted, `${entry.key}:group`),
      renderServiceBadge(entry.controlMode === 'optional' ? 'Optional' : 'Core', styles.serviceMiniBadgeMuted, `${entry.key}:control`),
      renderServiceBadge(statusLabel, statusTone, `${entry.key}:status`),
      ...(restartRecommended ? [renderServiceBadge('Restart recommended', styles.serviceStatusWarn, `${entry.key}:restart-rec`)] : []),
      ...(entry.lastFailureAt ? [renderServiceBadge('Failure logged', styles.serviceStatusUnavailable, `${entry.key}:failure`)] : []),
    ];
    const openService = () => {
      if (linkHref && typeof window !== 'undefined') {
        window.open(linkHref, '_blank', 'noreferrer');
        return;
      }
      setControlStatus(`${entry.label} does not expose an external route`);
    };

    return (
      <article key={entry.key} className="hmstx-hover-lift" style={styles.serviceCard}>
        <div style={{ ...styles.serviceCardShell, ...(isCompact ? styles.serviceCardShellCompact : {}) }}>
          <div style={{ ...styles.serviceCardCopy, ...(isCompact ? styles.serviceCardCopyCompact : {}) }}>
            <div style={{ ...styles.serviceCardHead, ...(isCompact ? styles.serviceCardHeadCompact : {}) }}>
              <div style={styles.serviceCardTitleBlock}>
                <h3 style={styles.serviceCardTitle}>{entry.label}</h3>
                <p style={styles.serviceCardDescription}>{entry.description}</p>
              </div>
              <div style={{ ...styles.serviceBadgeRow, ...(isPhone ? styles.serviceBadgeRowCompact : {}) }}>{badgeItems}</div>
            </div>
            <p style={styles.serviceCardReason}>{lifecycleReason || statsLine}</p>
            {restartRecommended ? <p style={{ ...styles.smallLabel, color: THEME.brightYellow }}>Lifecycle checks recommend a restart.</p> : null}
            {entry.lastFailureAt ? <p style={{ ...styles.smallLabel, color: THEME.crimsonRed }}>Last failure: {fmtDateTime(entry.lastFailureAt)}</p> : null}
            {entry.blocker ? <p style={{ ...styles.smallLabel, color: entry.status === 'unavailable' ? THEME.brightYellow : THEME.muted }}>{entry.blocker}</p> : null}
            <span style={styles.serviceQuickLabel}>{quickFacts.join(' · ')}</span>
          </div>
          <div style={{ ...styles.serviceCardRail, ...(isCompact ? styles.serviceCardRailCompact : {}) }}>
            {linkHref ? (
              <a href={linkHref} target="_blank" rel="noreferrer" className="ui-button ui-button--primary" style={styles.serviceActionBtn}>
                Open
              </a>
            ) : null}
            {canOperate ? (
              <>
                {!isRunning ? (
                  <button className="ui-button" style={styles.serviceActionBtn} type="button" disabled={startBusy} aria-label={`Start ${entry.label}`} onClick={() => void executeControl(entry.key, 'start')}>
                    {startBusy ? 'Starting…' : 'Start'}
                  </button>
                ) : null}
                <button className="ui-button" style={styles.serviceActionBtn} type="button" disabled={restartBusy} aria-label={`Restart ${entry.label}`} onClick={() => void executeControl(entry.key, 'restart')}>
                  {restartBusy ? 'Restarting…' : 'Restart'}
                </button>
                {isRunning ? (
                  <button className="ui-button" style={styles.serviceActionBtn} type="button" disabled={stopBusy} aria-label={`Stop ${entry.label}`} onClick={() => void executeControl(entry.key, 'stop')}>
                    {stopBusy ? 'Stopping…' : 'Stop'}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  const serviceCatalogByKey = new Map(serviceCatalog.map((entry) => [entry.key, entry]));
  const homeGroups = (['platform', 'data', 'access'] as const)
    .map((group) => ({
      group,
      items: (serviceGroups[group] || [])
        .map((key) => serviceCatalogByKey.get(key))
        .filter((entry): entry is ServiceCatalogEntry => Boolean(entry))
        .filter((entry) => entry.surface === 'home'),
    }))
    .filter((entry) => entry.items.length > 0);
  const homeListedCount = homeGroups.reduce((sum, entry) => sum + entry.items.length, 0);
  const optionalServiceEntries = optionalServices
    .map((name) => serviceCatalogByKey.get(name))
    .filter((entry): entry is ServiceCatalogEntry => Boolean(entry));
  const controllableServices = optionalServiceEntries.filter((entry) => entry.available);
  const buildServiceHref = (route?: string) => (route && gatewayBase ? `${gatewayBase}${route}` : '');
  const catalogRunningServices = serviceCatalog.filter((entry) => entry.status === 'working').length;
  const usedMemPct = monitor ? Math.min((monitor.totalMem > 0 ? (monitor.usedMem / monitor.totalMem) * 100 : 0), 100) : 0;
  const runningServices = catalogRunningServices || Object.values(services).filter(Boolean).length;
  const totalServices = serviceCatalog.length || Object.keys(services).length || 4;
  const lifecycleBadgeLabel = serviceLifecycle?.state ? serviceStatusLabel(serviceLifecycle.state, { unknownLabel: 'Lifecycle unknown' }) : null;
  const lifecycleBadgeTone = statusToneStyle(serviceLifecycle?.state || 'unavailable');
  const mountedFtpEntries = ftpFavourites.filter((favourite) => favourite.mount?.mounted && favourite.mount?.mountPoint);
  const mountedFtpMountPoints = new Set(mountedFtpEntries.map((favourite) => favourite.mount.mountPoint));
  const visibleStorageMounts = storage.filter((mount) => !mount.mount.startsWith('/mnt/cloud/') && !mountedFtpMountPoints.has(mount.mount));
  const mediaLibraryMounts = visibleStorageMounts.filter((mount) =>
    mount.category === 'media'
    || mount.category === 'shared'
    || mount.category === 'external'
    || mount.mount.toLowerCase().includes('/media')
  );
  const totalStorage = visibleStorageMounts.reduce((sum, mount) => sum + mount.size, 0);
  const usedStorage = visibleStorageMounts.reduce((sum, mount) => sum + mount.used, 0);
  const usedStoragePct = totalStorage > 0 ? Math.min((usedStorage / totalStorage) * 100, 100) : 0;
  const driveCount = driveState.manifest.drives.length;
  const filesystemStatus = !driveState.agentInstalled
    ? 'Drive agent missing'
    : driveCount > 0
      ? `${driveCount} removable drives mounted`
      : 'Only C is present';
  const latestDriveEvent = driveState.events[0] || null;
  const ftpBreadcrumbs = ftpPath.split('/').filter(Boolean);
  const filteredFtpEntries = ftpSearch.trim()
    ? ftpEntries.filter((entry) => entry.name.toLowerCase().includes(ftpSearch.trim().toLowerCase()))
    : ftpEntries;
  const controlStatusColor = !controlStatus
    ? THEME.muted
    : controlStatus.includes('succeeded')
      ? THEME.ok
      : THEME.crimsonRed;
  const storageProtectionStatusColor = !storageProtectionStatus
    ? THEME.muted
    : storageProtectionStatus.toLowerCase().includes('unable')
      || storageProtectionStatus.toLowerCase().includes('failed')
      || storageProtectionStatus.toLowerCase().includes('error')
      ? THEME.crimsonRed
      : THEME.ok;
  const ftpStatusColor = !ftpStatus
    ? THEME.muted
    : ftpStatus.toLowerCase().includes('failed') || ftpStatus.toLowerCase().includes('unable') || ftpStatus.toLowerCase().includes('error')
      ? THEME.crimsonRed
      : THEME.ok;
  const activeFtpFavourite = ftpFavourites.find((favourite) => favourite.id === ftpActiveFavouriteId) || null;
  const mountedFtpFavouriteCount = mountedFtpEntries.length;
  const terminalService = serviceCatalogByKey.get('ttyd') || null;
  const llmService = serviceCatalogByKey.get('llm') || null;
  const codexRevampedService = serviceCatalogByKey.get('codex_revamped') || null;
  const llmApiBaseUrl = `${gatewayBase.replace(/\/$/, '')}/api/openai/v1`;
  const llmLastUserMessage = [...llmMessages].reverse().find((entry) => entry.role === 'user') || null;
  const llmCanSend = llmMode === 'online'
    ? llmOnlineConfigured && llmOnlineAvailable && Boolean(llmOnlineModelId)
    : llmRunning && Boolean(llmActiveModelId);
  const llmStatusTone = !llmStatus
    ? THEME.muted
    : llmStatus.toLowerCase().includes('unable')
      || llmStatus.toLowerCase().includes('error')
      || llmStatus.toLowerCase().includes('not configured')
      ? THEME.crimsonRed
      : THEME.muted;
  const jellyfinService = serviceCatalogByKey.get('jellyfin') || null;
  const qbittorrentService = serviceCatalogByKey.get('qbittorrent') || null;
  const jellyfinHref = buildServiceHref(jellyfinService?.route);
  const downloadServices = serviceCatalog.filter((entry) => entry.surface === 'downloads');
  const requestServices = MEDIA_REQUEST_SERVICE_KEYS
    .map((key) => serviceCatalogByKey.get(key))
    .filter((entry): entry is ServiceCatalogEntry => Boolean(entry));
  const requestPrimary = requestServices[0] || null;
  const requestHref = buildServiceHref(requestPrimary?.route);
  const automationServices = MEDIA_AUTOMATION_SERVICE_ORDER
    .map((key) => serviceCatalogByKey.get(key))
    .filter((entry): entry is ServiceCatalogEntry => Boolean(entry));
  const subtitleServices = MEDIA_SUBTITLE_SERVICE_KEYS
    .map((key) => serviceCatalogByKey.get(key))
    .filter((entry): entry is ServiceCatalogEntry => Boolean(entry));
  const subtitlePrimary = subtitleServices[0] || null;
  const mediaSupportServices = MEDIA_SUPPORT_SERVICE_KEYS
    .map((key) => serviceCatalogByKey.get(key))
    .filter((entry): entry is ServiceCatalogEntry => Boolean(entry));
  const arrHealthyCount = mediaWorkflow?.automation?.healthy ?? automationServices.filter((entry) => entry.status === 'working').length;
  const requestStatus = mediaWorkflow?.requests?.status ?? (!requestPrimary
    ? 'blocked'
    : requestPrimary.status === 'working'
      ? 'working'
      : requestPrimary.available
        ? requestPrimary.status
        : 'blocked');
  const automationStatus = mediaWorkflow?.automation?.status ?? aggregateServiceStatus(automationServices);
  const subtitleStatus = mediaWorkflow?.subtitles?.status ?? (subtitlePrimary
    ? subtitlePrimary.available
      ? subtitlePrimary.status
      : 'blocked'
    : 'blocked');
  const downloadsStatus = mediaWorkflow?.downloads?.status ?? (downloadServices.length > 0
    ? aggregateServiceStatus(downloadServices)
    : 'blocked');
  const downloadWorkspaceTab = mediaWorkflow?.downloads?.workspaceTab
    || (downloadServices[0] ? (DOWNLOAD_WORKSPACE_BY_SERVICE[downloadServices[0].key] || 'downloads') : 'downloads');
  const primaryDownloadService = (mediaWorkflow?.downloads?.primaryServiceKey
    ? serviceCatalogByKey.get(mediaWorkflow.downloads.primaryServiceKey)
    : null) || qbittorrentService || downloadServices[0] || null;
  const primaryDownloadHref = buildServiceHref(primaryDownloadService?.route);
  const downloadSavePath = mediaWorkflow?.downloads?.defaultSavePath
    || mediaWorkflow?.downloads?.downloadRoots?.[1]
    || mediaWorkflow?.downloads?.downloadRoots?.[0]
    || null;
  const liveTvStatus = mediaWorkflow?.liveTv?.status ?? (jellyfinService?.status === 'working'
    ? 'setup'
    : jellyfinService?.status || 'unavailable');
  const watchSummary = mediaWorkflow?.watch?.summary || (mediaLibraryMounts.length > 0 ? `${mediaLibraryMounts.length} library mount${mediaLibraryMounts.length === 1 ? '' : 's'} online` : 'Library storage not detected');
  const requestSummary = mediaWorkflow?.requests?.summary || requestPrimary?.blocker || 'Users request content before automation starts';
  const automationSummary = mediaWorkflow?.automation?.summary || `${automationServices.filter((entry) => entry.status === 'working').length}/${automationServices.length} services working`;
  const downloadsSummary = mediaWorkflow?.downloads?.summary || (downloadServices.length > 0 ? 'Open transfer queue in Downloads' : 'No download client configured');
  const subtitleSummary = mediaWorkflow?.subtitles?.summary || subtitlePrimary?.blocker || 'Post-import subtitle sync and upgrade policy';
  const liveTvSummary = mediaWorkflow?.liveTv?.summary || 'Configure Jellyfin with an M3U tuner, XMLTV guide, and mapped channels';
  const liveTvChannelCount = mediaWorkflow?.liveTv?.channelCount ?? null;
  const liveTvSourcesReady = Boolean(mediaWorkflow?.liveTv?.playlistConfigured && mediaWorkflow?.liveTv?.guideConfigured);
  const storageProtection = mediaWorkflow?.storage?.protection || null;
  const storageBlockedServices = Array.isArray(storageProtection?.blockedServices) ? storageProtection.blockedServices : [];
  const storageStoppedByWatchdog = Array.isArray(storageProtection?.stoppedByWatchdog) ? storageProtection.stoppedByWatchdog : [];
  const storageProtectionDegraded = Boolean(
    storageProtection
    && (storageProtection.state === 'degraded' || storageBlockedServices.length > 0 || storageProtection.overallHealthy === false)
  );
  const storageProtectionRecoverable = Boolean(
    storageProtection
    && storageProtection.overallHealthy
    && storageProtection.resumeRequired
    && storageStoppedByWatchdog.length > 0
  );
  const storageProtectionSummary = storageProtectionDegraded
    ? (storageProtection?.reason || 'Storage watchdog detected missing vault or scratch mounts.')
    : storageProtectionRecoverable
      ? `Storage recovered; ${storageStoppedByWatchdog.length} service(s) need manual resume`
      : 'Storage watchdog reports healthy mount state';
  const storageProtectionTone = storageProtectionDegraded ? THEME.crimsonRed : storageProtectionRecoverable ? THEME.brightYellow : THEME.ok;
  const telemetryStale = lastTelemetryAt > 0 && Date.now() - lastTelemetryAt > (lowPowerMode ? 60000 : 20000);
  const batteryPct = monitor?.device?.batteryPct ?? null;
  const batteryLow = batteryPct != null && batteryPct <= 20 && !monitor?.device?.charging;
  const cpuLoadTone = loadAlertTone(monitor?.cpuLoad || 0, 65, 85);
  const memoryTone = loadAlertTone(usedMemPct, 70, 85);
  const eventLoopTone = loadAlertTone(monitor?.eventLoopP95Ms || 0, 70, 140);
  const loadAverageTone = loadAlertTone(monitor?.loadAvg1m || 0, Math.max(1, (monitor?.cpuCores || 1) * 0.8), Math.max(1, monitor?.cpuCores || 1));
  const wifiTone = monitor?.device?.wifiDbm != null && monitor.device.wifiDbm <= -80
    ? THEME.crimsonRed
    : monitor?.device?.wifiDbm != null && monitor.device.wifiDbm <= -70
      ? THEME.brightYellow
      : THEME.text;
  const batteryTone = batteryLow ? THEME.crimsonRed : THEME.text;
  const filteredLogs = debugLogs.filter((entry) => {
    const matchesLevel = logFilter === 'all' || entry.level === logFilter;
    const haystack = `${entry.message} ${entry.meta ? JSON.stringify(entry.meta) : ''}`.toLowerCase();
    const matchesQuery = !deferredLogSearch.trim() || haystack.includes(deferredLogSearch.trim().toLowerCase());
    return matchesLevel && matchesQuery;
  });
  const mediaWorkflowSteps = MEDIA_WORKFLOW_ORDER.map((step) => {
    if (step.id === 'watch') {
      return {
        ...step,
        meta: watchSummary,
        onClick: () => openMediaSection('watch'),
        status: mediaWorkflow?.watch?.status || jellyfinService?.status || 'unavailable',
        statusLabel: jellyfinService ? serviceStatusLabel(jellyfinService.status) : 'Missing',
      };
    }
    if (step.id === 'requests') {
      return {
        ...step,
        meta: requestSummary,
        onClick: () => openMediaSection('requests'),
        status: requestStatus,
        statusLabel: !requestPrimary ? 'Blocked' : serviceStatusLabel(requestStatus, { readyLabel: 'Ready' }),
      };
    }
    if (step.id === 'automation') {
      return {
        ...step,
        meta: automationSummary,
        onClick: () => openMediaSection('automation'),
        status: automationStatus,
        statusLabel: automationStatus === 'stalled' ? 'Active' : serviceStatusLabel(automationStatus),
      };
    }
    if (step.id === 'downloads') {
      return {
        ...step,
        meta: downloadsSummary,
        onClick: () => openTab(downloadWorkspaceTab),
        status: downloadsStatus,
        statusLabel: downloadsStatus === 'working' ? 'Ready' : serviceStatusLabel(downloadsStatus, { unknownLabel: 'Linked elsewhere' }),
      };
    }
    if (step.id === 'subtitles') {
      return {
        ...step,
        meta: subtitleSummary,
        onClick: () => openMediaSection('subtitles'),
        status: subtitleStatus,
        statusLabel: !subtitlePrimary ? 'Blocked' : serviceStatusLabel(subtitleStatus, { readyLabel: 'Ready' }),
      };
    }
    return {
      ...step,
      meta: liveTvSummary,
      onClick: () => openMediaSection('live-tv'),
      status: liveTvStatus,
      statusLabel: serviceStatusLabel(liveTvStatus, { unknownLabel: 'Setup' }),
    };
  });
  const mediaReadyCount = mediaWorkflowSteps.filter((step) => step.status === 'working').length;
  const liveTvChecklist = [
    {
      id: 'playlist',
      label: 'Playlist (M3U)',
      detail: mediaWorkflow?.liveTv?.playlistSource ? `Configured from ${mediaWorkflow.liveTv.playlistSource}. This is the tuner input for channels.` : 'Point Jellyfin to the IPTV M3U or M3U8 source. This is the tuner input for channels.',
      status: mediaWorkflow?.liveTv?.playlistConfigured ? 'working' : 'setup',
      statusLabel: mediaWorkflow?.liveTv?.playlistConfigured ? 'Configured' : 'Configure',
    },
    {
      id: 'guide',
      label: 'Guide (XMLTV)',
      detail: mediaWorkflow?.liveTv?.guideSource ? `Configured from ${mediaWorkflow.liveTv.guideSource}. This powers the guide and scheduling data.` : 'Add XMLTV guide data so the Live TV guide and recordings have schedule information.',
      status: mediaWorkflow?.liveTv?.guideConfigured ? 'working' : 'setup',
      statusLabel: mediaWorkflow?.liveTv?.guideConfigured ? 'Configured' : 'Configure',
    },
    {
      id: 'mapping',
      label: 'Channel Mapping',
      detail: mediaWorkflow?.liveTv?.channelsMapped === true
        ? `${liveTvChannelCount != null ? `${liveTvChannelCount} Live TV channel${liveTvChannelCount === 1 ? '' : 's'}` : 'Live TV channels'} detected in Jellyfin.`
        : liveTvSourcesReady
          ? 'Map Jellyfin channels to guide entries so guide listings line up with playback.'
          : 'Add both M3U and XMLTV sources first, then confirm mapping inside Jellyfin.',
      status: mediaWorkflow?.liveTv?.channelsMapped === true ? 'working' : liveTvSourcesReady ? 'setup' : 'stalled',
      statusLabel: mediaWorkflow?.liveTv?.channelsMapped === true
        ? `${liveTvChannelCount || ''}${liveTvChannelCount ? ' mapped' : 'Mapped'}`
        : liveTvSourcesReady
          ? 'Required'
          : 'Waiting on sources',
    },
    {
      id: 'watch',
      label: 'Guide / Watch',
      detail: 'Once the tuner and guide are configured, browsing and playback happen inside Jellyfin.',
      status: jellyfinService?.status === 'working'
        ? (liveTvSourcesReady && mediaWorkflow?.liveTv?.channelsMapped === true
          ? 'working'
          : liveTvSourcesReady
            ? 'stalled'
            : 'setup')
        : 'stopped',
      statusLabel: jellyfinService?.status === 'working'
        ? (liveTvSourcesReady && mediaWorkflow?.liveTv?.channelsMapped === true ? 'Open in Jellyfin' : 'Finish setup')
        : 'Jellyfin offline',
    },
  ];
  const paletteItems = [
    ...serviceCatalog.map((entry) => ({
      id: `service:${entry.key}`,
      kind: 'service' as const,
      label: entry.label,
      subtitle: SERVICE_GROUP_LABELS[entry.group],
      run: () => openServiceWorkspace(entry),
    })),
    {
      id: 'action:settings',
      kind: 'action' as const,
      label: 'Open settings',
      subtitle: 'Action',
      run: () => openTab('settings'),
    },
    {
      id: 'action:ai',
      kind: 'action' as const,
      label: 'Open LLM',
      subtitle: 'Action',
      run: () => openTab('ai'),
    },
    {
      id: 'action:telemetry',
      kind: 'action' as const,
      label: 'Refresh telemetry',
      subtitle: 'Action',
      run: () => {
        void fetchTelemetry();
        closeSearch();
      },
    },
    {
      id: 'action:logs',
      kind: 'action' as const,
      label: 'Download filtered logs',
      subtitle: 'Action',
      run: () => {
        exportLogs();
        closeSearch();
      },
    },
    ...COMMAND_DOCS.map((item) => ({
      id: item.id,
      kind: 'docs' as const,
      label: item.label,
      subtitle: item.subtitle,
      run: () => {
        if (typeof window !== 'undefined') {
          window.open(item.value, '_blank', 'noreferrer');
        }
        closeSearch();
      },
    })),
  ].filter((item) => {
    const query = deferredCommandQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    if (query.startsWith('>') && item.kind !== 'action') {
      return false;
    }
    if (query.startsWith('/') && item.kind !== 'docs') {
      return false;
    }
    const cleanQuery = query.replace(/^[>/]\s*/, '');
    return `${item.label} ${item.subtitle}`.toLowerCase().includes(cleanQuery);
  });
  const searchResultsOpen = commandPaletteOpen && (searchHasFocus || deferredCommandQuery.trim().length > 0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        setSearchHasFocus(true);
        commandPaletteInputRef.current?.focus();
        return;
      }

      if (!commandPaletteOpen) {
        if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && isPhone) {
          event.preventDefault();
          const currentIndex = TABS.findIndex((entry) => entry.key === activeTab);
          const nextIndex = event.key === 'ArrowRight'
            ? (currentIndex + 1) % TABS.length
            : (currentIndex - 1 + TABS.length) % TABS.length;
          setActiveTab(TABS[nextIndex].key);
        }
        return;
      }

      if (event.key === 'Escape') {
        setCommandPaletteOpen(false);
        setSearchHasFocus(false);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPaletteIndex((current) => Math.min(current + 1, Math.max(0, paletteItems.length - 1)));
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPaletteIndex((current) => Math.max(current - 1, 0));
      }

      if (event.key === 'Enter') {
        const current = paletteItems[paletteIndex];
        if (current) {
          event.preventDefault();
          current.run();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, commandPaletteOpen, isPhone, paletteIndex, paletteItems]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!searchContainerRef.current?.contains(event.target as Node)) {
        setCommandPaletteOpen(false);
        setSearchHasFocus(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    if (paletteIndex >= paletteItems.length) {
      setPaletteIndex(0);
    }
  }, [paletteIndex, paletteItems.length]);

  const navButtonLabel = (tab: TabKey) => {
    if (!isTablet) {
      return TABS.find((entry) => entry.key === tab)?.label || tab;
    }

    switch (tab) {
      case 'home':
        return 'Home';
      case 'media':
        return 'Media';
      case 'downloads':
        return 'DL';
      case 'arr':
        return 'Media';
      case 'terminal':
        return 'Term';
      case 'filesystem':
        return 'Files';
      case 'ftp':
        return 'FTP';
      case 'ai':
        return 'LLM';
      case 'settings':
        return 'Prefs';
      default:
        return tab;
    }
  };

  const navButtonIcon = (tab: TabKey) => {
    const icon = TAB_ICONS[tab];
    return (
      <svg
        aria-hidden="true"
        viewBox={icon.viewBox}
        focusable="false"
        style={styles.navIcon}
      >
        <path d={icon.path} fill="currentColor" />
      </svg>
    );
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);

    try {
      const res = await appFetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setAuthError(payload?.error || 'Login failed');
        return;
      }

      setIsAuthed(true);
      if (payload?.user?.username) {
        setSessionUser({
          role: String(payload.user.role || 'user'),
          username: String(payload.user.username || ''),
        });
      }
      setUsername('');
      setPassword('');
      setControlStatus('');
      void fetchDashboard();
    } catch {
      setAuthError('Unable to reach auth service');
    } finally {
      if (mountedRef.current) {
        setAuthBusy(false);
      }
    }
  };

  const toggleVerboseLogging = async (enabled: boolean) => {
    try {
      const res = await authFetch(`${API}/logging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setControlStatus('Failed to update logging mode');
        return;
      }

      setVerboseLogging(enabled);
      void fetchTelemetry();
    } catch {
      setControlStatus('Unable to update logging mode');
    }
  };

  const createManagedUser = async () => {
    setUserStatus('');
    setUsersBusy(true);
    try {
      const res = await authFetch(`${API}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userDraft),
      });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setUserStatus(String(payload?.error || 'Unable to create user'));
        return;
      }

      setUserDraft(createUserDraft());
      setUserStatus(`Created user ${payload?.user?.username || userDraft.username}`);
      await loadManagedUsers();
    } catch {
      setUserStatus('Unable to create user');
    } finally {
      if (mountedRef.current) {
        setUsersBusy(false);
      }
    }
  };

  const updateManagedUser = async (user: ManagedUser, updates: { role?: string; isDisabled?: boolean; password?: string }) => {
    setUserStatus('');
    setUsersBusy(true);
    try {
      const res = await authFetch(`${API}/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      if (!res.ok) {
        setUserStatus(String(payload?.error || 'Unable to update user'));
        return;
      }

      setUserStatus(`Updated ${payload?.user?.username || user.username}`);
      await loadManagedUsers();
    } catch {
      setUserStatus('Unable to update user');
    } finally {
      if (mountedRef.current) {
        setUsersBusy(false);
      }
    }
  };

  const syncFtpConnection = (favourite: FtpFavourite | null) => {
    if (!favourite) {
      return;
    }

    setFtpHost(favourite.host || '');
    setFtpPort(String(favourite.port || 21));
    setFtpUser(favourite.username || 'anonymous');
    setFtpPassword('');
    setFtpSecure(Boolean(favourite.secure));
    setFtpPath(favourite.remotePath || '/');
    setFtpActiveFavouriteId(favourite.id);
  };

  const resetFtpFavouriteEditor = () => {
    setFtpEditingFavouriteId(null);
    setFtpFavouriteDraft(createFtpFavouriteDraft({
      name: ftpDefaults?.defaultName || ftpHost.trim() || 'PS4',
      host: ftpHost.trim() || ftpDefaults?.host || '',
      port: ftpPort || String(ftpDefaults?.port || 2121),
      username: ftpUser.trim() || ftpDefaults?.user || 'anonymous',
      password: '',
      secure: ftpSecure || Boolean(ftpDefaults?.secure),
      remotePath: ftpPath || '/',
      mountName: ftpDefaults?.defaultName || ftpHost.trim() || 'PS4',
    }));
  };

  const loadFtpFavourites = async () => {
    setFtpFavouritesBusy(true);

    try {
      const res = await authFetch(`${API}/ftp/favourites`);
      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return [];
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Unable to load FTP favourites');
      }

      const nextFavourites = Array.isArray(payload.favourites) ? payload.favourites as FtpFavourite[] : [];
      setFtpFavourites(nextFavourites);

      if (ftpActiveFavouriteId !== null) {
        const active = nextFavourites.find((favourite) => favourite.id === ftpActiveFavouriteId) || null;
        if (active) {
          syncFtpConnection(active);
        } else {
          setFtpActiveFavouriteId(null);
        }
      }

      if (ftpEditingFavouriteId !== null && !nextFavourites.some((favourite) => favourite.id === ftpEditingFavouriteId)) {
        resetFtpFavouriteEditor();
      }

      return nextFavourites;
    } catch (error) {
      setFtpStatus(String(error instanceof Error ? error.message : error || 'Unable to load FTP favourites'));
      return [];
    } finally {
      setFtpFavouritesBusy(false);
    }
  };

  const ftpPayload = (pathOverride?: string, favouriteIdOverride: number | null = ftpActiveFavouriteId) => ({
    favouriteId: favouriteIdOverride ?? undefined,
    host: ftpHost.trim(),
    port: Number(ftpPort || 21),
    user: ftpUser.trim() || 'anonymous',
    password: ftpPassword,
    secure: ftpSecure,
    path: pathOverride || ftpPath,
  });

  const loadFtpDirectory = async (pathOverride?: string, favouriteIdOverride: number | null = ftpActiveFavouriteId) => {
    if (!favouriteIdOverride && !ftpHost.trim()) {
      setFtpStatus('Enter an FTP host or browse a saved favourite first.');
      return;
    }

    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ftpPayload(pathOverride, favouriteIdOverride)),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Unable to list remote directory');
        return;
      }

      const nextFavourite = favouriteIdOverride
        ? ftpFavourites.find((favourite) => favourite.id === favouriteIdOverride) || null
        : null;
      setFtpActiveFavouriteId(favouriteIdOverride ?? null);
      setFtpPath(payload.path || '/');
      setFtpEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setFtpStatus(`Connected to ${nextFavourite?.name || payload.connection?.host || ftpHost.trim()} at ${payload.path || '/'}`);
    } catch {
      setFtpStatus('Unable to reach FTP endpoint');
    } finally {
      setFtpBusy(false);
    }
  };

  const browseFtpFavourite = async (favourite: FtpFavourite) => {
    syncFtpConnection(favourite);
    await loadFtpDirectory(favourite.remotePath || '/', favourite.id);
  };

  const editFtpFavourite = (favourite: FtpFavourite) => {
    setFtpEditingFavouriteId(favourite.id);
    setFtpFavouriteDraft(createFtpFavouriteDraftFromFavourite(favourite));
    setFtpStatus(`Editing saved favourite ${favourite.name}`);
  };

  const saveFtpFavourite = async () => {
    if (!ftpFavouriteDraft.name.trim() || !ftpFavouriteDraft.host.trim()) {
      setFtpStatus('Favourite name and FTP host are required.');
      return;
    }

    setFtpFavouritesBusy(true);
    setFtpStatus('');

    try {
      const body: Record<string, unknown> = {
        name: ftpFavouriteDraft.name.trim(),
        host: ftpFavouriteDraft.host.trim(),
        port: Number(ftpFavouriteDraft.port || 21),
        username: ftpFavouriteDraft.username.trim() || 'anonymous',
        secure: ftpFavouriteDraft.secure,
        remotePath: ftpFavouriteDraft.remotePath.trim() || '/',
        mountName: ftpFavouriteDraft.mountName.trim() || ftpFavouriteDraft.name.trim(),
      };

      if (ftpEditingFavouriteId === null || ftpFavouriteDraft.password) {
        body.password = ftpFavouriteDraft.password;
      }

      const res = await authFetch(
        ftpEditingFavouriteId === null ? `${API}/ftp/favourites` : `${API}/ftp/favourites/${ftpEditingFavouriteId}`,
        {
          method: ftpEditingFavouriteId === null ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Unable to save FTP favourite');
        return;
      }

      const savedName = payload?.favourite?.name || ftpFavouriteDraft.name.trim();
      await loadFtpFavourites();
      setFtpStatus(ftpEditingFavouriteId === null ? `Saved favourite ${savedName}` : `Updated favourite ${savedName}`);
      setFtpEditingFavouriteId(payload?.favourite?.id || ftpEditingFavouriteId);
      setFtpFavouriteDraft((current) => createFtpFavouriteDraft({
        ...current,
        password: '',
      }));
    } catch {
      setFtpStatus('Unable to save FTP favourite');
    } finally {
      setFtpFavouritesBusy(false);
    }
  };

  const deleteFtpFavourite = async (favourite: FtpFavourite) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete FTP favourite "${favourite.name}"?`)) {
      return;
    }

    setFtpFavouritesBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/favourites/${favourite.id}`, {
        method: 'DELETE',
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Unable to delete FTP favourite');
        return;
      }

      if (ftpActiveFavouriteId === favourite.id) {
        setFtpActiveFavouriteId(null);
      }

      if (ftpEditingFavouriteId === favourite.id) {
        resetFtpFavouriteEditor();
      }

      await loadFtpFavourites();
      setFtpStatus(`Deleted favourite ${favourite.name}`);
    } catch {
      setFtpStatus('Unable to delete FTP favourite');
    } finally {
      setFtpFavouritesBusy(false);
    }
  };

  const toggleFtpFavouriteMount = async (favourite: FtpFavourite) => {
    setFtpFavouritesBusy(true);
    setFtpStatus('');

    try {
      const action = favourite.mount?.mounted ? 'unmount' : 'mount';
      const res = await authFetch(`${API}/ftp/favourites/${favourite.id}/${action}`, {
        method: 'POST',
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || `Unable to ${action} favourite`);
        return;
      }

      await loadFtpFavourites();
      setFtpStatus(
        action === 'mount'
          ? `Mounted ${favourite.name} into ~/Drives/${favourite.mount.mountName || favourite.mountName}`
          : `Unmounted ${favourite.name}`
      );
    } catch {
      setFtpStatus(`Unable to ${favourite.mount?.mounted ? 'unmount' : 'mount'} favourite`);
    } finally {
      setFtpFavouritesBusy(false);
    }
  };

  const downloadFtpEntry = async (entry: FtpEntry, { recursive = false }: { recursive?: boolean } = {}) => {
    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpPayload(),
          entryType: entry.type,
          recursive,
          remotePath: joinRemotePath(ftpPath, entry.name),
        }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Download failed');
        return;
      }

      setFtpEntryMenuState(null);
      setFtpStatus(`${payload.entryType === 'directory' ? 'Directory' : 'File'} saved to ${payload.localPath}`);
    } catch {
      setFtpStatus('Download failed');
    } finally {
      setFtpBusy(false);
    }
  };

  const setUploadTargetFromEntry = (entry: FtpEntry) => {
    const remotePath = joinRemotePath(ftpPath, entry.name);
    setFtpUploadRemotePath(entry.type === 'directory' ? `${remotePath}/` : remotePath);
    setFtpEntryMenuState(null);
    setFtpStatus(`Upload target set to ${entry.type === 'directory' ? `${remotePath}/` : remotePath}`);
  };

  const openFtpEntryMenu = (menuKey: string) => {
    const trigger = ftpMenuButtonRefs.current[menuKey];
    const rect = trigger?.getBoundingClientRect();
    const upward = rect ? rect.bottom > window.innerHeight - 180 : false;
    setFtpEntryMenuState((current) => current?.key === menuKey ? null : { key: menuKey, upward });
  };

  const uploadToFtp = async () => {
    if (!ftpUploadLocalPath.trim() || !ftpUploadRemotePath.trim()) {
      setFtpStatus('Set both a local file path and a remote upload path.');
      return;
    }

    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpPayload(),
          localPath: ftpUploadLocalPath.trim(),
          remotePath: ftpUploadRemotePath.trim(),
        }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Upload failed');
        return;
      }

      setFtpStatus(`Uploaded ${payload.localPath} to ${payload.remotePath}`);
      void loadFtpDirectory(parentRemotePath(ftpUploadRemotePath.trim()));
    } catch {
      setFtpStatus('Upload failed');
    } finally {
      setFtpBusy(false);
    }
  };

  const createFtpFolder = async () => {
    if (!ftpFolderName.trim()) {
      setFtpStatus('Enter a folder name first.');
      return;
    }

    const remotePath = joinRemotePath(ftpPath, ftpFolderName.trim());
    setFtpBusy(true);
    setFtpStatus('');

    try {
      const res = await authFetch(`${API}/ftp/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpPayload(),
          remotePath,
        }),
      });

      if (res.status === 401) {
        clearSession('Session expired. Please login again.');
        return;
      }

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFtpStatus(payload?.error || 'Folder creation failed');
        return;
      }

      setFtpFolderName('');
      setFtpStatus(`Created ${payload.remotePath}`);
      void loadFtpDirectory(ftpPath);
    } catch {
      setFtpStatus('Folder creation failed');
    } finally {
      setFtpBusy(false);
    }
  };

  if (!authChecked) {
    return (
      <div style={styles.loading} role="status" aria-live="polite">
        <div style={styles.skeletonShell}>
          <div style={styles.skeletonHeader} />
          <div style={styles.skeletonGrid}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`metric-${index}`} style={styles.skeletonCard} />
            ))}
          </div>
          <div style={styles.skeletonSplit}>
            <div style={{ ...styles.skeletonCard, minHeight: 220 }} />
            <div style={{ ...styles.skeletonCard, minHeight: 220 }} />
          </div>
          <div style={styles.skeletonGrid}>
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`service-${index}`} style={{ ...styles.skeletonCard, minHeight: 96 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <main id="app-main" style={styles.loginShell}>
        <form style={styles.loginCard} onSubmit={login} noValidate>
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>HmSTx Login</h1>
          <p style={{ marginTop: 0, color: THEME.muted, fontSize: 13 }}>Sign in to access the server dashboard.</p>
          <TextField
            id="login-username"
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={username}
            onChange={setUsername}
          />
          <TextField
            id="login-password"
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
          <p
            style={authError ? styles.errorText : styles.infoText}
            role={authError ? 'alert' : 'status'}
            aria-live="polite"
          >
            {authError || 'Use the account configured in server/.env.'}
          </p>
          <button className="ui-button ui-button--primary" style={styles.loginBtn} type="submit" disabled={authBusy}>
            {authBusy ? 'Signing In…' : 'Log In'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <div style={{ ...styles.app, ...(isPhone ? styles.appPhone : {}), ...(isTablet ? styles.appTablet : {}) }}>
      {!isPhone && (
        <aside style={{ ...styles.sidebar, ...(isTablet ? styles.sidebarTablet : {}) }}>
          <div style={styles.brand}>{isTablet ? 'Hx' : 'HmSTx'}</div>
          <nav aria-label="Dashboard Sections" style={{ ...styles.navGroup, ...(isTablet ? styles.navGroupTablet : {}) }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className="ui-button nav-ribbon-btn"
                aria-pressed={activeTab === tab.key}
                style={{ ...styles.navBtn, ...(activeTab === tab.key ? styles.navBtnActive : {}), ...(isTablet ? styles.navBtnTablet : {}) }}
                type="button"
                onClick={() => setActiveTab(tab.key)}
              >
                <span style={{ ...styles.navButtonContent, ...(isTablet ? styles.navButtonContentTablet : {}) }}>
                  {navButtonIcon(tab.key)}
                  <span style={styles.navButtonText}>{navButtonLabel(tab.key)}</span>
                </span>
              </button>
            ))}
          </nav>
          <button
            className="ui-button"
            style={{ ...styles.navBtn, ...styles.logoutBtn, ...(isTablet ? styles.navBtnTablet : {}) }}
            type="button"
            onClick={() => clearSession()}
          >
            {isTablet ? 'Exit' : 'Log Out'}
          </button>
        </aside>
      )}

      <main id="app-main" style={{ ...styles.main, ...(isTablet ? styles.mainTablet : {}), ...(isPhone ? styles.mainPhone : {}) }}>
        <div style={styles.utilityBar}>
          <div ref={searchContainerRef} style={{ ...styles.searchShell, ...(isPhone ? styles.searchShellCompact : {}) }}>
            <input
              ref={commandPaletteInputRef}
              className="ui-input"
              type="search"
              placeholder="Search services, actions, and docs"
              value={commandQuery}
              onFocus={() => {
                setSearchHasFocus(true);
                setCommandPaletteOpen(true);
              }}
              onChange={(event) => {
                setCommandQuery(event.target.value);
                setCommandPaletteOpen(true);
              }}
            />
            {searchResultsOpen ? (
              <div className="hmstx-popover" style={{ ...styles.searchResults, ...(isPhone ? styles.searchResultsCompact : {}) }}>
                {paletteItems.length === 0 ? (
                  <p style={styles.searchEmpty}>No matches.</p>
                ) : paletteItems.slice(0, 8).map((item, index) => (
                  <button
                    key={item.id}
                    className="ui-button"
                    type="button"
                    style={{ ...styles.searchResultItem, ...(isPhone ? styles.searchResultItemCompact : {}), ...(paletteIndex === index ? styles.searchResultItemActive : {}) }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={item.run}
                  >
                    <span style={styles.searchResultLabel}>{item.label}</span>
                    <span style={{ ...styles.searchResultMeta, ...(isPhone ? styles.searchResultMetaCompact : {}) }}>{item.subtitle}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {demoMode ? (
          <div style={{ ...styles.demoInfoBar, ...(isPhone ? styles.demoInfoBarCompact : {}) }} role="status" aria-live="polite">
            <div style={styles.demoInfoIntro}>
              <strong style={styles.demoInfoTitle}>Demo Build</strong>
              <span style={styles.demoInfoText}>Use this bar to verify whether Pages is serving the latest UI.</span>
            </div>
            <div style={styles.demoInfoMeta}>
              {demoMetaItems.map((item) => (
                <span key={item} style={styles.demoInfoPill} title={item === `Commit ${DEMO_LAST_COMMIT_ID}` && DEMO_LAST_COMMIT_FULL ? DEMO_LAST_COMMIT_FULL : item}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {showDemoBanner ? (
          <div style={styles.bannerWarn} role="status" aria-live="polite">
            <div>
              <strong>Demo mode active.</strong> Service controls, telemetry, and file actions are simulated for the Pages preview.
            </div>
            <button className="ui-button" type="button" style={styles.actionBtn} onClick={dismissDemoBanner}>
              Dismiss
            </button>
          </div>
        ) : null}

        {alertMessage ? (
          <div style={styles.bannerAlert} role="alert" aria-live="assertive">
            <div>{alertMessage}</div>
            <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => setAlertMessage('')}>
              Dismiss
            </button>
          </div>
        ) : null}

        {activeTab === 'home' && (
          <div>
            <div style={{ ...styles.headerBar, ...styles.homeHeaderBar }}>
              <div>
                <h1 style={{ ...styles.title, ...styles.homeTitle }}>HmSTx</h1>
              </div>
              <div style={{ ...styles.headerMeta, ...styles.homeHeaderMeta }}>
                <span style={{ ...styles.headerPill, ...styles.homeHeaderPill }}>{lastUpdated ? `Updated ${lastUpdated}` : 'Waiting for telemetry'}</span>
                <span style={{ ...styles.headerPill, ...styles.homeHeaderPill }}>{themeMode}</span>
                <span style={{ ...styles.headerPill, ...styles.homeHeaderPill }}>{lowPowerMode ? 'Low-power' : 'Live polling'}</span>
                <span style={{ ...styles.headerPill, ...styles.homeHeaderPill, ...(telemetryStale ? styles.headerPillWarn : {}) }}>
                  {telemetryStale ? 'Telemetry stale' : 'Telemetry live'}
                </span>
                <span style={{ ...styles.headerPill, ...styles.homeHeaderPill }}>{runningServices}/{totalServices} services</span>
                {lifecycleBadgeLabel ? <span style={{ ...styles.headerPill, ...styles.homeHeaderPill, ...lifecycleBadgeTone }}>{lifecycleBadgeLabel}</span> : null}
                <span style={{ ...styles.headerPill, ...styles.homeHeaderPill }}>{connections.length} clients</span>
                {monitor?.device?.batteryPct != null ? (
                  <span
                    style={{
                      ...styles.headerPill,
                      ...styles.homeHeaderPill,
                      ...(batteryLow ? styles.headerPillDanger : monitor.device.charging ? styles.headerPillOk : {}),
                      color: batteryTone,
                    }}
                  >
                    Battery {monitor.device.batteryPct}%{monitor.device.charging ? ' charging' : ''}
                  </span>
                ) : null}
              </div>
            </div>

            <section style={{ ...styles.homeLayout, ...styles.homeLayoutDense, ...(isCompact ? styles.homeLayoutCompact : {}) }}>
              <div style={{ ...styles.homePrimary, ...styles.homeColumnDense }}>
                <article className="hmstx-reveal hmstx-reveal-1 hmstx-hover-lift" style={{ ...styles.card, ...styles.homeCard }}>
                  <h3 style={{ ...styles.cardTitle, ...styles.homeCardTitle }}>System</h3>
                  <div style={{ ...styles.keyValueGrid, ...styles.homeKeyValueGrid }}>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>CPU load</span><strong style={{ color: cpuLoadTone }}>{monitor ? `${monitor.cpuLoad.toFixed(1)}%` : '--'}</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>Memory</span><strong style={{ color: memoryTone }}>{usedMemPct.toFixed(1)}%</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>Uptime</span><strong>{monitor ? `${(monitor.uptime / 3600).toFixed(1)}h` : '--'}</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>CPU cores</span><strong>{monitor ? monitor.cpuCores : '--'}</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>Load average</span><strong style={{ color: loadAverageTone }}>{monitor ? `${monitor.loadAvg1m.toFixed(2)} / ${monitor.loadAvg5m.toFixed(2)} / ${monitor.loadAvg15m.toFixed(2)}` : '--'}</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>Event loop</span><strong style={{ color: eventLoopTone }}>{monitor ? `${monitor.eventLoopP95Ms.toFixed(2)}ms p95` : '--'}</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>Node RSS</span><strong>{monitor ? fmtBytes(monitor.processRss) : '--'}</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}>
                      <span style={styles.keyLabel}>Network</span>
                      <strong>
                        {monitor ? (
                          <>
                            <span style={{ color: THEME.accentStrong }}>↓ {fmtRate(monitor.network.rxRate)}</span>
                            <span style={styles.networkDivider}> · </span>
                            <span style={{ color: THEME.brightYellow }}>↑ {fmtRate(monitor.network.txRate)}</span>
                          </>
                        ) : '--'}
                      </strong>
                    </div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>Wi-Fi</span><strong style={{ color: wifiTone }}>{monitor?.device?.wifiDbm != null ? `${monitor.device.wifiDbm} dBm` : '--'}</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>Battery</span><strong style={{ color: batteryTone }}>{monitor?.device?.batteryPct != null ? `${monitor.device.batteryPct}%${monitor.device.charging ? ' ⚡' : ''}` : '--'}</strong></div>
                    <div style={{ ...styles.keyValueRow, ...styles.homeKeyValueRow }}><span style={styles.keyLabel}>Android</span><strong style={styles.systemValueCompact}>{monitor?.device?.androidVersion || '--'}</strong></div>
                  </div>

                  <div style={{ ...styles.trendStack, ...styles.homeTrendStack }}>
                    <div>
                      <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel }}>CPU trend</p>
                      <canvas ref={cpuCanvas} width={460} height={144} style={styles.canvas} />
                    </div>
                    <div>
                      <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel }}>RAM trend</p>
                      <canvas ref={ramCanvas} width={460} height={144} style={styles.canvas} />
                    </div>
                  </div>
                </article>

                <article className="hmstx-reveal hmstx-reveal-2 hmstx-hover-lift" style={{ ...styles.card, ...styles.homeCard }}>
                  <h3 style={{ ...styles.cardTitle, ...styles.homeCardTitle }}>Storage</h3>
                  <Progress label="Storage used" value={usedStoragePct} />
                  <div style={styles.mountList}>
                    {visibleStorageMounts.map((mount) => (
                      <div key={`${mount.filesystem}-${mount.mount}`} className="hmstx-hover-lift" style={{ ...styles.mountRow, ...styles.homeMountRow }}>
                        <div style={styles.mountLeft}>
                          <strong>{mount.mount}</strong>
                          <p style={{ ...styles.mountMeta, ...styles.homeMountMeta }}>{mount.filesystem} {mount.fsType ? `(${mount.fsType})` : ''} {mount.category ? `- ${mount.category}` : ''}</p>
                        </div>
                        <div style={styles.mountRight}>
                          <span style={{ ...styles.storageMetric, ...(mount.usePercent >= 80 ? styles.storageMetricDanger : mount.usePercent >= 60 ? styles.storageMetricWarn : styles.storageMetricOk) }}>{mount.usePercent}%</span>
                          <span style={{ ...styles.mountMeta, ...styles.homeMountMeta }}>{fmtBytes(mount.used)} / {fmtBytes(mount.size)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="hmstx-reveal hmstx-reveal-3 hmstx-hover-lift" style={{ ...styles.card, ...styles.homeCard }}>
                  <div style={{ ...styles.sectionHeader, ...styles.homeSectionHeader }}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, ...styles.homeCardTitle, marginBottom: 4 }}>All Services</h3>
                      <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel }}>Gateway, data, and access services are managed here. Media owns the streaming and automation workflow.</p>
                    </div>
                    <span style={{ ...styles.headerPill, ...styles.homeHeaderPill }}>{homeListedCount} listed</span>
                  </div>
                  <div style={{ ...styles.serviceGroupStack, ...styles.homeServiceGroupStack }}>
                    {homeGroups.map(({ group, items }) => (
                      <section key={group} style={styles.serviceGroupSection}>
                        <div style={styles.serviceGroupHeader}>
                          <button className="ui-button" style={{ ...styles.groupToggle, ...styles.homeGroupToggle }} type="button" onClick={() => toggleSection(`home:${group}`)}>
                            {SERVICE_GROUP_LABELS[group]}
                          </button>
                          <span style={{ ...styles.smallLabel, ...styles.homeSmallLabel }}>{items.length} services</span>
                        </div>
                        <div style={{ ...styles.serviceCardGrid, ...(collapsedSections[`home:${group}`] ? styles.collapsedSection : {}) }}>
                          {items.map((entry) => renderServiceCard(entry))}
                        </div>
                      </section>
                    ))}
                  </div>
                </article>
              </div>

              <div style={{ ...styles.homeSecondary, ...styles.homeColumnDense }}>
                {storageProtection ? (
                  <article className="hmstx-reveal hmstx-reveal-4 hmstx-hover-lift" style={{ ...styles.card, ...styles.homeCard }}>
                    <div style={{ ...styles.logControlRow, ...styles.homeLogControlRow }}>
                      <h3 style={{ ...styles.cardTitle, ...styles.homeCardTitle, marginBottom: 0 }}>Storage Protection</h3>
                      <span style={{ ...styles.headerPill, ...styles.homeHeaderPill, color: storageProtectionTone }}>
                        {storageProtection.state || 'unknown'}
                      </span>
                    </div>
                    <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel, color: storageProtectionTone }}>
                      {storageProtectionSummary}
                    </p>
                    <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel }}>
                      Blocked: {storageBlockedServices.length > 0 ? storageBlockedServices.join(', ') : 'none'} · Last transition: {storageProtection.lastTransitionAt ? fmtTime(storageProtection.lastTransitionAt) : 'n/a'}
                    </p>
                    <div style={styles.actionWrap}>
                      <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => void runStorageRecheck()} disabled={storageProtectionBusy}>
                        {storageProtectionBusy ? 'Checking…' : 'Recheck'}
                      </button>
                      <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => void resumeStorageServices()} disabled={storageProtectionBusy || !storageProtectionRecoverable}>
                        {storageProtectionBusy ? 'Working…' : 'Resume stopped'}
                      </button>
                    </div>
                    <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel, color: storageProtectionStatus ? storageProtectionStatusColor : THEME.muted }}>
                      {storageProtectionStatus || (storageProtectionRecoverable ? `${storageStoppedByWatchdog.length} service(s) awaiting manual resume` : 'No pending resume actions')}
                    </p>
                  </article>
                ) : null}

                <article className="hmstx-reveal hmstx-reveal-4 hmstx-hover-lift" style={{ ...styles.card, ...styles.homeCard }}>
                  <div style={{ ...styles.logControlRow, ...styles.homeLogControlRow }}>
                    <h3 style={{ ...styles.cardTitle, ...styles.homeCardTitle, marginBottom: 0 }}>Optional Services</h3>
                    <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => void (serviceControllerLocked ? unlockServiceController() : lockServiceController())} disabled={serviceUnlockBusy}>
                      {serviceControllerLocked ? 'Unlock' : 'Lock'}
                    </button>
                  </div>
                  <div style={styles.serviceControllerCard}>
                    {serviceControllerLocked ? (
                      <div style={styles.serviceLockOverlay} aria-hidden={false}>
                        <div style={styles.serviceLockBadge}>Locked</div>
                        <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel, marginBottom: 10 }}>Enter the admin action password once to unlock optional services for this session.</p>
                        <TextField
                          id="service-unlock-password"
                          label="Admin Action Password"
                          name="serviceUnlockPassword"
                          type="password"
                          autoComplete="current-password"
                          value={serviceUnlockPassword}
                          onChange={setServiceUnlockPassword}
                        />
                        <button className="ui-button ui-button--primary" style={styles.serviceActionBtn} type="button" onClick={() => void unlockServiceController()} disabled={serviceUnlockBusy}>
                          {serviceUnlockBusy ? 'Unlocking…' : 'Unlock Controls'}
                        </button>
                      </div>
                    ) : null}
                    {controllableServices.length === 0 ? (
                      <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel }}>No optional services are available on this host.</p>
                    ) : controllableServices.map((entry) => {
                      const lifecycleState = entry.state || entry.status;
                      const lifecycleMessage = entry.reason || entry.statusReason || (entry.checkedAt || entry.lastCheckedAt ? `Checked ${fmtDateTime(entry.checkedAt || entry.lastCheckedAt)}` : 'No lifecycle notes');

                      return (
                        <div key={entry.key} style={{ ...styles.serviceRow, ...(isPhone ? styles.serviceRowCompact : {}), opacity: serviceControllerLocked ? 0.35 : 1 }}>
                          <div style={styles.serviceRowCopy}>
                            <span style={styles.serviceName}>{entry.label}</span>
                            <div style={{ ...styles.serviceBadgeRow, ...(isPhone ? styles.serviceBadgeRowCompact : {}) }}>
                              {renderServiceBadge('Optional', styles.serviceMiniBadgeMuted, `${entry.key}:optional`)}
                              {renderServiceBadge(serviceStatusLabel(lifecycleState), statusToneStyle(lifecycleState), `${entry.key}:state`)}
                              {entry.restartRecommended ? renderServiceBadge('Restart recommended', styles.serviceStatusWarn, `${entry.key}:restart-rec`) : null}
                            </div>
                            <p style={styles.serviceRowMeta}>
                              {lifecycleMessage}
                              {entry.lastFailureAt ? ` · Last failure ${fmtDateTime(entry.lastFailureAt)}` : ''}
                            </p>
                          </div>
                          <div style={{ ...styles.actionWrap, ...(isPhone ? styles.actionWrapCompact : {}) }}>
                            <button className="ui-button" disabled={serviceControllerLocked || !!controlBusy[`${entry.key}:start`]} style={styles.serviceActionBtn} type="button" onClick={() => void executeControl(entry.key, 'start')}>Start</button>
                            <button className="ui-button" disabled={serviceControllerLocked || !!controlBusy[`${entry.key}:restart`]} style={styles.serviceActionBtn} type="button" onClick={() => void executeControl(entry.key, 'restart')}>Restart</button>
                            <button className="ui-button" disabled={serviceControllerLocked || !!controlBusy[`${entry.key}:stop`]} style={styles.serviceActionBtn} type="button" onClick={() => void executeControl(entry.key, 'stop')}>Stop</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p
                    style={{ ...styles.smallLabel, ...styles.homeSmallLabel, marginTop: 8, color: controlStatusColor }}
                    role="status"
                    aria-live="polite"
                  >
                    {controlStatus || 'Ready'}
                  </p>
                </article>

                <article className="hmstx-reveal hmstx-reveal-5 hmstx-hover-lift" style={{ ...styles.card, ...styles.homeCard }}>
                  <div style={{ ...styles.logControlRow, ...styles.homeLogControlRow }}>
                    <h3 style={{ ...styles.cardTitle, ...styles.homeCardTitle, marginBottom: 0 }}>Connected Users</h3>
                    <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => setConnectionsExpanded((current) => !current)}>
                      {connectionsExpanded ? 'Compact columns' : 'Expand columns'}
                    </button>
                  </div>
                  <div style={styles.tableWrapTight}>
                    <table style={{ ...styles.table, ...styles.homeTable }}>
                      <thead>
                        <tr>
                          <th style={{ ...styles.th, ...styles.homeTh }}>Username</th>
                          <th style={{ ...styles.th, ...styles.homeTh }}>IP</th>
                          {connectionsExpanded ? <th style={{ ...styles.th, ...styles.homeTh }}>Protocol</th> : null}
                          <th style={{ ...styles.th, ...styles.homeTh }}>Duration</th>
                          {connectionsExpanded ? <th style={{ ...styles.th, ...styles.homeTh }}>Last Seen</th> : null}
                          <th style={{ ...styles.th, ...styles.homeTh }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {connections.length === 0 && (
                          <tr>
                            <td style={{ ...styles.td, ...styles.homeTd, ...styles.tableCellNoWrap }} colSpan={connectionsExpanded ? 6 : 4}>No active users</td>
                          </tr>
                        )}
                        {connections.map((user, idx) => (
                          <tr key={`${user.ip}-${user.port}-${idx}`}>
                            <td style={{ ...styles.td, ...styles.homeTd, ...styles.tableCellNoWrap }}>{user.username}</td>
                            <td style={{ ...styles.td, ...styles.homeTd, ...styles.tableCellNoWrap }}>{user.ip}</td>
                            {connectionsExpanded ? <td style={{ ...styles.td, ...styles.homeTd, ...styles.tableCellNoWrap }}>{user.protocol}</td> : null}
                            <td style={{ ...styles.td, ...styles.homeTd, ...styles.tableCellNoWrap }}>{fmtDuration(user.durationMs)}</td>
                            {connectionsExpanded ? <td style={{ ...styles.td, ...styles.homeTd, ...styles.tableCellNoWrap }}>{fmtTime(user.lastSeen)}</td> : null}
                            <td style={{ ...styles.td, ...styles.homeTd, ...styles.tableCellNoWrap }}>
                              {user.sessionId ? (
                                <button
                                  className="ui-button"
                                  style={styles.serviceActionBtn}
                                  type="button"
                                  disabled={connectionBusyId === user.sessionId}
                                  onClick={() => setDisconnectTarget(user)}
                                >
                                  {connectionBusyId === user.sessionId ? 'Kicking…' : 'Kick'}
                                </button>
                              ) : (
                                <span style={{ ...styles.smallLabel, ...styles.homeSmallLabel }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>

                <article className="hmstx-reveal hmstx-reveal-6 hmstx-hover-lift" style={{ ...styles.card, ...styles.homeCard }}>
                  <div style={{ ...styles.logControlRow, ...styles.homeLogControlRow }}>
                    <h3 style={{ ...styles.cardTitle, ...styles.homeCardTitle, marginBottom: 0 }}>Debug Log</h3>
                    <div style={styles.actionWrap}>
                      <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => toggleVerboseLogging(!verboseLogging)}>
                        {verboseLogging ? 'Disable Verbose' : 'Enable Verbose'}
                      </button>
                      <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={exportLogs}>
                        Download
                      </button>
                    </div>
                  </div>
                  <div style={{ ...styles.logFilters, ...styles.homeLogFilters }}>
                    <input
                      className="ui-input"
                      type="search"
                      placeholder="Filter logs"
                      value={logSearch}
                      onChange={(event) => setLogSearch(event.target.value)}
                    />
                    {(['all', 'info', 'warn', 'error'] as const).map((level) => (
                      <button
                        key={level}
                        className="ui-button"
                        type="button"
                        style={{ ...styles.actionBtn, ...(logFilter === level ? styles.navBtnActive : {}) }}
                        onClick={() => setLogFilter(level)}
                      >
                        {level.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div style={{ ...styles.logBoxCompact, ...styles.homeLogBox }}>
                    {filteredLogs.length === 0 && <p style={{ ...styles.smallLabel, ...styles.homeSmallLabel }}>No debug events yet.</p>}
                    {filteredLogs.slice(0, 60).map((log, idx) => (
                      <p key={`${log.timestamp}-${idx}`} style={{ ...styles.logLine, ...styles.homeLogLine }}>
                        <span style={styles.logTime}>{fmtTime(log.timestamp)}</span>
                        <span style={{ ...styles.logLevel, color: log.level === 'error' ? THEME.crimsonRed : log.level === 'warn' ? THEME.brightYellow : THEME.accent }}>
                          {log.level.toUpperCase()}
                        </span>
                        <span>
                          {log.message}
                          {log.meta ? ` ${JSON.stringify(log.meta)}` : ''}
                        </span>
                      </p>
                    ))}
                  </div>
                  <pre style={{ ...styles.markdownBoxCompact, ...styles.homeMarkdownBox }}>{logsMarkdown || '```log\n(no logs yet)\n```'}</pre>
                </article>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'terminal' && (
          <EmbeddedToolPanel
            title="Terminal"
            subtitle="Interactive shell via ttyd."
            meta={[terminalService ? `ttyd ${terminalService.status}` : 'ttyd status unknown']}
            frameTitle="Embedded Terminal"
            path="/term/"
            gatewayBase={gatewayBase}
            isCompact={isCompact}
            demoMode={demoMode}
          />
        )}

        {activeTab === 'filesystem' && (
          <Panel
            title="Filesystem"
            subtitle="Drive state, drive health, and a direct path into the full workspace."
            meta={[filesystemStatus, `${dashboardShares.length} shortcuts`]}
          >
            <div style={{ ...styles.homeLayout, ...(isCompact ? styles.homeLayoutCompact : {}) }}>
              <div style={styles.homePrimary}>
                <article style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Drive Summary</h3>
                      <p style={styles.smallLabel}>{filesystemStatus}</p>
                    </div>
                    <div style={styles.actionWrap}>
                      <button className="ui-button" style={styles.actionBtn} type="button" disabled={driveBusy} onClick={() => void runDriveCheck()}>
                        {driveBusy ? 'Checking…' : 'Check Drives'}
                      </button>
                      {gatewayBase ? (
                        <a href={`${gatewayBase}/files`} className="ui-button ui-button--primary" style={styles.linkBtn}>
                          Open Full Filesystem
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div style={styles.mountList}>
                    <div style={styles.mountRow}>
                      <div style={styles.mountLeft}>
                        <strong>C</strong>
                        <p style={styles.mountMeta}>Internal storage</p>
                      </div>
                      <div style={styles.mountRight}>
                        <span>Always mounted</span>
                        <span style={styles.mountMeta}>Shared Android storage</span>
                      </div>
                    </div>
                    {driveState.manifest.drives.map((drive) => (
                      <div key={`${drive.device}-${drive.mountPoint}`} style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>{drive.dirName || `${drive.letter} (${drive.name})`}</strong>
                          <p style={styles.mountMeta}>{drive.mountPoint}</p>
                        </div>
                        <div style={styles.mountRight}>
                          <span>{drive.state}</span>
                          <span style={styles.mountMeta}>{drive.filesystem || 'drive'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {driveError ? <p style={{ ...styles.smallLabel, color: THEME.crimsonRed, marginTop: 12 }}>{driveError}</p> : null}
                </article>

                <article style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Quick Links</h3>
                      <p style={styles.smallLabel}>Jump straight into the full workspace at the share root you want.</p>
                    </div>
                  </div>
                  <div style={styles.mountList}>
                    {dashboardShares.length === 0 ? (
                      <p style={styles.smallLabel}>No share shortcuts available yet.</p>
                    ) : (
                      dashboardShares.slice(0, 8).map((share) => (
                        <a key={share.id} href={`${gatewayBase}/files`} style={styles.quickLink}>
                          <strong>{share.name}</strong>
                          <span>{share.sourceType} · {share.pathKey}</span>
                        </a>
                      ))
                    )}
                  </div>
                </article>
              </div>

              <div style={styles.homeSecondary}>
                <article style={styles.card}>
                  <div style={styles.logControlRow}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Drive Log</h3>
                    <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => setShowDriveLog((value) => !value)}>
                      {showDriveLog ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {!showDriveLog ? (
                    <p style={styles.smallLabel}>{latestDriveEvent ? `${latestDriveEvent.event} · ${fmtDateTime(latestDriveEvent.timestamp)}` : 'No drive events yet.'}</p>
                  ) : (
                    <div style={styles.logBoxCompact}>
                      {driveState.events.length === 0 && <p style={styles.smallLabel}>No drive events yet.</p>}
                      {driveState.events.map((event, idx) => (
                        <p key={`${event.timestamp}-${idx}`} style={styles.logLine}>
                          <span style={styles.logTime}>{fmtTime(event.timestamp)}</span>
                          <span style={{ ...styles.logLevel, color: event.level === 'error' ? THEME.crimsonRed : event.level === 'warn' ? THEME.brightYellow : THEME.accent }}>
                            {event.level.toUpperCase()}
                          </span>
                          <span>{event.event}{event.letter ? ` · ${event.letter}` : ''}{event.name ? ` · ${event.name}` : ''}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              </div>
            </div>
          </Panel>
        )}

        {activeTab === 'downloads' && (
          <Panel
            title="Downloads"
            subtitle="qBittorrent and future download clients live here, while Jellyfin stays the viewing surface."
            meta={[downloadServices.length > 0 ? `${downloadServices.filter((entry) => entry.status === 'working').length}/${downloadServices.length} working` : 'No clients', downloadsSummary]}
          >
            <div style={styles.surfaceStack}>
              {storageProtection ? (
                <article style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Storage Guard</h3>
                      <p style={{ ...styles.smallLabel, color: storageProtectionTone }}>{storageProtectionSummary}</p>
                    </div>
                    <span style={{ ...styles.headerPill, color: storageProtectionTone }}>{storageProtection.state || 'unknown'}</span>
                  </div>
                  <p style={styles.smallLabel}>
                    Blocked services: {storageBlockedServices.length > 0 ? storageBlockedServices.join(', ') : 'none'} · Stopped by watchdog: {storageStoppedByWatchdog.length}
                  </p>
                  <div style={styles.actionWrap}>
                    <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => void runStorageRecheck()} disabled={storageProtectionBusy}>
                      {storageProtectionBusy ? 'Checking…' : 'Recheck Storage'}
                    </button>
                    <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => void resumeStorageServices()} disabled={storageProtectionBusy || !storageProtectionRecoverable}>
                      {storageProtectionBusy ? 'Working…' : 'Resume stopped'}
                    </button>
                  </div>
                  <p style={{ ...styles.smallLabel, color: storageProtectionStatus ? storageProtectionStatusColor : THEME.muted }}>
                    {storageProtectionStatus || (storageProtectionRecoverable ? `${storageStoppedByWatchdog.length} service(s) await manual resume` : 'No pending resume actions')}
                  </p>
                </article>
              ) : null}

              <article style={styles.card}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Download Services</h3>
                    <p style={styles.smallLabel}>Media automation hands off to this workspace. Keep queue health, peers, categories, and retry work here, then jump back to Jellyfin once imports land.</p>
                  </div>
                  <div style={styles.actionWrap}>
                    <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => openTab('media')}>
                      Back To Media
                    </button>
                    <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => openTab('filesystem')}>
                      Open Filesystem
                    </button>
                  </div>
                </div>
                {primaryDownloadService ? (
                  <div style={{ ...styles.mediaFeatureShell, marginBottom: 14, ...(isCompact ? styles.mediaFeatureShellCompact : {}) }}>
                    <div style={styles.mediaFeatureCopy}>
                      <div style={styles.mediaFeatureHead}>
                        <div style={styles.mediaFeatureTitleBlock}>
                          <h3 style={styles.mediaFeatureTitle}>{primaryDownloadService.label}</h3>
                          <p style={styles.mediaFeatureBody}>{primaryDownloadService.description}</p>
                        </div>
                        <div style={{ ...styles.serviceBadgeRow, ...(isPhone ? styles.serviceBadgeRowCompact : {}) }}>
                          {renderServiceBadge('Primary client', styles.serviceMiniBadgeMuted, 'downloads:primary')}
                          {renderServiceBadge(serviceStatusLabel(primaryDownloadService.status, { readyLabel: 'Ready' }), statusToneStyle(primaryDownloadService.status), 'downloads:primary-status')}
                        </div>
                      </div>
                      <p style={styles.serviceCardReason}>{primaryDownloadService.reason || primaryDownloadService.statusReason || 'Automation sends completed grabs here first, then Sonarr and Radarr import them back into the Jellyfin library.'}</p>
                      <div style={styles.mediaInfoList}>
                        <span style={styles.mediaInfoItem}>{downloadSavePath ? `Save path ${downloadSavePath}` : 'Save path not detected'}</span>
                        <span style={styles.mediaInfoItem}>{mediaWorkflow?.downloads?.clientCount != null ? `${mediaWorkflow.downloads.clientCount} client${mediaWorkflow.downloads.clientCount === 1 ? '' : 's'} linked` : `${downloadServices.length} client${downloadServices.length === 1 ? '' : 's'} linked`}</span>
                        <span style={styles.mediaInfoItem}>{jellyfinService ? `Watch completed imports in ${jellyfinService.label}` : 'Completed imports return to Jellyfin'}</span>
                      </div>
                    </div>
                    <div style={{ ...styles.serviceCardRail, ...(isCompact ? styles.serviceCardRailCompact : {}) }}>
                      {primaryDownloadHref ? (
                        <a href={primaryDownloadHref} target="_blank" rel="noreferrer" className="ui-button ui-button--primary" style={styles.serviceActionBtn}>
                          Open {primaryDownloadService?.label || 'Client'}
                        </a>
                      ) : null}
                      {jellyfinHref ? (
                        <a href={jellyfinHref} target="_blank" rel="noreferrer" className="ui-button" style={styles.serviceActionBtn}>
                          Open Jellyfin
                        </a>
                      ) : null}
                      <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => openMediaSection('automation')}>
                        Automation
                      </button>
                    </div>
                  </div>
                ) : null}
                <div style={styles.mediaSectionIntro}>
                  <span style={styles.mediaInfoItem}>{downloadsSummary}</span>
                  {mediaWorkflow?.downloads?.downloadRoots?.map((root) => (
                    <span key={root} style={styles.mediaInfoItem}>{root}</span>
                  ))}
                </div>
                <div style={styles.serviceCardGrid}>
                  {downloadServices.length > 0 ? downloadServices.map((entry) => renderServiceCard(entry)) : <p style={styles.smallLabel}>No dedicated download services are defined yet.</p>}
                </div>
              </article>
            </div>
          </Panel>
        )}

        {activeTab === 'media' && (
          <Panel
            title="Media"
            subtitle="Watch, request, automate, subtitle, and configure Live TV around Jellyfin."
            meta={[`${mediaReadyCount}/${mediaWorkflowSteps.length} working`, mediaLibraryMounts.length > 0 ? `${mediaLibraryMounts.length} library mount${mediaLibraryMounts.length === 1 ? '' : 's'}` : 'Library storage unknown', 'Downloads in separate tab']}
          >
            <div style={styles.surfaceStack}>
              <article style={styles.card}>
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Workflow</h3>
                    <p style={styles.smallLabel}>Jellyfin stays front-and-center. Requests, automation, subtitles, and Live TV support the same viewing surface, while download clients stay in their own tabs.</p>
                  </div>
                  <span style={styles.headerPill}>ARR merged here</span>
                </div>
                <div style={{ ...styles.mediaWorkflowGrid, ...(isCompact ? styles.mediaWorkflowGridCompact : {}) }}>
                  {mediaWorkflowSteps.map((step, index) => (
                    <button
                      key={step.id}
                      className="ui-button hmstx-hover-lift"
                      type="button"
                      style={{
                        ...styles.mediaWorkflowStep,
                        ...(step.status === 'working' ? styles.mediaWorkflowStepActive : {}),
                        ...(index > 0 ? styles.mediaWorkflowStepOverlap : {}),
                        ...(index % 2 === 0 ? styles.mediaWorkflowStepCascadeEven : styles.mediaWorkflowStepCascadeOdd),
                        ...(isCompact ? styles.mediaWorkflowStepTallCompact : styles.mediaWorkflowStepTall),
                        animationDelay: `${index * 60}ms`,
                        zIndex: mediaWorkflowSteps.length - index,
                      }}
                      onClick={step.onClick}
                    >
                      <div style={styles.mediaWorkflowStepHead}>
                        <span style={styles.mediaWorkflowStepLabel}>{step.label}</span>
                        <span style={{ ...styles.serviceStatusBadge, ...workflowToneStyle(step.status) }}>{step.statusLabel}</span>
                      </div>
                      <p style={styles.mediaWorkflowStepSummary}>{step.summary}</p>
                      <ul style={styles.mediaWorkflowStepList}>
                        {step.bullets.map((item) => (
                          <li key={`${step.id}-${item}`} style={styles.mediaWorkflowStepListItem}>{item}</li>
                        ))}
                      </ul>
                      <span style={styles.mediaWorkflowStepMeta}>{compactMediaMeta(step.meta)}</span>
                    </button>
                  ))}
                </div>
              </article>

              <div style={{ ...styles.mediaWorkspaceGrid, ...(isCompact ? styles.mediaWorkspaceGridCompact : {}) }}>
                <article
                  ref={(node) => {
                    mediaSectionRefs.current.watch = node;
                  }}
                  style={styles.card}
                >
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Watch</h3>
                      <p style={styles.smallLabel}>Jellyfin is the primary user-facing surface for movies, series, and Live TV playback.</p>
                    </div>
                    <span style={styles.headerPill}>{jellyfinService ? serviceStatusLabel(jellyfinService.status) : 'Missing'}</span>
                  </div>
                  {jellyfinService ? (
                    <div style={{ ...styles.mediaFeatureShell, ...(isCompact ? styles.mediaFeatureShellCompact : {}) }}>
                      <div style={styles.mediaFeatureCopy}>
                        <div style={styles.mediaFeatureHead}>
                          <div style={styles.mediaFeatureTitleBlock}>
                            <h3 style={styles.mediaFeatureTitle}>{jellyfinService.label}</h3>
                            <p style={styles.mediaFeatureBody}>{jellyfinService.description}</p>
                          </div>
                          <div style={{ ...styles.serviceBadgeRow, ...(isPhone ? styles.serviceBadgeRowCompact : {}) }}>
                            {renderServiceBadge('Primary surface', styles.serviceMiniBadgeMuted, 'watch:primary')}
                            {renderServiceBadge(serviceStatusLabel(jellyfinService.status), statusToneStyle(jellyfinService.status), 'watch:status')}
                          </div>
                        </div>
                        <p style={styles.serviceCardReason}>{jellyfinService.reason || jellyfinService.statusReason || 'Requests, imports, subtitles, and Live TV all converge back into Jellyfin for actual viewing.'}</p>
                        <div style={styles.mediaInfoList}>
                          <span style={styles.mediaInfoItem}>{mediaLibraryMounts.length > 0 ? `${mediaLibraryMounts.length} library mount${mediaLibraryMounts.length === 1 ? '' : 's'} online` : 'Library storage not detected yet'}</span>
                          <span style={styles.mediaInfoItem}>{requestPrimary ? `${requestPrimary.label} handles requests` : 'Request portal not configured'}</span>
                          <span style={styles.mediaInfoItem}>{primaryDownloadService ? `${primaryDownloadService.label} queue stays in Downloads` : 'Download client not configured yet'}</span>
                          <span style={styles.mediaInfoItem}>Live TV playback opens inside Jellyfin after M3U and XMLTV setup</span>
                        </div>
                      </div>
                      <div style={{ ...styles.serviceCardRail, ...(isCompact ? styles.serviceCardRailCompact : {}) }}>
                        {jellyfinHref ? (
                          <a href={jellyfinHref} target="_blank" rel="noreferrer" className="ui-button ui-button--primary" style={styles.serviceActionBtn}>
                            Open Jellyfin
                          </a>
                        ) : null}
                        <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => openMediaSection('requests')}>
                          Requests
                        </button>
                        <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => openTab(downloadWorkspaceTab)}>
                          Downloads
                        </button>
                        <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => openMediaSection('live-tv')}>
                          Live TV
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p style={styles.smallLabel}>Jellyfin is not available in the current service catalog.</p>
                  )}
                </article>

                <div style={styles.mediaSideStack}>
                  <article
                    ref={(node) => {
                      mediaSectionRefs.current.requests = node;
                    }}
                    style={styles.card}
                  >
                    <div style={styles.sectionHeader}>
                      <div>
                        <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Requests</h3>
                        <p style={styles.smallLabel}>Request intake sits upstream of automation so family members do not need to touch Sonarr or Radarr directly.</p>
                      </div>
                      <span style={styles.headerPill}>{serviceStatusLabel(requestStatus, { readyLabel: 'Ready' })}</span>
                    </div>
                    {requestPrimary ? (
                      <div style={styles.mediaMiniSection}>
                        <div style={{ ...styles.serviceBadgeRow, marginBottom: 8 }}>
                          {renderServiceBadge('Request portal', styles.serviceMiniBadgeMuted, 'requests:role')}
                          {renderServiceBadge(serviceStatusLabel(requestStatus, { readyLabel: 'Ready' }), workflowToneStyle(requestStatus), 'requests:status')}
                        </div>
                        <p style={styles.serviceCardDescription}>{requestPrimary.description}</p>
                        <p style={styles.serviceCardReason}>{requestPrimary.available ? 'Approved requests feed the automation layer with predefined profiles, folders, and quality defaults.' : requestPrimary.blocker || 'The request portal is not currently available on this host.'}</p>
                        <div style={{ ...styles.serviceCardRail, ...styles.serviceCardRailCompact }}>
                          {requestPrimary.available && requestHref ? (
                            <a href={requestHref} target="_blank" rel="noreferrer" className="ui-button ui-button--primary" style={styles.serviceActionBtn}>
                              Open Requests
                            </a>
                          ) : null}
                          <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => openMediaSection('automation')}>
                            View Automation
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p style={styles.smallLabel}>No request service is defined yet. Media requests should stay optional and sit in front of automation when added.</p>
                    )}
                  </article>

                  <article
                    ref={(node) => {
                      mediaSectionRefs.current.downloads = node;
                    }}
                    style={styles.card}
                  >
                    <div style={styles.sectionHeader}>
                      <div>
                        <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Downloads</h3>
                        <p style={styles.smallLabel}>Queue inspection, peers, and transfer troubleshooting stay outside Media so download workspaces can grow independently.</p>
                      </div>
                      <span style={styles.headerPill}>{downloadsStatus === 'working' ? 'Ready' : serviceStatusLabel(downloadsStatus)}</span>
                    </div>
                    <div style={styles.mediaMiniSection}>
                      <div style={{ ...styles.serviceBadgeRow, marginBottom: 8 }}>
                        {renderServiceBadge('Downloads tab', styles.serviceMiniBadgeMuted, 'downloads:location')}
                        {primaryDownloadService ? renderServiceBadge(primaryDownloadService.label, statusToneStyle(primaryDownloadService.status), 'downloads:qbit') : renderServiceBadge('No client', styles.serviceStatusWarn, 'downloads:none')}
                      </div>
                      <p style={styles.serviceCardDescription}>{primaryDownloadService ? primaryDownloadService.description : 'No download service is configured yet.'}</p>
                      <p style={styles.serviceCardReason}>{downloadSavePath ? `${primaryDownloadService?.label || 'Download client'} saves into ${downloadSavePath} before Sonarr and Radarr import completed media back into the library.` : 'Media only summarizes download health. Operational queue work stays in the dedicated Downloads tab.'}</p>
                      <div style={{ ...styles.serviceCardRail, ...styles.serviceCardRailCompact }}>
                        {primaryDownloadHref ? (
                          <a href={primaryDownloadHref} target="_blank" rel="noreferrer" className="ui-button ui-button--primary" style={styles.serviceActionBtn}>
                            Open {primaryDownloadService?.label || 'Client'}
                          </a>
                        ) : null}
                        <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => openTab(downloadWorkspaceTab)}>
                          Open Downloads
                        </button>
                        <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => openMediaSection('automation')}>
                          Upstream Automation
                        </button>
                      </div>
                    </div>
                  </article>

                  <article
                    ref={(node) => {
                      mediaSectionRefs.current.subtitles = node;
                    }}
                    style={styles.card}
                  >
                    <div style={styles.sectionHeader}>
                      <div>
                        <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Subtitles</h3>
                        <p style={styles.smallLabel}>Subtitle work happens after import, so it stays adjacent to Media instead of buried inside raw service controls.</p>
                      </div>
                      <span style={styles.headerPill}>{subtitlePrimary ? serviceStatusLabel(subtitleStatus, { readyLabel: 'Ready' }) : 'Blocked'}</span>
                    </div>
                    {subtitlePrimary ? (
                      <div style={styles.mediaMiniSection}>
                        <div style={{ ...styles.serviceBadgeRow, marginBottom: 8 }}>
                          {renderServiceBadge('Post-import', styles.serviceMiniBadgeMuted, 'subtitles:role')}
                          {renderServiceBadge(serviceStatusLabel(subtitleStatus, { readyLabel: 'Ready' }), workflowToneStyle(subtitleStatus), 'subtitles:status')}
                        </div>
                        <p style={styles.serviceCardDescription}>{subtitlePrimary.description}</p>
                        <p style={styles.serviceCardReason}>{subtitlePrimary.available ? 'Bazarr follows imported media from Sonarr and Radarr and applies subtitle language policy afterward.' : subtitlePrimary.blocker || 'Subtitle automation is not currently available on this host.'}</p>
                        <div style={{ ...styles.serviceCardRail, ...styles.serviceCardRailCompact }}>
                          <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => openMediaSection('automation')}>
                            Automation Details
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p style={styles.smallLabel}>No subtitle service is defined yet.</p>
                    )}
                  </article>
                </div>
              </div>

              <article
                ref={(node) => {
                  mediaSectionRefs.current['live-tv'] = node;
                }}
                style={styles.card}
              >
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Live TV</h3>
                    <p style={styles.smallLabel}>Center Live TV around Jellyfin’s official flow: add an M3U tuner, connect XMLTV guide data, map channels, then watch in Jellyfin.</p>
                  </div>
                  <span style={styles.headerPill}>{serviceStatusLabel(liveTvStatus, { unknownLabel: 'Setup' })}</span>
                </div>
                <div style={styles.mediaChecklist}>
                  {liveTvChecklist.map((item) => (
                    <div key={item.id} style={styles.mediaChecklistRow}>
                      <div style={styles.mediaChecklistCopy}>
                        <h4 style={styles.mediaChecklistTitle}>{item.label}</h4>
                        <p style={styles.mediaChecklistBody}>{item.detail}</p>
                      </div>
                      <span style={{ ...styles.serviceStatusBadge, ...workflowToneStyle(item.status) }}>{item.statusLabel}</span>
                    </div>
                  ))}
                </div>
                <div style={styles.mediaSupportMeta}>
                  <span style={styles.supportLabel}>Support stack</span>
                  <div style={{ ...styles.serviceBadgeRow, ...(isPhone ? styles.serviceBadgeRowCompact : {}) }}>
                    {mediaSupportServices.length > 0
                      ? mediaSupportServices.map((entry) => renderServiceBadge(entry.label, statusToneStyle(entry.status), `live-tv:${entry.key}`))
                      : <span style={styles.smallLabel}>No support services defined.</span>}
                  </div>
                </div>
                <div style={{ ...styles.serviceCardRail, marginTop: 12, ...(isCompact ? styles.serviceCardRailCompact : {}) }}>
                  {jellyfinHref ? (
                    <a href={jellyfinHref} target="_blank" rel="noreferrer" className="ui-button ui-button--primary" style={styles.serviceActionBtn}>
                      Open Jellyfin
                    </a>
                  ) : null}
                  <button className="ui-button" style={styles.serviceActionBtn} type="button" onClick={() => toggleSection('media:support')}>
                    {collapsedSections['media:support'] ? 'Show support stack' : 'Hide support stack'}
                  </button>
                </div>
              </article>

              <article
                ref={(node) => {
                  mediaSectionRefs.current.automation = node;
                }}
                style={styles.card}
              >
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Automation</h3>
                    <p style={styles.smallLabel}>Prowlarr manages indexers, Sonarr and Radarr drive grab and import policy, and download execution stays in the Downloads tab.</p>
                  </div>
                  <span style={styles.headerPill}>{arrHealthyCount}/{automationServices.length} working</span>
                </div>
                <div style={styles.mediaSectionIntro}>
                  <span style={styles.mediaInfoItem}>Prowlarr syncs indexers into Sonarr and Radarr.</span>
                  <span style={styles.mediaInfoItem}>Sonarr and Radarr monitor downloads, import results, and move them into the Jellyfin library.</span>
                  <span style={styles.mediaInfoItem}>qBittorrent and future download clients remain in other tabs by design.</span>
                </div>
                <div style={styles.serviceCardGrid}>
                  {automationServices.map((entry) => renderServiceCard(entry))}
                </div>
              </article>

              <article
                ref={(node) => {
                  mediaSectionRefs.current.support = node;
                }}
                style={styles.card}
              >
                <div style={styles.sectionHeader}>
                  <div>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Advanced Support</h3>
                    <p style={styles.smallLabel}>Redis and PostgreSQL support Live TV metadata and future operator tooling, but they should not dominate the main Media workflow.</p>
                  </div>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleSection('media:support')}>
                    {collapsedSections['media:support'] ? 'Show' : 'Hide'}
                  </button>
                </div>
                <div style={{ ...styles.serviceCardGrid, ...(collapsedSections['media:support'] ? styles.collapsedSection : {}) }}>
                  {mediaSupportServices.length > 0 ? mediaSupportServices.map((entry) => renderServiceCard(entry)) : <p style={styles.smallLabel}>No support services are defined for Media.</p>}
                </div>
              </article>
            </div>
          </Panel>
        )}

        {activeTab === 'ftp' && (
          <Panel
            title="FTP"
            subtitle="Save remotes, browse them directly, and mount them into ~/Drives when this host allows it."
            meta={[`${ftpFavourites.length} favourites`, `${mountedFtpFavouriteCount} mounted`]}
          >
            <div style={{ ...styles.ftpWorkspace, ...(isCompact ? styles.ftpWorkspaceCompact : {}) }}>
              <div style={styles.ftpSidebar}>
                <div style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Saved Favourites</h3>
                    <div style={styles.actionWrap}>
                      <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => resetFtpFavouriteEditor()}>New</button>
                      <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpFavourites()}>Reload</button>
                    </div>
                  </div>
                  <p style={styles.smallLabel}>Saved remotes can be browsed live or mounted into a drive folder. Mount errors stay attached to the favourite so they are visible without opening logs.</p>
                  <div style={styles.ftpFavouriteList}>
                    {ftpFavourites.length === 0 && (
                      <p style={styles.smallLabel}>No favourites saved yet. The editor below is prefilled with the default PS4 connection.</p>
                    )}
                    {ftpFavourites.map((favourite) => {
                      const mountLabel = favourite.mount?.mounted
                        ? 'Mounted'
                        : favourite.mount?.state === 'starting'
                          ? 'Starting'
                          : favourite.mount?.error
                            ? 'Error'
                            : 'Saved';

                      const badgeStyle = favourite.mount?.mounted
                        ? styles.ftpBadgeMounted
                        : favourite.mount?.error
                          ? styles.ftpBadgeError
                          : styles.ftpBadgeIdle;

                      return (
                        <div
                          key={favourite.id}
                          style={{
                            ...styles.ftpFavouriteRow,
                            ...(ftpActiveFavouriteId === favourite.id ? styles.ftpFavouriteRowActive : {}),
                          }}
                        >
                          <div style={styles.ftpFavouriteMeta}>
                            <div style={styles.ftpFavouriteHeader}>
                              <strong>{favourite.name}</strong>
                              <span style={{ ...styles.ftpBadge, ...badgeStyle }}>{mountLabel}</span>
                            </div>
                            <p style={styles.mountMeta}>{favourite.host}:{favourite.port} · {favourite.remotePath || '/'}</p>
                            <p style={styles.mountMeta}>Drive target: ~/Drives/{favourite.mountName || favourite.name}</p>
                            <p style={styles.mountMeta}>{describeFtpMount(favourite.mount)}</p>
                          </div>
                          <div style={styles.actionWrap}>
                            <button className="ui-button" disabled={ftpBusy || ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void browseFtpFavourite(favourite)}>Browse</button>
                            <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void toggleFtpFavouriteMount(favourite)}>
                              {favourite.mount?.mounted ? 'Unmount' : 'Mount'}
                            </button>
                            <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => editFtpFavourite(favourite)}>Edit</button>
                            <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void deleteFtpFavourite(favourite)}>Delete</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>{ftpEditingFavouriteId === null ? 'New Favourite' : 'Edit Favourite'}</h3>
                    <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => resetFtpFavouriteEditor()}>
                      {ftpEditingFavouriteId === null ? 'Reset' : 'Clear'}
                    </button>
                  </div>
                  <div style={styles.ftpActionGroup}>
                    <TextField id="ftp-favourite-name" label="Display Name" name="ftpFavouriteName" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.name} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, name: value }))} />
                    <TextField id="ftp-favourite-host" label="Host" name="ftpFavouriteHost" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.host} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, host: value }))} />
                    <TextField id="ftp-favourite-port" label="Port" name="ftpFavouritePort" autoComplete="off" inputMode="numeric" spellCheck={false} value={ftpFavouriteDraft.port} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, port: value }))} />
                    <TextField id="ftp-favourite-user" label="Username" name="ftpFavouriteUser" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.username} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, username: value }))} />
                    <TextField id="ftp-favourite-password" label={ftpEditingFavouriteId === null ? 'Password' : 'Password Override'} name="ftpFavouritePassword" type="password" autoComplete="off" value={ftpFavouriteDraft.password} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, password: value }))} />
                    <TextField id="ftp-favourite-remote-path" label="Start Path" name="ftpFavouriteRemotePath" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.remotePath} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, remotePath: value }))} />
                    <TextField id="ftp-favourite-mount-name" label="Drive Folder Name" name="ftpFavouriteMountName" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpFavouriteDraft.mountName} onChange={(value) => setFtpFavouriteDraft((prev) => ({ ...prev, mountName: value }))} />
                  </div>
                  <label style={styles.checkboxRow}>
                    <input type="checkbox" checked={ftpFavouriteDraft.secure} onChange={(event) => setFtpFavouriteDraft((prev) => ({ ...prev, secure: event.target.checked }))} />
                    <span>Use FTPS/TLS for this favourite</span>
                  </label>
                  <p style={styles.smallLabel}>Leave the password blank while editing if you want to keep the stored secret unchanged.</p>
                  <div style={styles.actionWrap}>
                    <button className="ui-button" disabled={ftpFavouritesBusy} style={styles.actionBtn} type="button" onClick={() => void saveFtpFavourite()}>
                      {ftpEditingFavouriteId === null ? 'Save Favourite' : 'Update Favourite'}
                    </button>
                  </div>
                </div>
              </div>

              <div style={styles.ftpMain}>
                <div style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Connection</h3>
                      <p style={styles.smallLabel}>Browse a saved favourite or detach and use the manual fields for one-off sessions.</p>
                    </div>
                    {activeFtpFavourite && <span style={styles.headerPill}>Using {activeFtpFavourite.name}</span>}
                  </div>
                  <div style={styles.ftpFormGrid}>
                    <TextField id="ftp-host" label="Host" name="ftpHost" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpHost} onChange={(value) => { setFtpActiveFavouriteId(null); setFtpHost(value); }} />
                    <TextField id="ftp-port" label="Port" name="ftpPort" autoComplete="off" inputMode="numeric" spellCheck={false} value={ftpPort} onChange={(value) => { setFtpActiveFavouriteId(null); setFtpPort(value); }} />
                    <TextField id="ftp-user" label="Username" name="ftpUser" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={ftpUser} onChange={(value) => { setFtpActiveFavouriteId(null); setFtpUser(value); }} />
                    <TextField id="ftp-password" label="Password" name="ftpPassword" type="password" autoComplete="off" value={ftpPassword} onChange={(value) => { setFtpActiveFavouriteId(null); setFtpPassword(value); }} />
                  </div>
                  <label style={styles.checkboxRow}>
                    <input type="checkbox" checked={ftpSecure} onChange={(event) => { setFtpActiveFavouriteId(null); setFtpSecure(event.target.checked); }} />
                    <span>Use FTPS/TLS</span>
                  </label>
                  <div style={styles.actionWrap}>
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(activeFtpFavourite?.remotePath || '/')}>Connect</button>
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(ftpPath)}>Refresh</button>
                    <button className="ui-button" disabled={ftpBusy || ftpPath === '/'} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(parentRemotePath(ftpPath))}>Up One Level</button>
                    {ftpActiveFavouriteId !== null && (
                      <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => { setFtpActiveFavouriteId(null); setFtpStatus('Detached from saved favourite. Manual connection fields are active now.'); }}>
                        Manual Mode
                      </button>
                    )}
                  </div>
                  <p style={styles.codeLine}>Current remote path: <code>{ftpPath}</code></p>
                  <p style={styles.codeLine}>Downloads land under: <code>{ftpDownloadRoot || '~/Drives'}</code></p>
                  {activeFtpFavourite && (
                    <p style={styles.codeLine}>Drive target: <code>~/Drives/{activeFtpFavourite.mountName || activeFtpFavourite.name}</code></p>
                  )}
                  <p
                    style={{ ...styles.smallLabel, color: ftpStatusColor }}
                    role="status"
                    aria-live="polite"
                  >
                    {ftpStatus || 'Ready'}
                  </p>
                </div>

                <div style={styles.card}>
                  <h3 style={styles.cardTitle}>Transfer Actions</h3>
                  <div style={styles.ftpActionGroup}>
                    <TextField
                      id="ftp-upload-local-path"
                      label="Local File Path"
                      name="ftpUploadLocalPath"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="/data/data/com.termux/files/home/Drives/C/patch.pkg"
                      value={ftpUploadLocalPath}
                      onChange={setFtpUploadLocalPath}
                    />
                    <TextField
                      id="ftp-upload-remote-path"
                      label="Remote Upload Path"
                      name="ftpUploadRemotePath"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="/data/patch.pkg"
                      value={ftpUploadRemotePath}
                      onChange={setFtpUploadRemotePath}
                    />
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void uploadToFtp()}>Upload Local File</button>
                  </div>
                  <div style={styles.ftpActionGroup}>
                    <TextField
                      id="ftp-folder-name"
                      label="New Remote Folder"
                      name="ftpFolderName"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="new-folder"
                      value={ftpFolderName}
                      onChange={setFtpFolderName}
                    />
                    <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void createFtpFolder()}>Create Folder</button>
                  </div>
                  <p style={styles.smallLabel}>The row menu in the listing can prefill the upload target for the folder or file you choose.</p>
                </div>

                <div style={styles.card}>
                  <div className="fs-topbar fs-topbar--path">
                    <div className="fs-pathbar-shell">
                      <div className="fs-pathbar" aria-label="Remote path">
                        <button className="fs-crumb fs-crumb--path" type="button" onClick={() => void loadFtpDirectory('/')}>
                          <span>/</span>
                          {ftpBreadcrumbs.length > 0 ? <span className="fs-crumb__divider">/</span> : null}
                        </button>
                        {ftpBreadcrumbs.map((segment, index) => {
                          const crumbPath = `/${ftpBreadcrumbs.slice(0, index + 1).join('/')}`;
                          return (
                            <button key={crumbPath} className="fs-crumb fs-crumb--path" type="button" onClick={() => void loadFtpDirectory(crumbPath)}>
                              <span>{segment}</span>
                              {index < ftpBreadcrumbs.length - 1 ? <span className="fs-crumb__divider">/</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="fs-topbar__actions">
                      <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(ftpPath)}>Refresh</button>
                      <button className="ui-button" disabled={ftpBusy || ftpPath === '/'} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(parentRemotePath(ftpPath))}>Up</button>
                    </div>
                  </div>
                  <div className="fs-topbar fs-topbar--details">
                    <div className="fs-titlebar">
                      <h2>Remote entries</h2>
                      <div className="fs-titlebar__meta">
                        <span>{activeFtpFavourite?.name || ftpHost || 'Manual session'}</span>
                        <span>{filteredFtpEntries.filter((entry) => entry.type === 'directory').length} folders</span>
                        <span>{filteredFtpEntries.filter((entry) => entry.type !== 'directory').length} files</span>
                      </div>
                    </div>
                    <div className="fs-actions fs-actions--rail">
                      <input
                        className="ui-input fs-search"
                        type="search"
                        placeholder="Filter remote entries"
                        value={ftpSearch}
                        onChange={(event) => setFtpSearch(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="fs-meta">
                    <span>{activeFtpFavourite ? `${activeFtpFavourite.host}:${activeFtpFavourite.port}` : `${ftpHost || 'No host'}:${ftpPort}`}</span>
                    <span>{ftpPath}</span>
                    <span style={{ color: ftpStatusColor }}>{ftpStatus || 'Ready'}</span>
                  </div>
                  <div className="fs-browser-list">
                    {filteredFtpEntries.length === 0 ? (
                      <div className="tool-empty fs-empty">
                        {ftpBusy ? 'Loading remote folder…' : 'No listing loaded yet.'}
                      </div>
                    ) : (
                      filteredFtpEntries.map((entry) => {
                        const menuKey = `${entry.type}:${entry.name}`;
                        const isDirectory = entry.type === 'directory';

                        return (
                          <article key={menuKey} className="fs-browser-item fs-browser-item--no-check">
                            <button className="fs-browser-main" type="button" onClick={() => isDirectory ? void loadFtpDirectory(joinRemotePath(ftpPath, entry.name)) : void downloadFtpEntry(entry)}>
                              <span className={`fs-entry-icon fs-entry-icon--${isDirectory ? 'directory' : 'file'} fs-entry-icon--tile`} aria-hidden="true" />
                              <span className="fs-browser-copy">
                                <strong>{entry.name}</strong>
                                <span>{isDirectory ? 'Folder' : 'File'} · {entry.modifiedAt ? fmtTime(entry.modifiedAt) : entry.rawModifiedAt || '--'}</span>
                              </span>
                            </button>

                            <div className="fs-browser-meta">
                              <span>{isDirectory ? '—' : fmtBytes(entry.size)}</span>
                              <span>{entry.permissions || (isDirectory ? 'remote folder' : 'remote file')}</span>
                            </div>

                            <div className="fs-browser-actions">
                              {isDirectory ? (
                                <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void loadFtpDirectory(joinRemotePath(ftpPath, entry.name))}>Open</button>
                              ) : (
                                <button className="ui-button" disabled={ftpBusy} style={styles.actionBtn} type="button" onClick={() => void downloadFtpEntry(entry)}>Pull</button>
                              )}
                              <div className="fs-row-menu">
                                <MenuButton
                                  className="ui-button fs-row-menu__trigger"
                                  disabled={ftpBusy}
                                  label={`Open FTP actions for ${entry.name}`}
                                  open={ftpEntryMenuState?.key === menuKey}
                                  ref={(node) => {
                                    ftpMenuButtonRefs.current[menuKey] = node;
                                  }}
                                  onClick={() => openFtpEntryMenu(menuKey)}
                                />
                                {ftpEntryMenuState?.key === menuKey && (
                                  <div className={`fs-row-menu__panel ${ftpEntryMenuState.upward ? 'fs-row-menu__panel--upward' : ''}`}>
                                    {isDirectory ? (
                                      <button className="ui-button fs-row-menu__item" type="button" onClick={() => void loadFtpDirectory(joinRemotePath(ftpPath, entry.name))}>Open folder</button>
                                    ) : null}
                                    <button className="ui-button fs-row-menu__item" type="button" onClick={() => void downloadFtpEntry(entry, { recursive: isDirectory })}>
                                      {isDirectory ? 'Pull folder' : 'Pull file'}
                                    </button>
                                    <button className="ui-button fs-row-menu__item" type="button" onClick={() => setUploadTargetFromEntry(entry)}>
                                      {isDirectory ? 'Use for uploads' : 'Use path'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        )}

        {activeTab === 'ai' && (
          <Panel
            title="LLM"
            subtitle="Chat-first local LLM workspace with a separate management view."
            meta={[
              llmActiveModelId ? `Active model: ${llmActiveModelId}` : 'No active model',
              llmRunning ? 'Service running' : 'Service stopped',
            ]}
          >
            <div style={styles.surfaceStack}>
              <div style={styles.llmSubnav}>
                <button
                  className="ui-button"
                  type="button"
                  style={{ ...styles.llmSubnavBtn, ...(llmSubview === 'chat' ? styles.llmSubnavBtnActive : {}) }}
                  onClick={() => setLlmSubview('chat')}
                >
                  Chat
                </button>
                <button
                  className="ui-button"
                  type="button"
                  style={{ ...styles.llmSubnavBtn, ...(llmSubview === 'manage' ? styles.llmSubnavBtnActive : {}) }}
                  onClick={() => setLlmSubview('manage')}
                >
                  Manage
                </button>
              </div>

              {llmSubview === 'chat' ? (
                <div style={styles.card}>
                  <div style={styles.llmChatHead}>
                    <div>
                      <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Chat</h3>
                      <p style={styles.smallLabel}>History is persisted per admin user session.</p>
                    </div>
                    <div style={styles.actionWrap}>
                      <button
                        className="ui-button"
                        style={{ ...styles.actionBtn, ...(llmMode === 'local' ? styles.llmModeBtnActive : {}) }}
                        type="button"
                        onClick={() => setLlmMode('local')}
                      >
                        Local
                      </button>
                      <button
                        className="ui-button"
                        style={{ ...styles.actionBtn, ...(llmMode === 'online' ? styles.llmModeBtnActive : {}) }}
                        type="button"
                        onClick={() => setLlmMode('online')}
                      >
                        Online
                      </button>
                      {llmMode === 'online' ? (
                        <select
                          className="ui-input"
                          style={styles.llmModelSelect}
                          value={llmOnlineModelId}
                          onChange={(event) => setLlmOnlineModelId(event.target.value)}
                        >
                          {llmOnlineModels.length === 0 ? (
                            <option value="">No online models</option>
                          ) : llmOnlineModels.map((model) => (
                            <option key={`online:${model.id}`} value={model.id}>{model.label || model.id}</option>
                          ))}
                        </select>
                      ) : null}
                      {isPhone ? (
                        <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => setLlmHistoryOpen(true)}>
                          History
                        </button>
                      ) : null}
                      <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => { setLlmConversationId(null); setLlmMessages([]); }}>
                        New Chat
                      </button>
                      <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => void loadLlmConversations()}>
                        Refresh
                      </button>
                    </div>
                  </div>

                  <div style={{ ...styles.llmWorkspace, ...(isCompact ? styles.llmWorkspaceCompact : {}) }}>
                    {!isPhone ? (
                      <aside style={styles.llmRail}>
                        {llmConversations.length === 0 ? (
                          <p style={styles.smallLabel}>No saved conversations yet.</p>
                        ) : (
                          <div style={styles.llmConversationList}>
                            {llmConversations.map((conversation) => (
                              <button
                                key={conversation.id}
                                className="ui-button"
                                style={{ ...styles.llmConversationItem, ...(llmConversationId === conversation.id ? styles.llmConversationItemActive : {}) }}
                                type="button"
                                onClick={() => setLlmConversationId(conversation.id)}
                              >
                                <strong>{conversation.title || `Conversation ${conversation.id}`}</strong>
                                <span style={styles.mountMeta}>{fmtTime(conversation.updatedAt)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </aside>
                    ) : null}

                    <div style={styles.llmChatShell}>
                      <div style={styles.llmThread}>
                        {llmMessages.length === 0 ? (
                          <p style={styles.llmThreadEmpty}>No messages yet. Send a prompt to start.</p>
                        ) : llmMessages.map((entry) => (
                          <article
                            key={entry.id}
                            style={{
                              ...styles.llmMessageRow,
                              ...(entry.role === 'user' ? styles.llmMessageRowUser : {}),
                            }}
                          >
                            <div
                              style={{
                                ...styles.llmMessageBubble,
                                ...(entry.role === 'user' ? styles.llmMessageBubbleUser : styles.llmMessageBubbleAssistant),
                              }}
                            >
                              <div style={styles.llmMessageMeta}>
                                <strong>{entry.role === 'assistant' ? 'Assistant' : entry.role === 'user' ? 'You' : entry.role}</strong>
                                <span style={styles.mountMeta}>{fmtTime(entry.createdAt)}</span>
                              </div>
                              <div style={styles.llmMessageBody}>
                                {parseLlmMessageSegments(entry.content).map((segment, idx) => (
                                  segment.type === 'code' ? (
                                    <div key={`${entry.id}:code:${idx}`} style={styles.llmCodeBlock}>
                                      <div style={styles.llmCodeHead}>
                                        <span style={styles.llmCodeLanguage}>{segment.language || 'code'}</span>
                                      </div>
                                      <pre style={styles.llmCodeBody}>
                                        <code>{segment.content}</code>
                                      </pre>
                                    </div>
                                  ) : (
                                    <p key={`${entry.id}:text:${idx}`} style={styles.llmMessageText}>{segment.content}</p>
                                  )
                                ))}
                              </div>
                              {entry.role === 'assistant' ? (
                                <div style={styles.llmMessageActions}>
                                  <button className="ui-button" style={styles.llmTinyBtn} type="button" onClick={() => void copyLlmMessage(entry.content)}>
                                    Copy
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>

                      <div style={styles.llmComposer}>
                        <textarea
                          className="ui-input"
                          style={styles.llmComposerInput}
                          value={llmPrompt}
                          placeholder={llmMode === 'online' ? 'Ask your online model...' : 'Ask your local model...'}
                          onChange={(event) => setLlmPrompt(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              if (llmCanSend) {
                                void sendLlmPrompt();
                              }
                            }
                          }}
                        />
                        <div style={styles.llmComposerActions}>
                          <button
                            className="ui-button"
                            style={styles.actionBtn}
                            type="button"
                            disabled={llmBusy || !llmLastUserMessage}
                            onClick={() => void retryLastLlmPrompt()}
                          >
                            Retry Last
                          </button>
                          <button
                            className="ui-button ui-button--primary"
                            style={styles.actionBtn}
                            type="button"
                            disabled={llmBusy || !llmPrompt.trim() || !llmCanSend}
                            onClick={() => void sendLlmPrompt()}
                          >
                            {llmBusy ? 'Sending…' : 'Send'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {llmStatus ? (
                    <p style={{ ...styles.smallLabel, marginTop: 10, color: llmStatusTone }}>
                      {llmStatus}
                    </p>
                  ) : null}
                </div>
              ) : (
                <>
                  {llmService ? renderServiceCard(llmService) : (
                    <div style={styles.card}>
                      <p style={styles.smallLabel}>Local LLM service is not present in the service catalog.</p>
                    </div>
                  )}
                  {codexRevampedService ? renderServiceCard(codexRevampedService) : (
                    <div style={styles.card}>
                      <p style={styles.smallLabel}>Codex ReVamped service is not present in the service catalog.</p>
                    </div>
                  )}

                  <div style={styles.card}>
                    <div style={styles.sectionHeader}>
                      <div>
                        <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Access Settings</h3>
                        <p style={styles.smallLabel}>Use OpenAI-compatible endpoints behind the gateway with your configured LLM API key.</p>
                      </div>
                    </div>
                    <div style={styles.mountList}>
                      <div style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>API Base</strong>
                          <p style={styles.mountMeta}>{llmApiBaseUrl}</p>
                        </div>
                      </div>
                      <div style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>Models Endpoint</strong>
                          <p style={styles.mountMeta}>GET {llmApiBaseUrl}/models</p>
                        </div>
                      </div>
                      <div style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>Chat Endpoint</strong>
                          <p style={styles.mountMeta}>POST {llmApiBaseUrl}/chat/completions</p>
                        </div>
                      </div>
                      <div style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>Authorization</strong>
                          <p style={styles.mountMeta}>Bearer token required. Key status: {llmApiKeyConfigured ? 'Configured' : 'Not configured in server/.env'}</p>
                        </div>
                        <div style={styles.mountRight}>
                          <span style={llmApiKeyConfigured ? styles.storageMetricOk : styles.storageMetricWarn}>{llmApiKeyConfigured ? 'ready' : 'pending'}</span>
                        </div>
                      </div>
                      <div style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>Online Provider</strong>
                          <p style={styles.mountMeta}>{llmOnlineConfigured ? 'Configured in server/.env' : 'Not configured'}</p>
                        </div>
                        <div style={styles.mountRight}>
                          <span style={llmOnlineConfigured ? styles.storageMetricOk : styles.storageMetricWarn}>{llmOnlineConfigured ? 'ready' : 'pending'}</span>
                        </div>
                      </div>
                      <div style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>Online Models</strong>
                          <p style={styles.mountMeta}>
                            {llmOnlineAvailable
                              ? `${llmOnlineModels.length} model${llmOnlineModels.length === 1 ? '' : 's'} discovered`
                              : (llmOnlineError || 'Online models unavailable')}
                          </p>
                        </div>
                        <div style={styles.mountRight}>
                          <span style={llmOnlineAvailable ? styles.storageMetricOk : styles.storageMetricWarn}>{llmOnlineAvailable ? 'ok' : 'issue'}</span>
                        </div>
                      </div>
                      <div style={styles.mountRow}>
                        <div style={styles.mountLeft}>
                          <strong>Online Active Model</strong>
                          <p style={styles.mountMeta}>Choose the default online model used for new chats.</p>
                          <select
                            className="ui-input"
                            style={{ ...styles.llmModelSelect, marginTop: 8, minWidth: 240 }}
                            value={llmOnlineModelId}
                            onChange={(event) => setLlmOnlineModelId(event.target.value)}
                            disabled={!llmOnlineConfigured || llmOnlineModels.length === 0}
                          >
                            {llmOnlineModels.length === 0 ? (
                              <option value="">No online models</option>
                            ) : llmOnlineModels.map((model) => (
                              <option key={`online-manage:${model.id}`} value={model.id}>{model.label || model.id}</option>
                            ))}
                          </select>
                        </div>
                        <div style={styles.mountRight}>
                          <div style={styles.actionWrap}>
                            <button
                              className="ui-button"
                              style={styles.actionBtn}
                              type="button"
                              disabled={llmModelBusyId === 'online-refresh'}
                              onClick={() => void refreshOnlineLlmModels()}
                            >
                              {llmModelBusyId === 'online-refresh' ? 'Refreshing…' : 'Refresh'}
                            </button>
                            <button
                              className="ui-button ui-button--primary"
                              style={styles.actionBtn}
                              type="button"
                              disabled={!llmOnlineConfigured || !llmOnlineAvailable || !llmOnlineModelId || llmModelBusyId === 'online-select'}
                              onClick={() => void selectOnlineLlmModel()}
                            >
                              {llmModelBusyId === 'online-select' ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={styles.card}>
                    <div style={styles.sectionHeader}>
                      <div>
                        <h3 style={{ ...styles.cardTitle, marginBottom: 4 }}>Models</h3>
                        <p style={styles.smallLabel}>Install curated presets or attach a local GGUF path. Only installed models can be selected.</p>
                      </div>
                      <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => void loadLlmState()}>
                        Refresh
                      </button>
                    </div>
                    <div style={{ ...styles.serviceCardGrid, marginTop: 10 }}>
                      {llmModels.length === 0 ? (
                        <p style={styles.smallLabel}>No models discovered yet.</p>
                      ) : llmModels.map((model) => (
                        <article key={model.id} style={styles.serviceCard}>
                          <div style={styles.serviceCardShell}>
                            <div style={styles.serviceCardCopy}>
                              <div style={styles.serviceCardHead}>
                                <div style={styles.serviceCardTitleBlock}>
                                  <h3 style={styles.serviceCardTitle}>{model.label}</h3>
                                  <p style={styles.serviceCardDescription}>{model.path}</p>
                                </div>
                                <div style={styles.serviceBadgeRow}>
                                  {renderServiceBadge(model.source, styles.serviceMiniBadgeMuted, `${model.id}:source`)}
                                  {renderServiceBadge(model.installed ? 'Installed' : 'Not installed', model.installed ? styles.serviceStatusOk : styles.serviceStatusWarn, `${model.id}:installed`)}
                                  {renderServiceBadge(llmActiveModelId === model.id ? 'Active' : 'Inactive', llmActiveModelId === model.id ? styles.serviceStatusOk : styles.serviceStatusIdle, `${model.id}:active`)}
                                </div>
                              </div>
                            </div>
                            <div style={styles.serviceCardRail}>
                              <button
                                className="ui-button"
                                style={styles.serviceActionBtn}
                                type="button"
                                disabled={llmModelBusyId === model.id || !model.installed || llmActiveModelId === model.id}
                                onClick={() => void selectLlmModel(model.id)}
                              >
                                {llmModelBusyId === model.id ? 'Applying…' : 'Use'}
                              </button>
                              <button
                                className="ui-button"
                                style={styles.serviceActionBtn}
                                type="button"
                                disabled={llmModelBusyId === model.id || model.installed}
                                onClick={() => void pullLlmModel(model.id)}
                              >
                                {llmModelBusyId === model.id ? 'Pulling…' : model.installed ? 'Installed' : 'Pull'}
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    <div style={{ ...styles.ftpActionGroup, marginTop: 14 }}>
                      <TextField
                        id="llm-local-model-label"
                        label="Local Model Label"
                        name="llmLocalModelLabel"
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck={false}
                        value={llmLocalModelLabel}
                        onChange={setLlmLocalModelLabel}
                      />
                      <TextField
                        id="llm-local-model-path"
                        label="Local GGUF Path"
                        name="llmLocalModelPath"
                        autoCapitalize="none"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck={false}
                        value={llmLocalModelPath}
                        onChange={setLlmLocalModelPath}
                        placeholder="/data/data/com.termux/files/home/services/llm/models/custom.gguf"
                      />
                      <div style={styles.actionWrap}>
                        <button className="ui-button" style={styles.actionBtn} type="button" disabled={llmModelBusyId === 'add-local'} onClick={() => void addLocalLlmModel()}>
                          {llmModelBusyId === 'add-local' ? 'Adding…' : 'Add Local Model'}
                        </button>
                      </div>
                    </div>
                    {llmPullJobs.length > 0 ? (
                      <div style={{ ...styles.mountList, marginTop: 12 }}>
                        {llmPullJobs.slice(0, 5).map((job) => (
                          <div key={job.id} style={styles.mountRow}>
                            <div style={styles.mountLeft}>
                              <strong>{job.modelId || job.id}</strong>
                              <p style={styles.mountMeta}>{job.message || 'No status message'}{job.updatedAt ? ` · ${fmtTime(job.updatedAt)}` : ''}</p>
                            </div>
                            <div style={styles.mountRight}>
                              <span style={job.status === 'success' ? styles.storageMetricOk : job.status === 'failed' ? styles.storageMetricDanger : styles.storageMetricWarn}>{job.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </Panel>
        )}

        {activeTab === 'settings' && (
          <Panel
            title="Settings"
            subtitle="Session, logging, and diagnostics controls."
            meta={[`Signed in as ${sessionUser?.username || 'unknown'}`, `Role: ${sessionUser?.role || 'user'}`]}
          >
            <div style={styles.surfaceStack}>
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Appearance & Power</h3>
                <p style={styles.smallLabel}>Theme, polling mode, and onboarding help are managed here instead of the global header.</p>
                <div style={styles.actionWrap}>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={toggleTheme}>Cycle Theme</button>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => setLowPowerMode((current) => !current)}>
                    {lowPowerMode ? 'Disable Low-Power' : 'Enable Low-Power'}
                  </button>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => setShowOnboarding(true)}>Help</button>
                </div>
              </div>

              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Session</h3>
                <p style={styles.smallLabel}>Session access is cookie-based and invalidates on logout or timeout.</p>
                <div style={styles.actionWrap}>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => clearSession()}>Log Out Everywhere Here</button>
                </div>
              </div>

              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Logging</h3>
                <p style={styles.smallLabel}>Verbose mode keeps richer audit and service transition entries in the dashboard log.</p>
                <div style={styles.actionWrap}>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleVerboseLogging(true)}>Enable Verbose</button>
                  <button className="ui-button" style={styles.actionBtn} type="button" onClick={() => toggleVerboseLogging(false)}>Disable Verbose</button>
                </div>
              </div>

              {sessionUser?.role === 'admin' ? (
                <div style={styles.card}>
                  <div style={styles.sectionHeader}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Users</h3>
                    <span style={styles.smallLabel}>{managedUsers.length} managed users</span>
                  </div>
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Username</th>
                          <th style={styles.th}>Role</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managedUsers.length === 0 && (
                          <tr>
                            <td style={styles.td} colSpan={4}>{usersBusy ? 'Loading users…' : 'No users found.'}</td>
                          </tr>
                        )}
                        {managedUsers.map((user) => (
                          <tr key={user.id}>
                            <td style={styles.td}>{user.username}</td>
                            <td style={styles.td}>{user.role}</td>
                            <td style={styles.td}>{user.isDisabled ? 'disabled' : 'active'}</td>
                            <td style={styles.td}>
                              <div style={styles.ftpRowActions}>
                                <button
                                  className="ui-button"
                                  style={styles.actionBtn}
                                  type="button"
                                  disabled={usersBusy || user.username === sessionUser?.username}
                                  onClick={() => void updateManagedUser(user, { role: user.role === 'admin' ? 'user' : 'admin' })}
                                >
                                  {user.role === 'admin' ? 'Make User' : 'Make Admin'}
                                </button>
                                <button
                                  className="ui-button"
                                  style={styles.actionBtn}
                                  type="button"
                                  disabled={usersBusy || user.username === sessionUser?.username}
                                  onClick={() => void updateManagedUser(user, { isDisabled: !user.isDisabled })}
                                >
                                  {user.isDisabled ? 'Enable' : 'Disable'}
                                </button>
                                <button
                                  className="ui-button"
                                  style={styles.actionBtn}
                                  type="button"
                                  disabled={usersBusy}
                                  onClick={() => {
                                    const nextPassword = window.prompt(`Set a new password for ${user.username}`);
                                    if (!nextPassword) {
                                      return;
                                    }
                                    void updateManagedUser(user, { password: nextPassword });
                                  }}
                                >
                                  Reset Password
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ ...styles.sectionHeader, marginTop: 16 }}>
                    <h3 style={{ ...styles.cardTitle, marginBottom: 0 }}>Create User</h3>
                    <span style={styles.smallLabel}>Use this for per-user share grants and controlled read-only access.</span>
                  </div>
                  <div style={styles.ftpActionGroup}>
                    <TextField
                      id="user-create-name"
                      label="Username"
                      name="userCreateName"
                      autoCapitalize="none"
                      autoCorrect="off"
                      autoComplete="username"
                      spellCheck={false}
                      placeholder="guest-user"
                      value={userDraft.username}
                      onChange={(value) => setUserDraft((current) => ({ ...current, username: value }))}
                    />
                    <TextField
                      id="user-create-password"
                      label="Password"
                      name="userCreatePassword"
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder="at least 8 characters"
                      value={userDraft.password}
                      onChange={(value) => setUserDraft((current) => ({ ...current, password: value }))}
                    />
                    <label style={styles.field}>
                      <span style={styles.fieldLabel}>Role</span>
                      <select
                        className="ui-input"
                        value={userDraft.role}
                        onChange={(event) => setUserDraft((current) => ({ ...current, role: event.target.value === 'admin' ? 'admin' : 'user' }))}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <button className="ui-button" style={styles.actionBtn} type="button" disabled={usersBusy} onClick={() => void createManagedUser()}>
                      {usersBusy ? 'Saving…' : 'Create User'}
                    </button>
                  </div>
                  {userStatus ? <p style={{ ...styles.smallLabel, color: userStatus.toLowerCase().includes('unable') || userStatus.toLowerCase().includes('error') ? THEME.crimsonRed : THEME.ok }}>{userStatus}</p> : null}
                </div>
              ) : null}
            </div>
          </Panel>
        )}

      </main>

      {isPhone && (
        <nav aria-label="Dashboard Sections" style={styles.bottomNav}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className="ui-button"
              aria-pressed={activeTab === tab.key}
              aria-label={tab.label}
              style={{ ...styles.bottomNavBtn, ...(activeTab === tab.key ? styles.bottomNavBtnActive : {}) }}
              type="button"
              onClick={() => setActiveTab(tab.key)}
            >
              <span style={styles.bottomNavBtnContent}>
                {navButtonIcon(tab.key)}
                <span style={styles.bottomNavBtnText}>{tab.label}</span>
              </span>
            </button>
          ))}
        </nav>
      )}

      <DialogSurface
        open={activeTab === 'ai' && isPhone && llmHistoryOpen}
        onClose={() => setLlmHistoryOpen(false)}
        overlayStyle={styles.modalOverlay}
        panelStyle={styles.llmHistoryDrawer}
        labelledBy="llm-history-title"
        describedBy="llm-history-help"
      >
        <div style={styles.llmDrawerHead}>
          <h3 id="llm-history-title" style={{ ...styles.cardTitle, marginBottom: 4 }}>Conversation History</h3>
          <p id="llm-history-help" style={styles.smallLabel}>Pick a conversation to load it into chat.</p>
        </div>
        <div style={styles.llmConversationList}>
          {llmConversations.length === 0 ? (
            <p style={styles.smallLabel}>No saved conversations yet.</p>
          ) : llmConversations.map((conversation) => (
            <button
              key={`drawer:${conversation.id}`}
              className="ui-button"
              style={{ ...styles.llmConversationItem, ...(llmConversationId === conversation.id ? styles.llmConversationItemActive : {}) }}
              type="button"
              onClick={() => {
                setLlmConversationId(conversation.id);
                setLlmHistoryOpen(false);
              }}
            >
              <strong>{conversation.title || `Conversation ${conversation.id}`}</strong>
              <span style={styles.mountMeta}>{fmtTime(conversation.updatedAt)}</span>
            </button>
          ))}
        </div>
      </DialogSurface>

      <DialogSurface
        open={showOnboarding}
        onClose={dismissOnboarding}
        overlayStyle={styles.modalOverlay}
        panelStyle={styles.modalCard}
        labelledBy="onboarding-title"
        describedBy="onboarding-help"
      >
        <h3 id="onboarding-title" style={styles.cardTitle}>Welcome to HmSTx</h3>
        <div id="onboarding-help" style={styles.surfaceStack}>
          <div style={styles.quickLink}>
            <strong>Monitor the host</strong>
            <span>Track CPU, memory, storage, and Android-side device health from one screen.</span>
          </div>
          <div style={styles.quickLink}>
            <strong>Operate optional services</strong>
            <span>Unlock the controller once per session, then start, stop, or restart optional services safely.</span>
          </div>
          <div style={styles.quickLink}>
            <strong>Search quickly</strong>
            <span>Use Ctrl/Cmd+K to jump to services, run actions, and open docs without hunting through tabs.</span>
          </div>
          <div style={styles.quickLink}>
            <strong>Use the docs hub</strong>
            <span>The same demo shell links directly to the operator docs, operations runbook, and live NAS roadmap.</span>
          </div>
        </div>
        <div style={{ ...styles.actionWrap, marginTop: 16 }}>
          <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => openExternalLink(DOCS_HUB_URL)}>
            Docs Hub
          </button>
          <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => openExternalLink(ROADMAP_DOC_URL)}>
            Roadmap
          </button>
          <button className="ui-button ui-button--primary" type="button" style={styles.actionBtn} onClick={dismissOnboarding}>
            Get Started
          </button>
        </div>
      </DialogSurface>

      <DialogSurface
        open={Boolean(disconnectTarget)}
        onClose={() => setDisconnectTarget(null)}
        overlayStyle={styles.modalOverlay}
        panelStyle={styles.modalCard}
        labelledBy="disconnect-title"
        describedBy="disconnect-help"
      >
        <h3 id="disconnect-title" style={styles.cardTitle}>Kick session</h3>
        <p id="disconnect-help" style={styles.smallLabel}>
          Kick {disconnectTarget?.username} at {disconnectTarget?.ip} from the dashboard session list?
        </p>
        <div style={styles.actionWrap}>
          <button className="ui-button" type="button" style={styles.actionBtn} onClick={() => setDisconnectTarget(null)}>
            Cancel
          </button>
          <button className="ui-button ui-button--primary" type="button" style={styles.actionBtn} onClick={() => disconnectTarget && void disconnectConnection(disconnectTarget)}>
            Confirm
          </button>
        </div>
      </DialogSurface>
    </div>
  );
}

type TextFieldProps = {
  autoComplete?: string;
  autoCapitalize?: InputHTMLAttributes<HTMLInputElement>['autoCapitalize'];
  autoCorrect?: InputHTMLAttributes<HTMLInputElement>['autoCorrect'];
  id: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder?: string;
  spellCheck?: boolean;
  type?: InputHTMLAttributes<HTMLInputElement>['type'];
  value: string;
};

function TextField({
  autoComplete = 'off',
  autoCapitalize,
  autoCorrect,
  id,
  inputMode,
  label,
  name,
  onChange,
  placeholder,
  spellCheck = false,
  type = 'text',
  value,
}: TextFieldProps) {
  return (
    <label htmlFor={id} style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <input
        className="ui-input"
        id={id}
        inputMode={inputMode}
        name={name}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        placeholder={placeholder}
        spellCheck={spellCheck}
        style={styles.input}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(value, 100));
  const fill = safeValue >= 85 ? THEME.crimsonRed : safeValue >= 70 ? THEME.brightYellow : THEME.accent;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={styles.progressLabel}>
        <span>{label}</span>
        <span>{safeValue.toFixed(0)}%</span>
      </div>
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, background: fill, width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

function EmbeddedToolPanel({
  title,
  subtitle,
  meta = [],
  frameTitle,
  path,
  gatewayBase,
  isCompact,
  demoMode,
}: {
  title: string;
  subtitle?: string;
  meta?: string[];
  frameTitle: string;
  path: string;
  gatewayBase: string;
  isCompact: boolean;
  demoMode: boolean;
}) {
  const frameSrc = gatewayBase ? `${gatewayBase}${path}` : '';

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      meta={meta}
      action={gatewayBase ? (
        <a href={frameSrc} target="_blank" rel="noreferrer" className="ui-button" style={styles.linkBtn}>
          Open In New Tab
        </a>
      ) : (
        <span style={styles.smallLabel}>Resolving gateway…</span>
      )}
    >
      {demoMode ? (
        <div style={{ ...styles.framePlaceholder, ...(isCompact ? styles.frameCompact : {}) }} role="img" aria-label="Demo terminal output">
          <pre style={styles.demoTerminal}>{getDemoTerminalLines().join('\n')}</pre>
        </div>
      ) : gatewayBase ? (
        <iframe title={frameTitle} src={frameSrc} style={{ ...styles.frame, ...(isCompact ? styles.frameCompact : {}) }} />
      ) : (
        <div style={styles.framePlaceholder} role="status" aria-live="polite">
          Gateway is still resolving. This view will load automatically.
        </div>
      )}
    </Panel>
  );
}

function Panel({
  title,
  subtitle,
  meta = [],
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: string[];
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div style={styles.pageHeader}>
        <div style={styles.pageHeaderCopy}>
          <h1 style={styles.title}>{title}</h1>
          {subtitle ? <p style={styles.panelSubtitle}>{subtitle}</p> : null}
        </div>
        {(meta.length > 0 || action) ? (
          <div style={styles.pageHeaderSide}>
            {meta.length > 0 ? (
              <div style={styles.headerMeta}>
                {meta.map((item) => (
                  <span key={item} style={styles.headerPill}>{item}</span>
                ))}
              </div>
            ) : null}
            {action ? <div style={styles.pageHeaderAction}>{action}</div> : null}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function drawTrend(canvas: HTMLCanvasElement | null, data: number[], stroke: string, fill: string) {
  if (!canvas || data.length === 0) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  const max = 100;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#121519';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i += 1) {
    const y = (h / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(184,139,69,0.45)';
  ctx.beginPath();
  ctx.moveTo(0, h - (70 / max) * (h - 12) - 6);
  ctx.lineTo(w, h - (70 / max) * (h - 12) - 6);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '11px var(--font-geist-mono), monospace';
  ctx.fillText('100%', 8, 14);
  ctx.fillText('50%', 8, h / 2);
  ctx.fillText('0%', 8, h - 8);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.beginPath();

  data.forEach((val, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - (val / max) * (h - 12) - 6;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.28;
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = stroke;
  data.forEach((val, i) => {
    if (i % 5 !== 0 && i !== data.length - 1) {
      return;
    }

    const x = (i / Math.max(data.length - 1, 1)) * w;
    const y = h - (val / max) * (h - 12) - 6;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

const styles: Record<string, CSSProperties> = {
  loading: {
    minHeight: '100dvh',
    display: 'grid',
    placeItems: 'center',
    background: THEME.bg,
    color: THEME.text,
    padding: 24,
  },
  skeletonShell: {
    width: 'min(1120px, 100%)',
    display: 'grid',
    gap: 16,
  },
  skeletonHeader: {
    height: 44,
    borderRadius: 10,
    border: `1px solid ${THEME.border}`,
    background: THEME.panel,
    animation: 'hmstx-pulse 1.4s ease-in-out infinite',
  },
  skeletonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16,
  },
  skeletonSplit: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 16,
  },
  skeletonCard: {
    minHeight: 88,
    borderRadius: 10,
    border: `1px solid ${THEME.border}`,
    background: THEME.panel,
    animation: 'hmstx-pulse 1.4s ease-in-out infinite',
  },
  loginShell: {
    minHeight: '100dvh',
    background: THEME.bg,
    display: 'grid',
    placeItems: 'center',
    padding: 24,
  },
  loginCard: {
    width: '100%',
    maxWidth: 360,
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 24,
  },
  field: {
    display: 'grid',
    gap: 6,
    marginBottom: 12,
  },
  fieldLabel: {
    color: THEME.muted,
    fontSize: 13,
  },
  input: {
    width: '100%',
    marginBottom: 0,
  },
  infoText: {
    color: THEME.muted,
    fontSize: 12,
    marginTop: 0,
    marginBottom: 12,
  },
  errorText: {
    color: THEME.crimsonRed,
    fontSize: 12,
    marginTop: 0,
    marginBottom: 12,
  },
  loginBtn: {
    width: '100%',
    fontWeight: 600,
  },
  app: {
    minHeight: '100dvh',
    display: 'flex',
    background: THEME.bg,
    color: THEME.text,
    overflowX: 'hidden',
    fontFamily: 'var(--font-geist-sans), sans-serif',
  },
  appTablet: { minHeight: '100dvh' },
  appPhone: {
    minHeight: '100dvh',
    paddingBottom: 76,
  },
  sidebar: {
    width: 248,
    minHeight: '100dvh',
    borderRight: `1px solid ${THEME.border}`,
    padding: 16,
    background: '#15181c',
    overflowY: 'auto',
  },
  sidebarTablet: {
    width: 72,
    padding: 12,
  },
  brand: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 18,
    color: THEME.text,
    whiteSpace: 'nowrap',
  },
  navGroup: { display: 'flex', flexDirection: 'column', gap: 8 },
  navGroupTablet: { gap: 6 },
  navBtn: {
    padding: '10px 12px',
    textAlign: 'left',
    fontWeight: 500,
    justifyContent: 'flex-start',
  },
  navBtnTablet: {
    width: '100%',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '10px 6px',
    fontSize: 12,
  },
  navBtnActive: {
    background: THEME.panelRaised,
    color: THEME.text,
    borderColor: THEME.border,
  },
  logoutBtn: { marginTop: 14 },
  navButtonContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  navButtonContentTablet: {
    flexDirection: 'column',
    gap: 6,
  },
  navButtonText: {
    minWidth: 0,
  },
  navIcon: {
    width: 18,
    height: 18,
    flexShrink: 0,
    color: 'currentColor',
  },
  main: { flex: 1, minHeight: 0, padding: 24, overflowY: 'auto' },
  mainTablet: { padding: 18 },
  mainPhone: { padding: 16, overflowY: 'visible' },
  utilityBar: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  searchShell: {
    position: 'relative',
    flex: '1 1 auto',
    minWidth: 0,
    width: '100%',
  },
  searchShellCompact: {
    width: '100%',
  },
  searchResults: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    left: 0,
    right: 0,
    zIndex: 30,
    display: 'grid',
    gap: 6,
    padding: 10,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    background: '#101314',
    boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
    maxHeight: 340,
    overflowY: 'auto',
  },
  searchResultsCompact: {
    gap: 8,
    padding: 8,
    borderRadius: 12,
  },
  searchResultItem: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '9px 10px',
    borderRadius: 6,
    background: '#161a1f',
    fontFamily: 'var(--font-geist-mono), monospace',
    fontSize: 12,
  },
  searchResultItemCompact: {
    gridTemplateColumns: 'minmax(0, 1fr)',
    justifyItems: 'start',
    gap: 4,
    padding: '10px 12px',
  },
  searchResultItemActive: {
    background: '#1f252c',
    borderColor: THEME.accent,
  },
  searchResultLabel: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    textAlign: 'left',
  },
  searchResultMeta: {
    color: THEME.muted,
    fontSize: 11,
    whiteSpace: 'nowrap',
    textAlign: 'right',
  },
  searchResultMetaCompact: {
    whiteSpace: 'normal',
    textAlign: 'left',
  },
  searchEmpty: {
    margin: 0,
    color: THEME.muted,
    fontSize: 12,
    fontFamily: 'var(--font-geist-mono), monospace',
  },
  utilityMeta: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  utilityActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: { margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: THEME.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  homeTitle: { marginBottom: 2, fontSize: 22 },
  panelSubtitle: { margin: '0 0 16px', color: THEME.muted, fontSize: 12, maxWidth: 680, overflowWrap: 'anywhere' },
  pageHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  pageHeaderCopy: {
    minWidth: 0,
    flex: '1 1 420px',
  },
  pageHeaderSide: {
    display: 'grid',
    justifyItems: 'end',
    gap: 10,
    minWidth: 0,
  },
  pageHeaderAction: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  headerBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  homeHeaderBar: {
    gap: 12,
    marginBottom: 14,
  },
  headerMeta: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  homeHeaderMeta: {
    gap: 6,
  },
  headerPill: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: THEME.panel,
    color: THEME.muted,
    fontSize: 12,
    padding: '6px 10px',
  },
  homeHeaderPill: {
    fontSize: 11,
    padding: '5px 9px',
  },
  headerPillOk: {
    color: '#cfe8cf',
    borderColor: 'rgba(111, 159, 112, 0.4)',
    background: 'rgba(111, 159, 112, 0.16)',
    boxShadow: 'inset 0 0 0 1px rgba(111, 159, 112, 0.08)',
  },
  headerPillWarn: {
    color: '#f0cf8c',
    borderColor: 'rgba(184, 139, 69, 0.42)',
    background: 'rgba(184, 139, 69, 0.18)',
    boxShadow: 'inset 0 0 0 1px rgba(184, 139, 69, 0.1)',
  },
  headerPillDanger: {
    color: '#f2bbbb',
    borderColor: 'rgba(196, 91, 91, 0.42)',
    background: 'rgba(196, 91, 91, 0.16)',
    boxShadow: 'inset 0 0 0 1px rgba(196, 91, 91, 0.08)',
  },
  demoInfoBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
    padding: '10px 12px',
    border: `1px solid rgba(111, 159, 112, 0.32)`,
    borderRadius: 10,
    background: 'linear-gradient(90deg, rgba(111, 159, 112, 0.12), rgba(17, 19, 21, 0.92))',
    boxShadow: 'inset 0 0 0 1px rgba(111, 159, 112, 0.06)',
    color: THEME.text,
  },
  demoInfoBarCompact: {
    alignItems: 'flex-start',
  },
  demoInfoIntro: {
    minWidth: 0,
    display: 'grid',
    gap: 2,
  },
  demoInfoTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#d5e8d6',
  },
  demoInfoText: {
    fontSize: 12,
    color: THEME.muted,
  },
  demoInfoMeta: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  demoInfoPill: {
    border: `1px solid rgba(111, 159, 112, 0.26)`,
    borderRadius: 999,
    background: 'rgba(17, 19, 21, 0.74)',
    color: THEME.text,
    fontSize: 11,
    padding: '5px 9px',
    fontFamily: 'var(--font-geist-mono), monospace',
    lineHeight: 1.35,
  },
  bannerWarn: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    padding: '10px 12px',
    border: `1px solid rgba(184, 139, 69, 0.42)`,
    borderRadius: 10,
    background: 'rgba(184, 139, 69, 0.16)',
    boxShadow: 'inset 0 0 0 1px rgba(184, 139, 69, 0.08)',
    color: THEME.text,
  },
  bannerAlert: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    padding: '10px 12px',
    border: `1px solid rgba(196, 91, 91, 0.42)`,
    borderRadius: 10,
    background: 'rgba(196, 91, 91, 0.16)',
    boxShadow: 'inset 0 0 0 1px rgba(196, 91, 91, 0.08)',
    color: THEME.text,
  },
  homeLayout: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 16,
    minHeight: 'calc(100dvh - 168px)',
  },
  homeLayoutDense: {
    gap: 14,
  },
  homeLayoutCompact: {
    flexDirection: 'column',
    minHeight: 'auto',
  },
  homePrimary: {
    flex: '1 1 58%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  homeSecondary: {
    flex: '1 1 42%',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  homeColumnDense: {
    gap: 14,
  },
  card: {
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 16,
  },
  homeCard: {
    padding: 14,
  },
  cardTitle: { margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: THEME.text },
  homeCardTitle: { marginBottom: 10, fontSize: 14 },
  smallLabel: { margin: '0 0 8px', color: THEME.muted, fontSize: 12, overflowWrap: 'anywhere' },
  homeSmallLabel: { marginBottom: 6, fontSize: 11, lineHeight: 1.4 },
  codeLine: {
    margin: '0 0 8px',
    color: THEME.muted,
    fontSize: 12,
    overflowWrap: 'anywhere',
  },
  keyValueGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
    marginBottom: 16,
  },
  homeKeyValueGrid: {
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 6,
    marginBottom: 14,
  },
  keyValueRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
  },
  homeKeyValueRow: {
    gap: 8,
    padding: '7px 9px',
  },
  keyLabel: {
    color: THEME.muted,
    fontSize: 12,
  },
  systemValueCompact: {
    fontSize: 12,
  },
  networkDivider: {
    color: THEME.muted,
  },
  trendStack: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
  },
  homeTrendStack: {
    gap: 10,
  },
  canvas: {
    width: '100%',
    height: 156,
    borderRadius: 8,
    border: `1px solid ${THEME.border}`,
    background: '#121519',
  },
  progressLabel: { display: 'flex', justifyContent: 'space-between', color: THEME.muted, fontSize: 12, marginBottom: 6 },
  progressTrack: { height: 8, borderRadius: 999, background: '#242930', overflow: 'hidden' },
  progressFill: { height: '100%', background: THEME.accent, transition: 'width 220ms ease, background-color 180ms ease' },
  serviceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 10,
    borderBottom: `1px solid ${THEME.border}`,
    gap: 8,
  },
  serviceRowCompact: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  serviceRowCopy: {
    display: 'grid',
    gap: 4,
    minWidth: 0,
    flex: '1 1 auto',
  },
  serviceRowMeta: {
    color: THEME.muted,
    fontSize: 12,
    overflowWrap: 'anywhere',
  },
  serviceName: { textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 8 },
  serviceControllerCard: {
    position: 'relative',
    display: 'grid',
    gap: 10,
  },
  serviceLockOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 2,
    display: 'grid',
    alignContent: 'center',
    gap: 10,
    padding: 16,
    background: 'rgba(17, 19, 21, 0.86)',
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
  },
  serviceLockBadge: {
    width: 'fit-content',
    padding: '4px 8px',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: THEME.panelRaised,
    color: THEME.text,
    fontSize: 12,
    fontWeight: 600,
  },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  actionWrap: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  actionWrapCompact: {
    width: '100%',
    justifyContent: 'flex-start',
  },
  actionBtn: {
    padding: '7px 10px',
    fontSize: 12,
  },
  llmModeBtnActive: {
    borderColor: THEME.accent,
    background: 'rgba(111, 159, 112, 0.14)',
    color: THEME.text,
  },
  llmModelSelect: {
    minHeight: 36,
    minWidth: 200,
    maxWidth: 320,
    padding: '6px 10px',
    fontSize: 12,
  },
  surfaceStack: {
    display: 'grid',
    gap: 16,
  },
  llmSubnav: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  llmSubnavBtn: {
    minHeight: 38,
    padding: '6px 12px',
    fontSize: 12,
  },
  llmSubnavBtnActive: {
    borderColor: THEME.accent,
    background: 'rgba(111, 159, 112, 0.14)',
    color: THEME.text,
  },
  llmChatHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  llmWorkspace: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)',
    gap: 12,
    alignItems: 'stretch',
  },
  llmWorkspaceCompact: {
    gridTemplateColumns: '1fr',
  },
  llmRail: {
    display: 'grid',
    gap: 8,
    alignContent: 'start',
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    background: '#13171b',
    padding: 10,
    maxHeight: '68dvh',
    overflowY: 'auto',
  },
  llmConversationList: {
    display: 'grid',
    gap: 8,
    alignContent: 'start',
  },
  llmConversationItem: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    textAlign: 'left',
    display: 'grid',
    gap: 4,
    width: '100%',
    padding: '10px 12px',
    minHeight: 0,
  },
  llmConversationItemActive: {
    borderColor: THEME.accent,
    background: 'rgba(111, 159, 112, 0.14)',
  },
  llmChatShell: {
    display: 'grid',
    gridTemplateRows: 'minmax(0, 1fr) auto',
    gap: 10,
    minHeight: 460,
  },
  llmThread: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    background: '#111418',
    padding: 12,
    display: 'grid',
    alignContent: 'start',
    gap: 10,
    maxHeight: '68dvh',
    overflowY: 'auto',
  },
  llmThreadEmpty: {
    margin: 0,
    color: THEME.muted,
    fontSize: 13,
  },
  llmMessageRow: {
    display: 'flex',
    justifyContent: 'flex-start',
  },
  llmMessageRowUser: {
    justifyContent: 'flex-end',
  },
  llmMessageBubble: {
    width: 'min(760px, 100%)',
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    padding: '10px 12px',
    display: 'grid',
    gap: 8,
  },
  llmMessageBubbleAssistant: {
    background: '#161b20',
  },
  llmMessageBubbleUser: {
    background: 'rgba(111, 159, 112, 0.12)',
    borderColor: 'rgba(111, 159, 112, 0.38)',
  },
  llmMessageMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  llmMessageBody: {
    display: 'grid',
    gap: 8,
  },
  llmMessageText: {
    margin: 0,
    color: THEME.text,
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  llmCodeBlock: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    overflow: 'hidden',
    background: '#0f1216',
  },
  llmCodeHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    borderBottom: `1px solid ${THEME.border}`,
    background: '#141920',
  },
  llmCodeLanguage: {
    color: THEME.muted,
    fontSize: 11,
    fontFamily: 'var(--font-geist-mono), monospace',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  },
  llmCodeBody: {
    margin: 0,
    padding: '10px 12px',
    color: '#d8e0d0',
    fontSize: 12,
    lineHeight: 1.55,
    overflowX: 'auto',
    fontFamily: 'var(--font-geist-mono), monospace',
    whiteSpace: 'pre',
  },
  llmMessageActions: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  llmTinyBtn: {
    minHeight: 30,
    minWidth: 0,
    padding: '5px 10px',
    fontSize: 11,
  },
  llmComposer: {
    display: 'grid',
    gap: 8,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    background: '#14181d',
    padding: 10,
    position: 'sticky',
    bottom: 0,
  },
  llmComposerInput: {
    minHeight: 102,
    resize: 'vertical',
  },
  llmComposerActions: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  llmHistoryDrawer: {
    width: '100%',
    maxWidth: 420,
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 14,
    display: 'grid',
    gap: 10,
    maxHeight: '70dvh',
    overflowY: 'auto',
  },
  llmDrawerHead: {
    display: 'grid',
    gap: 2,
  },
  mediaWorkflowGrid: {
    display: 'flex',
    alignItems: 'stretch',
    overflowX: 'auto',
    gap: 0,
    padding: '2px 8px 8px 2px',
    scrollSnapType: 'x mandatory',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'thin',
  },
  mediaWorkflowGridCompact: {
    paddingBottom: 6,
  },
  mediaWorkflowStep: {
    display: 'grid',
    gap: 8,
    padding: '12px 14px',
    minWidth: 294,
    maxWidth: 364,
    flex: '0 0 min(364px, 90vw)',
    textAlign: 'left',
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    scrollSnapAlign: 'start',
    position: 'relative',
    animation: 'hmstx-rise 220ms ease both',
  },
  mediaWorkflowStepTall: {
    height: 640,
    alignContent: 'start',
  },
  mediaWorkflowStepTallCompact: {
    height: 600,
    alignContent: 'start',
  },
  mediaWorkflowStepOverlap: {
    marginLeft: -12,
  },
  mediaWorkflowStepCascadeEven: {
    marginTop: 0,
  },
  mediaWorkflowStepCascadeOdd: {
    marginTop: 6,
  },
  mediaWorkflowStepActive: {
    borderColor: 'rgba(111, 159, 112, 0.42)',
    boxShadow: 'inset 0 0 0 1px rgba(111, 159, 112, 0.08)',
    background: '#15191d',
  },
  mediaWorkflowStepHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  mediaWorkflowStepLabel: {
    color: THEME.text,
    fontSize: 13,
    fontWeight: 700,
  },
  mediaWorkflowStepSummary: {
    margin: 0,
    color: THEME.muted,
    fontSize: 12,
    lineHeight: 1.35,
  },
  mediaWorkflowStepList: {
    margin: 0,
    paddingLeft: 18,
    display: 'grid',
    gap: 4,
  },
  mediaWorkflowStepListItem: {
    color: THEME.text,
    fontSize: 12,
    lineHeight: 1.35,
  },
  mediaWorkflowStepMeta: {
    color: THEME.muted,
    fontSize: 11,
    fontFamily: 'var(--font-geist-mono), monospace',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  mediaWorkspaceGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
    gap: 16,
    alignItems: 'start',
  },
  mediaWorkspaceGridCompact: {
    gridTemplateColumns: '1fr',
  },
  mediaFeatureShell: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gap: 14,
    alignItems: 'start',
  },
  mediaFeatureShellCompact: {
    gridTemplateColumns: '1fr',
    gap: 12,
  },
  mediaFeatureCopy: {
    minWidth: 0,
    display: 'grid',
    gap: 10,
  },
  mediaFeatureHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
  },
  mediaFeatureTitleBlock: {
    minWidth: 0,
    display: 'grid',
    gap: 6,
  },
  mediaFeatureTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: THEME.text,
  },
  mediaFeatureBody: {
    margin: 0,
    color: THEME.muted,
    fontSize: 13,
    lineHeight: 1.55,
  },
  mediaInfoList: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  mediaInfoItem: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 28,
    padding: '4px 10px',
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: '#15181c',
    color: THEME.text,
    fontSize: 11,
    lineHeight: 1.3,
  },
  mediaSideStack: {
    minWidth: 0,
    display: 'grid',
    gap: 16,
  },
  mediaMiniSection: {
    display: 'grid',
    gap: 10,
  },
  mediaChecklist: {
    display: 'grid',
    gap: 10,
  },
  mediaChecklistRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    padding: '12px 14px',
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
  },
  mediaChecklistCopy: {
    minWidth: 0,
    flex: '1 1 280px',
    display: 'grid',
    gap: 4,
  },
  mediaChecklistTitle: {
    margin: 0,
    color: THEME.text,
    fontSize: 13,
    fontWeight: 600,
  },
  mediaChecklistBody: {
    margin: 0,
    color: THEME.muted,
    fontSize: 12,
    lineHeight: 1.5,
  },
  mediaSupportMeta: {
    display: 'grid',
    gap: 8,
    marginTop: 14,
  },
  mediaSectionIntro: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  serviceGroupStack: {
    display: 'grid',
    gap: 14,
  },
  homeServiceGroupStack: {
    gap: 12,
  },
  serviceGroupSection: {
    display: 'grid',
    gap: 10,
  },
  serviceGroupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  serviceGroupTitle: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    color: THEME.text,
  },
  groupToggle: {
    padding: '8px 10px',
    fontSize: 12,
  },
  homeGroupToggle: {
    padding: '7px 9px',
    fontSize: 11,
  },
  serviceCardGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: 12,
  },
  collapsedSection: {
    display: 'none',
  },
  serviceCard: {
    width: '100%',
    display: 'grid',
    gap: 0,
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    overflow: 'hidden',
  },
  mediaClusterCard: {
    width: '100%',
    display: 'grid',
    gap: 0,
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    overflow: 'hidden',
  },
  serviceCardShell: {
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    flexWrap: 'wrap',
  },
  serviceCardShellCompact: {
    gap: 10,
    padding: 12,
  },
  serviceCardCopy: {
    flex: '1 1 420px',
    minWidth: 0,
    display: 'grid',
    gap: 8,
  },
  serviceCardCopyCompact: {
    flex: '1 1 100%',
  },
  serviceCardHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
  },
  serviceCardHeadCompact: {
    gap: 8,
  },
  serviceCardTitleBlock: {
    minWidth: 0,
    display: 'grid',
    gap: 6,
  },
  serviceCardTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: THEME.text,
  },
  serviceCardDescription: {
    margin: 0,
    color: THEME.muted,
    fontSize: 13,
    lineHeight: 1.5,
  },
  serviceCardReason: {
    margin: 0,
    color: THEME.muted,
    fontSize: 12,
    lineHeight: 1.45,
  },
  serviceCardRail: {
    flex: '0 0 auto',
    minWidth: 0,
    display: 'flex',
    gap: 6,
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  serviceCardRailCompact: {
    width: '100%',
    justifyContent: 'flex-start',
  },
  serviceQuickLabel: {
    margin: 0,
    color: THEME.muted,
    fontSize: 11,
    fontFamily: 'var(--font-geist-mono), monospace',
  },
  serviceBadgeRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  serviceBadgeRowCompact: {
    gap: 5,
  },
  serviceMiniBadge: {
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 11,
    lineHeight: 1.1,
    border: `1px solid ${THEME.border}`,
    whiteSpace: 'nowrap',
  },
  serviceMiniBadgeMuted: {
    color: THEME.muted,
    background: '#15181c',
  },
  serviceActionBtn: {
    minHeight: 36,
    minWidth: 72,
    padding: '7px 12px',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
    borderRadius: 999,
    textDecoration: 'none',
  },
  supportList: {
    display: 'grid',
    gap: 6,
  },
  supportLabel: {
    color: THEME.muted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  supportToggleList: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
  },
  supportToggleListCompact: {
    display: 'grid',
    gap: 8,
  },
  supportCheckbox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    border: `1px solid ${THEME.border}`,
    borderRadius: 999,
    background: '#15181c',
    fontSize: 12,
  },
  serviceStatusBadge: {
    borderRadius: 8,
    padding: '4px 8px',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    border: `1px solid ${THEME.border}`,
  },
  serviceStatusOk: {
    color: '#cfe8cf',
    background: 'rgba(111, 159, 112, 0.16)',
    borderColor: 'rgba(111, 159, 112, 0.42)',
    boxShadow: 'inset 0 0 0 1px rgba(111, 159, 112, 0.08)',
  },
  serviceStatusIdle: {
    color: THEME.muted,
    background: '#15181c',
    borderColor: 'rgba(96, 103, 112, 0.22)',
  },
  serviceStatusWarn: {
    color: '#f0cf8c',
    background: 'rgba(184, 139, 69, 0.18)',
    borderColor: 'rgba(184, 139, 69, 0.44)',
    boxShadow: 'inset 0 0 0 1px rgba(184, 139, 69, 0.08)',
  },
  serviceStatusUnavailable: {
    color: '#f2bbbb',
    background: 'rgba(196, 91, 91, 0.18)',
    borderColor: 'rgba(196, 91, 91, 0.44)',
    boxShadow: 'inset 0 0 0 1px rgba(196, 91, 91, 0.08)',
  },
  storageMetric: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 48,
    padding: '2px 8px',
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: '#15181c',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  storageMetricOk: {
    color: '#cfe8cf',
    borderColor: 'rgba(111, 159, 112, 0.38)',
    background: 'rgba(111, 159, 112, 0.14)',
  },
  storageMetricWarn: {
    color: '#f0cf8c',
    borderColor: 'rgba(184, 139, 69, 0.42)',
    background: 'rgba(184, 139, 69, 0.16)',
  },
  storageMetricDanger: {
    color: '#f2bbbb',
    borderColor: 'rgba(196, 91, 91, 0.42)',
    background: 'rgba(196, 91, 91, 0.16)',
  },
  mountList: { display: 'grid', gap: 8 },
  mountLeft: { minWidth: 0, flex: '1 1 220px' },
  mountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: '8px 10px',
    gap: 10,
  },
  homeMountRow: {
    padding: '7px 9px',
    gap: 8,
  },
  mountRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  mountMeta: { margin: 0, fontSize: 12, color: THEME.muted, overflowWrap: 'anywhere' },
  homeMountMeta: { fontSize: 11 },
  logControlRow: { marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  homeLogControlRow: { marginBottom: 8, gap: 8 },
  logFilters: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  homeLogFilters: {
    gap: 6,
    marginBottom: 8,
  },
  logBoxCompact: {
    maxHeight: 320,
    overflow: 'auto',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: '8px 10px',
    background: '#121519',
    fontFamily: 'monospace',
  },
  homeLogBox: {
    maxHeight: 300,
    padding: '7px 9px',
  },
  markdownBoxCompact: {
    margin: '10px 0 0',
    maxHeight: 180,
    overflow: 'auto',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: '10px 12px',
    background: '#121519',
    color: '#d6dbd0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  homeMarkdownBox: {
    marginTop: 8,
    maxHeight: 160,
    padding: '8px 10px',
    fontSize: 11,
  },
  logLine: { margin: '0 0 3px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' },
  homeLogLine: { marginBottom: 2, fontSize: 11, gap: 6 },
  logTime: { color: THEME.muted, minWidth: 72 },
  logLevel: { fontWeight: 700, minWidth: 42 },
  tableWrap: { width: '100%', overflowX: 'auto' },
  tableWrapTight: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  homeTable: { fontSize: 12 },
  th: {
    color: THEME.muted,
    fontWeight: 500,
    textAlign: 'left',
    padding: '0 10px 10px',
    borderBottom: `1px solid ${THEME.border}`,
    whiteSpace: 'nowrap',
  },
  homeTh: {
    padding: '0 8px 8px',
    fontSize: 12,
  },
  td: {
    background: 'transparent',
    borderBottom: `1px solid ${THEME.border}`,
    padding: '10px',
    color: THEME.text,
    verticalAlign: 'top',
    overflowWrap: 'anywhere',
  },
  homeTd: {
    padding: '8px',
    fontSize: 12,
  },
  tableCellNoWrap: {
    whiteSpace: 'nowrap',
    overflowWrap: 'normal',
  },
  frame: {
    width: '100%',
    minHeight: 480,
    height: 'calc(100dvh - 184px)',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: '#121519',
  },
  frameCompact: {
    minHeight: 520,
    height: '70dvh',
  },
  framePlaceholder: {
    minHeight: 320,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: '#121519',
    color: THEME.muted,
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    textAlign: 'center',
  },
  demoTerminal: {
    margin: 0,
    width: '100%',
    minHeight: 300,
    padding: 20,
    overflowX: 'auto',
    borderRadius: 8,
    background: '#101314',
    color: '#dfe7d7',
    fontFamily: 'var(--font-geist-mono), monospace',
    fontSize: 13,
    lineHeight: 1.6,
    textAlign: 'left',
  },
  panelActions: { marginBottom: 10 },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  homeSectionHeader: {
    gap: 8,
    marginBottom: 10,
  },
  ftpWorkspace: {
    display: 'grid',
    gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)',
    gap: 16,
    alignItems: 'start',
  },
  ftpWorkspaceCompact: {
    gridTemplateColumns: '1fr',
  },
  ftpSidebar: {
    display: 'grid',
    gap: 16,
    minWidth: 0,
  },
  ftpMain: {
    display: 'grid',
    gap: 16,
    minWidth: 0,
  },
  ftpGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 },
  ftpFormGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  ftpActionGroup: { display: 'grid', gap: 10, marginTop: 12 },
  ftpFavouriteList: {
    display: 'grid',
    gap: 10,
  },
  ftpFavouriteRow: {
    display: 'grid',
    gap: 10,
    padding: '10px 12px',
    background: THEME.panelRaised,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
  },
  ftpFavouriteRowActive: {
    borderColor: THEME.accent,
  },
  ftpFavouriteMeta: {
    minWidth: 0,
  },
  ftpFavouriteHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  ftpBadge: {
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 11,
    border: `1px solid ${THEME.border}`,
    whiteSpace: 'nowrap',
  },
  ftpBadgeMounted: {
    color: THEME.ok,
    background: 'rgba(111, 159, 112, 0.12)',
    borderColor: 'rgba(111, 159, 112, 0.32)',
  },
  ftpBadgeError: {
    color: THEME.crimsonRed,
    background: 'rgba(196, 91, 91, 0.12)',
    borderColor: 'rgba(196, 91, 91, 0.32)',
  },
  ftpBadgeIdle: {
    color: THEME.muted,
    background: '#15181c',
  },
  ftpRowActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
  },
  ftpMenuCell: {
    position: 'relative',
  },
  ftpMenuButton: {
    minWidth: 36,
    padding: '7px 10px',
    fontSize: 12,
    letterSpacing: 1,
  },
  ftpMenu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    minWidth: 160,
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    padding: 6,
    display: 'grid',
    gap: 4,
    zIndex: 20,
    boxShadow: '0 8px 24px rgba(0,0,0,0.24)',
  },
  ftpMenuItem: {
    justifyContent: 'flex-start',
    width: '100%',
    padding: '8px 10px',
    fontSize: 12,
  },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: THEME.text, fontSize: 13 },
  linkBtn: {
    display: 'inline-block',
    padding: '8px 12px',
    fontSize: 13,
    textDecoration: 'none',
  },
  quickLink: {
    display: 'grid',
    gap: 3,
    padding: '10px 12px',
    border: `1px solid ${THEME.border}`,
    borderRadius: 8,
    background: THEME.panelRaised,
    color: THEME.text,
    textDecoration: 'none',
  },
  bottomNav: {
    position: 'fixed',
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    display: 'grid',
    gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))`,
    gap: 8,
    padding: '10px 10px calc(14px + env(safe-area-inset-bottom, 0px))',
    borderTop: `1px solid ${THEME.border}`,
    background: '#15181c',
  },
  bottomNavBtn: {
    minHeight: 58,
    padding: '8px 6px',
    justifyContent: 'center',
    fontSize: 12,
  },
  bottomNavBtnContent: {
    display: 'grid',
    gap: 4,
    placeItems: 'center',
    lineHeight: 1,
    width: '100%',
  },
  bottomNavBtnText: {
    fontSize: 10,
    lineHeight: 1.15,
    textAlign: 'center',
  },
  bottomNavBtnActive: {
    background: THEME.panelRaised,
    borderColor: THEME.border,
    color: THEME.text,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(7, 8, 10, 0.72)',
    display: 'grid',
    placeItems: 'center',
    zIndex: 90,
    padding: 16,
    overscrollBehavior: 'contain',
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    background: THEME.panel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 10,
    padding: 16,
  },
  paletteList: {
    display: 'grid',
    gap: 8,
    marginTop: 12,
    maxHeight: 360,
    overflowY: 'auto',
  },
  paletteItem: {
    justifyContent: 'space-between',
    width: '100%',
    padding: '10px 12px',
  },
  paletteItemActive: {
    background: THEME.panelRaised,
    borderColor: THEME.accent,
  },
};
