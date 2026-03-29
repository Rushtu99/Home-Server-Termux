'use client';

import { useMemo } from 'react';

export default function TerminalPage() {
  const gatewayBase = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const { protocol, hostname, host, port } = window.location;
    if (port === '8088') return `${protocol}//${host}`;
    return `${protocol}//${hostname}:8088`;
  }, []);

  return (
    <div className="tool-page">
      <h1 className="tool-header">💻 Terminal</h1>
      <iframe title="Terminal" src={`${gatewayBase}/term/`} className="tool-frame" />
    </div>
  );
}
