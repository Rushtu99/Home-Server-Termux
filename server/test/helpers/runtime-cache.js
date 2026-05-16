const path = require('path');

const toPosix = (value) => String(value || '').replace(/\\/g, '/');

const resetRuntimeModuleCache = ({ repoRoot, extraPrefixes = [] } = {}) => {
  const resolvedRepoRoot = toPosix(repoRoot || path.resolve(__dirname, '../../..'));
  const serverRoot = `${resolvedRepoRoot}/server`;
  const srcPrefix = `${serverRoot}/src/`;
  const appDbPath = `${serverRoot}/app-db.js`;
  const additional = Array.isArray(extraPrefixes)
    ? extraPrefixes.map((entry) => toPosix(entry)).filter(Boolean)
    : [];

  for (const modulePath of Object.keys(require.cache)) {
    const normalized = toPosix(modulePath);
    const inSrc = normalized.startsWith(srcPrefix);
    const isAppDb = normalized === appDbPath;
    const isServerLocal = normalized.startsWith(`${serverRoot}/`)
      && !normalized.startsWith(`${serverRoot}/test/`)
      && !normalized.includes('/node_modules/');
    const inAdditional = additional.some((prefix) => normalized.startsWith(prefix));

    if (inSrc || isAppDb || isServerLocal || inAdditional) {
      delete require.cache[modulePath];
    }
  }
};

module.exports = {
  resetRuntimeModuleCache,
};
