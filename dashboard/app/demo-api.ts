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

type DemoFtpEntry = {
  modifiedAt?: string;
  name: string;
  permissions?: string;
  rawModifiedAt?: string;
  size: number;
  type: 'file' | 'directory';
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
  blocker?: string;
  controlMode: 'always_on' | 'optional';
  description: string;
  group: 'platform' | 'media' | 'arr' | 'data' | 'access';
  key: string;
  lastCheckedAt?: string | null;
  lastTransitionAt?: string | null;
  label: string;
  latencyMs?: number | null;
  placeholder: boolean;
  route?: string;
  status: 'working' | 'stopped' | 'stalled' | 'unavailable';
  statusReason?: string;
  surface: 'home' | 'media' | 'arr' | 'terminal' | 'settings' | 'ftp';
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
  { available: true, controlMode: 'always_on', description: 'Handles automated and manual torrent downloads for the media stack.', group: 'media', key: 'qbittorrent', label: 'qBittorrent', placeholder: false, route: '/qb/', status: 'working', surface: 'media' },
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
];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const textResponse = (body: string, status = 200, contentType = 'text/plain; charset=utf-8') =>
  new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
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

const parentRemotePath = (value = '/') => {
  const parts = normalizeRemotePath(value).split('/').filter(Boolean);
  parts.pop();
  return `/${parts.join('/')}` || '/';
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

const optionalServices = ['ftp', 'copyparty', 'syncthing', 'samba', 'sshd'];
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

const buildServiceCatalog = (state: DemoState): DemoServiceCatalogEntry[] =>
  SERVICE_META.map((entry) => {
    if (!entry.available) {
      const unavailableEntry = {
        ...clone(entry),
        avgLatencyMs: null,
        lastCheckedAt: nowIso(),
        lastTransitionAt: nowIso(),
        latencyMs: null,
        uptimePct: null,
      };
      return {
        ...unavailableEntry,
        statusReason: statusReasonForDemoService(unavailableEntry),
      };
    }

    const running = Boolean(state.services[entry.key]);
    const status = entry.controlMode === 'optional'
      ? (running ? 'working' : 'stopped')
      : (running ? 'working' : 'stalled');
    const latencyMs = running ? demoServiceLatency[entry.key] || 44 : null;

    return {
      ...entry,
      avgLatencyMs: latencyMs,
      lastCheckedAt: nowIso(),
      lastTransitionAt: nowIso(),
      latencyMs,
      status,
      statusReason: statusReasonForDemoService({
        ...entry,
        latencyMs,
        status,
      }),
      uptimePct: running ? 99.4 : 96.1,
    };
  });

const buildServiceGroups = (catalog: DemoServiceCatalogEntry[]) =>
  catalog.reduce<Record<string, string[]>>((acc, entry) => {
    acc[entry.group] ||= [];
    acc[entry.group].push(entry.key);
    return acc;
  }, {});

const buildDashboardPayload = (state: DemoState) => {
  const serviceCatalog = buildServiceCatalog(state);

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
  serviceGroups: buildServiceGroups(serviceCatalog),
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
    logs: dashboard.logs,
    monitor: dashboard.monitor,
    serviceCatalog: dashboard.serviceCatalog,
    serviceController: dashboard.serviceController,
    serviceGroups: dashboard.serviceGroups,
    services: dashboard.services,
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
    serviceCatalog,
    serviceGroups: buildServiceGroups(serviceCatalog),
    services: clone(state.services),
  };
};

const handleFsUpload = async (state: DemoState, url: URL, init?: RequestInit) => {
  const parentPath = normalizeFsPath(url.searchParams.get('path') || '');
  const fileName = String(url.searchParams.get('name') || 'upload.bin').trim() || 'upload.bin';
  const targetPath = normalizeFsPath(parentPath ? `${parentPath}/${fileName}` : fileName);
  let size = 0;

  if (typeof init?.body === 'string') {
    size = init.body.length;
  } else if (init?.body instanceof ArrayBuffer) {
    size = init.body.byteLength;
  } else if (ArrayBuffer.isView(init?.body as ArrayBufferView)) {
    size = (init?.body as ArrayBufferView).byteLength;
  }

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
  if (pathname === '/api/telemetry' && method === 'GET') {
    return jsonResponse(buildTelemetryPayload(demoState));
  }
  if (pathname === '/api/services' && method === 'GET') {
    return jsonResponse(buildServiceResponse(demoState));
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
