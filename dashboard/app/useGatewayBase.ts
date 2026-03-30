'use client';

import { useEffect, useState } from 'react';
import { getBasePath, isDemoMode } from './demo-mode';

export function useGatewayBase() {
  const [gatewayBase, setGatewayBase] = useState('');

  useEffect(() => {
    const { origin, protocol, hostname, host, port } = window.location;
    if (isDemoMode()) {
      setGatewayBase(`${origin}${getBasePath()}`);
      return;
    }
    setGatewayBase(port === '8088' ? `${protocol}//${host}` : `${protocol}//${hostname}:8088`);
  }, []);

  return gatewayBase;
}
