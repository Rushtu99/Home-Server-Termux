const http = require('http');
const https = require('https');
const net = require('net');
const { exec } = require('child_process');

const checkPort = ({ host = '127.0.0.1', port, timeoutMs = 1500 }) => new Promise((resolve) => {
  const socket = new net.Socket();
  let done = false;
  const finish = (ok, error = '') => {
    if (done) return;
    done = true;
    socket.destroy();
    resolve({ ok, error });
  };
  socket.setTimeout(timeoutMs);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false, 'timeout'));
  socket.once('error', (error) => finish(false, error.message));
  socket.connect(Number(port), host);
});

const checkHttp = ({ url, timeoutMs = 2500, expectedStatus }) => new Promise((resolve) => {
  const client = String(url || '').startsWith('https:') ? https : http;
  const request = client.get(url, { timeout: timeoutMs }, (response) => {
    response.resume();
    const status = Number(response.statusCode || 0);
    const expected = expectedStatus ? Number(expectedStatus) : null;
    resolve({ ok: expected ? status === expected : status >= 200 && status < 500, status });
  });
  request.on('timeout', () => {
    request.destroy();
    resolve({ ok: false, error: 'timeout' });
  });
  request.on('error', (error) => resolve({ ok: false, error: error.message }));
});

const checkProcess = ({ pid }) => {
  try {
    process.kill(Number(pid), 0);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

const checkCustom = ({ command, timeoutMs = 5000 }) => new Promise((resolve) => {
  exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
    resolve({
      ok: !error,
      output: String(stdout || '').trim(),
      error: error ? String(stderr || error.message || error).trim() : '',
    });
  });
});

const runHealthCheck = async (descriptor = {}) => {
  const health = descriptor.health || {};
  const type = String(health.type || descriptor.healthType || '').toLowerCase();
  if (type === 'http') return checkHttp({ url: health.url, expectedStatus: health.expectedStatus, timeoutMs: health.timeoutMs });
  if (type === 'port') return checkPort({ host: descriptor.host || health.host, port: descriptor.port || health.port, timeoutMs: health.timeoutMs });
  if (type === 'process') return checkProcess({ pid: health.pid });
  if (type === 'custom' || health.command) return checkCustom({ command: health.command, timeoutMs: health.timeoutMs });
  if (descriptor.port) return checkPort({ host: descriptor.host, port: descriptor.port });
  return { ok: true, skipped: true };
};

module.exports = {
  checkCustom,
  checkHttp,
  checkPort,
  checkProcess,
  runHealthCheck,
};
