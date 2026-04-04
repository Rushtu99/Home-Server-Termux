import { describe, expect, it } from 'vitest';
import { getBasePath, isDemoMode, withBasePath } from './demo-mode';

describe('demo-mode helpers', () => {
  it('returns stable values based on build-time env', () => {
    expect(typeof isDemoMode()).toBe('boolean');
    expect(typeof getBasePath()).toBe('string');
  });

  it('prefixes paths with base path', () => {
    const prefixed = withBasePath('/term');
    if (getBasePath()) {
      expect(prefixed.startsWith(getBasePath())).toBe(true);
    } else {
      expect(prefixed).toBe('/term');
    }
  });
});
