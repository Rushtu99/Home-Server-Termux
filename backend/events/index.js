const fs = require('fs');
const path = require('path');

const ensureDir = (target) => fs.mkdirSync(target, { recursive: true });

const createPersistentEventLog = ({ projectRoot } = {}) => {
  const root = projectRoot || path.resolve(__dirname, '../..');
  const eventDir = path.join(root, 'state', 'events');
  const eventFile = path.join(eventDir, 'events.jsonl');
  ensureDir(eventDir);

  const emit = (event, subject, payload = {}) => {
    const entry = {
      event: String(event || 'unknown'),
      payload: payload && typeof payload === 'object' ? payload : {},
      subject: String(subject || ''),
      timestamp: new Date().toISOString(),
    };
    fs.appendFileSync(eventFile, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  };

  const list = ({ limit = 200 } = {}) => {
    if (!fs.existsSync(eventFile)) return [];
    return fs.readFileSync(eventFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(2000, Number(limit) || 200)))
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  };

  return { emit, eventFile, list };
};

module.exports = {
  createPersistentEventLog,
};
