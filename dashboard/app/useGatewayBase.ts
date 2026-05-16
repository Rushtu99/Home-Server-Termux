'use client';

import { getBasePath, isDemoMode } from './demo-mode';
import { resolveGatewayBase } from './gateway-base';

export function useGatewayBase() {
  if (typeof window === 'undefined') {
    return '';
  }

  return resolveGatewayBase(window.location, {
    basePath: getBasePath(),
    demoMode: isDemoMode(),
  });
}
