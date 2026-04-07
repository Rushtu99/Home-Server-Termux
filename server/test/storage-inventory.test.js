const {
  classifyStorageMount,
  parseMountTypesFromOutput,
  parseStorageInventoryFromOutput,
} = require('../lib/storage-inventory');

describe('storage inventory helpers', () => {
  it('classifies mount categories', () => {
    expect(classifyStorageMount('/data/user/0')).toBe('internal');
    expect(classifyStorageMount('/storage/emulated')).toBe('shared');
    expect(classifyStorageMount('/storage/ABCD-1234')).toBe('external');
    expect(classifyStorageMount('/system')).toBe('system');
  });

  it('parses mount type map from mount command output', () => {
    const map = parseMountTypesFromOutput(
      '/dev/block/dm-7 on /data type f2fs (rw)\n' +
      '/dev/fuse on /storage/emulated type fuse (rw)\n'
    );
    expect(map.get('/data')).toBe('f2fs');
    expect(map.get('/storage/emulated')).toBe('fuse');
  });

  it('parses and dedupes storage inventory rows', () => {
    const df = [
      'Filesystem 1024-blocks Used Available Capacity Mounted on',
      '/dev/block/dm-7 1000 400 600 40% /data',
      '/dev/fuse 1000 400 600 40% /storage/emulated',
      '/dev/block/sda1 2000 1000 1000 50% /storage/ABCD-1234',
      'tmpfs 500 20 480 4% /apex',
    ].join('\n');
    const mountTypes = new Map([
      ['/data', 'f2fs'],
      ['/storage/emulated', 'fuse'],
      ['/storage/ABCD-1234', 'exfat'],
      ['/apex', 'tmpfs'],
    ]);
    const { mounts, summary } = parseStorageInventoryFromOutput(df, mountTypes, new Set(['f2fs', 'fuse', 'exfat']));
    expect(mounts.map((m) => m.mount)).toEqual(['/storage/emulated', '/storage/ABCD-1234']);
    expect(summary.totalSize).toBe((1000 + 2000) * 1024);
    expect(summary.totalUsed).toBe((400 + 1000) * 1024);
  });
});
