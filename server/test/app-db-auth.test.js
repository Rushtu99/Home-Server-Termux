const { hashPassword, normalizeUsername, verifyPassword } = require('../app-db');

describe('app-db auth exports', () => {
  it('normalizes usernames by trimming', () => {
    expect(normalizeUsername('  admin  ')).toBe('admin');
    expect(normalizeUsername()).toBe('');
  });

  it('hashes and verifies passwords', () => {
    const hash = hashPassword('secret-123');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('secret-123', hash)).toBe(true);
    expect(verifyPassword('bad-password', hash)).toBe(false);
  });

  it('throws when hashing blank password', () => {
    expect(() => hashPassword('')).toThrow('Password is required');
  });

  it('rejects invalid hash shapes safely', () => {
    expect(verifyPassword('secret', 'not-a-valid-hash')).toBe(false);
  });
});
