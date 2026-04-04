const { isPrivateTorrentHost, isValidTorrentSource, validateMediaTorrentPayload } = require('../lib/torrent');

describe('torrent helpers', () => {
  it('accepts magnet and http/https sources', () => {
    expect(isValidTorrentSource('magnet:?xt=urn:btih:abc')).toBe(true);
    expect(isValidTorrentSource('https://example.com/test.torrent')).toBe(true);
    expect(isValidTorrentSource('http://example.com/test.torrent')).toBe(true);
  });

  it('rejects empty or invalid sources', () => {
    expect(isValidTorrentSource('')).toBe(false);
    expect(isValidTorrentSource('ftp://example.com/file.torrent')).toBe(false);
    expect(isValidTorrentSource('not-a-url')).toBe(false);
  });

  it('rejects localhost and private-network torrent URLs', () => {
    expect(isPrivateTorrentHost('localhost')).toBe(true);
    expect(isPrivateTorrentHost('192.168.1.20')).toBe(true);
    expect(isPrivateTorrentHost('10.0.0.4')).toBe(true);
    expect(isPrivateTorrentHost('example.com')).toBe(false);
    expect(isValidTorrentSource('http://localhost/test.torrent')).toBe(false);
    expect(isValidTorrentSource('http://192.168.1.20/test.torrent')).toBe(false);
    expect(isValidTorrentSource('http://10.0.0.4/test.torrent')).toBe(false);
  });

  it('validates lane + media type constraints', () => {
    expect(validateMediaTorrentPayload({
      source: 'magnet:?xt=urn:btih:abc',
      lane: 'arr',
      mediaType: 'movies',
    })).toEqual({ ok: true, code: '' });

    expect(validateMediaTorrentPayload({
      source: 'https://example.com/x.torrent',
      lane: 'standalone',
    })).toEqual({ ok: true, code: '' });

    expect(validateMediaTorrentPayload({
      source: 'https://example.com/x.torrent',
      lane: 'invalid',
      mediaType: 'movies',
    })).toEqual({ ok: false, code: 'invalid_lane' });

    expect(validateMediaTorrentPayload({
      source: 'https://example.com/x.torrent',
      lane: 'arr',
      mediaType: 'manual',
    })).toEqual({ ok: false, code: 'invalid_media_type' });
  });
});
