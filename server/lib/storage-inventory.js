const DEFAULT_STORAGE_FS_TYPES = new Set([
  'ext2',
  'ext3',
  'ext4',
  'f2fs',
  'vfat',
  'exfat',
  'fuseblk',
  'ntfs',
  'tmpfs',
]);

const classifyStorageMount = (mountPoint) => {
  if (mountPoint === '/data' || mountPoint.startsWith('/data/')) {
    return 'internal';
  }

  if (mountPoint === '/storage/emulated' || mountPoint.startsWith('/mnt/user/') || mountPoint.startsWith('/mnt/pass_through/')) {
    return 'shared';
  }

  if ((mountPoint.startsWith('/storage/') && !mountPoint.startsWith('/storage/emulated')) || mountPoint.startsWith('/mnt/media_rw/')) {
    return 'external';
  }

  return 'system';
};

const preferredMountScore = (mountPoint) => {
  if (mountPoint === '/storage/emulated') {
    return 4;
  }

  if (mountPoint.startsWith('/storage/') && !mountPoint.startsWith('/storage/emulated')) {
    return 3;
  }

  if (mountPoint === '/data') {
    return 2;
  }

  return 1;
};

const parseMountTypesFromOutput = (mountOutput = '') => {
  const mountTypes = new Map();

  for (const line of String(mountOutput || '').split('\n')) {
    const match = line.match(/^.+ on (\S+) type (\S+) \(.+\)$/);
    if (!match) {
      continue;
    }
    mountTypes.set(match[1], match[2]);
  }

  return mountTypes;
};

const parseStorageInventoryFromOutput = (dfOutput = '', mountTypes = new Map(), storageFsTypes = DEFAULT_STORAGE_FS_TYPES) => {
  const mounts = [];
  const dedupeByPool = new Map();

  for (const line of String(dfOutput || '').split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) {
      continue;
    }

    const filesystem = parts[0];
    const mountPoint = parts[5];
    const category = classifyStorageMount(mountPoint);

    if (category === 'system') {
      continue;
    }

    const fsType = mountTypes.get(mountPoint) || '';
    if (fsType && !storageFsTypes.has(fsType)) {
      continue;
    }

    const size = (Number(parts[1]) || 0) * 1024;
    const used = (Number(parts[2]) || 0) * 1024;
    const available = (Number(parts[3]) || 0) * 1024;
    const usePercent = Number(String(parts[4]).replace('%', '')) || 0;
    const entry = {
      filesystem,
      fsType,
      size,
      used,
      available,
      usePercent,
      mount: mountPoint,
      category,
    };

    const duplicateKey =
      mountPoint === '/data' || mountPoint === '/storage/emulated'
        ? `${size}:${used}:${available}:primary`
        : `${filesystem}:${mountPoint}`;
    const existing = dedupeByPool.get(duplicateKey);

    if (!existing || preferredMountScore(mountPoint) > preferredMountScore(existing.mount)) {
      dedupeByPool.set(duplicateKey, entry);
    }
  }

  mounts.push(...dedupeByPool.values());
  mounts.sort((a, b) => {
    const categoryOrder = ['shared', 'external', 'internal', 'system'];
    const aIndex = categoryOrder.indexOf(a.category);
    const bIndex = categoryOrder.indexOf(b.category);
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return a.mount.localeCompare(b.mount);
  });

  const summary = mounts.reduce(
    (acc, mount) => {
      acc.totalSize += mount.size;
      acc.totalUsed += mount.used;
      return acc;
    },
    { totalSize: 0, totalUsed: 0 }
  );

  return { mounts, summary };
};

module.exports = {
  DEFAULT_STORAGE_FS_TYPES,
  classifyStorageMount,
  parseMountTypesFromOutput,
  parseStorageInventoryFromOutput,
  preferredMountScore,
};
