'use client';

import { getBasePath, isDemoMode } from './demo-mode';

export function useGatewayBase() {
  if (typeof window === 'undefined') {
    return '';
  }

  const { origin, protocol, hostname, host, port } = window.location;
  if (isDemoMode()) {
    return `${origin}${getBasePath()}`;
  }
  return port === '8088' ? `${protocol}//${host}` : `${protocol}//${hostname}:8088`;
}
