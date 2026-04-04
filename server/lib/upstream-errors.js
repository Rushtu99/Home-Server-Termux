const normalizeErrorText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const toClientFacingUpstreamError = ({ status = 0, rawMessage = '', fallbackMessage = 'Upstream request failed' } = {}) => {
  const normalizedRaw = normalizeErrorText(rawMessage);
  const token = normalizedRaw.toLowerCase();
  if (!normalizedRaw) {
    return fallbackMessage;
  }
  if (status === 401 || status === 403 || /api key|token|auth|credential/.test(token)) {
    return 'Upstream provider rejected the request.';
  }
  if (status === 404) {
    return 'Requested upstream resource is unavailable.';
  }
  if (status === 408 || status === 504 || /timed out|timeout/.test(token)) {
    return 'Upstream request timed out.';
  }
  if (status === 429 || /rate limit|quota/.test(token)) {
    return 'Upstream provider rate limited the request.';
  }
  return fallbackMessage;
};

const extractUpstreamErrorText = async (response, fallbackMessage) => {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => ({}));
    return normalizeErrorText(payload?.error?.message || payload?.error || fallbackMessage);
  }
  const text = await response.text().catch(() => '');
  return normalizeErrorText(text || fallbackMessage);
};

module.exports = {
  extractUpstreamErrorText,
  normalizeErrorText,
  toClientFacingUpstreamError,
};
