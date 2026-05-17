const fs = require('fs');
const path = require('path');
const { readYamlSubsetFile } = require('../config/yaml-subset');

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const normalizeName = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
const arrayValue = (value) => Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
const numberValue = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const resolveMaybePath = (serviceDir, value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return path.isAbsolute(text) ? text : path.join(serviceDir, text);
};

const mergeDescriptor = (base = {}, override = {}) => {
  const merged = { ...base, ...override };
  for (const key of ['commands', 'health', 'restart']) {
    if (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
      && override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      merged[key] = { ...base[key], ...override[key] };
    }
  }
  return merged;
};

const readOverride = (projectRoot, scope, name) => {
  const filePath = path.join(projectRoot, 'config', scope, `${name}.yaml`);
  if (!fs.existsSync(filePath)) return {};
  return readYamlSubsetFile(filePath);
};

const envPrefixFor = (name) => String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');

const serviceEnvOverrides = (name) => {
  const prefix = envPrefixFor(name);
  const out = {};
  const port = process.env[`${prefix}_PORT`] || (name === 'backend' ? process.env.PORT || process.env.BACKEND_PORT : '');
  const host = process.env[`${prefix}_BIND_HOST`] || (name === 'backend' ? process.env.BACKEND_BIND_HOST : '');
  if (port) out.port = Number(port);
  if (host) out.host = host;
  return out;
};

const commandFor = (serviceDir, commandName, descriptor) => {
  const commands = descriptor.commands && typeof descriptor.commands === 'object' ? descriptor.commands : {};
  const scriptName = commands[commandName] || (commandName === 'check' ? commands.status : '') || `${commandName}.sh`;
  const resolved = resolveMaybePath(serviceDir, scriptName);
  return resolved && fs.existsSync(resolved) ? shellQuote(resolved) : '';
};

const loadServiceDescriptor = (serviceDir, { projectRoot } = {}) => {
  const descriptorPath = path.join(serviceDir, 'service.yaml');
  if (!fs.existsSync(descriptorPath)) return null;
  const base = readYamlSubsetFile(descriptorPath);
  const baseName = normalizeName(base.name || path.basename(serviceDir));
  const raw = mergeDescriptor(
    mergeDescriptor(base, readOverride(projectRoot || path.resolve(serviceDir, '../..'), 'services', baseName)),
    serviceEnvOverrides(baseName),
  );
  const name = normalizeName(raw.name || baseName);
  const aliases = arrayValue(raw.aliases).map(normalizeName).filter((entry) => entry && entry !== name);
  const dependencies = arrayValue(raw.dependencies).map(normalizeName);
  const host = String(raw.host || raw.bindHost || '').trim() || null;
  const port = numberValue(raw.port, 0);
  const health = raw.health && typeof raw.health === 'object' ? { ...raw.health } : {};

  return {
    ...raw,
    aliases,
    dependencies,
    descriptorPath,
    directory: serviceDir,
    group: String(raw.group || 'platform'),
    health,
    host,
    key: name,
    label: String(raw.label || raw.name || name),
    name,
    port,
    surface: String(raw.surface || raw.group || 'home'),
  };
};

const loadClusterDescriptor = (clusterDir, { projectRoot } = {}) => {
  const descriptorPath = path.join(clusterDir, 'cluster.yaml');
  if (!fs.existsSync(descriptorPath)) return null;
  const base = readYamlSubsetFile(descriptorPath);
  const baseName = normalizeName(base.name || path.basename(clusterDir));
  const raw = mergeDescriptor(base, readOverride(projectRoot || path.resolve(clusterDir, '../..'), 'clusters', baseName));
  const name = normalizeName(raw.name || baseName);
  return {
    ...raw,
    aliases: arrayValue(raw.aliases).map(normalizeName).filter((entry) => entry && entry !== name),
    dependsOn: arrayValue(raw.dependsOn).map(normalizeName),
    descriptorPath,
    directory: clusterDir,
    name,
    services: arrayValue(raw.services).map(normalizeName),
  };
};

