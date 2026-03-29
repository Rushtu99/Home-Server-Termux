const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const HASH_PARAMS = {
  keyLength: 64,
  maxmem: 32 * 1024 * 1024,
  N: 16384,
  p: 1,
  r: 8,
  saltLength: 16,
};

const nowIso = () => new Date().toISOString();

const normalizeUsername = (username = '') => String(username).trim();
const normalizeText = (value = '') => String(value || '').trim();
const safeJsonParse = (value, fallbackValue = {}) => {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallbackValue;
  }
};

const encodeBuffer = (value) => Buffer.from(value).toString('base64url');

const decodeBuffer = (value) => Buffer.from(String(value), 'base64url');

const hashPassword = (password) => {
  const normalizedPassword = String(password || '');
  if (!normalizedPassword) {
    throw new Error('Password is required');
  }

  const salt = crypto.randomBytes(HASH_PARAMS.saltLength);
  const derived = crypto.scryptSync(normalizedPassword, salt, HASH_PARAMS.keyLength, {
    N: HASH_PARAMS.N,
    maxmem: HASH_PARAMS.maxmem,
    p: HASH_PARAMS.p,
    r: HASH_PARAMS.r,
  });

  return [
    'scrypt',
    HASH_PARAMS.N,
    HASH_PARAMS.r,
    HASH_PARAMS.p,
    encodeBuffer(salt),
    encodeBuffer(derived),
  ].join('$');
};

