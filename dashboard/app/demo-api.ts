'use client';

import { getBasePath, isDemoMode, withBasePath } from './demo-mode';

type DemoLog = {
  id?: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  meta?: unknown;
  timestamp: string;
};

type DemoUser = {
  createdAt: string;
  id: number;
  isDisabled: boolean;
  role: 'admin' | 'user';
  updatedAt: string;
  username: string;
};

type DemoSharePermission = {
  accessLevel: 'deny' | 'read' | 'write';
  subjectKey: string;
  subjectType: 'role' | 'user';
};

type DemoShare = {
  createdAt: string;
  description: string;
  id: number;
  isHidden: boolean;
  isReadOnly: boolean;
  name: string;
  pathKey: string;
  permissions: DemoSharePermission[];
  sourceType: string;
  updatedAt: string;
};

type DemoFsNode = {
  modifiedAt: string;
  name: string;
  path: string;
  size: number;
  type: 'directory' | 'file';
};

type DemoFsOperation = {
  createdAt: string;
  destinationPath: string;
  failureCount: number;
  failures: Array<{ error: string; path: string }>;
  id: string;
  kind: 'upload' | 'copy' | 'move' | 'delete';
  manifest: Array<{ lastModified: number; relativePath: string; size: number }>;
  message: string;
  processedBytes: number;
  processedItems: number;
  sourcePaths: string[];
  status: 'queued' | 'receiving' | 'running' | 'cancelling' | 'success' | 'partial' | 'failed' | 'cancelled';
  totalBytes: number;
  totalItems: number;
  updatedAt: string;
  uploadedFiles: string[];
};

type DemoFtpMountState = {
  error?: string;
  mountName: string;
  mountPoint: string;
  mounted: boolean;
  pid?: number | null;
  remoteName: string;
  running: boolean;
  state: 'mounted' | 'starting' | 'error' | 'unmounted';
};

type DemoFtpFavourite = {
  createdAt: string;
  host: string;
  id: number;
  mount: DemoFtpMountState;
  mountName: string;
  name: string;
  password: string;
  port: number;
  protocol: string;
  remotePath: string;
  secure: boolean;
  updatedAt: string;
  username: string;
};

type DemoRemoteNode = {
  modifiedAt: string;
  name: string;
  path: string;
  size: number;
  type: 'directory' | 'file';
};

type DemoServiceCatalogEntry = {
  available: boolean;
  avgLatencyMs?: number | null;
  blockedBy?: string;
  blockedReason?: string;
  blocker?: string;
  checkedAt?: string | null;
  controlMode: 'always_on' | 'optional';
  description: string;
  group: 'platform' | 'media' | 'arr' | 'data' | 'access' | 'filesystem' | 'downloads' | 'ai';
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
  state?: string;
  status: 'working' | 'stopped' | 'stalled' | 'unavailable' | 'blocked';
  statusReason?: string;
  resumeRequired?: boolean;
  surface: 'home' | 'media' | 'downloads' | 'arr' | 'terminal' | 'settings' | 'ftp' | 'filesystem' | 'ai';
  uptimePct?: number | null;
};

const nowIso = () => new Date().toISOString();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Keep the preview demo on the same service contract as the live dashboard so
// GitHub Pages reflects the real product shell instead of a hand-made mock.
const SERVICE_META: DemoServiceCatalogEntry[] = [
  { available: true, controlMode: 'always_on', description: 'Single public gateway for the dashboard and companion services.', group: 'platform', key: 'nginx', label: 'nginx', placeholder: false, status: 'working', surface: 'home' },
  { available: true, controlMode: 'always_on', description: 'Browser terminal access inside the dashboard.', group: 'platform', key: 'ttyd', label: 'ttyd', placeholder: false, route: '/term/', status: 'working', surface: 'terminal' },
  { available: true, controlMode: 'always_on', description: 'Streams your movie and series library to local clients.', group: 'media', key: 'jellyfin', label: 'Jellyfin', placeholder: false, route: '/jellyfin/', status: 'working', surface: 'media' },
  { available: true, controlMode: 'always_on', description: 'Handles automated and manual torrent downloads alongside the dedicated downloads workspace.', group: 'downloads', key: 'qbittorrent', label: 'qBittorrent', placeholder: false, route: '/qb/', status: 'working', surface: 'downloads' },
  { available: false, blocker: 'Currently blocked on Android-native Node/chroot packaging.', controlMode: 'always_on', description: 'Request portal for adding movies and shows into the automation flow.', group: 'media', key: 'jellyseerr', label: 'Jellyseerr', placeholder: true, route: '/requests/', status: 'unavailable', surface: 'media' },
  { available: true, controlMode: 'always_on', description: 'Automates series discovery, tracking, and download handoff.', group: 'arr', key: 'sonarr', label: 'Sonarr', placeholder: false, route: '/sonarr/', status: 'working', surface: 'arr' },
  { available: true, controlMode: 'always_on', description: 'Automates movie discovery, tracking, and download handoff.', group: 'arr', key: 'radarr', label: 'Radarr', placeholder: false, route: '/radarr/', status: 'working', surface: 'arr' },
  { available: true, controlMode: 'always_on', description: 'Central indexer manager for Sonarr and Radarr.', group: 'arr', key: 'prowlarr', label: 'Prowlarr', placeholder: false, route: '/prowlarr/', status: 'working', surface: 'arr' },
  { available: false, blocker: 'Currently blocked on Python native dependencies for this host.', controlMode: 'always_on', description: 'Subtitle automation for imported media libraries.', group: 'arr', key: 'bazarr', label: 'Bazarr', placeholder: true, status: 'unavailable', surface: 'arr' },
  { available: true, controlMode: 'always_on', description: 'Persistent database for IPTV services and future media metadata.', group: 'data', key: 'postgres', label: 'PostgreSQL', placeholder: false, status: 'working', surface: 'media' },
  { available: true, controlMode: 'always_on', description: 'Cache and worker coordination for IPTV and background jobs.', group: 'data', key: 'redis', label: 'Redis', placeholder: false, status: 'working', surface: 'media' },
  { available: true, controlMode: 'optional', description: 'Legacy remote access and PS4-compatible transfer path.', group: 'access', key: 'ftp', label: 'FTP', placeholder: false, status: 'working', surface: 'ftp' },
  { available: true, controlMode: 'optional', description: 'High-throughput uploads, drop folders, and browser-based transfer.', group: 'access', key: 'copyparty', label: 'copyparty', placeholder: false, route: '/copyparty/', status: 'stopped', surface: 'home' },
  { available: true, controlMode: 'optional', description: 'Device sync and backup across phones, laptops, and shares.', group: 'access', key: 'syncthing', label: 'Syncthing', placeholder: false, status: 'working', surface: 'home' },
  { available: true, controlMode: 'optional', description: 'LAN file sharing for desktop and TV clients.', group: 'access', key: 'samba', label: 'Samba', placeholder: false, status: 'stopped', surface: 'home' },
  { available: true, controlMode: 'optional', description: 'Shell access for maintenance and recovery.', group: 'access', key: 'sshd', label: 'sshd', placeholder: false, status: 'stopped', surface: 'home' },
  { available: true, controlMode: 'optional', description: 'Local on-device inference using llama.cpp with selectable GGUF models.', group: 'ai', key: 'llm', label: 'Local LLM', placeholder: false, route: '/llm/', status: 'working', surface: 'ai' },
];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const parseJsonBody = (init?: RequestInit) => {
  if (!init?.body || typeof init.body !== 'string') {
    return {};
  }

  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const normalizeFsPath = (value = '') =>
  String(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');

const normalizeAccessLevel = (value: unknown): DemoSharePermission['accessLevel'] =>
  value === 'write' || value === 'read' ? value : 'deny';

const normalizeRemotePath = (value = '/') => {
  const parts = String(value)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');

  return `/${parts.join('/')}` || '/';
};

const parentFsPath = (value = '') => {
  const parts = normalizeFsPath(value).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
};

const topLevelName = (value = '') => normalizeFsPath(value).split('/').filter(Boolean)[0] || '';

const makeNode = (path: string, type: 'directory' | 'file', size = 0): DemoFsNode => {
  const normalizedPath = normalizeFsPath(path);
  const parts = normalizedPath.split('/').filter(Boolean);
  return {
    modifiedAt: nowIso(),
    name: parts[parts.length - 1] || normalizedPath,
    path: normalizedPath,
    size,
    type,
  };
};

const makeRemoteNode = (path: string, type: 'directory' | 'file', size = 0): DemoRemoteNode => {
  const normalizedPath = normalizeRemotePath(path);
  const parts = normalizedPath.split('/').filter(Boolean);
  return {
    modifiedAt: nowIso(),
    name: parts[parts.length - 1] || '/',
    path: normalizedPath,
    size,
    type,
  };
};

const pushLog = (state: DemoState, level: DemoLog['level'], message: string, meta?: unknown) => {
  state.logs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    level,
    message,
    meta,
    timestamp: nowIso(),
  });
  state.logs = state.logs.slice(0, 80);
};

