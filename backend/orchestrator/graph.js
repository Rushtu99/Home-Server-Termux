const normalize = (value) => String(value || '').trim().toLowerCase();

const resolveDependencyOrder = (definitions = {}, target, { includeSelf = true } = {}) => {
  const key = normalize(target);
  if (!definitions[key]) throw new Error(`Unknown target '${target}'`);
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = (name, stack = []) => {
    if (visiting.has(name)) throw new Error(`Dependency cycle detected: ${[...stack, name].join(' -> ')}`);
    if (visited.has(name)) return;
    visiting.add(name);
    const deps = definitions[name]?.dependsOn || definitions[name]?.dependencies || [];
    for (const dep of deps.map(normalize).filter(Boolean)) {
      if (!definitions[dep]) throw new Error(`Unknown dependency '${dep}' referenced by '${name}'`);
      visit(dep, [...stack, name]);
    }
    visiting.delete(name);
    visited.add(name);
    if (includeSelf || name !== key) ordered.push(name);
  };

  visit(key);
  return ordered;
};

const resolveServiceDependencyOrder = (definitions = {}, target, { includeSelf = true } = {}) => {
  const key = normalize(target);
  if (!definitions[key]) throw new Error(`Unknown service '${target}'`);
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  const visit = (name, stack = []) => {
    if (visiting.has(name)) throw new Error(`Service dependency cycle detected: ${[...stack, name].join(' -> ')}`);
    if (visited.has(name)) return;
    visiting.add(name);
    const deps = definitions[name]?.dependencies || [];
    for (const dep of deps.map(normalize).filter(Boolean)) {
      if (!definitions[dep]) throw new Error(`Unknown service dependency '${dep}' referenced by '${name}'`);
      visit(dep, [...stack, name]);
    }
    visiting.delete(name);
    visited.add(name);
    if (includeSelf || name !== key) ordered.push(name);
  };

  visit(key);
  return ordered;
};

const resolveDependentOrder = (definitions = {}, target, { includeSelf = true } = {}) => {
  const key = normalize(target);
  if (!definitions[key]) throw new Error(`Unknown target '${target}'`);
  const reverse = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const deps = definition?.dependsOn || definition?.dependencies || [];
    for (const dep of deps.map(normalize).filter(Boolean)) {
      if (!reverse[dep]) reverse[dep] = [];
      reverse[dep].push(name);
    }
  }

  const ordered = [];
  const visited = new Set();
  const visit = (name) => {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dependent of reverse[name] || []) visit(dependent);
    if (includeSelf || name !== key) ordered.push(name);
  };

  visit(key);
  return ordered;
};

const detectCycle = (definitions = {}) => {
  for (const key of Object.keys(definitions)) {
    try {
      resolveDependencyOrder(definitions, key);
    } catch (error) {
      if (String(error.message || '').includes('cycle')) return error.message;
      throw error;
    }
  }
  return null;
};

module.exports = {
  detectCycle,
  resolveDependentOrder,
  resolveDependencyOrder,
  resolveServiceDependencyOrder,
};
