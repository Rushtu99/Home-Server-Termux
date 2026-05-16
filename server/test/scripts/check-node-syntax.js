const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const serverRoot = path.resolve(__dirname, '../..');
const srcRoot = path.join(serverRoot, 'src');

const listJsFiles = (rootDir) => {
  const files = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!fs.existsSync(current)) {
      continue;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      if (entry.isFile() && target.endsWith('.js')) {
        files.push(target);
      }
    }
  }
  return files.sort();
};

const targets = [
  ...listJsFiles(srcRoot),
  path.join(serverRoot, 'index.js'),
  path.join(serverRoot, 'app-db.js'),
];

let hasFailure = false;
for (const file of targets) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    hasFailure = true;
    process.stderr.write(`\n[check:syntax] ${path.relative(serverRoot, file)} failed\n`);
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log(`[check:syntax] OK (${targets.length} files)`);
