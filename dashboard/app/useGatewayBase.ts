'use client';

import { getBasePath, isDemoMode } from './demo-mode';
import { resolveGatewayBase } from './gateway-base';

export function useGatewayBase() {
  if (typeof window === 'undefined') {
    return '';
  }

  return resolveGatewayBase(window.location, {
    backendOrigin: process.env.NEXT_PUBLIC_BACKEND_ORIGIN || '',
    basePath: getBasePath(),
    demoMode: isDemoMode(),
  });
}
