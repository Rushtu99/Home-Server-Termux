const fs = require('fs');
const path = require('path');
const { resetRuntimeModuleCache } = require('./helpers/runtime-cache');

const repoRoot = path.resolve(__dirname, '../..');
const fixturePath = path.resolve(__dirname, 'fixtures/route-manifest-baseline.json');

const normalize = (payload) => ({
  schemaVersion: Number(payload.schemaVersion || 0),
  sourceEntrypoint: String(payload.sourceEntrypoint || ''),
  totalRoutes: Number(payload.totalRoutes || 0),
  routes: Array.isArray(payload.routes) ? payload.routes : [],
});

describe('route manifest parity', () => {
  beforeEach(() => {
    resetRuntimeModuleCache({ repoRoot });
  });

  afterEach(() => {
    resetRuntimeModuleCache({ repoRoot });
  });

  it('matches baseline route manifest (excluding capturedAt)', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const { createApp } = require('../src/main/create-app');
    const runtime = createApp({ enablePolling: false });

    const current = {
      schemaVersion: 1,
      sourceEntrypoint: 'server/index.js',
      totalRoutes: runtime.routeManifest.totalRoutes,
      routes: runtime.routeManifest.routes,
    };

    expect(normalize(current)).toEqual(normalize(fixture));
  });
});
