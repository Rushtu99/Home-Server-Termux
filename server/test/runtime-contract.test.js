const fs = require('fs');
const os = require('os');
const path = require('path');
const { resetRuntimeModuleCache } = require('./helpers/runtime-cache');

const repoRoot = path.resolve(__dirname, '../..');

const applyTestEnv = (tmpRoot) => {
  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.BACKEND_BIND_HOST = '127.0.0.1';
  process.env.RUNTIME_DIR = path.join(tmpRoot, 'runtime');
  process.env.APP_DB_PATH = path.join(tmpRoot, 'runtime', 'app.db');
  process.env.FTP_MOUNT_RUNTIME_DIR = path.join(tmpRoot, 'runtime', 'ftp-mounts');
  process.env.FS_OPERATIONS_STATE_DIR = path.join(tmpRoot, 'runtime', 'fs-operations');
  process.env.FS_OPERATIONS_STAGING_DIR = path.join(tmpRoot, 'runtime', 'fs-operations', 'staging');
  process.env.LLM_MODELS_DIR = path.join(tmpRoot, 'runtime', 'llm-models');
  process.env.LLM_PULL_STATE_DIR = path.join(tmpRoot, 'runtime', 'llm-pulls');
  process.env.STRICT_BOOTSTRAP = 'false';
  process.env.JWT_SECRET = 'test-jwt-secret-local-only';
  process.env.APP_AUTH_SECRET = 'test-app-auth-secret-local-only';
  process.env.DASHBOARD_USER = 'admin';
  process.env.DASHBOARD_PASS = 'test-admin-password';
  process.env.ADMIN_ACTION_PASSWORD = 'test-admin-password';
  process.env.COOKIE_SECURE = 'false';
  process.env.ENABLE_SSHD = 'false';
  delete process.env.POLL_INTERVAL_MS;
};

describe('runtime contract', () => {
  let originalEnv = null;
  let tmpRoot = null;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-runtime-'));
    applyTestEnv(tmpRoot);
    resetRuntimeModuleCache({ repoRoot });
  });

  afterEach(async () => {
    try {
      const { stopServer } = require('../src/main/stop-server');
      await stopServer();
    } catch {
      // no-op
    }
    process.env = originalEnv;
    resetRuntimeModuleCache({ repoRoot });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('createApp returns app runtime contract without listening', () => {
    const { createApp } = require('../src/main/create-app');
    const runtime = createApp({ enablePolling: false });

    expect(runtime).toBeTruthy();
    expect(runtime.app).toBeTruthy();
    expect(typeof runtime.app.listen).toBe('function');
    expect(runtime.polling.intervalMs).toBe(30000);
    expect(runtime.polling.enabled).toBe(false);
    expect(runtime.routeManifest).toBeTruthy();
    expect(runtime.startupInvariants).toBeTruthy();
  });

  it('respects POLL_INTERVAL_MS override when valid', () => {
    process.env.POLL_INTERVAL_MS = '45000';
    resetRuntimeModuleCache({ repoRoot });
    const { createApp } = require('../src/main/create-app');
    const runtime = createApp({ enablePolling: false });
    expect(runtime.polling.intervalMs).toBe(45000);
  });

  it('clamps POLL_INTERVAL_MS override to minimum 10000', () => {
    process.env.POLL_INTERVAL_MS = '5000';
    resetRuntimeModuleCache({ repoRoot });
    const { createApp } = require('../src/main/create-app');
    const runtime = createApp({ enablePolling: false });
    expect(runtime.polling.intervalMs).toBe(10000);
  });

  it('startServer supports enablePolling=false and stopServer closes cleanly', async () => {
    const { startServer } = require('../src/main/start-server');
    const { stopServer } = require('../src/main/stop-server');
    const { __runtimeState } = require('../src/main/kernel');

    const runtime = await startServer({ host: '127.0.0.1', port: 0, enablePolling: false, silent: true });
    expect(runtime.port).toBeGreaterThan(0);
    expect(__runtimeState.pollIntervalId).toBeNull();

    await stopServer(runtime);
    expect(__runtimeState.pollIntervalId).toBeNull();
  });

  it('startServer supports enablePolling=true and creates polling timer', async () => {
    const { startServer } = require('../src/main/start-server');
    const { stopServer } = require('../src/main/stop-server');
    const { __runtimeState } = require('../src/main/kernel');

    const runtime = await startServer({ host: '127.0.0.1', port: 0, enablePolling: true, silent: true });
    expect(runtime.port).toBeGreaterThan(0);
    expect(__runtimeState.pollIntervalId).toBeTruthy();

    await stopServer(runtime);
    expect(__runtimeState.pollIntervalId).toBeNull();
  });
});
