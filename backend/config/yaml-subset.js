const fs = require('fs');

const stripComment = (line) => {
  let quote = '';
  for (let idx = 0; idx < line.length; idx += 1) {
    const char = line[idx];
    if ((char === '"' || char === "'") && line[idx - 1] !== '\\') {
      quote = quote === char ? '' : quote || char;
    }
    if (char === '#' && !quote) {
      return line.slice(0, idx);
    }
  }
  return line;
};

const unquote = (value) => {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
};

const parseScalar = (raw) => {
  const value = unquote(raw);
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
};

const splitInlineArray = (raw) => {
  const inner = String(raw || '').trim().slice(1, -1).trim();
  if (!inner) return [];
  const out = [];
  let quote = '';
  let current = '';
  for (let idx = 0; idx < inner.length; idx += 1) {
    const char = inner[idx];
    if ((char === '"' || char === "'") && inner[idx - 1] !== '\\') {
      quote = quote === char ? '' : quote || char;
      current += char;
      continue;
    }
    if (char === ',' && !quote) {
      out.push(parseScalar(current.trim()));
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(parseScalar(current.trim()));
  return out;
};

const parseValue = (raw) => {
  const text = String(raw || '').trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitInlineArray(text);
  }
  return parseScalar(text);
};

const parseYamlSubset = (source, { filePath = '<inline>' } = {}) => {
  const root = {};
  let activeKey = null;
  let activeKind = null;

  const setActive = (key, kind) => {
    activeKey = key;
    activeKind = kind;
    if (kind === 'array') root[key] = [];
    if (kind === 'map') root[key] = {};
  };

  String(source || '').split(/\r?\n/).forEach((line, index) => {
    const withoutComment = stripComment(line).replace(/\s+$/, '');
    if (!withoutComment.trim()) return;

    const indentMatch = withoutComment.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    const trimmed = withoutComment.trim();

    if (indent === 0) {
      const match = trimmed.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
      if (!match) {
        throw new Error(`${filePath}:${index + 1}: unsupported YAML subset syntax`);
      }
      const [, key, rawValue = ''] = match;
      if (rawValue === '') {
        activeKey = key;
        activeKind = null;
        root[key] = null;
        return;
      }
      root[key] = parseValue(rawValue);
      activeKey = null;
      activeKind = null;
      return;
    }

    if (!activeKey) {
      throw new Error(`${filePath}:${index + 1}: nested value without a parent key`);
    }

    if (indent !== 2) {
      throw new Error(`${filePath}:${index + 1}: only one nesting level with two spaces is supported`);
    }

    if (trimmed.startsWith('- ')) {
      if (activeKind === null) setActive(activeKey, 'array');
      if (activeKind !== 'array') throw new Error(`${filePath}:${index + 1}: cannot mix array and map values`);
      root[activeKey].push(parseValue(trimmed.slice(2)));
      return;
    }

    const child = trimmed.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/);
    if (!child) {
      throw new Error(`${filePath}:${index + 1}: unsupported nested YAML syntax`);
    }
    if (activeKind === null) setActive(activeKey, 'map');
    if (activeKind !== 'map') throw new Error(`${filePath}:${index + 1}: cannot mix map and array values`);
    const [, key, rawValue = ''] = child;
    root[activeKey][key] = parseValue(rawValue);
  });

  return root;
};

const readYamlSubsetFile = (filePath) => parseYamlSubset(fs.readFileSync(filePath, 'utf8'), { filePath });

module.exports = {
  parseYamlSubset,
  readYamlSubsetFile,
};
