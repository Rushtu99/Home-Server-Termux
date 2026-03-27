'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';

const BASE_URL = '/api';

export default function Dashboard() {
  const [status, setStatus] = useState<any>(null);
  const [services, setServices] = useState<any>({});

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const s = await axios.get(`${BASE_URL}/status`);
      const svc = await axios.get(`${BASE_URL}/services`);

      setStatus(s.data);
      setServices(svc.data);
    } catch (err) {
      console.error(err);
    }
  };

  const ServiceBadge = ({ running }: { running: boolean }) => (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: '999px',
        fontSize: '12px',
        background: running ? '#16a34a' : '#dc2626',
        color: 'white',
      }}
    >
      {running ? 'Running' : 'Stopped'}
    </span>
  );

  const Card = ({ title, children }: any) => (
    <div
      style={{
        background: '#111',
        padding: '20px',
        borderRadius: '16px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      }}
    >
      <h2 style={{ marginBottom: '10px' }}>{title}</h2>
      {children}
    </div>
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#fff',
        padding: '20px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ fontSize: '28px', marginBottom: '20px' }}>
        📱 Home Server Dashboard
      </h1>

      {/* GRID */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '20px',
        }}
      >
        {/* SYSTEM */}
        <Card title="🟢 System Status">
          <p style={{ opacity: 0.8 }}>
            {status?.uptime || 'Loading...'}
          </p>
        </Card>

        {/* SERVICES */}
        <Card title="⚙️ Services">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              SSH: <ServiceBadge running={services.ssh} />
            </div>
            <div>
              FTP: <ServiceBadge running={services.ftp} />
            </div>
            <div>
              Filebrowser: <ServiceBadge running={services.filebrowser} />
            </div>
            <div>
              Terminal: <ServiceBadge running={services.ttyd} />
            </div>
          </div>
        </Card>

        {/* QUICK ACCESS */}
        <Card title="🚀 Quick Access">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <a href="/files" style={linkStyle}>
              📁 File Manager
            </a>

            <a href="/term" style={linkStyle}>
              💻 Terminal
            </a>

            <a href="/api/status" style={linkStyle}>
              📡 API Status
            </a>
          </div>
        </Card>

        {/* NETWORK */}
        <Card title="🌐 Network">
          <div style={{ fontSize: '14px', opacity: 0.8 }}>
            <p>Dashboard: :8088</p>
            <p>SSH: :8022</p>
            <p>API: /api</p>
            <p>Files: /files</p>
          </div>
        </Card>
      </div>

      {/* REFRESH BUTTON */}
      <div style={{ marginTop: '20px' }}>
        <button
          onClick={fetchData}
          style={{
            padding: '10px 16px',
            background: '#2563eb',
            border: 'none',
            borderRadius: '10px',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          🔄 Refresh
        </button>
      </div>
    </div>
  );
}

const linkStyle = {
  padding: '10px',
  borderRadius: '10px',
  background: '#1f2937',
  textDecoration: 'none',
  color: 'white',
};
