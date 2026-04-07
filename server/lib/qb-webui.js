const buildQbittorrentWebUiUrl = (baseUrl, pathname) => {
  const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const cleanPath = String(pathname || '').startsWith('/') ? pathname : `/${pathname || ''}`;
  return `${cleanBase}${cleanPath}`;
};

const getSetCookieHeaderValues = (headers) => {
  if (typeof headers?.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const joined = headers?.get?.('set-cookie');
  if (!joined) {
    return [];
  }
  return joined.split(/,(?=\s*[^;=]+=[^;]+)/g).map((value) => value.trim()).filter(Boolean);
};

const extractQbittorrentSidCookie = (headers) => {
  const setCookies = getSetCookieHeaderValues(headers);
  const sidCookie = setCookies.find((entry) => entry.toUpperCase().startsWith('SID='));
  if (!sidCookie) {
    return '';
  }
  return sidCookie.split(';')[0];
};

module.exports = {
  buildQbittorrentWebUiUrl,
  extractQbittorrentSidCookie,
  getSetCookieHeaderValues,
};
