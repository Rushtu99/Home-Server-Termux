const normalizeStringArray = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

const normalizeStorageRoleState = (value = {}) => ({
  drives: normalizeStringArray(value?.drives),
  healthy: value?.healthy !== false,
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
