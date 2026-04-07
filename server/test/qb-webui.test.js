const {
  buildQbittorrentWebUiUrl,
  extractQbittorrentSidCookie,
  getSetCookieHeaderValues,
} = require('../lib/qb-webui');

describe('qb-webui helpers', () => {
  it('builds URL from base and pathname', () => {
    expect(buildQbittorrentWebUiUrl('http://127.0.0.1:8081/', '/api/v2/app/version'))
      .toBe('http://127.0.0.1:8081/api/v2/app/version');
    expect(buildQbittorrentWebUiUrl('http://127.0.0.1:8081', 'api/v2/auth/login'))
      .toBe('http://127.0.0.1:8081/api/v2/auth/login');
  });

  it('extracts SID cookie from set-cookie headers', () => {
    const headers = {
      get: (name) => (name === 'set-cookie' ? 'foo=bar; Path=/, SID=abcdef123; HttpOnly; Path=/' : null),
    };
    expect(getSetCookieHeaderValues(headers)).toEqual(['foo=bar; Path=/', 'SID=abcdef123; HttpOnly; Path=/']);
    expect(extractQbittorrentSidCookie(headers)).toBe('SID=abcdef123');
  });

  it('returns empty SID when cookie is missing', () => {
    const headers = { get: () => null };
    expect(extractQbittorrentSidCookie(headers)).toBe('');
  });
});
