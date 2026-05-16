const path = require('path');

const DEFAULT_CLUSTER_CONFIG_RELATIVE_PATH = path.join('orchestrator', 'config', 'clusters.js');

const loadClusterConfig = ({ projectRoot, configPath } = {}) => {
  const resolvedProjectRoot = path.resolve(projectRoot || path.resolve(__dirname, '../../../../..'));
  const targetPath = path.resolve(
    resolvedProjectRoot,
    configPath || process.env.ORCHESTRATOR_CLUSTER_CONFIG || DEFAULT_CLUSTER_CONFIG_RELATIVE_PATH
  );

  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const loaded = require(targetPath);
    const clusters = loaded && typeof loaded === 'object' && loaded.clusters && typeof loaded.clusters === 'object'
      ? loaded.clusters
      : {};
    return {
      clusters,
      path: targetPath,
    };
  } catch {
    return {
      clusters: {},
      path: targetPath,
    };
  }
};

module.exports = {
  DEFAULT_CLUSTER_CONFIG_RELATIVE_PATH,
  loadClusterConfig,
};
