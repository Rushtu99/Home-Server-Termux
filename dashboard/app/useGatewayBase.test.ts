import { describe, expect, it } from 'vitest';
import { useGatewayBase } from './useGatewayBase';

describe('useGatewayBase', () => {
  it('returns local gateway URL for non-demo mode', () => {
    const value = useGatewayBase();
    expect(typeof value).toBe('string');
    expect(value.startsWith('http')).toBe(true);
  });
});
