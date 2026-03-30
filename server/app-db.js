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

const FTP_AUTH_PREFIX = 'enc:v1:';
const DEFAULT_AUTH_SECRET = 'change-this-in-production';
const getFtpAuthSecret = () => String(process.env.APP_AUTH_SECRET || process.env.JWT_SECRET || DEFAULT_AUTH_SECRET);

const nowIso = () => new Date().toISOString();

const normalizeUsername = (username = '') => String(username).trim();
const normalizeText = (value = '') => String(value || '').trim();
const normalizeShareName = (value = '') => normalizeText(value).slice(0, 80);
const normalizePathKey = (value = '') => normalizeText(value).replace(/[\\/]+/g, ' ').trim().slice(0, 120);
const normalizeAccessLevel = (value = '', fallbackValue = 'deny') => {
  const normalized = normalizeText(value).toLowerCase();
  return ['deny', 'read', 'write'].includes(normalized) ? normalized : fallbackValue;
};
const normalizeSubjectType = (value = '', fallbackValue = 'role') => {
  const normalized = normalizeText(value).toLowerCase();
  return ['role', 'user', 'group'].includes(normalized) ? normalized : fallbackValue;
};
const safeJsonParse = (value, fallbackValue = {}) => {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallbackValue;
  }
};

const getSecretKey = (secret) => {
  const normalized = String(secret || '').trim();
  if (!normalized) {
    return null;
  }

  return crypto.createHash('sha256').update(normalized).digest();
};

