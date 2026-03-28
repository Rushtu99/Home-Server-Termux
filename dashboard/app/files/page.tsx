'use client';

export default function FilesPage() {
  return (
    <div style={{ height: '100vh', width: '100%' }}>
      <h1 style={{ padding: '10px' }}>📁 File Manager</h1>

      <iframe
        src="http://192.168.1.69:8088/files/"
        style={{
          width: '100%',
          height: '90%',
          border: 'none',
        }}
      />
    </div>
  );
}
