import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRIVE_PAYLOAD,
  formatBytes,
  formatDuration,
  formatRate,
  normalizeDrivePayload,
} from './dashboard-utils';

describe('dashboard-utils', () => {
  it('formats bytes, rates and durations', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatRate(1024)).toBe('1 KB/s');
    expect(formatDuration(5 * 60 * 1000)).toBe('5m');
    expect(formatDuration(125 * 60 * 1000)).toBe('2h 5m');
  });

  it('normalizes missing payload values with defaults', () => {
    expect(normalizeDrivePayload(null)).toEqual(EMPTY_DRIVE_PAYLOAD);
    expect(normalizeDrivePayload({
      refreshIntervalMs: 1000,
      events: [],
      manifest: { drives: [] },
    }).refreshIntervalMs).toBe(60000);
  });
});
