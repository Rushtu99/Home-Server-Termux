const { parseDurationMs } = require('../lib/time');

describe('parseDurationMs', () => {
  it('uses fallback for blank/invalid values', () => {
    expect(parseDurationMs('', 500)).toBe(500);
    expect(parseDurationMs('nope', 900)).toBe(900);
  });

  it('parses integer milliseconds and unit suffix values', () => {
    expect(parseDurationMs('1200', 1)).toBe(1200);
    expect(parseDurationMs('5s', 1)).toBe(5000);
    expect(parseDurationMs('2m', 1)).toBe(120000);
    expect(parseDurationMs('1h', 1)).toBe(3600000);
    expect(parseDurationMs('1d', 1)).toBe(86400000);
  });

  it('falls back for non-positive numeric values', () => {
    expect(parseDurationMs('0', 250)).toBe(250);
  });
});
