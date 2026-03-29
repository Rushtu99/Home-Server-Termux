'use client';

import { useEffect, useState } from 'react';

export function useGatewayBase() {
  const [gatewayBase, setGatewayBase] = useState('');

  useEffect(() => {
    const { protocol, hostname, host, port } = window.location;
    setGatewayBase(port === '8088' ? `${protocol}//${host}` : `${protocol}//${hostname}:8088`);
  }, []);

  return gatewayBase;
}
