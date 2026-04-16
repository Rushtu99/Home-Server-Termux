const normalizeStringArray = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

const normalizeBoolish = (value, fallbackValue = true) => {
  if (value == null) {
    return fallbackValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallbackValue;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  return fallbackValue;
};

const normalizeStorageRoleState = (value = {}) => ({
  drives: normalizeStringArray(value?.drives),
  healthy: normalizeBoolish(value?.healthy, true),
  reason: String(value?.reason || ''),
  roots: normalizeStringArray(value?.roots),
});

const buildStorageBlockReasonForService = (serviceName, storageProtection) => {
  const vaultHealthy = storageProtection?.vault?.healthy !== false;
  const scratchHealthy = storageProtection?.scratch?.healthy !== false;

  if (!vaultHealthy && !scratchHealthy) {
    return 'Blocked by storage watchdog: vault and scratch are unavailable.';
  }

  if (!scratchHealthy && ['qbittorrent', 'media-workflow'].includes(serviceName)) {
    const detail = storageProtection?.scratch?.reason || storageProtection?.reason || 'scratch storage unavailable';
    return `Blocked by storage watchdog: ${detail}`;
  }

  if (!vaultHealthy && ['jellyfin', 'bazarr', 'media-workflow'].includes(serviceName)) {
    const detail = storageProtection?.vault?.reason || storageProtection?.reason || 'vault storage unavailable';
    return `Blocked by storage watchdog: ${detail}`;
  }

  if (storageProtection?.reason) {
    return `Blocked by storage watchdog: ${storageProtection.reason}`;
  }

  return 'Blocked by storage watchdog: required media storage is unavailable.';
};

const getStorageBlockForService = (serviceName, storageProtection) => {
  if (!storageProtection || !Array.isArray(storageProtection.blockedServices)) {
    return { blocked: false, reason: '' };
  }

  if (!storageProtection.blockedServices.includes(serviceName)) {
    return { blocked: false, reason: '' };
  }

  return {
    blocked: true,
    reason: buildStorageBlockReasonForService(serviceName, storageProtection),
    resumeRequired: Boolean(storageProtection.resumeRequired)
      && Array.isArray(storageProtection.stoppedByWatchdog)
      && storageProtection.stoppedByWatchdog.includes(serviceName),
  };
};

module.exports = {
  buildStorageBlockReasonForService,
  getStorageBlockForService,
  normalizeStorageRoleState,
  normalizeStringArray,
};