const listDirectories = (root) => {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
};

const createDescriptorRegistry = ({ projectRoot } = {}) => {
  const root = projectRoot || path.resolve(__dirname, '../..');
  const servicesRoot = path.join(root, 'services');
  const clustersRoot = path.join(root, 'clusters');
  const serviceDescriptors = {};
  const serviceAliases = {};
  const clusterDescriptors = {};
  const clusterAliases = {};

  for (const serviceDir of listDirectories(servicesRoot)) {
    const descriptor = loadServiceDescriptor(serviceDir, { projectRoot: root });
    if (!descriptor) continue;
    serviceDescriptors[descriptor.name] = descriptor;
    for (const alias of descriptor.aliases) serviceAliases[alias] = descriptor.name;
  }

  for (const clusterDir of listDirectories(clustersRoot)) {
    const descriptor = loadClusterDescriptor(clusterDir, { projectRoot: root });
    if (!descriptor) continue;
    clusterDescriptors[descriptor.name] = descriptor;
    for (const alias of descriptor.aliases) clusterAliases[alias] = descriptor.name;
  }

  for (const descriptor of Object.values(serviceDescriptors)) {
    descriptor.dependencies = descriptor.dependencies.map((entry) => serviceAliases[entry] || entry);
  }

  for (const descriptor of Object.values(clusterDescriptors)) {
    descriptor.dependsOn = descriptor.dependsOn.map((entry) => clusterAliases[entry] || entry);
    descriptor.services = descriptor.services.map((entry) => serviceAliases[entry] || entry);
  }

  const serviceCommands = Object.fromEntries(Object.entries(serviceDescriptors).map(([name, descriptor]) => {
    const statusCommand = commandFor(descriptor.directory, 'status', descriptor);
    const healthCommand = commandFor(descriptor.directory, 'health', descriptor);
    return [name, {
      binary: String(descriptor.binary || 'bash'),
      check: statusCommand || healthCommand,
      health: healthCommand || statusCommand,
      host: descriptor.host || '127.0.0.1',
      installCheckPaths: ['start.sh', 'stop.sh', 'status.sh', 'health.sh'].map((entry) => path.join(descriptor.directory, entry)).filter((entry) => fs.existsSync(entry)),
      port: descriptor.port || 0,
      restart: `${commandFor(descriptor.directory, 'stop', descriptor)}; ${commandFor(descriptor.directory, 'start', descriptor)}`,
      start: commandFor(descriptor.directory, 'start', descriptor),
      stop: commandFor(descriptor.directory, 'stop', descriptor),
      v2DescriptorPath: descriptor.descriptorPath,
    }];
  }));

  const clusterConfig = Object.fromEntries(Object.entries(clusterDescriptors).map(([name, descriptor]) => [name, {
    dependsOn: descriptor.dependsOn,
    services: descriptor.services,
  }]));

  const catalogEntries = Object.values(serviceDescriptors).map((descriptor) => ({
    available: true,
    controlMode: String(descriptor.controlMode || 'optional'),
    dependencies: descriptor.dependencies,
    description: String(descriptor.description || ''),
    group: descriptor.group,
    host: descriptor.host || null,
    key: descriptor.name,
    label: descriptor.label,
    port: descriptor.port || null,
    route: descriptor.route || null,
    status: 'unknown',
    surface: descriptor.surface,
    type: 'service',
    v2: true,
  }));

  return {
    catalogEntries,
    clusterAliases,
    clusterConfig,
    clusterDescriptors,
    clustersRoot,
    resolveClusterName: (name) => clusterAliases[normalizeName(name)] || normalizeName(name),
    resolveServiceName: (name) => serviceAliases[normalizeName(name)] || normalizeName(name),
    serviceAliases,
    serviceCommands,
    serviceDescriptors,
    servicesRoot,
  };
};

module.exports = {
  createDescriptorRegistry,
  loadClusterDescriptor,
  loadServiceDescriptor,
  normalizeName,
  shellQuote,
};
