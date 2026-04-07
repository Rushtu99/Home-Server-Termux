#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvFile } = require('node:process');
const { createAppDb } = require('../server/app-db');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT_DIR, 'server', '.env');

if (typeof loadEnvFile === 'function' && fs.existsSync(ENV_FILE)) {
  loadEnvFile(ENV_FILE);
}

const HOME_DIR = process.env.HOME || '/data/data/com.termux/files/home';
const FILESYSTEM_ROOT = process.env.FILEBROWSER_ROOT || path.join(HOME_DIR, 'Drives');
const RUNTIME_DIR = process.env.RUNTIME_DIR || path.join(ROOT_DIR, 'runtime');
const APP_DB_PATH = process.env.APP_DB_PATH || path.join(RUNTIME_DIR, 'app.db');
const SAMBA_RUNTIME_DIR = process.env.SAMBA_RUNTIME_DIR || path.join(RUNTIME_DIR, 'samba');
const SAMBA_CONFIG_PATH = process.env.SAMBA_CONFIG_PATH || path.join(SAMBA_RUNTIME_DIR, 'smb.conf');
const SAMBA_PORT = Number(process.env.SAMBA_PORT || 445);
const SAMBA_GUEST_EXPORTS = process.env.SAMBA_GUEST_EXPORTS !== 'false';
const SAMBA_SERVER_NAME = String(process.env.SAMBA_SERVER_NAME || 'HomeServer').trim() || 'HomeServer';
const SAMBA_FORCE_USER = String(
  process.env.SAMBA_FORCE_USER ||
  process.env.USER ||
  process.env.LOGNAME ||
  os.userInfo().username ||
  'nobody'
).trim();

const sambaStateDirs = {
  cache: path.join(SAMBA_RUNTIME_DIR, 'cache'),
  lock: path.join(SAMBA_RUNTIME_DIR, 'lock'),
  ncalrpc: path.join(SAMBA_RUNTIME_DIR, 'ncalrpc'),
  pid: path.join(SAMBA_RUNTIME_DIR, 'pid'),
  private: path.join(SAMBA_RUNTIME_DIR, 'private'),
  state: path.join(SAMBA_RUNTIME_DIR, 'state'),
};

const normalizeAccessLevel = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'read' || normalized === 'write' ? normalized : 'deny';
};

const sanitizeShareSectionName = (value = '') => String(value || '')
  .replace(/[\r\n\[\]]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 80);

const getUserRoleAccess = (share) => {
  const permissions = Array.isArray(share?.permissions) ? share.permissions : [];
  const rolePermission = permissions.find((entry) =>
    String(entry?.subjectType || '').toLowerCase() === 'role' &&
    String(entry?.subjectKey || '').toLowerCase() === 'user'
  );

  return normalizeAccessLevel(rolePermission?.accessLevel || '');
};

const appDb = createAppDb({ dbPath: APP_DB_PATH });
const shares = appDb.listShares({ includePermissions: true });
const exportableShares = shares.filter((share) =>
  !share.isHidden &&
  getUserRoleAccess(share) !== 'deny' &&
  fs.existsSync(path.join(FILESYSTEM_ROOT, share.pathKey))
);

fs.mkdirSync(SAMBA_RUNTIME_DIR, { recursive: true });
for (const dirPath of Object.values(sambaStateDirs)) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.chmodSync(dirPath, 0o755);
}

const lines = [
  '[global]',
  `  netbios name = ${SAMBA_SERVER_NAME}`,
  '  server string = Home Server',
  '  server role = standalone server',
  `  smb ports = ${SAMBA_PORT}`,
  '  disable spoolss = yes',
  '  load printers = no',
  '  printing = bsd',
  '  printcap name = /dev/null',
  '  map to guest = Bad User',
  `  guest account = ${SAMBA_FORCE_USER}`,
  '  browseable = yes',
  '  unix charset = UTF-8',
  '  server min protocol = SMB2',
  '  client min protocol = SMB2',
  `  lock directory = ${sambaStateDirs.lock}`,
  `  state directory = ${sambaStateDirs.state}`,
  `  cache directory = ${sambaStateDirs.cache}`,
  `  pid directory = ${sambaStateDirs.pid}`,
  `  private dir = ${sambaStateDirs.private}`,
  `  ncalrpc dir = ${sambaStateDirs.ncalrpc}`,
  `  log file = ${path.join(ROOT_DIR, 'logs', 'samba-%m.log')}`,
  '  max log size = 1024',
];

if (!SAMBA_GUEST_EXPORTS) {
  lines.push('  guest ok = no');
}

for (const share of exportableShares) {
  const sharePath = path.join(FILESYSTEM_ROOT, share.pathKey);
  const sectionName = sanitizeShareSectionName(share.name || share.pathKey);
  const readOnly = share.isReadOnly || getUserRoleAccess(share) !== 'write';

  lines.push('');
  lines.push(`[${sectionName}]`);
  lines.push(`  path = ${sharePath}`);
  lines.push('  browseable = yes');
  lines.push(`  read only = ${readOnly ? 'yes' : 'no'}`);
  lines.push(`  guest ok = ${SAMBA_GUEST_EXPORTS ? 'yes' : 'no'}`);
  lines.push(`  force user = ${SAMBA_FORCE_USER}`);
  lines.push('  create mask = 0644');
  lines.push('  directory mask = 0755');
}

fs.writeFileSync(SAMBA_CONFIG_PATH, `${lines.join('\n')}\n`);

process.stdout.write(JSON.stringify({
  configPath: SAMBA_CONFIG_PATH,
  exportableShares: exportableShares.map((share) => ({
    isReadOnly: Boolean(share.isReadOnly || getUserRoleAccess(share) !== 'write'),
    name: share.name,
    pathKey: share.pathKey,
  })),
  guestExports: SAMBA_GUEST_EXPORTS,
  port: SAMBA_PORT,
}) + '\n');
