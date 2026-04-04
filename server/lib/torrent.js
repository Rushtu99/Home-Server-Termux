const TORRENT_LANES = new Set(['arr', 'standalone']);
const ARR_MEDIA_TYPES = new Set(['movies', 'series']);

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
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
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
  isValidTorrentSource,
  validateMediaTorrentPayload,
};
