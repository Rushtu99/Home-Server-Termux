const path = require('path');
const { parseYamlSubset } = require('../../backend/config/yaml-subset');
const { createDescriptorRegistry } = require('../../backend/services/registry');
const { resolveDependencyOrder, resolveServiceDependencyOrder } = require('../../backend/orchestrator/graph');

const repoRoot = path.resolve(__dirname, '../..');

describe('v2 descriptor registry', () => {
  it('parses the supported YAML subset', () => {
    const parsed = parseYamlSubset(`
name: demo
port: 8080
aliases: [one, two]
commands:
  start: start.sh
  stop: stop.sh
dependsOn:
  - base
`);
    expect(parsed).toEqual({
      aliases: ['one', 'two'],
      commands: { start: 'start.sh', stop: 'stop.sh' },
      dependsOn: ['base'],
      name: 'demo',
      port: 8080,
    });
  });

  it('loads service and cluster descriptors from the v2 layout', () => {
    const registry = createDescriptorRegistry({ projectRoot: repoRoot });
    expect(Object.keys(registry.serviceDescriptors)).toContain('filesystem');
    expect(Object.keys(registry.serviceDescriptors)).toContain('llama_cpp');
    expect(registry.serviceAliases.qbit).toBe('qbittorrent');
    expect(registry.clusterAliases.arrstack).toBe('arr');
    expect(registry.clusterConfig.media.dependsOn).toEqual(['arr']);
    expect(registry.clusterConfig.main.services).toEqual(['filesystem', 'backend', 'frontend', 'nginx']);
    expect(registry.serviceCommands.filesystem.start).toContain('services/filesystem/start.sh');
  });

  it('resolves cluster dependency order topologically', () => {
    const registry = createDescriptorRegistry({ projectRoot: repoRoot });
    expect(resolveDependencyOrder(registry.clusterConfig, 'media')).toEqual(['arr', 'media']);
  });

  it('resolves service dependency order topologically', () => {
    const registry = createDescriptorRegistry({ projectRoot: repoRoot });
    expect(resolveServiceDependencyOrder(registry.serviceDescriptors, 'bazarr')).toEqual([
      'filesystem',
      'qbittorrent',
      'prowlarr',
      'sonarr',
      'radarr',
      'bazarr',
    ]);
  });
});
