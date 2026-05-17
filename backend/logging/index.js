const fs = require('fs');
const path = require('path');

const ensureDir = (target) => fs.mkdirSync(target, { recursive: true });
const timestamp = () => new Date().toISOString();
const safeName = (value) => String(value || 'orchestrator').replace(/[^A-Za-z0-9_.-]/g, '_');

const rotateIfNeeded = (filePath, maxBytes = 1024 * 1024) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < maxBytes) return;
    const rotated = `${filePath}.${timestamp().replace(/[:.]/g, '-')}`;
    fs.renameSync(filePath, rotated);
  } catch (_) {
    // Missing logs do not need rotation.
  }
};

const createLogger = ({ projectRoot, scope = 'orchestrator', name = 'orchestrator', maxBytes } = {}) => {
  const root = projectRoot || path.resolve(__dirname, '../..');
  const logDir = path.join(root, 'logs', scope);
  ensureDir(logDir);
  const filePath = path.join(logDir, `${safeName(name)}.log`);

  const write = (level, message, meta = {}) => {
    rotateIfNeeded(filePath, maxBytes);
    const payload = Object.keys(meta || {}).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    fs.appendFileSync(filePath, `[${timestamp()}] ${String(level || 'info').toUpperCase()} ${message}${payload}\n`, 'utf8');
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    error: (message, meta) => write('error', message, meta),
    filePath,
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
  };
};

module.exports = {
  createLogger,
};
