'use client';

import { useEffect, useState, useRef } from 'react';

const API = process.env.NEXT_PUBLIC_API || '/api';

type Services = Record<string, boolean>;

type Monitor = {
  cpuLoad: number;
  totalMem: number;
  usedMem: number;
  uptime: number;
};

export default function Dashboard() {
  const [services, setServices] = useState<Services>({});
  const [monitor, setMonitor] = useState<Monitor | null>(null);

  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);

  const cpuCanvas = useRef<HTMLCanvasElement>(null);
  const ramCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    drawGraph(cpuCanvas.current, cpuHistory);
  }, [cpuHistory]);

  useEffect(() => {
    drawGraph(ramCanvas.current, ramHistory);
  }, [ramHistory]);

  const fetchAll = async () => {
    try {
      const [svcRes, monitorRes] = await Promise.all([
        fetch(`${API}/services`),
        fetch(`${API}/monitor`),
      ]);

      if (!svcRes.ok || !monitorRes.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const svc = await svcRes.json();
      const m = await monitorRes.json();

      setServices(svc);
      setMonitor(m);

      setCpuHistory(prev => [...prev.slice(-29), m.cpuLoad]);
      setRamHistory(prev => [
        ...prev.slice(-29),
        (m.usedMem / m.totalMem) * 100,
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  const control = async (service: string, action: string) => {
    try {
      const res = await fetch(`${API}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, action }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        console.error('Control failed', payload);
      }
    } catch (err) {
      console.error(err);
    }

    fetchAll();
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>📱 Home Server</h1>

      <div style={styles.grid}>
        <SystemCard monitor={monitor} />
        <ServicesCard services={services} control={control} />
        <GraphsCard cpuRef={cpuCanvas} ramRef={ramCanvas} />
      </div>
    </div>
  );
}

/* COMPONENTS */

const SystemCard = ({ monitor }: any) => (
  <Card title="📊 System">
    {monitor ? (
      <>
        <p>CPU: {monitor.cpuLoad.toFixed(1)}%</p>
        <p>
          RAM: {(monitor.usedMem / 1024 / 1024).toFixed(0)} /{' '}
          {(monitor.totalMem / 1024 / 1024).toFixed(0)} MB
        </p>
        <p>Uptime: {(monitor.uptime / 3600).toFixed(1)} hrs</p>
      </>
    ) : (
      <p>Loading...</p>
    )}
  </Card>
);

const ServicesCard = ({ services, control }: any) => (
  <Card title="⚙️ Services">
    {Object.entries(services).map(([name, running]: any) => (
      <div key={name} style={styles.serviceRow}>
        <div>
          <strong>{name.toUpperCase()}</strong>
          <Status running={running} />
        </div>

        <div style={styles.actions}>
          <Btn color="#16a34a" onClick={() => control(name, 'start')}>▶</Btn>
          <Btn color="#dc2626" onClick={() => control(name, 'stop')}>■</Btn>
          <Btn color="#2563eb" onClick={() => control(name, 'restart')}>↻</Btn>
        </div>
      </div>
    ))}
  </Card>
);

const GraphsCard = ({ cpuRef, ramRef }: any) => (
  <Card title="📈 Live Graphs">
    <canvas ref={cpuRef} width={300} height={100} style={styles.canvas} />
    <canvas ref={ramRef} width={300} height={100} style={styles.canvas} />
  </Card>
);

const Card = ({ title, children }: any) => (
  <div style={styles.card}>
    <h2>{title}</h2>
    {children}
  </div>
);

const Status = ({ running }: { running: boolean }) => (
  <span style={{
    marginLeft: 10,
    padding: '2px 8px',
    borderRadius: 999,
    background: running ? '#16a34a' : '#dc2626',
    fontSize: 12,
  }}>
    {running ? 'Running' : 'Stopped'}
  </span>
);

const Btn = ({ color, onClick, children }: any) => (
  <button style={{ ...styles.btn, background: color }} onClick={onClick}>
    {children}
  </button>
);

/* GRAPH */

function drawGraph(canvas: HTMLCanvasElement | null, data: number[]) {
  if (!canvas || data.length === 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const max = Math.max(...data, 100);

  ctx.strokeStyle = '#2563eb';
  ctx.beginPath();

  data.forEach((val, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (val / max) * h;

    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });

  ctx.stroke();
}

/* STYLES */

const styles: any = {
  container: { background: '#0a0a0a', color: '#fff', minHeight: '100vh', padding: 20 },
  title: { fontSize: 28, marginBottom: 20 },
  grid: { display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  card: { background: '#111', padding: 20, borderRadius: 16 },
  serviceRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 10 },
  actions: { display: 'flex', gap: 5 },
  btn: { border: 'none', color: '#fff', padding: '5px 10px', borderRadius: 6, cursor: 'pointer' },
  canvas: { width: '100%', background: '#000', borderRadius: 8, marginBottom:10 },
};