const verifyPassword = (password, storedHash) => {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, rawN, rawR, rawP, saltText, hashText] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (![N, r, p].every((value) => Number.isFinite(value) && value > 0)) {
    return false;
  }

  try {
    const salt = decodeBuffer(saltText);
    const expected = decodeBuffer(hashText);
    const actual = crypto.scryptSync(String(password || ''), salt, expected.length, {
      N,
      maxmem: HASH_PARAMS.maxmem,
      p,
      r,
    });

    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

const createAppDb = ({ dbPath }) => {
  if (!dbPath) {
    throw new Error('dbPath is required');
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ftp_favourites (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      protocol TEXT NOT NULL DEFAULT 'ftp',
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 21,
      username TEXT NOT NULL DEFAULT '',
      auth_json TEXT NOT NULL DEFAULT '{}',
      secure INTEGER NOT NULL DEFAULT 0,
      remote_path TEXT NOT NULL DEFAULT '/',
      mount_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const statements = {
    countUsers: db.prepare('SELECT COUNT(*) AS count FROM users'),
    findUserByUsername: db.prepare(`
      SELECT id, username, password_hash AS passwordHash, role, is_disabled AS isDisabled, created_at AS createdAt, updated_at AS updatedAt
      FROM users
      WHERE username = ?
      LIMIT 1
    `),
    insertUser: db.prepare(`
      INSERT INTO users (username, password_hash, role, is_disabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateUserPassword: db.prepare(`
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `),
    getSetting: db.prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1'),
    upsertSetting: db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `),
    listFtpFavourites: db.prepare(`
      SELECT
        id,
        name,
        protocol,
        host,
        port,
        username,
        auth_json AS authJson,
        secure,
        remote_path AS remotePath,
        mount_name AS mountName,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM ftp_favourites
      ORDER BY lower(name), id
    `),
    getFtpFavouriteById: db.prepare(`
      SELECT
        id,
        name,
        protocol,
        host,
        port,
        username,
        auth_json AS authJson,
        secure,
        remote_path AS remotePath,
        mount_name AS mountName,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM ftp_favourites
      WHERE id = ?
      LIMIT 1
    `),
    insertFtpFavourite: db.prepare(`
      INSERT INTO ftp_favourites (
        name,
        protocol,
        host,
        port,
        username,
        auth_json,
        secure,
        remote_path,
        mount_name,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateFtpFavourite: db.prepare(`
      UPDATE ftp_favourites
      SET
        name = ?,
        protocol = ?,
        host = ?,
        port = ?,
        username = ?,
        auth_json = ?,
        secure = ?,
        remote_path = ?,
        mount_name = ?,
        updated_at = ?
      WHERE id = ?
    `),
    deleteFtpFavourite: db.prepare(`
      DELETE FROM ftp_favourites
      WHERE id = ?
    `),
  };

  const serializeFtpFavourite = (row, { includeSecrets = false } = {}) => {
    if (!row) {
      return null;
    }

    const auth = safeJsonParse(row.authJson, {});
    const payload = {
      id: Number(row.id),
      name: normalizeText(row.name),
      protocol: normalizeText(row.protocol) || 'ftp',
      host: normalizeText(row.host),
      port: Number(row.port || 21),
      username: normalizeText(row.username) || 'anonymous',
      secure: Boolean(row.secure),
      remotePath: normalizeText(row.remotePath) || '/',
      mountName: normalizeText(row.mountName),
      createdAt: normalizeText(row.createdAt),
      updatedAt: normalizeText(row.updatedAt),
    };

    if (includeSecrets) {
      payload.auth = auth;
    }

    return payload;
  };

  return {
    dbPath,
    bootstrapAdmin({ username, password, role = 'admin' }) {
      if (this.countUsers() > 0) {
        return { seeded: false };
      }

      const normalizedUsername = normalizeUsername(username) || 'admin';
      const timestamp = nowIso();
      statements.insertUser.run(
        normalizedUsername,
        hashPassword(password),
        role,
        0,
        timestamp,
        timestamp
      );

      return { seeded: true, username: normalizedUsername, role };
    },
    countUsers() {
      return Number(statements.countUsers.get()?.count || 0);
    },
    findUserByUsername(username) {
      const normalizedUsername = normalizeUsername(username);
      if (!normalizedUsername) {
        return null;
      }

      return statements.findUserByUsername.get(normalizedUsername) || null;
    },
    setUserPassword(userId, password) {
      const numericUserId = Number(userId);
      if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
        throw new Error('Valid userId is required');
      }

      statements.updateUserPassword.run(hashPassword(password), nowIso(), numericUserId);
    },
    getSetting(key, fallbackValue = null) {
      const row = statements.getSetting.get(String(key || ''));
      return row ? row.value : fallbackValue;
    },
    getBooleanSetting(key, fallbackValue = false) {
      const raw = this.getSetting(key, fallbackValue ? 'true' : 'false');
      return String(raw).toLowerCase() === 'true';
    },
    setSetting(key, value) {
      statements.upsertSetting.run(String(key || ''), String(value ?? ''), nowIso());
    },
    listFtpFavourites({ includeSecrets = false } = {}) {
      return statements.listFtpFavourites.all().map((row) => serializeFtpFavourite(row, { includeSecrets }));
    },
    getFtpFavouriteById(id, { includeSecrets = false } = {}) {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        return null;
      }

      return serializeFtpFavourite(statements.getFtpFavouriteById.get(numericId), { includeSecrets });
    },
    createFtpFavourite(payload = {}) {
      const timestamp = nowIso();
      statements.insertFtpFavourite.run(
        normalizeText(payload.name),
        normalizeText(payload.protocol) || 'ftp',
        normalizeText(payload.host),
        Number(payload.port || 21),
        normalizeText(payload.username) || 'anonymous',
        JSON.stringify(payload.auth || {}),
        payload.secure ? 1 : 0,
        normalizeText(payload.remotePath) || '/',
        normalizeText(payload.mountName),
        timestamp,
        timestamp
      );

      return this.getFtpFavouriteById(db.prepare('SELECT last_insert_rowid() AS id').get().id, { includeSecrets: false });
    },
    updateFtpFavourite(id, payload = {}) {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        throw new Error('Valid favourite id is required');
      }

      statements.updateFtpFavourite.run(
        normalizeText(payload.name),
        normalizeText(payload.protocol) || 'ftp',
        normalizeText(payload.host),
        Number(payload.port || 21),
        normalizeText(payload.username) || 'anonymous',
        JSON.stringify(payload.auth || {}),
        payload.secure ? 1 : 0,
        normalizeText(payload.remotePath) || '/',
        normalizeText(payload.mountName),
        nowIso(),
        numericId
      );

      return this.getFtpFavouriteById(numericId, { includeSecrets: false });
    },
    deleteFtpFavourite(id) {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        throw new Error('Valid favourite id is required');
      }

      statements.deleteFtpFavourite.run(numericId);
    },
    close() {
      db.close();
    },
  };
};

module.exports = {
  createAppDb,
  hashPassword,
  normalizeUsername,
  verifyPassword,
};