const encryptJson = (value, secret) => {
  const normalizedValue = value && typeof value === 'object' ? value : {};
  const key = getSecretKey(secret);
  if (!key) {
    return JSON.stringify(normalizedValue);
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalizedValue), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${FTP_AUTH_PREFIX}${Buffer.concat([iv, authTag, ciphertext]).toString('base64url')}`;
};

const decryptJson = (value, secret, fallbackValue = {}) => {
  const normalized = String(value || '');
  if (!normalized.startsWith(FTP_AUTH_PREFIX)) {
    return safeJsonParse(normalized, fallbackValue);
  }

  const key = getSecretKey(secret);
  if (!key) {
    return fallbackValue;
  }

  try {
    const payload = Buffer.from(normalized.slice(FTP_AUTH_PREFIX.length), 'base64url');
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return safeJsonParse(plaintext, fallbackValue);
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

    CREATE TABLE IF NOT EXISTS shares (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      path_key TEXT NOT NULL UNIQUE COLLATE NOCASE,
      description TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'folder',
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_read_only INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS share_permissions (
      id INTEGER PRIMARY KEY,
      share_id INTEGER NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      subject_type TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      access_level TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (share_id, subject_type, subject_key)
    );
  `);

  const statements = {
    countUsers: db.prepare('SELECT COUNT(*) AS count FROM users'),
    listUsers: db.prepare(`
      SELECT id, username, role, is_disabled AS isDisabled, created_at AS createdAt, updated_at AS updatedAt
      FROM users
      ORDER BY lower(username), id
    `),
    getUserById: db.prepare(`
      SELECT id, username, role, is_disabled AS isDisabled, created_at AS createdAt, updated_at AS updatedAt
      FROM users
      WHERE id = ?
      LIMIT 1
    `),
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
    updateUserProfile: db.prepare(`
      UPDATE users
      SET role = ?, is_disabled = ?, updated_at = ?
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
    rewriteFtpFavouriteAuth: db.prepare(`
      UPDATE ftp_favourites
      SET auth_json = ?, updated_at = ?
      WHERE id = ?
    `),
    deleteFtpFavourite: db.prepare(`
      DELETE FROM ftp_favourites
      WHERE id = ?
    `),
    listShares: db.prepare(`
      SELECT
        id,
        name,
        path_key AS pathKey,
        description,
        source_type AS sourceType,
        is_hidden AS isHidden,
        is_read_only AS isReadOnly,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM shares
      ORDER BY lower(name), id
    `),
    getShareById: db.prepare(`
      SELECT
        id,
        name,
        path_key AS pathKey,
        description,
        source_type AS sourceType,
        is_hidden AS isHidden,
        is_read_only AS isReadOnly,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM shares
      WHERE id = ?
      LIMIT 1
    `),
    getShareByPathKey: db.prepare(`
      SELECT
        id,
        name,
        path_key AS pathKey,
        description,
        source_type AS sourceType,
        is_hidden AS isHidden,
        is_read_only AS isReadOnly,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM shares
      WHERE path_key = ?
      LIMIT 1
    `),
    insertShare: db.prepare(`
      INSERT INTO shares (
        name,
        path_key,
        description,
        source_type,
        is_hidden,
        is_read_only,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateShare: db.prepare(`
      UPDATE shares
      SET
        name = ?,
        description = ?,
        source_type = ?,
        is_hidden = ?,
        is_read_only = ?,
        updated_at = ?
      WHERE id = ?
    `),
    listSharePermissionsByShareId: db.prepare(`
      SELECT
        id,
        share_id AS shareId,
        subject_type AS subjectType,
        subject_key AS subjectKey,
        access_level AS accessLevel,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM share_permissions
      WHERE share_id = ?
      ORDER BY subject_type, lower(subject_key), id
    `),
    upsertSharePermission: db.prepare(`
      INSERT INTO share_permissions (
        share_id,
        subject_type,
        subject_key,
        access_level,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(share_id, subject_type, subject_key) DO UPDATE SET
        access_level = excluded.access_level,
        updated_at = excluded.updated_at
    `),
    deleteSharePermissionsByShareId: db.prepare(`
      DELETE FROM share_permissions
      WHERE share_id = ?
    `),
  };

  const serializeFtpFavourite = (row, { includeSecrets = false } = {}) => {
    if (!row) {
      return null;
    }

    const auth = decryptJson(row.authJson, getFtpAuthSecret(), {});
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

  const serializeSharePermission = (row) => {
    if (!row) {
      return null;
    }

    return {
      accessLevel: normalizeAccessLevel(row.accessLevel),
      createdAt: normalizeText(row.createdAt),
      id: Number(row.id),
      shareId: Number(row.shareId),
      subjectKey: normalizeText(row.subjectKey),
      subjectType: normalizeSubjectType(row.subjectType),
      updatedAt: normalizeText(row.updatedAt),
    };
  };

  const serializeShare = (row, { includePermissions = false } = {}) => {
    if (!row) {
      return null;
    }

    const payload = {
      createdAt: normalizeText(row.createdAt),
      description: normalizeText(row.description),
      id: Number(row.id),
      isHidden: Boolean(row.isHidden),
      isReadOnly: Boolean(row.isReadOnly),
      name: normalizeShareName(row.name),
      pathKey: normalizePathKey(row.pathKey),
      sourceType: normalizeText(row.sourceType) || 'folder',
      updatedAt: normalizeText(row.updatedAt),
    };

    if (includePermissions) {
      payload.permissions = statements.listSharePermissionsByShareId
        .all(Number(row.id))
        .map((permissionRow) => serializeSharePermission(permissionRow));
    }

    return payload;
  };

  const serializeUser = (row) => {
    if (!row) {
      return null;
    }

    return {
      createdAt: normalizeText(row.createdAt),
      id: Number(row.id),
      isDisabled: Boolean(row.isDisabled),
      role: normalizeText(row.role) || 'user',
      updatedAt: normalizeText(row.updatedAt),
      username: normalizeUsername(row.username),
    };
  };

  const api = {
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
    listUsers() {
      return statements.listUsers.all().map((row) => serializeUser(row));
    },
    getUserById(userId) {
      const numericUserId = Number(userId);
      if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
        return null;
      }

      return serializeUser(statements.getUserById.get(numericUserId));
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
    createUser({ username, password, role = 'user', isDisabled = false } = {}) {
      const normalizedUsername = normalizeUsername(username);
      if (!normalizedUsername) {
        throw new Error('Username is required');
      }
      if (!password) {
        throw new Error('Password is required');
      }

      const timestamp = nowIso();
      statements.insertUser.run(
        normalizedUsername,
        hashPassword(password),
        normalizeText(role) || 'user',
        isDisabled ? 1 : 0,
        timestamp,
        timestamp
      );

      return this.getUserById(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    },
    updateUser(userId, { role, isDisabled } = {}) {
      const existing = this.getUserById(userId);
      if (!existing) {
        throw new Error('User not found');
      }

      statements.updateUserProfile.run(
        normalizeText(role || existing.role) || 'user',
        isDisabled == null ? (existing.isDisabled ? 1 : 0) : isDisabled ? 1 : 0,
        nowIso(),
        Number(existing.id)
      );

      return this.getUserById(existing.id);
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
    listShares({ includePermissions = false } = {}) {
      return statements.listShares.all().map((row) => serializeShare(row, { includePermissions }));
    },
    getShareById(id, { includePermissions = false } = {}) {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        return null;
      }

      return serializeShare(statements.getShareById.get(numericId), { includePermissions });
    },
    getShareByPathKey(pathKey, { includePermissions = false } = {}) {
      const normalizedPathKey = normalizePathKey(pathKey);
      if (!normalizedPathKey) {
        return null;
      }

      return serializeShare(statements.getShareByPathKey.get(normalizedPathKey), { includePermissions });
    },
    createShare(payload = {}) {
      const name = normalizeShareName(payload.name);
      const pathKey = normalizePathKey(payload.pathKey || payload.name);
      if (!name || !pathKey) {
        throw new Error('Share name is required');
      }

      const timestamp = nowIso();
      statements.insertShare.run(
        name,
        pathKey,
        normalizeText(payload.description),
        normalizeText(payload.sourceType) || 'folder',
        payload.isHidden ? 1 : 0,
        payload.isReadOnly ? 1 : 0,
        timestamp,
        timestamp
      );

      const share = this.getShareByPathKey(pathKey, { includePermissions: false });
      if (!share) {
        throw new Error('Unable to create share');
      }

      this.replaceSharePermissions(share.id, Array.isArray(payload.permissions) ? payload.permissions : [
        { subjectType: 'role', subjectKey: 'admin', accessLevel: 'write' },
        { subjectType: 'role', subjectKey: 'user', accessLevel: 'deny' },
      ]);

      return this.getShareById(share.id, { includePermissions: true });
    },
    updateShare(id, payload = {}) {
      const existing = this.getShareById(id, { includePermissions: true });
      if (!existing) {
        throw new Error('Share not found');
      }

      statements.updateShare.run(
        normalizeShareName(payload.name || existing.name),
        normalizeText(payload.description ?? existing.description),
        normalizeText(payload.sourceType || existing.sourceType) || 'folder',
        payload.isHidden == null ? (existing.isHidden ? 1 : 0) : payload.isHidden ? 1 : 0,
        payload.isReadOnly == null ? (existing.isReadOnly ? 1 : 0) : payload.isReadOnly ? 1 : 0,
        nowIso(),
        Number(existing.id)
      );

      if (Array.isArray(payload.permissions)) {
        this.replaceSharePermissions(existing.id, payload.permissions);
      }

      return this.getShareById(existing.id, { includePermissions: true });
    },
    replaceSharePermissions(shareId, permissions = []) {
      const numericShareId = Number(shareId);
      if (!Number.isInteger(numericShareId) || numericShareId <= 0) {
        throw new Error('Valid shareId is required');
      }

      const normalizedPermissions = permissions
        .map((entry) => ({
          accessLevel: normalizeAccessLevel(entry?.accessLevel),
          subjectKey: normalizeText(entry?.subjectKey).toLowerCase(),
          subjectType: normalizeSubjectType(entry?.subjectType),
        }))
        .filter((entry) => entry.subjectKey);

      statements.deleteSharePermissionsByShareId.run(numericShareId);
      const timestamp = nowIso();
      for (const permission of normalizedPermissions) {
        statements.upsertSharePermission.run(
          numericShareId,
          permission.subjectType,
          permission.subjectKey,
          permission.accessLevel,
          timestamp,
          timestamp
        );
      }
    },
    syncShares(records = []) {
      const normalizedRecords = records
        .map((entry) => ({
          description: normalizeText(entry?.description),
          isHidden: Boolean(entry?.isHidden),
          isReadOnly: Boolean(entry?.isReadOnly),
          name: normalizeShareName(entry?.name || entry?.pathKey),
          pathKey: normalizePathKey(entry?.pathKey),
          sourceType: normalizeText(entry?.sourceType) || 'folder',
        }))
        .filter((entry) => entry.name && entry.pathKey);

      for (const record of normalizedRecords) {
        const existing = this.getShareByPathKey(record.pathKey, { includePermissions: true });
        if (!existing) {
          this.createShare({
            ...record,
            permissions: [
              { subjectType: 'role', subjectKey: 'admin', accessLevel: 'write' },
              { subjectType: 'role', subjectKey: 'user', accessLevel: 'deny' },
            ],
          });
          continue;
        }

        statements.updateShare.run(
          existing.name || record.name,
          existing.description || record.description,
          record.sourceType,
          existing.isHidden ? 1 : record.isHidden ? 1 : 0,
          existing.isReadOnly ? 1 : record.isReadOnly ? 1 : 0,
          nowIso(),
          Number(existing.id)
        );
      }

      return this.listShares({ includePermissions: true });
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
        encryptJson(payload.auth || {}, getFtpAuthSecret()),
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
        encryptJson(payload.auth || {}, getFtpAuthSecret()),
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

  const ftpAuthSecret = getFtpAuthSecret();
  if (ftpAuthSecret) {
    const rewrittenAt = nowIso();
    for (const row of statements.listFtpFavourites.all()) {
      if (String(row.authJson || '').startsWith(FTP_AUTH_PREFIX)) {
        continue;
      }

      statements.rewriteFtpFavouriteAuth.run(
        encryptJson(safeJsonParse(row.authJson, {}), ftpAuthSecret),
        rewrittenAt,
        Number(row.id)
      );
    }
  }

  return api;
};

module.exports = {
  createAppDb,
  hashPassword,
  normalizeUsername,
  verifyPassword,
};
