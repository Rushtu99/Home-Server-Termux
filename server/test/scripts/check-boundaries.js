const fs = require('fs');
const path = require('path');

const serverRoot = path.resolve(__dirname, '../..');
const srcRoot = path.join(serverRoot, 'src');

const fileRules = [
  {
    file: /^server\/src\/domain\/.*\.js$/,
    forbidden: /^(\.\.\/)+(handlers|routes|main)(\/|$)/,
    message: 'domain layer cannot import handlers/routes/main',
  },
  {
    file: /^server\/src\/handlers\/.*\.js$/,
    forbidden: /^(\.\.\/)+(routes|main)(\/|$)/,
    message: 'handlers layer cannot import routes/main',
  },
  {
    file: /^server\/src\/routes\/.*\.js$/,
    forbidden: /^(\.\.\/)+(domain|main)(\/|$)/,
    message: 'routes layer cannot import domain/main',
  },
  {
    file: /^server\/src\/main\/.*\.js$/,
    forbidden: /^(\.\.\/)+(domain)(\/|$)/,
    message: 'main layer cannot import domain directly',
  },
];

const readJsFiles = (rootDir) => {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!fs.existsSync(current)) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
      } else if (entry.isFile() && target.endsWith('.js')) {
        out.push(target);
      }
    }
  }
  return out.sort();
};

const extractSpecifiers = (source) => {
  const specifiers = [];
  const requireRe = /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g;
  const importRe = /from\s+['\"]([^'\"]+)['\"]/g;

  let match = requireRe.exec(source);
  while (match) {
    specifiers.push(match[1]);
    match = requireRe.exec(source);
  }

  match = importRe.exec(source);
  while (match) {
    specifiers.push(match[1]);
    match = importRe.exec(source);
  }

  return specifiers;
};

const violations = [];
for (const file of readJsFiles(srcRoot)) {
  const rel = `server/${path.relative(serverRoot, file).replace(/\\/g, '/')}`;
  const source = fs.readFileSync(file, 'utf8');
  const specifiers = extractSpecifiers(source);

  for (const rule of fileRules) {
    if (!rule.file.test(rel)) {
      continue;
    }

    for (const specifier of specifiers) {
      if (rule.forbidden.test(specifier)) {
        violations.push({ file: rel, specifier, message: rule.message });
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('[check:boundaries] violations found\n');
  for (const violation of violations) {
    process.stderr.write(`- ${violation.file}: ${violation.specifier} (${violation.message})\n`);
  }
  process.exit(1);
}

console.log('[check:boundaries] OK');
