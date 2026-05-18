const fs = require('fs');
const path = require('path');

const serverRoot = path.resolve(__dirname, '../..');
const fixturesRoot = path.resolve(serverRoot, 'test/fixtures');
const routeFixturePath = path.join(fixturesRoot, 'route-manifest-baseline.json');
const startupFixturePath = path.join(fixturesRoot, 'startup-invariants-baseline.json');

const { createApp } = require(path.join(serverRoot, 'src/main/create-app'));

const now = new Date().toISOString();
const appRuntime = createApp({ enablePolling: false });
const routeManifest = appRuntime.routeManifest || { totalRoutes: 0, routes: [] };
const startup = appRuntime.startupInvariants || { invariants: {}, registrationOrder: {} };

const routeFixture = {
  schemaVersion: 1,
  capturedAt: now,
  sourceEntrypoint: 'server/index.js',
  totalRoutes: Number(routeManifest.totalRoutes || 0),
  routes: Array.isArray(routeManifest.routes) ? routeManifest.routes : [],
};

const startupFixture = {
  schemaVersion: 1,
  capturedAt: now,
  sourceEntrypoint: 'server/index.js',
  invariants: {
    envLoadGuardEnabled: Boolean(startup.invariants?.envLoadGuardEnabled),
    trustProxy: String(startup.invariants?.trustProxy || ''),
    jsonBodyLimit: String(startup.invariants?.jsonBodyLimit || '256kb'),
    authRoutesBeforeDualRoutes: Boolean(startup.invariants?.authRoutesBeforeDualRoutes),
    errorMiddlewareLast: Boolean(startup.invariants?.errorMiddlewareLast),
    pollIntervalMs: Number(startup.invariants?.pollIntervalMs || 30000),
  },
  registrationOrder: {
    firstAuthRouteIndex: Number(startup.registrationOrder?.firstAuthRouteIndex ?? -1),
    firstDualRouteIndex: Number(startup.registrationOrder?.firstDualRouteIndex ?? -1),
    errorMiddlewareIndex: Number(startup.registrationOrder?.errorMiddlewareIndex ?? -1),
    lastRouteIndex: Number(startup.registrationOrder?.lastRouteIndex ?? -1),
  },
};

fs.mkdirSync(fixturesRoot, { recursive: true });
fs.writeFileSync(routeFixturePath, `${JSON.stringify(routeFixture, null, 2)}\n`);
fs.writeFileSync(startupFixturePath, `${JSON.stringify(startupFixture, null, 2)}\n`);

console.log(`wrote ${routeFixturePath}`);
console.log(`wrote ${startupFixturePath}`);

process.exit(0);
