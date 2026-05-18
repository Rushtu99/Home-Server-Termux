import { describe, expect, it } from 'vitest';
import { resolveGatewayBase } from './gateway-base';
import { useGatewayBase } from './useGatewayBase';

describe('useGatewayBase', () => {
  it('returns an absolute URL in browser context', () => {
    const value = useGatewayBase();
    expect(typeof value).toBe('string');
    expect(value.startsWith('http')).toBe(true);
  });
});

describe('resolveGatewayBase', () => {
  it('uses demo base path when demo mode is enabled', () => {
    const value = resolveGatewayBase(
      {
        origin: 'https://example.com',
        protocol: 'https:',
        hostname: 'example.com',
        host: 'example.com',
        port: '',
      },
      { demoMode: true, basePath: '/Home-Server-Termux' }
    );

    expect(value).toBe('https://example.com/Home-Server-Termux');
  });

  it('maps local dev port 3000 to backend 4000', () => {
    const value = resolveGatewayBase({
      origin: 'http://127.0.0.1:3000',
      protocol: 'http:',
      hostname: '127.0.0.1',
      host: '127.0.0.1:3000',
      port: '3000',
    });

    expect(value).toBe('http://127.0.0.1:4000');
  });

  it('prefers explicit backend origin override', () => {
    const value = resolveGatewayBase(
      {
        origin: 'http://127.0.0.1:3000',
        protocol: 'http:',
        hostname: '127.0.0.1',
        host: '127.0.0.1:3000',
        port: '3000',
      },
      { backendOrigin: 'https://api.example.net/' }
    );

    expect(value).toBe('https://api.example.net');
  });

  it('keeps same origin for non-dev ports', () => {
    const value = resolveGatewayBase({
      origin: 'https://hs.example.net:8443',
      protocol: 'https:',
      hostname: 'hs.example.net',
      host: 'hs.example.net:8443',
      port: '8443',
    });

    expect(value).toBe('https://hs.example.net:8443');
  });
});
