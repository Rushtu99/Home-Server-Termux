const TORRENT_LANES = new Set(['arr', 'standalone']);
const ARR_MEDIA_TYPES = new Set(['movies', 'series']);

const PRIVATE_IPV4_PATTERNS = [
  /^0\.0\.0\.0$/,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
];

const isPrivateTorrentHost = (hostname) => {
  const value = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!value) {
    return true;
  }
  if (
    value === 'localhost'
    || value === 'ip6-localhost'
    || value === '::1'
    || value === '::'
    || value === 'host.docker.internal'
    || value.endsWith('.local')
  ) {
    return true;
  }
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(value));
};

const isValidTorrentSource = (source) => {
  const value = String(source || '').trim();
  if (!value) {
    return false;
  }
  if (/^magnet:\?/i.test(value)) {
    return true;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    return !isPrivateTorrentHost(parsed.hostname);
  } catch {
    return false;
  }
};

const validateMediaTorrentPayload = ({ source, lane, mediaType }) => {
  if (!isValidTorrentSource(source)) {
    return { ok: false, code: 'invalid_source' };
  }

  const normalizedLane = String(lane || '').trim().toLowerCase();
  if (!TORRENT_LANES.has(normalizedLane)) {
    return { ok: false, code: 'invalid_lane' };
  }

  const normalizedMediaType = String(mediaType || '').trim().toLowerCase();
  if (normalizedLane === 'arr' && !ARR_MEDIA_TYPES.has(normalizedMediaType)) {
    return { ok: false, code: 'invalid_media_type' };
  }

  return { ok: true, code: '' };
};

module.exports = {
  ARR_MEDIA_TYPES,
  TORRENT_LANES,
  isPrivateTorrentHost,
  isValidTorrentSource,
  validateMediaTorrentPayload,
};