const buildMarkdownLog = (logs: DemoLog[]) => {
  const recent = logs.slice(0, 20);
  const counts = recent.reduce(
    (acc, entry) => {
      acc[entry.level] += 1;
      return acc;
    },
    { error: 0, info: 0, warn: 0 }
  );

  const lines = recent.map((entry) => {
    const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
    return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}${meta}`;
  });

  return `### Debug Summary\n- entries: ${recent.length}\n- info=${counts.info}, warn=${counts.warn}, error=${counts.error}\n\n\`\`\`log\n${lines.join('\n')}\n\`\`\``;
};

type DemoState = {
  connections: Array<{
    durationMs?: number;
    ip: string;
    lastSeen: string;
    port: string;
    protocol: string;
    sessionId?: string;
    status: string;
    username: string;
  }>;
  controllerLocked: boolean;
  driveEvents: Array<{
    event: string;
    filesystem?: string;
    level: string;
    letter?: string;
    mountPoint?: string;
    name?: string;
    timestamp: string;
  }>;
  drives: Array<{
    device: string;
    dirName: string;
    error: string;
    filesystem: string;
    letter: string;
    mountPoint: string;
    name: string;
    rawMountPoint?: string;
    state: string;
    uuid: string;
  }>;
  ftpDefaults: {
    defaultName: string;
    downloadRoot: string;
    host: string;
    password: string;
    port: number;
    secure: boolean;
    user: string;
  };
  ftpFavourites: DemoFtpFavourite[];
  fsOperations: DemoFsOperation[];
  llmActiveModelId: string;
  llmApiKeyConfigured: boolean;
  llmOnline: {
    activeModelId: string;
    available: boolean;
    configured: boolean;
    error: string;
    models: Array<{ id: string; label: string }>;
  };
  llmConversations: Array<{ id: number; title: string; createdAt: string; updatedAt: string }>;
  llmMessagesByConversation: Record<number, Array<{ id: number; role: 'user' | 'assistant' | 'system'; content: string; modelId: string; createdAt: string }>>;
  llmModels: Array<{ id: string; label: string; source: 'preset' | 'custom'; path: string; installed: boolean }>;
  llmPullJobs: Array<{ id: string; status: 'queued' | 'running' | 'success' | 'failed'; modelId: string; message: string; updatedAt: string }>;
  logs: DemoLog[];
  remoteNodes: Map<string, DemoRemoteNode>;
  serviceUnlockExpiresAt: string | null;
  services: Record<string, boolean>;
  sessionUser: { role: 'admin' | 'user'; username: string } | null;
  shares: DemoShare[];
  storage: Array<{
    available: number;
    category?: string;
    filesystem: string;
    fsType?: string;
    mount: string;
    size: number;
    usePercent: number;
    used: number;
  }>;
  users: DemoUser[];
  verboseLoggingEnabled: boolean;
  nodes: Map<string, DemoFsNode>;
};

const seedState = (): DemoState => {
  const nodes = new Map<string, DemoFsNode>();
  const remoteNodes = new Map<string, DemoRemoteNode>();

  [
    makeNode('C', 'directory'),
    makeNode('C/DCIM', 'directory'),
    makeNode('C/DCIM/Camera', 'directory'),
    makeNode('C/DCIM/Camera/IMG_2026-03-12_1820.jpg', 'file', 3_410_112),
    makeNode('Media', 'directory'),
    makeNode('Media/movies', 'directory'),
    makeNode('Media/movies/Dune Part Two (2024)', 'directory'),
    makeNode('Media/movies/Dune Part Two (2024)/Dune Part Two (2024).mkv', 'file', 18_220_425_216),
    makeNode('Media/series', 'directory'),
    makeNode('Media/series/Andor', 'directory'),
    makeNode('Media/series/Andor/Season 01', 'directory'),
    makeNode('Media/series/Andor/Season 01/Andor.S01E01.mkv', 'file', 2_100_145_176),
    makeNode('Media/downloads', 'directory'),
    makeNode('Media/downloads/manual', 'directory'),
    makeNode('Media/iptv-cache', 'directory'),
    makeNode('Media/iptv-cache/playlist.m3u', 'file', 86_210),
    makeNode('Media/iptv-epg', 'directory'),
    makeNode('Media/iptv-epg/guide.xml', 'file', 312_480),
    makeNode('Projects', 'directory'),
    makeNode('Projects/Designs', 'directory'),
    makeNode('Projects/Designs/dashboard-wireframe.md', 'file', 4820),
    makeNode('PS4', 'directory'),
    makeNode('PS4/pkg', 'directory'),
    makeNode('PS4/pkg/patch.pkg', 'file', 1_288_490_010),
  ].forEach((node) => nodes.set(node.path, node));

  [
    makeRemoteNode('/', 'directory'),
    makeRemoteNode('/data', 'directory'),
    makeRemoteNode('/data/app', 'directory'),
    makeRemoteNode('/data/app/patch.pkg', 'file', 1_288_490_010),
    makeRemoteNode('/user', 'directory'),
    makeRemoteNode('/user/screenshots', 'directory'),
    makeRemoteNode('/user/screenshots/snap001.png', 'file', 4_108_200),
    makeRemoteNode('/hdd', 'directory'),
  ].forEach((node) => remoteNodes.set(node.path, node));

  const currentTime = nowIso();
  const shares: DemoShare[] = [
    {
      createdAt: currentTime,
      description: 'Internal shared storage mirrored from Android storage.',
      id: 1,
      isHidden: false,
      isReadOnly: false,
      name: 'C',
      pathKey: 'C',
      permissions: [
        { accessLevel: 'write', subjectKey: 'admin', subjectType: 'role' },
        { accessLevel: 'read', subjectKey: 'user', subjectType: 'role' },
      ],
      sourceType: 'internal',
      updatedAt: currentTime,
    },
    {
      createdAt: currentTime,
      description: 'Primary media library share for movies and series.',
      id: 2,
      isHidden: false,
      isReadOnly: false,
      name: 'Media',
      pathKey: 'Media',
      permissions: [
        { accessLevel: 'write', subjectKey: 'admin', subjectType: 'role' },
        { accessLevel: 'read', subjectKey: 'user', subjectType: 'role' },
      ],
      sourceType: 'media',
      updatedAt: currentTime,
    },
    {
      createdAt: currentTime,
      description: 'Project workspace and documentation samples.',
      id: 3,
      isHidden: false,
      isReadOnly: false,
      name: 'Projects',
      pathKey: 'Projects',
      permissions: [
        { accessLevel: 'write', subjectKey: 'admin', subjectType: 'role' },
      ],
      sourceType: 'folder',
      updatedAt: currentTime,
    },
    {
      createdAt: currentTime,
      description: 'Mounted PS4 FTP target represented as a local drive folder.',
      id: 4,
      isHidden: false,
      isReadOnly: false,
      name: 'PS4',
      pathKey: 'PS4',
      permissions: [
        { accessLevel: 'write', subjectKey: 'admin', subjectType: 'role' },
        { accessLevel: 'read', subjectKey: 'user', subjectType: 'role' },
      ],
      sourceType: 'ftp',
      updatedAt: currentTime,
    },
  ];

  const ftpFavourites: DemoFtpFavourite[] = [
    {
      createdAt: currentTime,
      host: '192.168.1.8',
      id: 1,
      mount: {
        mountName: 'PS4',
        mountPoint: '/data/data/com.termux/files/home/Drives/PS4',
        mounted: true,
        pid: 8123,
        remoteName: 'PS4',
        running: true,
        state: 'mounted',
      },
      mountName: 'PS4',
      name: 'PS4',
      password: 'demo',
      port: 2121,
      protocol: 'ftp',
      remotePath: '/',
      secure: false,
      updatedAt: currentTime,
      username: 'anonymous',
    },
  ];

  return {
    connections: [
      { durationMs: 32 * 60 * 1000, ip: '192.168.1.16', lastSeen: currentTime, port: '0', protocol: 'web', sessionId: 'demo-session-admin', status: 'active', username: 'admin' },
      { durationMs: 2 * 60 * 60 * 1000, ip: '192.168.1.31', lastSeen: currentTime, port: '0', protocol: 'jellyfin', status: 'playing', username: 'living-room-tv' },
    ],
    controllerLocked: true,
    driveEvents: [
      { event: 'Mounted Media archive', filesystem: 'ext4', level: 'info', letter: 'D', mountPoint: '/mnt/media', name: 'Media Archive', timestamp: currentTime },
      { event: 'Drive check completed', level: 'info', timestamp: currentTime },
    ],
    drives: [
      { device: '/dev/block/sda1', dirName: 'D (Media Archive)', error: '', filesystem: 'ext4', letter: 'D', mountPoint: '/mnt/media', name: 'Media Archive', rawMountPoint: '/mnt/media', state: 'mounted', uuid: 'media-001' },
      { device: '/dev/block/sdb1', dirName: 'E (Cold Backup)', error: '', filesystem: 'exfat', letter: 'E', mountPoint: '/mnt/backup', name: 'Cold Backup', rawMountPoint: '/mnt/backup', state: 'mounted', uuid: 'backup-002' },
    ],
    ftpDefaults: {
      defaultName: 'PS4',
      downloadRoot: '~/Drives',
      host: '192.168.1.8',
      password: 'demo',
      port: 2121,
      secure: false,
      user: 'anonymous',
    },
    ftpFavourites,
    fsOperations: [],
    llmActiveModelId: 'qwen2.5-coder-1.5b-q4_k_m',
    llmApiKeyConfigured: true,
    llmOnline: {
      activeModelId: 'gpt-4.1-mini',
      available: true,
      configured: true,
      error: '',
      models: [
        { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
        { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
      ],
    },
    llmConversations: [],
    llmMessagesByConversation: {},
    llmModels: [
      { id: 'qwen2.5-coder-1.5b-q4_k_m', label: 'Qwen2.5-Coder 1.5B Q4_K_M', source: 'preset', path: '~/services/llm/models/qwen2.5-coder-1.5b-q4_k_m/model.gguf', installed: false },
      { id: 'qwen2.5-coder-3b-q4_k_m', label: 'Qwen2.5-Coder 3B Q4_K_M', source: 'preset', path: '~/services/llm/models/qwen2.5-coder-3b-q4_k_m/model.gguf', installed: true },
      { id: 'qwen2.5-coder-7b-q4_k_m', label: 'Qwen2.5-Coder 7B Q4_K_M', source: 'preset', path: '~/services/llm/models/qwen2.5-coder-7b-q4_k_m/model.gguf', installed: false },
      { id: 'mistral-7b-instruct-v0.3-q4_k_m', label: 'Mistral 7B Instruct v0.3 Q4_K_M', source: 'preset', path: '~/services/llm/models/mistral-7b-instruct-v0.3-q4_k_m/model.gguf', installed: false },
      { id: 'llama-3.2-3b-instruct-q4_k_m', label: 'Llama 3.2 3B Instruct Q4_K_M', source: 'preset', path: '~/services/llm/models/llama-3.2-3b-instruct-q4_k_m/model.gguf', installed: false },
    ],
    llmPullJobs: [],
    logs: [
      { level: 'info', message: 'Demo mode bootstrapped', timestamp: currentTime },
      { level: 'info', message: 'Dashboard preview is using dummy data', timestamp: currentTime },
      { level: 'warn', message: 'All service controls are simulated in demo mode', timestamp: currentTime },
    ],
    remoteNodes,
    serviceUnlockExpiresAt: null,
    services: {
      copyparty: false,
      ftp: true,
      jellyfin: true,
      llm: true,
      nginx: true,
      postgres: true,
      prowlarr: true,
      qbittorrent: true,
      radarr: true,
      redis: true,
      samba: false,
      sshd: false,
      sonarr: true,
      syncthing: true,
      ttyd: true,
    },
    sessionUser: { role: 'admin', username: 'admin' },
    shares,
    storage: [
      { available: 182_000_000_000, category: 'internal', filesystem: '/storage/emulated', fsType: 'f2fs', mount: '/storage/emulated/0', size: 256_000_000_000, usePercent: 29, used: 74_000_000_000 },
      { available: 1_200_000_000_000, category: 'media', filesystem: '/dev/block/sda1', fsType: 'ext4', mount: '/mnt/media', size: 2_000_000_000_000, usePercent: 40, used: 800_000_000_000 },
    ],
    users: [
      { createdAt: currentTime, id: 1, isDisabled: false, role: 'admin', updatedAt: currentTime, username: 'admin' },
      { createdAt: currentTime, id: 2, isDisabled: false, role: 'user', updatedAt: currentTime, username: 'guest' },
    ],
    verboseLoggingEnabled: false,
    nodes,
  };
};

const demoState = seedState();

const optionalServices = ['ftp', 'copyparty', 'syncthing', 'samba', 'sshd', 'llm'];
const demoServiceLatency: Record<string, number> = {
  copyparty: 0,
  ftp: 132,
  jellyfin: 168,
  nginx: 42,
  postgres: 18,
  prowlarr: 112,
  qbittorrent: 86,
  radarr: 118,
  redis: 8,
  samba: 0,
  sonarr: 126,
  sshd: 0,
  syncthing: 94,
  ttyd: 61,
  llm: 74,
};

const statusReasonForDemoService = (entry: DemoServiceCatalogEntry) => {
  if (!entry.available) {
    return entry.blocker || 'Not installed on this host.';
  }

  if (entry.status === 'working') {
    return entry.latencyMs && entry.latencyMs > 800 ? 'Healthy, but response time is elevated.' : 'Healthy.';
  }

  if (entry.controlMode === 'optional') {
    return 'Stopped by operator.';
  }

  return 'Expected to be running, but the health check failed.';
};

const lifecycleStateForDemoStatus = (status: DemoServiceCatalogEntry['status']) => {
  if (status === 'working') {
    return 'running';
  }
  if (status === 'stalled') {
    return 'degraded';
  }
  return status;
};

const buildServiceCatalog = (state: DemoState): DemoServiceCatalogEntry[] =>
  SERVICE_META.map((entry) => {
    const checkedAt = nowIso();

    if (!entry.available) {
      const unavailableEntry = {
        ...clone(entry),
        avgLatencyMs: null,
        checkedAt,
        lastCheckedAt: checkedAt,
        lastFailureAt: null,
        lastTransitionAt: checkedAt,
        latencyMs: null,
        restartRecommended: false,
        state: lifecycleStateForDemoStatus(entry.status),
        uptimePct: null,
      };
      const reason = statusReasonForDemoService(unavailableEntry);
      return {
        ...unavailableEntry,
        reason,
        statusReason: reason,
      };
    }

    const running = Boolean(state.services[entry.key]);
    const status = entry.controlMode === 'optional'
      ? (running ? 'working' : 'stopped')
      : (running ? 'working' : 'stalled');
    const latencyMs = running ? demoServiceLatency[entry.key] || 44 : null;
    const reason = statusReasonForDemoService({
      ...entry,
      latencyMs,
      status,
    });
    const restartRecommended = status === 'stalled';

    return {
      ...entry,
      avgLatencyMs: latencyMs,
      checkedAt,
      lastCheckedAt: checkedAt,
      lastFailureAt: restartRecommended ? checkedAt : null,
      lastTransitionAt: checkedAt,
      latencyMs,
      reason,
      restartRecommended,
      state: lifecycleStateForDemoStatus(status),
      status,
      statusReason: reason,
      uptimePct: running ? 99.4 : 96.1,
    };
  });

const buildServiceGroups = (catalog: DemoServiceCatalogEntry[]) =>
  catalog.reduce<Record<string, string[]>>((acc, entry) => {
    acc[entry.group] ||= [];
    acc[entry.group].push(entry.key);
    return acc;
  }, {});

const buildLifecycleSummary = (catalog: DemoServiceCatalogEntry[]) => {
  const counts = {
    blocked: 0,
    crashed: 0,
    degraded: 0,
    healthy: 0,
    stopped: 0,
  };
  let lastFailureAt: string | null = null;
  let restartRecommended = false;

  for (const entry of catalog) {
    const state = lifecycleStateForDemoStatus(entry.status);
    if (state in counts) {
      counts[state as keyof typeof counts] += 1;
    } else {
      counts.degraded += 1;
    }
    if (!lastFailureAt && entry.lastFailureAt) {
      lastFailureAt = entry.lastFailureAt;
    }
    restartRecommended = restartRecommended || Boolean(entry.restartRecommended);
  }

  if (counts.crashed > 0) {
    return {
      checkedAt: nowIso(),
      counts,
      lastFailureAt: lastFailureAt || nowIso(),
      reason: `${counts.crashed} service${counts.crashed === 1 ? '' : 's'} failed health checks.`,
      restartRecommended: true,
      state: 'crashed',
    };
  }

  if (counts.blocked > 0) {
    return {
      checkedAt: nowIso(),
      counts,
      lastFailureAt,
      reason: `${counts.blocked} service${counts.blocked === 1 ? '' : 's'} are blocked.`,
      restartRecommended,
      state: 'blocked',
    };
  }

  if (counts.degraded > 0) {
    return {
      checkedAt: nowIso(),
      counts,
      lastFailureAt,
      reason: `${counts.degraded} service${counts.degraded === 1 ? '' : 's'} are degraded.`,
      restartRecommended,
      state: 'degraded',
    };
  }

  if (counts.healthy === 0 && counts.stopped > 0) {
    return {
      checkedAt: nowIso(),
      counts,
      lastFailureAt,
      reason: 'All services are currently stopped.',
      restartRecommended,
      state: 'stopped',
    };
  }

  return {
    checkedAt: nowIso(),
    counts,
    lastFailureAt,
    reason: counts.stopped > 0
      ? 'Running services are healthy; some services are stopped by operator.'
      : 'All services are healthy.',
    restartRecommended,
    state: 'healthy',
  };
};

const aggregateCatalogStatus = (entries: DemoServiceCatalogEntry[]) => {
  if (entries.length === 0) {
    return 'unavailable';
  }
  if (entries.every((entry) => entry.status === 'working')) {
    return 'working';
  }
  if (entries.some((entry) => entry.status === 'working' || entry.status === 'stalled')) {
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

const buildMediaWorkflow = (state: DemoState, catalog: DemoServiceCatalogEntry[]) => {
  const catalogByKey = new Map(catalog.map((entry) => [entry.key, entry]));
  const watchEntry = catalogByKey.get('jellyfin') || null;
  const requestEntry = catalogByKey.get('jellyseerr') || null;
  const automationEntries = ['prowlarr', 'sonarr', 'radarr']
    .map((key) => catalogByKey.get(key))
    .filter((entry): entry is DemoServiceCatalogEntry => Boolean(entry));
  const subtitleEntry = catalogByKey.get('bazarr') || null;
  const supportEntries = ['redis', 'postgres']
    .map((key) => catalogByKey.get(key))
    .filter((entry): entry is DemoServiceCatalogEntry => Boolean(entry));
  const downloadEntries = catalog.filter((entry) => entry.surface === 'downloads');
  const primaryDownloadEntry = downloadEntries[0] || null;
  const libraryRoots = ['~/Drives/Media/movies', '~/Drives/Media/series'];
  const downloadRoots = ['~/Drives/Media/downloads', '~/Drives/Media/downloads/manual'];
  const playlistSource = state.nodes.has('Media/iptv-cache/playlist.m3u') ? '~/Drives/Media/iptv-cache/playlist.m3u' : null;
  const guideSource = state.nodes.has('Media/iptv-epg/guide.xml') ? '~/Drives/Media/iptv-epg/guide.xml' : null;
  const channelCount = 42;

  return {
    watch: {
      libraryRootReady: state.nodes.has('Media/movies') && state.nodes.has('Media/series'),
      libraryRoots,
      serviceKeys: watchEntry ? [watchEntry.key] : [],
      status: watchEntry?.status || 'unavailable',
      summary: 'Library roots are present and ready for Jellyfin playback.',
    },
    requests: {
      blocker: !requestEntry || !requestEntry.available ? requestEntry?.blocker || 'Request portal is not installed in the demo host.' : null,
      serviceKeys: requestEntry ? [requestEntry.key] : [],
      status: !requestEntry || !requestEntry.available ? 'blocked' : requestEntry.status,
      summary: !requestEntry || !requestEntry.available
        ? requestEntry?.blocker || 'Requests are unavailable in this demo state.'
        : 'Approved requests flow into Sonarr and Radarr with saved defaults.',
    },
    automation: {
      healthy: automationEntries.filter((entry) => entry.status === 'working').length,
      serviceKeys: automationEntries.map((entry) => entry.key),
      status: aggregateCatalogStatus(automationEntries),
      summary: 'Prowlarr syncs indexers into Sonarr and Radarr, which then import completed downloads.',
      total: automationEntries.length,
    },
    downloads: {
      clientCount: downloadEntries.length,
      defaultSavePath: '~/Drives/Media/downloads/manual',
      downloadRoots,
      primaryServiceKey: primaryDownloadEntry?.key || null,
      serviceKeys: downloadEntries.map((entry) => entry.key),
      status: aggregateCatalogStatus(downloadEntries),
      summary: `${primaryDownloadEntry?.label || 'Download clients'} run in the dedicated Downloads tab. Save path: ~/Drives/Media/downloads/manual`,
      workspaceTab: 'downloads',
    },
    storage: {
      compatibilityRoot: '~/Drives/Media',
      vaultRoot: '~/Drives/D/VAULT/Media',
      vaultRoots: ['~/Drives/D/VAULT/Media'],
      scratchRoot: '~/Drives/E/SCRATCH/HmSTxScratch',
      scratchRoots: ['~/Drives/E/SCRATCH/HmSTxScratch'],
      importAbortFreeGb: 200,
      vaultWarnFreeGb: 250,
      scratchWarnFreeGb: 150,
      scratchWarnUsedPercent: 85,
      scratchRetentionDays: 30,
      scratchMinFreeGb: 200,
      scratchCleanupEnabled: true,
      cleanupMode: 'hybrid_age_and_size',
      importReviewDir: '~/Drives/E/SCRATCH/HmSTxScratch/review',
      importLogDir: '~/Drives/E/SCRATCH/HmSTxScratch/logs',
      transcodeDir: '~/Drives/E/SCRATCH/HmSTxScratch/cache/jellyfin',
      miscCacheDir: '~/Drives/E/SCRATCH/HmSTxScratch/cache/misc',
      qbitTempDir: '~/Drives/E/SCRATCH/HmSTxScratch/tmp/qbittorrent',
      qbitDefaultSavePath: '~/Drives/E/SCRATCH/HmSTxScratch/downloads/manual',
      qbitCategoryPaths: {
        manual: '~/Drives/E/SCRATCH/HmSTxScratch/downloads/manual',
        movies: '~/Drives/E/SCRATCH/HmSTxScratch/downloads/movies',
        series: '~/Drives/E/SCRATCH/HmSTxScratch/downloads/series',
      },
      reviewQueueCount: 0,
      importStatus: {
        status: 'ok',
        trigger: 'demo',
        imported: 4,
        skippedExisting: 1,
        ambiguousReview: 0,
        failed: 0,
        collisionCount: 1,
        scannedItems: 5,
        aborted: false,
        abortReason: '',
        lastRunAt: nowIso(),
      },
      cleanupStatus: {
        status: 'ok',
        trigger: 'demo',
        cleanupMode: 'hybrid_age_and_size',
        scratchPressureBefore: false,
        scratchPressureAfter: false,
        deletedItems: 0,
        deletedBytes: 0,
        deletedCacheItems: 0,
        deletedImportedItems: 0,
        lastRunAt: nowIso(),
      },
      lastImportRunAt: nowIso(),
      lastCleanupRunAt: nowIso(),
      vault: {
        freeGb: 721.42,
        usedPercent: 81.3,
        warning: false,
      },
      scratch: {
        freeGb: 882.11,
        usedPercent: 52.7,
        warning: false,
      },
      protection: {
        available: true,
        blockedServices: [],
        enabled: true,
        generatedAt: nowIso(),
        healthyStreak: 4,
        lastDegradedAt: null,
        lastHealthyAt: nowIso(),
        lastTransitionAt: nowIso(),
        manualResume: true,
        overallHealthy: true,
        reason: 'Storage healthy',
        resumeRequired: false,
        state: 'healthy',
        stoppedByWatchdog: [],
        vault: {
          healthy: true,
          reason: '',
          drives: ['~/Drives/D'],
          roots: ['~/Drives/D/VAULT/Media'],
        },
        scratch: {
          healthy: true,
          reason: '',
          drives: ['~/Drives/E'],
          roots: ['~/Drives/E/SCRATCH/HmSTxScratch'],
        },
      },
    },
    subtitles: {
      blocker: !subtitleEntry || !subtitleEntry.available ? subtitleEntry?.blocker || 'Subtitle automation is not installed in this demo host.' : null,
      serviceKeys: subtitleEntry ? [subtitleEntry.key] : [],
      status: !subtitleEntry || !subtitleEntry.available ? 'blocked' : subtitleEntry.status,
      summary: !subtitleEntry || !subtitleEntry.available
        ? subtitleEntry?.blocker || 'Subtitle automation is unavailable.'
        : 'Subtitle automation runs after library import.',
    },
    liveTv: {
      channelCount,
      channelsMapped: true,
      guideConfigured: Boolean(guideSource),
      guideSource,
      playlistConfigured: Boolean(playlistSource),
      playlistSource,
      status: watchEntry?.status === 'working' && playlistSource && guideSource ? 'working' : 'setup',
      summary: playlistSource && guideSource
        ? `${channelCount} channels are already mapped in Jellyfin. Live TV is ready.`
        : 'Add both M3U and XMLTV sources for Jellyfin Live TV.',
      tunerType: 'm3u',
    },
    support: {
      serviceKeys: supportEntries.map((entry) => entry.key),
      status: aggregateCatalogStatus(supportEntries),
      summary: 'Redis and PostgreSQL support the media workflow behind the scenes.',
    },
  };
};

const buildDashboardPayload = (state: DemoState) => {
  const serviceCatalog = buildServiceCatalog(state);
  const mediaWorkflow = buildMediaWorkflow(state, serviceCatalog);
  const lifecycle = buildLifecycleSummary(serviceCatalog);

  return {
  connections: {
    users: clone(state.connections),
  },
  generatedAt: nowIso(),
  logs: {
    entries: clone(state.logs),
    logs: clone(state.logs),
    markdown: buildMarkdownLog(state.logs),
    verboseLoggingEnabled: state.verboseLoggingEnabled,
  },
  monitor: {
    cpuCores: 8,
    cpuLoad: 21.4,
    eventLoopLagMs: 2.1,
    eventLoopP95Ms: 4.8,
    freeMem: 3_820_000_000,
    loadAvg1m: 1.02,
    loadAvg5m: 0.84,
    loadAvg15m: 0.73,
    network: {
      rxBytes: 2_840_000_000,
      rxRate: 2_420_000,
      txBytes: 1_280_000_000,
      txRate: 620_000,
    },
    device: {
      androidVersion: 'Android 16',
      batteryPct: 84,
      charging: true,
      wifiDbm: -45,
    },
    processExternal: 18_400_000,
    processHeapTotal: 94_000_000,
    processHeapUsed: 58_000_000,
    processRss: 228_000_000,
    totalMem: 7_680_000_000,
    uptime: 184_000,
    usedMem: 3_860_000_000,
  },
  serviceController: {
    locked: state.controllerLocked,
    optionalServices,
  },
  serviceCatalog,
  lifecycle,
  serviceGroups: buildServiceGroups(serviceCatalog),
  mediaWorkflow,
  services: clone(state.services),
  storage: {
    mounts: clone(state.storage),
  },
  };
};

const buildTelemetryPayload = (state: DemoState) => {
  const dashboard = buildDashboardPayload(state);
  return {
    generatedAt: dashboard.generatedAt,
    lifecycle: dashboard.lifecycle,
    logs: dashboard.logs,
    mediaWorkflow: dashboard.mediaWorkflow,
    monitor: dashboard.monitor,
    serviceCatalog: dashboard.serviceCatalog,
    serviceController: dashboard.serviceController,
    serviceGroups: dashboard.serviceGroups,
    services: dashboard.services,
  };
};

const UI_WORKSPACES = ['overview', 'media', 'files', 'transfers', 'ai', 'terminal', 'admin'] as const;
const LEGACY_TAB_TO_WORKSPACE: Record<string, typeof UI_WORKSPACES[number]> = {
  home: 'overview',
  media: 'media',
  downloads: 'media',
  arr: 'media',
  terminal: 'terminal',
  filesystem: 'files',
  ftp: 'transfers',
  ai: 'ai',
  settings: 'admin',
};

const normalizeWorkspaceKey = (value = '') => {
  const key = String(value || '').trim().toLowerCase();
  return UI_WORKSPACES.includes(key as typeof UI_WORKSPACES[number]) ? key : '';
};

const buildUiBootstrapPayload = (state: DemoState) => {
  const serviceCatalog = buildServiceCatalog(state);
  const lifecycle = buildLifecycleSummary(serviceCatalog);
  const serviceByKey = new Map(serviceCatalog.map((entry) => [entry.key, entry]));
  const transferService = serviceByKey.get('ftp');
  const aiService = serviceByKey.get('llm');
  const terminalService = serviceByKey.get('ttyd');
  const canUseFilesWorkspace = state.shares.length > 0;

  return {
    generatedAt: nowIso(),
    user: state.sessionUser ? clone(state.sessionUser) : null,
    lifecycle,
    nav: [
      { key: 'overview', label: 'Overview', legacyTabs: ['home'], summary: 'System health, telemetry, and lifecycle status', available: true, status: 'working' },
      { key: 'media', label: 'Media', legacyTabs: ['media', 'downloads', 'arr'], summary: 'Jellyfin and automation workflow surfaces', available: true, status: lifecycle.state },
      { key: 'files', label: 'Files', legacyTabs: ['filesystem'], summary: 'Drive, share, and filesystem management', available: canUseFilesWorkspace, status: canUseFilesWorkspace ? 'working' : 'blocked' },
      { key: 'transfers', label: 'Transfers', legacyTabs: ['ftp'], summary: 'FTP favourites and remote transfer tools', available: Boolean(transferService?.available), status: transferService?.status || 'unavailable' },
      { key: 'ai', label: 'AI', legacyTabs: ['ai'], summary: 'Local and online LLM runtime workspace', available: Boolean(aiService?.available), status: aiService?.status || 'unavailable' },
      { key: 'terminal', label: 'Terminal', legacyTabs: ['terminal'], summary: 'Terminal and command access surface', available: Boolean(terminalService?.available), status: terminalService?.status || 'unavailable' },
      { key: 'admin', label: 'Admin', legacyTabs: ['settings'], summary: 'Service controls, access policy, and operations', available: true, status: lifecycle.state },
    ],
    legacyTabMap: LEGACY_TAB_TO_WORKSPACE,
    capabilities: {
      canAdmin: state.sessionUser?.role === 'admin',
      canControlServices: state.sessionUser?.role === 'admin',
      canManageUsers: state.sessionUser?.role === 'admin',
      canManageShares: state.sessionUser?.role === 'admin',
      canUseFilesWorkspace,
      canUseTransfersWorkspace: Boolean(transferService?.available),
      canUseAiWorkspace: Boolean(aiService?.available),
      canUseTerminalWorkspace: Boolean(terminalService?.available),
    },
    serviceCounts: {
      total: serviceCatalog.length,
      available: serviceCatalog.filter((entry) => entry.available).length,
      working: serviceCatalog.filter((entry) => entry.status === 'working').length,
      blocked: serviceCatalog.filter((entry) => entry.status === 'blocked').length,
      unavailable: serviceCatalog.filter((entry) => entry.status === 'unavailable').length,
    },
  };
};

const buildLlmStatePayload = (state: DemoState) => {
  const activeModel = state.llmModels.find((entry) => entry.id === state.llmActiveModelId) || null;
  return {
    activeModel,
    activeModelId: state.llmActiveModelId,
    apiKeyConfigured: state.llmApiKeyConfigured,
    available: true,
    blocker: null,
    models: clone(state.llmModels),
    online: clone(state.llmOnline),
    pullJobs: clone(state.llmPullJobs),
    running: Boolean(state.services.llm),
  };
};

const buildUiWorkspacePayload = (state: DemoState, workspaceKey: string) => {
  const dashboard = buildDashboardPayload(state);
  const telemetry = buildTelemetryPayload(state);
  const serviceCatalog = dashboard.serviceCatalog || [];

  if (workspaceKey === 'overview') {
    return {
      generatedAt: nowIso(),
      workspaceKey,
      telemetry,
      connections: dashboard.connections,
      storage: dashboard.storage,
    };
  }

  if (workspaceKey === 'media') {
    return {
      generatedAt: nowIso(),
      workspaceKey,
      lifecycle: dashboard.lifecycle,
      mediaWorkflow: dashboard.mediaWorkflow,
      services: serviceCatalog.filter((entry) => ['media', 'arr', 'downloads', 'data'].includes(String(entry.group || ''))),
    };
  }

  if (workspaceKey === 'files') {
    const protection = buildMediaWorkflow(state, buildServiceCatalog(state)).storage?.protection || null;
    return {
      generatedAt: nowIso(),
      workspaceKey,
      drives: {
        agentInstalled: true,
        checkedAt: nowIso(),
        events: clone(state.driveEvents),
        manifest: {
          drives: clone(state.drives),
          generatedAt: nowIso(),
          intervalMs: 60000,
        },
        refreshIntervalMs: 60000,
      },
      storageProtection: protection,
      shares: clone(state.shares),
      users: clone(state.users),
    };
  }

  if (workspaceKey === 'transfers') {
    return {
      generatedAt: nowIso(),
      workspaceKey,
      ftpDefaults: {
        defaultName: state.ftpDefaults.defaultName,
        host: state.ftpDefaults.host,
        port: state.ftpDefaults.port,
        user: state.ftpDefaults.user,
        secure: state.ftpDefaults.secure,
        downloadRoot: state.ftpDefaults.downloadRoot,
        ftpMounting: {
          available: true,
          mode: 'root_helper',
          reason: 'Demo cloud mount helper is available',
        },
      },
      favourites: clone(state.ftpFavourites),
      services: serviceCatalog.filter((entry) => ['access', 'downloads'].includes(String(entry.group || ''))),
    };
  }

  if (workspaceKey === 'ai') {
    return {
      generatedAt: nowIso(),
      workspaceKey,
      llmState: buildLlmStatePayload(state),
    };
  }

  if (workspaceKey === 'terminal') {
    return {
      generatedAt: nowIso(),
      workspaceKey,
      terminal: serviceCatalog.find((entry) => entry.key === 'ttyd') || null,
    };
  }

  return {
    generatedAt: nowIso(),
    workspaceKey,
    dashboard,
    services: clone(state.services),
  };
};

const listChildNodes = (nodes: Map<string, DemoFsNode>, currentPath: string) => {
  const prefix = currentPath ? `${currentPath}/` : '';
  return Array.from(nodes.values())
    .filter((node) => node.path !== currentPath)
    .filter((node) => {
      if (!currentPath) {
        return !node.path.includes('/');
      }
      if (!node.path.startsWith(prefix)) {
        return false;
      }
      const remainder = node.path.slice(prefix.length);
      return remainder.length > 0 && !remainder.includes('/');
    })
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
};

const buildFsPayload = (state: DemoState, inputPath = '') => {
  const currentPath = normalizeFsPath(inputPath);
  if (!currentPath) {
    return {
      breadcrumbs: [{ label: 'Drives', path: '' }],
      entries: state.shares.map((share) => ({
        accessLevel: 'write',
        editable: false,
        modifiedAt: share.updatedAt,
        name: share.name,
        path: share.pathKey,
        shareId: share.id,
        shareSourceType: share.sourceType,
        size: 0,
        type: 'directory',
      })),
      path: '',
      root: '~/Drives',
      share: null,
    };
  }

  const share = state.shares.find((entry) => entry.pathKey === topLevelName(currentPath)) || null;
  const breadcrumbs = currentPath
    .split('/')
    .filter(Boolean)
    .reduce<Array<{ label: string; path: string }>>((acc, part) => {
      const last = acc[acc.length - 1];
      const nextPath = last?.path ? `${last.path}/${part}` : part;
      acc.push({ label: part, path: nextPath });
      return acc;
    }, [{ label: 'Drives', path: '' }]);

  return {
    breadcrumbs,
    entries: listChildNodes(state.nodes, currentPath).map((node) => ({
      accessLevel: share ? 'write' : 'read',
      editable: share ? !share.isReadOnly : false,
      modifiedAt: node.modifiedAt,
      name: node.name,
      path: node.path,
      shareId: share?.id,
      shareSourceType: share?.sourceType,
      size: node.size,
      type: node.type,
    })),
    path: currentPath,
    root: '~/Drives',
    share: share
      ? {
          accessLevel: 'write',
          id: share.id,
          isReadOnly: share.isReadOnly,
          name: share.name,
          pathKey: share.pathKey,
          sourceType: share.sourceType,
        }
      : null,
  };
};

const listRemoteChildren = (nodes: Map<string, DemoRemoteNode>, currentPath: string) => {
  const prefix = currentPath === '/' ? '/' : `${currentPath}/`;
  return Array.from(nodes.values())
    .filter((node) => node.path !== currentPath)
    .filter((node) => {
      if (currentPath === '/') {
        const remainder = node.path.replace(/^\//, '');
        return remainder.length > 0 && !remainder.includes('/');
      }
      if (!node.path.startsWith(prefix)) {
        return false;
      }
      const remainder = node.path.slice(prefix.length);
      return remainder.length > 0 && !remainder.includes('/');
    })
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
};

const getRemoteListing = (state: DemoState, path = '/') => {
  const currentPath = normalizeRemotePath(path);
  return {
    connection: {
      host: state.ftpDefaults.host,
      port: state.ftpDefaults.port,
      secure: state.ftpDefaults.secure,
      user: state.ftpDefaults.user,
    },
    entries: listRemoteChildren(state.remoteNodes, currentPath).map((node) => ({
      modifiedAt: node.modifiedAt,
      name: node.name,
      permissions: node.type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
      rawModifiedAt: node.modifiedAt,
      size: node.size,
      type: node.type,
    })),
    path: currentPath,
  };
};

const renameNodeTree = (nodes: Map<string, DemoFsNode>, sourcePath: string, targetPath: string) => {
  const entries = Array.from(nodes.values())
    .filter((node) => node.path === sourcePath || node.path.startsWith(`${sourcePath}/`))
    .sort((a, b) => a.path.localeCompare(b.path));

  entries.forEach((entry) => nodes.delete(entry.path));
  entries.forEach((entry) => {
    const nextPath = entry.path === sourcePath ? targetPath : `${targetPath}${entry.path.slice(sourcePath.length)}`;
    nodes.set(
      nextPath,
      {
        ...entry,
        modifiedAt: nowIso(),
        name: nextPath.split('/').filter(Boolean).pop() || entry.name,
        path: nextPath,
      }
    );
  });
};

const removeNodeTree = (nodes: Map<string, DemoFsNode>, sourcePath: string) => {
  Array.from(nodes.keys())
    .filter((nodePath) => nodePath === sourcePath || nodePath.startsWith(`${sourcePath}/`))
    .forEach((nodePath) => nodes.delete(nodePath));
};

const cloneNodeTree = (nodes: Map<string, DemoFsNode>, sourcePath: string, targetPath: string) => {
  const entries = Array.from(nodes.values())
    .filter((node) => node.path === sourcePath || node.path.startsWith(`${sourcePath}/`))
    .sort((a, b) => a.path.localeCompare(b.path));

  entries.forEach((entry) => {
    const nextPath = entry.path === sourcePath ? targetPath : `${targetPath}${entry.path.slice(sourcePath.length)}`;
    nodes.set(
      nextPath,
      {
        ...entry,
        modifiedAt: nowIso(),
        name: nextPath.split('/').filter(Boolean).pop() || entry.name,
        path: nextPath,
      }
    );
  });
};

const createDownloadResponse = (relativePath = '') => {
  const blob = new Blob(
    [
      `Demo download\n\nPath: ${relativePath}\nGenerated: ${nowIso()}\n\nThis is a safe preview artifact and not a real NAS file.\n`,
    ],
    { type: 'text/plain' }
  );
  return URL.createObjectURL(blob);
};

const measureRequestBody = (body: RequestInit['body']) => {
  if (typeof body === 'string') {
    return body.length;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body as ArrayBufferView)) {
    return (body as ArrayBufferView).byteLength;
  }
  return 0;
};

const createDemoFsOperation = (
  state: DemoState,
  kind: DemoFsOperation['kind'],
  payload: Partial<DemoFsOperation> = {}
): DemoFsOperation => {
  const createdAt = nowIso();
  const operation: DemoFsOperation = {
    createdAt,
    destinationPath: String(payload.destinationPath || ''),
    failureCount: Math.max(0, Number(payload.failureCount || 0) || 0),
    failures: Array.isArray(payload.failures)
      ? payload.failures.map((entry) => ({
          error: String(entry?.error || 'Operation failed'),
          path: String(entry?.path || ''),
        }))
      : [],
    id: `fs-op-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    kind,
    manifest: Array.isArray(payload.manifest)
      ? payload.manifest.map((entry) => ({
          lastModified: Math.max(0, Number(entry?.lastModified || 0) || 0),
          relativePath: normalizeFsPath(String(entry?.relativePath || '')),
          size: Math.max(0, Number(entry?.size || 0) || 0),
        })).filter((entry) => entry.relativePath)
      : [],
    message: String(payload.message || 'Queued'),
    processedBytes: Math.max(0, Number(payload.processedBytes || 0) || 0),
    processedItems: Math.max(0, Number(payload.processedItems || 0) || 0),
    sourcePaths: Array.isArray(payload.sourcePaths) ? payload.sourcePaths.map((entry) => normalizeFsPath(String(entry))).filter(Boolean) : [],
    status: payload.status || 'queued',
    totalBytes: Math.max(0, Number(payload.totalBytes || 0) || 0),
    totalItems: Math.max(0, Number(payload.totalItems || 0) || 0),
    updatedAt: createdAt,
    uploadedFiles: Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles.map((entry) => normalizeFsPath(String(entry))).filter(Boolean) : [],
  };
  state.fsOperations.unshift(operation);
  state.fsOperations = state.fsOperations
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 24);
  return operation;
};

const updateDemoFsOperation = (state: DemoState, operationId: string, updater: (current: DemoFsOperation) => DemoFsOperation) => {
  const index = state.fsOperations.findIndex((entry) => entry.id === operationId);
  if (index === -1) {
    return null;
  }
  const next = updater(clone(state.fsOperations[index]));
  next.updatedAt = nowIso();
  state.fsOperations[index] = next;
  state.fsOperations = state.fsOperations
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 24);
  return next;
};

const isDemoFsOperationActive = (operation: DemoFsOperation) =>
  operation.status === 'queued' || operation.status === 'receiving' || operation.status === 'running' || operation.status === 'cancelling';

const requireSession = (state: DemoState) => {
  if (!state.sessionUser) {
    return jsonResponse({ error: 'Login required' }, 401);
  }
  return null;
};

const buildServiceResponse = (state: DemoState) => {
  const serviceCatalog = buildServiceCatalog(state);

  return {
    controller: {
      locked: state.controllerLocked,
      optionalServices,
    },
    lifecycle: buildLifecycleSummary(serviceCatalog),
    mediaWorkflow: buildMediaWorkflow(state, serviceCatalog),
    serviceCatalog,
    serviceGroups: buildServiceGroups(serviceCatalog),
    services: clone(state.services),
  };
};

const handleFsUpload = async (state: DemoState, url: URL, init?: RequestInit) => {
  const parentPath = normalizeFsPath(url.searchParams.get('path') || '');
  const fileName = String(url.searchParams.get('name') || 'upload.bin').trim() || 'upload.bin';
  const targetPath = normalizeFsPath(parentPath ? `${parentPath}/${fileName}` : fileName);
  const size = measureRequestBody(init?.body);

  state.nodes.set(targetPath, {
    modifiedAt: nowIso(),
    name: fileName,
    path: targetPath,
    size: size || 2048,
    type: 'file',
  });
  pushLog(state, 'info', 'Demo filesystem upload completed', { path: targetPath });
  return jsonResponse({ path: targetPath, success: true });
};

const handleDemoRequest = async (path: string, init?: RequestInit) => {
  const sessionError = !path.includes('/auth/login') && !path.includes('/auth/logout') ? requireSession(demoState) : null;
  if (sessionError) {
    return sessionError;
  }

  const url = new URL(path, `https://demo.local${getBasePath() || ''}`);
  const pathname = url.pathname.replace(getBasePath(), '') || '/';
  const method = String(init?.method || 'GET').toUpperCase();
  const body = parseJsonBody(init);

  if (pathname === '/api/auth/me' && method === 'GET') {
    return jsonResponse({ user: demoState.sessionUser });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    demoState.sessionUser = { role: 'admin', username: String(body.username || 'admin') || 'admin' };
    pushLog(demoState, 'info', 'Demo login success', { username: demoState.sessionUser.username });
    return jsonResponse({ success: true, user: demoState.sessionUser });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    pushLog(demoState, 'info', 'Demo logout');
    demoState.sessionUser = null;
    demoState.controllerLocked = true;
    return jsonResponse({ success: true });
  }
  if (pathname === '/api/dashboard' && method === 'GET') {
    return jsonResponse(buildDashboardPayload(demoState));
  }
  if (pathname === '/api/ui/bootstrap' && method === 'GET') {
    return jsonResponse(buildUiBootstrapPayload(demoState));
  }
  if (pathname.startsWith('/api/ui/workspaces/') && method === 'GET') {
    const workspaceKey = normalizeWorkspaceKey(pathname.split('/').pop() || '');
    if (!workspaceKey) {
      return jsonResponse({ error: 'Unknown workspace key' }, 404);
    }
    return jsonResponse(buildUiWorkspacePayload(demoState, workspaceKey));
  }
  if (pathname === '/api/telemetry' && method === 'GET') {
    return jsonResponse(buildTelemetryPayload(demoState));
  }
  if (pathname === '/api/services' && method === 'GET') {
    return jsonResponse(buildServiceResponse(demoState));
  }
  if (pathname === '/api/storage/protection' && method === 'GET') {
    const protection = buildMediaWorkflow(demoState, buildServiceCatalog(demoState)).storage?.protection || null;
    return jsonResponse({ events: [], storageProtection: protection });
  }
  if (pathname === '/api/storage/protection/recheck' && method === 'POST') {
    const protection = buildMediaWorkflow(demoState, buildServiceCatalog(demoState)).storage?.protection || null;
    pushLog(demoState, 'info', 'Demo storage recheck requested');
    return jsonResponse({ success: true, storageProtection: protection });
  }
  if (pathname === '/api/storage/protection/resume' && method === 'POST') {
    const protection = buildMediaWorkflow(demoState, buildServiceCatalog(demoState)).storage?.protection || null;
    pushLog(demoState, 'info', 'Demo storage resume requested');
    return jsonResponse({ success: true, resumed: [], failed: [], storageProtection: protection });
  }
  if (pathname === '/api/control/unlock' && method === 'POST') {
    if (!String(body.adminPassword || '').trim()) {
      return jsonResponse({ error: 'Admin password is required' }, 400);
    }
    demoState.controllerLocked = false;
    demoState.serviceUnlockExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    pushLog(demoState, 'info', 'Demo controller unlocked');
    return jsonResponse({ expiresAt: demoState.serviceUnlockExpiresAt, locked: false, success: true });
  }
  if (pathname === '/api/control/lock' && method === 'POST') {
    demoState.controllerLocked = true;
    demoState.serviceUnlockExpiresAt = null;
    pushLog(demoState, 'info', 'Demo controller locked');
    return jsonResponse({ locked: true, success: true });
  }
  if (pathname === '/api/control' && method === 'POST') {
    const service = String(body.service || '');
    const action = String(body.action || '');
    if (!optionalServices.includes(service)) {
      return jsonResponse({ error: 'Unknown service' }, 400);
    }
    if (demoState.controllerLocked) {
      return jsonResponse({ error: 'Service controller is locked' }, 423);
    }
    if (action === 'start' || action === 'restart') {
      demoState.services[service] = true;
    } else if (action === 'stop') {
      demoState.services[service] = false;
    }
    pushLog(demoState, 'info', 'Demo service control used', { action, service });
    return jsonResponse({ expectedRunning: action !== 'stop', output: '(demo)', running: demoState.services[service], success: true });
  }
  if (pathname === '/api/llm/state' && method === 'GET') {
    return jsonResponse(buildLlmStatePayload(demoState));
  }
  if (pathname === '/api/llm/models/select' && method === 'POST') {
    const modelId = String(body.modelId || '').trim();
    const model = demoState.llmModels.find((entry) => entry.id === modelId) || null;
    if (!model) {
      return jsonResponse({ error: 'Model not found' }, 404);
    }
    if (!model.installed) {
      return jsonResponse({ error: 'Model is not installed locally' }, 409);
    }
    demoState.llmActiveModelId = modelId;
    pushLog(demoState, 'info', 'Demo model selected', { modelId });
    return jsonResponse({ success: true, model, restartRequired: Boolean(demoState.services.llm) });
  }
  if (pathname === '/api/llm/models/add-local' && method === 'POST') {
    const label = String(body.label || '').trim() || 'Custom GGUF';
    const modelPath = String(body.path || '').trim();
    if (!modelPath) {
      return jsonResponse({ error: 'path is required' }, 400);
    }
    const modelId = `local-${Date.now()}`;
    const model = { id: modelId, label, source: 'custom' as const, path: modelPath, installed: true };
    demoState.llmModels.push(model);
    pushLog(demoState, 'info', 'Demo local model added', { modelId, path: modelPath });
    return jsonResponse({ success: true, model });
  }
  if (pathname === '/api/llm/models/pull' && method === 'POST') {
    const modelId = String(body.modelId || '').trim();
    const model = demoState.llmModels.find((entry) => entry.id === modelId) || null;
    if (!model) {
      return jsonResponse({ error: 'Preset model not found' }, 404);
    }
    if (model.installed) {
      return jsonResponse({ success: true, alreadyInstalled: true, model });
    }
    const jobId = `pull-${Date.now()}`;
    demoState.llmPullJobs.unshift({
      id: jobId,
      status: 'success',
      modelId,
      message: 'Download complete (demo)',
      updatedAt: nowIso(),
    });
    model.installed = true;
    pushLog(demoState, 'info', 'Demo model pull completed', { jobId, modelId });
    return jsonResponse({ success: true, jobId, modelId });
  }
  if (pathname.startsWith('/api/llm/models/pull/') && method === 'GET') {
    const jobId = pathname.split('/').pop() || '';
    const job = demoState.llmPullJobs.find((entry) => entry.id === jobId) || null;
    if (!job) {
      return jsonResponse({ error: 'Pull job not found' }, 404);
    }
    return jsonResponse(job);
  }
  if (pathname === '/api/llm/online/models/refresh' && method === 'POST') {
    return jsonResponse({ success: true, online: clone(demoState.llmOnline) });
  }
  if (pathname === '/api/llm/online/models/select' && method === 'POST') {
    const modelId = String(body.modelId || '').trim();
    const model = demoState.llmOnline.models.find((entry) => entry.id === modelId) || null;
    if (!model) {
      return jsonResponse({ error: 'A valid online model is required.' }, 400);
    }
    demoState.llmOnline.activeModelId = model.id;
    pushLog(demoState, 'info', 'Demo online model selected', { modelId: model.id });
    return jsonResponse({ success: true, model: clone(model) });
  }
  if (pathname === '/api/llm/conversations' && method === 'GET') {
    return jsonResponse({ conversations: clone(demoState.llmConversations) });
  }
  if (pathname.startsWith('/api/llm/conversations/') && pathname.endsWith('/messages') && method === 'GET') {
    const conversationId = Number(pathname.split('/')[4] || 0);
    const conversation = demoState.llmConversations.find((entry) => entry.id === conversationId) || null;
    if (!conversation) {
      return jsonResponse({ error: 'Conversation not found' }, 404);
    }
    return jsonResponse({
      conversation,
      messages: clone(demoState.llmMessagesByConversation[conversationId] || []),
    });
  }
  if (pathname.startsWith('/api/llm/conversations/') && method === 'DELETE') {
    const conversationId = Number(pathname.split('/')[4] || 0);
    demoState.llmConversations = demoState.llmConversations.filter((entry) => entry.id !== conversationId);
    delete demoState.llmMessagesByConversation[conversationId];
    return jsonResponse({ success: true, id: conversationId });
  }
  if (pathname === '/api/llm/chat' && method === 'POST') {
    const text = String(body.message || '').trim();
    if (!text) {
      return jsonResponse({ error: 'message is required' }, 400);
    }
    const mode = String(body.mode || 'local').toLowerCase() === 'online' ? 'online' : 'local';
    let conversationId = Number(body.conversationId || 0);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      conversationId = Math.max(0, ...demoState.llmConversations.map((entry) => entry.id)) + 1;
      demoState.llmConversations.unshift({
        id: conversationId,
        title: text.slice(0, 80),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      demoState.llmMessagesByConversation[conversationId] = [];
    }
    const activeModelId = mode === 'online'
      ? String(body.onlineModelId || demoState.llmOnline.activeModelId || '').trim()
      : demoState.llmActiveModelId;
    if (!activeModelId) {
      return jsonResponse({ error: mode === 'online' ? 'A valid online model is required.' : 'No active local model selected.' }, 400);
    }
    const userMessage = { id: Date.now(), role: 'user' as const, content: text, modelId: activeModelId, createdAt: nowIso() };
    const assistantMessage = {
      id: Date.now() + 1,
      role: 'assistant' as const,
      content: mode === 'online'
        ? `Demo online reply: processed "${text.slice(0, 120)}" with ${activeModelId}.`
        : `Demo local reply: processed "${text.slice(0, 120)}" with ${activeModelId}.`,
      modelId: activeModelId,
      createdAt: nowIso(),
    };
    demoState.llmMessagesByConversation[conversationId] ||= [];
    demoState.llmMessagesByConversation[conversationId].push(userMessage, assistantMessage);
    const conversation = demoState.llmConversations.find((entry) => entry.id === conversationId);
    if (conversation) {
      conversation.updatedAt = nowIso();
    }
    return jsonResponse({ success: true, conversationId, assistantMessage, mode });
  }
  if (pathname === '/api/openai/v1/models' && method === 'GET') {
    return jsonResponse({
      object: 'list',
      data: demoState.llmModels.filter((entry) => entry.installed).map((entry) => ({
        id: entry.id,
        object: 'model',
        owned_by: entry.source,
        created: 0,
      })),
      active_model: demoState.llmActiveModelId,
    });
  }
  if (pathname === '/api/openai/v1/chat/completions' && method === 'POST') {
    const incomingMessages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...incomingMessages].reverse().find((entry) => String(entry?.role || '') === 'user');
    const prompt = String(lastUser?.content || '').trim();
    return jsonResponse({
      id: `chatcmpl-demo-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: demoState.llmActiveModelId,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: `Demo OpenAI-compatible response for: ${prompt || 'no prompt'}`,
          },
        },
      ],
      usage: {
        prompt_tokens: 42,
        completion_tokens: 28,
        total_tokens: 70,
      },
    });
  }
  if (pathname === '/api/logging' && method === 'POST') {
    demoState.verboseLoggingEnabled = Boolean(body.enabled);
    pushLog(demoState, 'info', 'Demo verbose logging changed', { enabled: demoState.verboseLoggingEnabled });
    return jsonResponse({
      markdown: buildMarkdownLog(demoState.logs),
      success: true,
      verboseLoggingEnabled: demoState.verboseLoggingEnabled,
    });
  }
  if (pathname === '/api/drives' && method === 'GET') {
    return jsonResponse({
      agentInstalled: true,
      checkedAt: nowIso(),
      events: clone(demoState.driveEvents),
      manifest: {
        drives: clone(demoState.drives),
        generatedAt: nowIso(),
        intervalMs: 60000,
      },
      refreshIntervalMs: 60000,
    });
  }
  if (pathname === '/api/drives/check' && method === 'POST') {
    demoState.driveEvents.unshift({
      event: 'Manual demo drive check completed',
      level: 'info',
      timestamp: nowIso(),
    });
    pushLog(demoState, 'info', 'Demo drive check completed');
    return jsonResponse({
      agentInstalled: true,
      checkedAt: nowIso(),
      events: clone(demoState.driveEvents),
      manifest: {
        drives: clone(demoState.drives),
        generatedAt: nowIso(),
        intervalMs: 60000,
      },
      refreshIntervalMs: 60000,
    });
  }
  if (pathname === '/api/shares' && method === 'GET') {
    return jsonResponse({ shares: clone(demoState.shares) });
  }
  if (pathname === '/api/shares' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name) {
      return jsonResponse({ error: 'Share name is required' }, 400);
    }
    const pathKey = normalizeFsPath(name);
    const share: DemoShare = {
      createdAt: nowIso(),
      description: '',
      id: Math.max(0, ...demoState.shares.map((entry) => entry.id)) + 1,
      isHidden: false,
      isReadOnly: false,
      name,
      pathKey,
      permissions: [
        { accessLevel: 'write', subjectKey: 'admin', subjectType: 'role' },
      ],
      sourceType: 'folder',
      updatedAt: nowIso(),
    };
    demoState.shares.push(share);
    demoState.nodes.set(pathKey, makeNode(pathKey, 'directory'));
    pushLog(demoState, 'info', 'Demo share created', { name, pathKey });
    return jsonResponse({ share });
  }
  if (pathname.startsWith('/api/shares/') && method === 'PUT') {
    const id = Number(pathname.split('/').pop() || 0);
    const share = demoState.shares.find((entry) => entry.id === id);
    if (!share) {
      return jsonResponse({ error: 'Share not found' }, 404);
    }
    share.name = String(body.name || share.name);
    share.description = String(body.description || '');
    share.isHidden = Boolean(body.isHidden);
    share.isReadOnly = Boolean(body.isReadOnly);
    share.updatedAt = nowIso();
    share.permissions = [
      { accessLevel: 'write', subjectKey: 'admin', subjectType: 'role' },
      {
        accessLevel: normalizeAccessLevel(body.defaultRoleAccess),
        subjectKey: 'user',
        subjectType: 'role',
      },
      ...Array.isArray(body.userPermissions)
        ? (body.userPermissions as Array<Record<string, unknown>>).map((entry) => ({
            accessLevel: normalizeAccessLevel(entry.accessLevel),
            subjectKey: String(entry.username || ''),
            subjectType: 'user' as const,
          }))
        : [],
    ];
    pushLog(demoState, 'info', 'Demo share updated', { id, name: share.name });
    return jsonResponse({ share });
  }
  if (pathname === '/api/users' && method === 'GET') {
    return jsonResponse({ users: clone(demoState.users) });
  }
  if (pathname.match(/^\/api\/connections\/[^/]+\/disconnect$/) && method === 'POST') {
    const sessionId = pathname.split('/')[3] || '';
    if (sessionId === 'demo-session-admin') {
      return jsonResponse({ error: 'You cannot disconnect your current session' }, 400);
    }

    const connectionIndex = demoState.connections.findIndex((entry) => entry.sessionId === sessionId);
    if (connectionIndex === -1) {
      return jsonResponse({ error: 'Connection not found' }, 404);
    }

    const [connection] = demoState.connections.splice(connectionIndex, 1);
    pushLog(demoState, 'warn', 'Demo connection disconnected', { sessionId, username: connection.username });
    return jsonResponse({ sessionId, success: true, username: connection.username });
  }
  if (pathname === '/api/users' && method === 'POST') {
    const username = String(body.username || '').trim().toLowerCase();
    if (!username) {
      return jsonResponse({ error: 'Username is required' }, 400);
    }
    const user: DemoUser = {
      createdAt: nowIso(),
      id: Math.max(0, ...demoState.users.map((entry) => entry.id)) + 1,
      isDisabled: false,
      role: body.role === 'admin' ? 'admin' : 'user',
      updatedAt: nowIso(),
      username,
    };
    demoState.users.push(user);
    pushLog(demoState, 'info', 'Demo user created', { username });
    return jsonResponse({ user });
  }
  if (pathname.startsWith('/api/users/') && method === 'PUT') {
    const id = Number(pathname.split('/').pop() || 0);
    const user = demoState.users.find((entry) => entry.id === id);
    if (!user) {
      return jsonResponse({ error: 'User not found' }, 404);
    }
    user.role = body.role === 'admin' ? 'admin' : user.role;
    user.isDisabled = typeof body.isDisabled === 'boolean' ? body.isDisabled : user.isDisabled;
    user.updatedAt = nowIso();
    pushLog(demoState, 'info', 'Demo user updated', { id, username: user.username });
    return jsonResponse({ user });
  }
  if (pathname === '/api/fs/list' && method === 'GET') {
    return jsonResponse(buildFsPayload(demoState, url.searchParams.get('path') || ''));
  }
  if (pathname === '/api/fs/mkdir' && method === 'POST') {
    const name = String(body.name || '').trim();
    const parentPath = normalizeFsPath(String(body.path || ''));
    const nextPath = normalizeFsPath(parentPath ? `${parentPath}/${name}` : name);
    demoState.nodes.set(nextPath, makeNode(nextPath, 'directory'));
    pushLog(demoState, 'info', 'Demo folder created', { path: nextPath });
    return jsonResponse({ path: nextPath, success: true });
  }
  if (pathname === '/api/fs/rename' && method === 'POST') {
    const sourcePath = normalizeFsPath(String(body.path || ''));
    const name = String(body.name || '').trim();
    const targetPath = normalizeFsPath(`${parentFsPath(sourcePath)}/${name}`);
    renameNodeTree(demoState.nodes, sourcePath, targetPath);
    pushLog(demoState, 'info', 'Demo entry renamed', { from: sourcePath, to: targetPath });
    return jsonResponse({ path: targetPath, success: true });
  }
  if (pathname === '/api/fs/operations' && method === 'GET') {
    return jsonResponse({ operations: clone(demoState.fsOperations) });
  }
  if (pathname.startsWith('/api/fs/operations/') && method === 'GET') {
    const operationId = pathname.split('/').pop() || '';
    const operation = demoState.fsOperations.find((entry) => entry.id === operationId) || null;
    if (!operation) {
      return jsonResponse({ error: 'Filesystem operation not found' }, 404);
    }
    return jsonResponse(clone(operation));
  }
  if (pathname.match(/^\/api\/fs\/operations\/[^/]+\/control$/) && method === 'POST') {
    const operationId = pathname.split('/')[4] || '';
    const action = String(body.action || '').trim().toLowerCase();
    const operation = demoState.fsOperations.find((entry) => entry.id === operationId) || null;
    if (!operation) {
      return jsonResponse({ error: 'Filesystem operation not found' }, 404);
    }
    if (action === 'cancel') {
      if (!isDemoFsOperationActive(operation)) {
        return jsonResponse({ error: 'Operation is already complete', operation }, 409);
      }
      const next = updateDemoFsOperation(demoState, operationId, (current) => ({
        ...current,
        message: current.kind === 'delete'
          ? 'Recycle cancelled (demo)'
          : current.kind === 'move'
            ? 'Move cancelled (demo)'
            : current.kind === 'upload'
              ? 'Upload cancelled (demo)'
              : 'Copy cancelled (demo)',
        status: 'cancelled',
      }));
      return jsonResponse({ operation: next, success: true });
    }
    if (action === 'dismiss') {
      if (isDemoFsOperationActive(operation)) {
        return jsonResponse({ error: 'Only completed operations can be dismissed' }, 409);
      }
      demoState.fsOperations = demoState.fsOperations.filter((entry) => entry.id !== operationId);
      return jsonResponse({ dismissed: true, operationId, success: true });
    }
    return jsonResponse({ error: 'Unsupported operation control action' }, 400);
  }
  if (pathname === '/api/fs/operations/delete' && method === 'POST') {
    const sourcePaths = Array.isArray(body.paths)
      ? (body.paths as unknown[]).map((entry) => normalizeFsPath(String(entry))).filter(Boolean)
      : body.path
        ? [normalizeFsPath(String(body.path))]
        : [];
    sourcePaths.forEach((entryPath) => removeNodeTree(demoState.nodes, entryPath));
    const operation = createDemoFsOperation(demoState, 'delete', {
      message: 'Recycle complete (demo)',
      processedItems: sourcePaths.length,
      sourcePaths,
      status: 'success',
      totalItems: sourcePaths.length,
    });
    pushLog(demoState, 'info', 'Demo recycle operation completed', { count: sourcePaths.length, operationId: operation.id });
    return jsonResponse({ operation, operationId: operation.id, success: true }, 202);
  }
  if (pathname === '/api/fs/operations/transfer' && method === 'POST') {
    const destinationPath = normalizeFsPath(String(body.destinationPath || ''));
    const mode = body.mode === 'move' ? 'move' : 'copy';
    const sourcePaths = Array.isArray(body.sourcePaths)
      ? (body.sourcePaths as unknown[]).map((entry) => normalizeFsPath(String(entry))).filter(Boolean)
      : body.sourcePath
        ? [normalizeFsPath(String(body.sourcePath))]
        : [];

    sourcePaths.forEach((sourcePath) => {
      const targetPath = normalizeFsPath(`${destinationPath}/${sourcePath.split('/').pop() || sourcePath}`);
      cloneNodeTree(demoState.nodes, sourcePath, targetPath);
      if (mode === 'move') {
        removeNodeTree(demoState.nodes, sourcePath);
      }
    });
    const operation = createDemoFsOperation(demoState, mode, {
      destinationPath,
      message: `${mode === 'move' ? 'Move' : 'Copy'} complete (demo)`,
      processedItems: sourcePaths.length,
      sourcePaths,
      status: 'success',
      totalItems: sourcePaths.length,
    });
    pushLog(demoState, 'info', 'Demo transfer operation completed', { destinationPath, mode, operationId: operation.id, sourcePaths });
    return jsonResponse({ operation, operationId: operation.id, success: true }, 202);
  }
  if (pathname === '/api/fs/operations/upload' && method === 'POST') {
    const destinationPath = normalizeFsPath(String(body.destinationPath || ''));
    const manifest = Array.isArray(body.manifest)
      ? (body.manifest as Array<Record<string, unknown>>).map((entry) => ({
          lastModified: Math.max(0, Number(entry.lastModified || 0) || 0),
          relativePath: normalizeFsPath(String(entry.relativePath || '')),
          size: Math.max(0, Number(entry.size || 0) || 0),
        })).filter((entry) => entry.relativePath)
      : [];
    const totalBytes = manifest.reduce((sum, entry) => sum + entry.size, 0);
    const operation = createDemoFsOperation(demoState, 'upload', {
      destinationPath,
      manifest,
      message: 'Waiting for file data (demo)',
      status: 'receiving',
      totalBytes,
      totalItems: manifest.length,
      uploadedFiles: [],
    });
    return jsonResponse({ operation, operationId: operation.id, success: true }, 202);
  }
  if (pathname.match(/^\/api\/fs\/operations\/[^/]+\/file$/) && method === 'POST') {
    const operationId = pathname.split('/')[4] || '';
    const relativePath = normalizeFsPath(url.searchParams.get('relativePath') || '');
    const operation = updateDemoFsOperation(demoState, operationId, (current) => {
      const uploadedFiles = [...new Set([...current.uploadedFiles, relativePath])];
      const uploadedBytes = current.manifest
        .filter((entry) => uploadedFiles.includes(entry.relativePath))
        .reduce((sum, entry) => sum + entry.size, 0);
      return {
        ...current,
        message: `Received ${uploadedFiles.length}/${current.totalItems} files (demo)`,
        processedBytes: uploadedBytes,
        processedItems: uploadedFiles.length,
        uploadedFiles,
      };
    });
    if (!operation) {
      return jsonResponse({ error: 'Filesystem operation not found' }, 404);
    }
    return jsonResponse({ operation, success: true });
  }
  if (pathname.match(/^\/api\/fs\/operations\/[^/]+\/finalize$/) && method === 'POST') {
    const operationId = pathname.split('/')[4] || '';
    const operation = updateDemoFsOperation(demoState, operationId, (current) => {
      current.manifest.forEach((entry) => {
        const targetPath = normalizeFsPath(`${current.destinationPath}/${entry.relativePath}`);
        const parentPath = parentFsPath(targetPath);
        const segments = targetPath.split('/').filter(Boolean);
        let cursor = '';
        segments.slice(0, -1).forEach((segment) => {
          cursor = normalizeFsPath(cursor ? `${cursor}/${segment}` : segment);
          if (!demoState.nodes.has(cursor)) {
            demoState.nodes.set(cursor, makeNode(cursor, 'directory'));
          }
        });
        if (parentPath && !demoState.nodes.has(parentPath)) {
          demoState.nodes.set(parentPath, makeNode(parentPath, 'directory'));
        }
        demoState.nodes.set(targetPath, makeNode(targetPath, 'file', entry.size || 2048));
      });
      return {
        ...current,
        message: 'Upload complete (demo)',
        processedBytes: current.totalBytes,
        processedItems: current.totalItems,
        status: 'success',
      };
    });
    if (!operation) {
      return jsonResponse({ error: 'Filesystem operation not found' }, 404);
    }
    pushLog(demoState, 'info', 'Demo upload operation finalized', { destinationPath: operation.destinationPath, operationId });
    return jsonResponse({ operation, operationId, success: true }, 202);
  }
  if (pathname === '/api/fs/delete' && method === 'POST') {
    const paths = Array.isArray(body.paths)
      ? (body.paths as unknown[]).map((entry) => normalizeFsPath(String(entry)))
      : body.path
        ? [normalizeFsPath(String(body.path))]
        : [];
    paths.forEach((entryPath) => removeNodeTree(demoState.nodes, entryPath));
    pushLog(demoState, 'info', 'Demo entries recycled', { count: paths.length });
    return jsonResponse({ failureCount: 0, recycled: true, successCount: paths.length });
  }
  if (pathname === '/api/fs/paste' && method === 'POST') {
    const destinationPath = normalizeFsPath(String(body.destinationPath || ''));
    const mode = body.mode === 'move' ? 'move' : 'copy';
    const sourcePaths = Array.isArray(body.sourcePaths)
      ? (body.sourcePaths as unknown[]).map((entry) => normalizeFsPath(String(entry)))
      : body.sourcePath
        ? [normalizeFsPath(String(body.sourcePath))]
        : [];

    sourcePaths.forEach((sourcePath) => {
      const targetPath = normalizeFsPath(`${destinationPath}/${sourcePath.split('/').pop() || sourcePath}`);
      cloneNodeTree(demoState.nodes, sourcePath, targetPath);
      if (mode === 'move') {
        removeNodeTree(demoState.nodes, sourcePath);
      }
    });
    pushLog(demoState, 'info', 'Demo paste completed', { destinationPath, mode, sourcePaths });
    return jsonResponse({ failureCount: 0, path: destinationPath, successCount: sourcePaths.length });
  }
  if (pathname === '/api/fs/upload' && method === 'POST') {
    return handleFsUpload(demoState, url, init);
  }
  if (pathname === '/api/ftp/defaults' && method === 'GET') {
    return jsonResponse(clone(demoState.ftpDefaults));
  }
  if (pathname === '/api/ftp/favourites' && method === 'GET') {
    return jsonResponse({ favourites: clone(demoState.ftpFavourites) });
  }
  if (pathname === '/api/ftp/favourites' && method === 'POST') {
    const favourite: DemoFtpFavourite = {
      createdAt: nowIso(),
      host: String(body.host || demoState.ftpDefaults.host),
      id: Math.max(0, ...demoState.ftpFavourites.map((entry) => entry.id)) + 1,
      mount: {
        mountName: String(body.mountName || body.name || 'Remote'),
        mountPoint: `/data/data/com.termux/files/home/Drives/${String(body.mountName || body.name || 'Remote')}`,
        mounted: false,
        remoteName: String(body.name || 'Remote'),
        running: false,
        state: 'unmounted',
      },
      mountName: String(body.mountName || body.name || 'Remote'),
      name: String(body.name || 'Remote'),
      password: String(body.password || ''),
      port: Number(body.port || 21),
      protocol: 'ftp',
      remotePath: String(body.remotePath || '/'),
      secure: Boolean(body.secure),
      updatedAt: nowIso(),
      username: String(body.username || 'anonymous'),
    };
    demoState.ftpFavourites.push(favourite);
    pushLog(demoState, 'info', 'Demo FTP favourite created', { id: favourite.id, name: favourite.name });
    return jsonResponse({ favourite });
  }
  if (pathname.startsWith('/api/ftp/favourites/') && pathname.endsWith('/mount') && method === 'POST') {
    const id = Number(pathname.split('/')[4] || 0);
    const favourite = demoState.ftpFavourites.find((entry) => entry.id === id);
    if (!favourite) {
      return jsonResponse({ error: 'Favourite not found' }, 404);
    }
    favourite.mount = {
      ...favourite.mount,
      mounted: true,
      pid: 9000 + id,
      running: true,
      state: 'mounted',
    };
    pushLog(demoState, 'info', 'Demo FTP favourite mounted', { id, name: favourite.name });
    return jsonResponse({ favourite, mount: favourite.mount });
  }
  if (pathname.startsWith('/api/ftp/favourites/') && pathname.endsWith('/unmount') && method === 'POST') {
    const id = Number(pathname.split('/')[4] || 0);
    const favourite = demoState.ftpFavourites.find((entry) => entry.id === id);
    if (!favourite) {
      return jsonResponse({ error: 'Favourite not found' }, 404);
    }
    favourite.mount = {
      ...favourite.mount,
      mounted: false,
      pid: null,
      running: false,
      state: 'unmounted',
    };
    pushLog(demoState, 'info', 'Demo FTP favourite unmounted', { id, name: favourite.name });
    return jsonResponse({ favourite, mount: favourite.mount });
  }
  if (pathname.startsWith('/api/ftp/favourites/') && method === 'PUT') {
    const id = Number(pathname.split('/')[4] || 0);
    const favourite = demoState.ftpFavourites.find((entry) => entry.id === id);
    if (!favourite) {
      return jsonResponse({ error: 'Favourite not found' }, 404);
    }
    favourite.name = String(body.name || favourite.name);
    favourite.host = String(body.host || favourite.host);
    favourite.port = Number(body.port || favourite.port);
    favourite.username = String(body.username || favourite.username);
    favourite.secure = Boolean(body.secure);
    favourite.remotePath = String(body.remotePath || favourite.remotePath);
    favourite.mountName = String(body.mountName || favourite.mountName);
    favourite.updatedAt = nowIso();
    pushLog(demoState, 'info', 'Demo FTP favourite updated', { id, name: favourite.name });
    return jsonResponse({ favourite });
  }
  if (pathname.startsWith('/api/ftp/favourites/') && method === 'DELETE') {
    const id = Number(pathname.split('/')[4] || 0);
    demoState.ftpFavourites = demoState.ftpFavourites.filter((entry) => entry.id !== id);
    pushLog(demoState, 'info', 'Demo FTP favourite deleted', { id });
    return jsonResponse({ success: true });
  }
  if (pathname === '/api/ftp/list' && method === 'POST') {
    const pathValue = String(body.path || '/');
    const listing = getRemoteListing(demoState, pathValue);
    pushLog(demoState, 'info', 'Demo FTP directory listed', { count: listing.entries.length, path: listing.path });
    return jsonResponse(listing);
  }
  if (pathname === '/api/ftp/download' && method === 'POST') {
    return jsonResponse({ entryType: body.entryType || 'file', localPath: `~/Drives/Downloads/${nowIso().slice(11, 19).replace(/:/g, '')}` });
  }
  if (pathname === '/api/ftp/upload' && method === 'POST') {
    pushLog(demoState, 'info', 'Demo FTP upload simulated', { remotePath: body.remotePath });
    return jsonResponse({ localPath: body.localPath, remotePath: body.remotePath, success: true });
  }
  if (pathname === '/api/ftp/mkdir' && method === 'POST') {
    const remotePath = normalizeRemotePath(String(body.remotePath || '/new-folder'));
    demoState.remoteNodes.set(remotePath, makeRemoteNode(remotePath, 'directory'));
    pushLog(demoState, 'info', 'Demo FTP folder created', { remotePath });
    return jsonResponse({ remotePath, success: true });
  }

  return jsonResponse({ error: `Demo endpoint not implemented: ${method} ${pathname}` }, 404);
};

export const appFetch = async (input: string, init?: RequestInit) => {
  if (!isDemoMode()) {
    return fetch(input, { ...init, credentials: init?.credentials || 'include' });
  }

  return handleDemoRequest(input, init);
};

export const createDemoDownloadUrl = (relativePath: string) => createDownloadResponse(relativePath);

export const getDemoTerminalFrameUrl = () => withBasePath('/term');

export const getDemoTerminalLines = () => [
  'admin@hmstx:~$ uptime',
  ' 14:22:11 up 2 days, 3:14, load average: 1.02, 0.84, 0.73',
  'admin@hmstx:~$ ls ~/Drives',
  'C  Media  Projects  PS4',
  'admin@hmstx:~$ systemctl status jellyfin',
  'jellyfin.service - active (running) [demo output]',
];
