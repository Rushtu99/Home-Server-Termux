const {
  buildStorageBlockReasonForService,
  getStorageBlockForService,
  normalizeStorageRoleState,
  normalizeStringArray,
} = require('../lib/storage-protection');

describe('storage protection helpers', () => {
  it('normalizes string arrays and role state', () => {
    expect(normalizeStringArray([' a ', '', null, 'b'])).toEqual(['a', 'b']);
    expect(normalizeStorageRoleState({
      drives: [' /d '],
      healthy: false,
      reason: 'bad',
      roots: [' /r '],
    })).toEqual({
      drives: ['/d'],
      healthy: false,
      reason: 'bad',
      roots: ['/r'],
    });
  });

  it('builds reason strings for degraded states', () => {
    expect(buildStorageBlockReasonForService('qbittorrent', {
      scratch: { healthy: false, reason: 'scratch low' },
      vault: { healthy: true },
      reason: '',
    })).toContain('scratch low');

    expect(buildStorageBlockReasonForService('jellyfin', {
      scratch: { healthy: true },
      vault: { healthy: false, reason: 'vault down' },
      reason: '',
    })).toContain('vault down');
  });

  it('returns block metadata only for blocked services', () => {
    const state = {
      blockedServices: ['qbittorrent'],
      resumeRequired: true,
      stoppedByWatchdog: ['qbittorrent'],
      scratch: { healthy: false, reason: 'scratch unavailable' },
      vault: { healthy: true },
      reason: '',
    };
    expect(getStorageBlockForService('qbittorrent', state)).toEqual({
      blocked: true,
      reason: 'Blocked by storage watchdog: scratch unavailable',
      resumeRequired: true,
    });
    expect(getStorageBlockForService('jellyfin', state)).toEqual({
      blocked: false,
      reason: '',
    });
  });
});
