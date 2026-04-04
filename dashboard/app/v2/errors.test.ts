import { describe, expect, it } from 'vitest';
import { toErrorMessage } from './errors';

describe('toErrorMessage', () => {
  it('handles Error instances and string values', () => {
    expect(toErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(toErrorMessage('plain', 'fallback')).toBe('plain');
  });

  it('uses fallback for nullish and empty-ish values', () => {
    expect(toErrorMessage(null, 'fallback')).toBe('fallback');
    expect(toErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('stringifies non-error objects', () => {
    expect(toErrorMessage({ code: 1 }, 'fallback')).toContain('[object Object]');
  });
});
