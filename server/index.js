const { createApp } = require('./src/main/create-app');
const { startServer } = require('./src/main/start-server');
const { stopServer } = require('./src/main/stop-server');

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  startServer,
  stopServer,
};
