'use client';

import { useMemo } from 'react';

export default function FilesPage() {
  const gatewayBase = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const { protocol, hostname, host, port } = window.location;
    if (port === '8088') return `${protocol}//${host}`;
    return `${protocol}//${hostname}:8088`;
  }, []);

  return (
    <div className="tool-page">
      <h1 className="tool-header">📁 File Manager</h1>
      <iframe title="File Manager" src={`${gatewayBase}/files/`} className="tool-frame" />
    </div>
  );
}
