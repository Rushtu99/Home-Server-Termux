const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 4000;

/**
 * 🔹 System Status API
 */
app.get('/api/status', async (req, res) => {
  exec('uptime', (err, stdout) => {
    res.json({
      status: 'running',
      uptime: stdout
    });
  });
});

/**
 * 🔹 File System (list directory)
 */
app.get('/api/files', (req, res) => {
  const dir = req.query.path || '/storage/emulated/0';

  exec(`ls -lah "${dir}"`, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr });

    res.json({
      path: dir,
      data: stdout
    });
  });
});

/**
 * 🔹 Service Status Check
 */
app.get('/api/services', (req, res) => {
  exec('ps aux', (err, stdout) => {
    res.json({
      ftp: stdout.includes('vsftpd'),
      ssh: stdout.includes('sshd'),
      filebrowser: stdout.includes('filebrowser'),
      ttyd: stdout.includes('ttyd')
    });
  });
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
