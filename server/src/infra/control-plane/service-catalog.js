const DEFAULT_GROUP = 'platform';

const GROUP_MAP = {
  ai: 'ai',
  arr: 'media',
  data: 'media',
  downloads: 'media',
  access: 'fileshare',
  media: 'media',
  platform: 'platform',
};

const SERVICE_OVERRIDES = {
  ftp: { group: 'fileshare', type: 'service' },
  jellyfin: { dependencies: ['redis'], type: 'service' },
  jellyseerr: { dependencies: ['jellyfin', 'sonarr', 'radarr', 'prowlarr'], type: 'service' },
  llm: { group: 'ai', type: 'service' },
  nginx: { group: 'platform', type: 'service' },
  postgres: { dependencies: ['redis'], type: 'service' },
  tailscale: { group: 'network', type: 'service' },
};

const WORKER_OVERRIDES = {
  'jellyfin-library-sync': { dependencies: ['jellyfin'], group: 'workers' },
  'media-importer': { dependencies: ['qbittorrent', 'jellyfin'], group: 'workers' },
  'media-workflow': { dependencies: ['media-importer'], group: 'workers' },
  'storage-watchdog': { dependencies: ['usb-mount-service'], group: 'workers' },
  'usb-mount-service': { dependencies: [], group: 'workers' },
};

const GROUP_ORDER = ['platform', 'fileshare', 'media', 'ai', 'network', 'workers'];

const extractWrapper = (command = '') => {
  const text = String(command || '');
  const match = text.match(/([\w./-]+\.sh)/);
  return match ? match[1] : null;
};

const toHealthCheck = (serviceKey, entry) => ({
  command: entry?.check || null,
  intervalMs: serviceKey === 'storage-watchdog' ? 8000 : 10000,
  type: entry?.port ? 'command+tcp' : 'command',
});

const normalizeGroup = (group) => {
  const normalized = GROUP_MAP[String(group || '').toLowerCase()] || String(group || '').toLowerCase();
  return GROUP_ORDER.includes(normalized) ? normalized : DEFAULT_GROUP;
};

const buildCatalogEntries = ({
  serviceCatalog = [],
  serviceCommands = {},
  workerCommands = {},
  optionalServiceNames = [],
  manageableServiceNames = [],
} = {}) => {
  const optionalSet = new Set(optionalServiceNames.map((entry) => String(entry)));
  const manageableSet = new Set(manageableServiceNames.map((entry) => String(entry)));

  const baseEntries = serviceCatalog.map((entry) => {
    const key = String(entry.key || '');
    const overrides = SERVICE_OVERRIDES[key] || {};
    const commands = serviceCommands[key] || {};
    const wrapper = extractWrapper(commands.start || commands.restart || commands.stop || '');

    return {
      available: Boolean(entry.available),
      bind: {
        host: entry.host || null,
        port: Number.isFinite(Number(entry.port)) ? Number(entry.port) : null,
      },
      capabilities: {
        controllable: manageableSet.has(key),
        installChecked: true,
        optional: optionalSet.has(key),
      },
      controlMode: entry.controlMode || (optionalSet.has(key) ? 'optional' : 'always_on'),
      dependencies: Array.isArray(overrides.dependencies) ? [...overrides.dependencies] : [],
      description: entry.description || '',
      group: normalizeGroup(overrides.group || entry.group),
      healthCheck: toHealthCheck(key, commands),
      key,
      label: entry.label || key,
      legacyAliases: [key],
      reason: entry.reason || entry.statusReason || entry.blocker || '',
      route: entry.route || null,
      state: entry.state || null,
      status: entry.status || 'unknown',
      surface: entry.surface || null,
      type: overrides.type || 'service',
      visibility: 'visible',
      wrapper: {
        command: wrapper,
        statusJson: true,
      },
    };
  });

  const workerEntries = Object.entries(workerCommands).map(([key, commands]) => {
    const overrides = WORKER_OVERRIDES[key] || {};
    const wrapper = extractWrapper(commands.start || commands.restart || commands.status || '');
    return {
      available: true,
      bind: {
        host: null,
        port: null,
      },
      capabilities: {
        controllable: true,
        installChecked: true,
        optional: true,
      },
      controlMode: 'optional',
      dependencies: Array.isArray(overrides.dependencies) ? [...overrides.dependencies] : [],
      description: `Workflow worker adapter for ${key}.`,
      group: normalizeGroup(overrides.group || 'workers'),
      healthCheck: toHealthCheck(key, commands),
      key,
      label: key,
      legacyAliases: [key],
      reason: '',
      route: null,
      state: null,
      status: 'unknown',
      surface: 'admin',
      type: 'worker',
      visibility: 'visible',
      wrapper: {
        command: wrapper,
        statusJson: true,
      },
    };
  });

  const merged = [...baseEntries, ...workerEntries];
  merged.sort((left, right) => {
    const groupOrder = GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group);
    if (groupOrder !== 0) {
      return groupOrder;
    }
    return String(left.label || left.key).localeCompare(String(right.label || right.key));
  });

  return merged;
};

module.exports = {
  buildCatalogEntries,
  GROUP_ORDER,
};
