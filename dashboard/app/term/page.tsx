'use client';

export default function TerminalPage() {
  return (
    <div style={{ height: '100vh', width: '100%' }}>
      <h1 style={{ padding: '10px' }}>💻 Terminal</h1>

      <iframe
        src="/term/"
        style={{
          width: '100%',
          height: '90%',
          border: 'none',
          background: 'black',
        }}
      />
    </div>
  );
}
