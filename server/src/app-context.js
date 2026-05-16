const createAppContext = ({ appDb, rootDir, runtimeDir }) => ({
  appDb,
  rootDir,
  runtimeDir,
});

module.exports = {
  createAppContext,
};
