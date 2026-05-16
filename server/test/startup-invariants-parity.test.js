const fs = require('fs');
const path = require('path');
const { resetRuntimeModuleCache } = require('./helpers/runtime-cache');

const repoRoot = path.resolve(__dirname, '../..');
const fixturePath = path.resolve(__dirname, 'fixtures/startup-invariants-baseline.json');

const normalize = (payload) => ({
  schemaVersion: Number(payload.schemaVersion || 0),
  sourceEntrypoint: String(payload.sourceEntrypoint || ''),
  invariants: payload.invariants || {},
  registrationOrder: payload.registrationOrder || {},
});

describe('startup invariants parity', () => {
  beforeEach(() => {
    resetRuntimeModuleCache({ repoRoot });
  });

  afterEach(() => {
    resetRuntimeModuleCache({ repoRoot });
  });

  it('matches baseline startup invariants (excluding capturedAt)', () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const { createApp } = require('../src/main/create-app');
    const runtime = createApp({ enablePolling: false });

    const current = {
      schemaVersion: 1,
      sourceEntrypoint: 'server/index.js',
      invariants: runtime.startupInvariants.invariants,
      registrationOrder: runtime.startupInvariants.registrationOrder,
    };

    expect(normalize(current)).toEqual(normalize(fixture));
  });
});
