#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createStandaloneOrchestrator } = require('../orchestrator');
const { getAndroidPowerState } = require('../power/android');
const { detectCycle } = require('../orchestrator/graph');

const projectRoot = path.resolve(__dirname, '../..');
const orchestrator = createStandaloneOrchestrator({ projectRoot });
const args = process.argv.slice(2);
const action = String(args[0] || 'help').toLowerCase();
const target = args[1];

const print = (payload) => {
  if (typeof payload === 'string') {
    console.log(payload);
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
};

const usage = () => print(`usage: hs <command> [target]\n\ncommands:\n  start <cluster|service>\n  stop <cluster|service>\n  restart <cluster|service>\n  status\n  health [service] [--repair]\n  doctor\n  logs [target] [--follow]\n  logs --follow [target]\n  cluster <start|stop|restart> <name>\n  service <start|stop|restart> <name>`);

const isCluster = (name) => Boolean(orchestrator.registry.clusterDescriptors[orchestrator.registry.resolveClusterName(name)]);
const isService = (name) => Boolean(orchestrator.registry.serviceDescriptors[orchestrator.registry.resolveServiceName(name)]);

const controlAny = async (verb, name) => {
  if (!['start', 'stop', 'restart'].includes(String(verb || '').toLowerCase())) {
    throw new Error(`Invalid action '${verb}'`);
  }
  if (!name) throw new Error(`${verb} requires a target`);
  if (isCluster(name)) {
    if (verb === 'start') return orchestrator.startCluster(name);
    if (verb === 'stop') return orchestrator.stopCluster(name);
    return orchestrator.restartCluster(name);
  }
  if (isService(name)) return orchestrator.controlService(name, verb);
  throw new Error(`Unknown target '${name}'`);
};

const positionalAfterAction = () => args.slice(1).filter((entry) => !String(entry || '').startsWith('-'));

const logs = () => {
  const follow = args.includes('--follow') || args.includes('-f');
  const name = positionalAfterAction()[0] || 'hs';
  const candidates = [
    path.join(projectRoot, 'logs', 'services', `${name}.log`),
    path.join(projectRoot, 'logs', 'clusters', `${name}.log`),
    path.join(projectRoot, 'logs', 'orchestrator', `${name}.log`),
    path.join(projectRoot, 'logs', `${name}.log`),
  ];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[2];
  if (!follow) {
    if (!fs.existsSync(filePath)) return print({ error: 'log not found', path: filePath });
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).slice(-120);
    return print(lines.join('\n'));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.closeSync(fs.openSync(filePath, 'a'));
  const child = spawn('tail', ['-f', filePath], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
  return null;
};

const doctor = () => {
  const registry = orchestrator.registry;
  const missing = [];
  const warnings = [];
  for (const descriptor of Object.values(registry.serviceDescriptors)) {
    for (const script of ['service.yaml', 'start.sh', 'stop.sh', 'health.sh']) {
      const filePath = path.join(descriptor.directory, script);
      if (!fs.existsSync(filePath)) missing.push(filePath);
    }
    const statusPath = path.join(descriptor.directory, 'status.sh');
    if (!fs.existsSync(statusPath)) warnings.push(`${descriptor.name}: status.sh missing; health.sh will be used for status fallback`);
  }

  let clusterCycle = null;
  try {
    clusterCycle = detectCycle(registry.clusterConfig);
  } catch (error) {
    warnings.push(error.message);
  }
  for (const [clusterName, definition] of Object.entries(registry.clusterConfig)) {
    for (const dependency of definition.dependsOn || []) {
      if (!registry.clusterDescriptors[dependency]) missing.push(`clusters/${clusterName}: dependency '${dependency}'`);
    }
    for (const service of definition.services || []) {
      if (!registry.serviceDescriptors[service]) missing.push(`clusters/${clusterName}: service '${service}'`);
    }
  }
  return {
    clusters: Object.keys(registry.clusterDescriptors).length,
    clusterCycle,
    descriptors: Object.keys(registry.serviceDescriptors).length,
    missing,
    ok: missing.length === 0,
    power: getAndroidPowerState(),
    projectRoot,
    warnings,
  };
};

(async () => {
  if (['help', '-h', '--help'].includes(action)) return usage();
  if (['start', 'stop', 'restart'].includes(action)) return print(await controlAny(action, target));
  if (action === 'cluster') return print(await controlAny(args[1], args[2]));
  if (action === 'service') return print(await orchestrator.controlService(args[2], args[1]));
  if (action === 'status') return print(await orchestrator.status());
  if (action === 'health') {
    const repair = args.includes('--repair');
    const healthTarget = positionalAfterAction()[0];
    if (repair && !healthTarget) return print(await orchestrator.healthSweep({ repair: true }));
    if (healthTarget) return print(await orchestrator.runServiceHealth(healthTarget));
    const results = [];
    for (const name of Object.keys(orchestrator.registry.serviceDescriptors)) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await orchestrator.runServiceHealth(name));
    }
    return print({ generatedAt: new Date().toISOString(), services: results });
  }
  if (action === 'doctor') return print(doctor());
  if (action === 'logs') return logs();
  throw new Error(`Unknown command '${action}'`);
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
