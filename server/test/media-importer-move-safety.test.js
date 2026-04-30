import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const importerScript = path.join(repoRoot, 'scripts', 'media-importer.sh');
const tempRoots = [];

const writeFile = (target, content) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

const readText = (target) => fs.readFileSync(target, 'utf8');

const createHarness = (extraEnv = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-importer-test-'));
  tempRoots.push(root);

  const vaultRoot = path.join(root, 'vault', 'VAULT', 'Media');
  const scratchRoot = path.join(root, 'scratch', 'SCRATCH', 'HmSTxScratch');
  const runtimeDir = path.join(root, 'runtime');
  const logsDir = path.join(scratchRoot, 'logs');
  const downloadsDir = path.join(scratchRoot, 'downloads');
  const moviesDir = path.join(vaultRoot, 'movies');

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.mkdirSync(moviesDir, { recursive: true });

  const baseEnv = {
    ...process.env,
    PROJECT: repoRoot,
    SERVER_ENV_FILE: path.join(root, 'server.env.missing'),
    RUNTIME_DIR: runtimeDir,
    MEDIA_VAULT_ROOT: vaultRoot,
    MEDIA_SCRATCH_ROOT: scratchRoot,
    MEDIA_SMALL_DOWNLOADS_DIR: path.join(scratchRoot, 'small'),
    MEDIA_IMPORT_REVIEW_DIR: path.join(scratchRoot, 'review'),
    MEDIA_IMPORT_LOG_DIR: logsDir,
    MEDIA_IMPORT_STATUS_FILE: path.join(logsDir, 'import-status.json'),
    MEDIA_CLEANUP_STATUS_FILE: path.join(logsDir, 'cleanup-status.json'),
    MEDIA_IMPORTED_INDEX_FILE: path.join(logsDir, 'imported-items.tsv'),
    MEDIA_IMPORT_EVENTS_FILE: path.join(logsDir, 'import-events.tsv'),
    MEDIA_IMPORT_REQUIRE_EXTERNAL_VAULT: 'false',
    MEDIA_IMPORT_ABORT_FREE_GB: '0',
    MEDIA_SCRATCH_MIN_FREE_GB: '0',
    MEDIA_SCRATCH_CLEANUP_ENABLED: 'false',
    ...extraEnv,
  };

  const runImport = (sourcePath, runEnv = {}) =>
    spawnSync(
      'bash',
      [importerScript, 'import', '--trigger', 'vitest', '--skip-cleanup', '--source', sourcePath],
      {
        env: { ...baseEnv, ...runEnv },
        cwd: repoRoot,
        encoding: 'utf8',
      }
    );

  const runImportScan = (runEnv = {}) =>
    spawnSync(
      'bash',
      [importerScript, 'import', '--trigger', 'vitest', '--skip-cleanup'],
      {
        env: { ...baseEnv, ...runEnv },
        cwd: repoRoot,
        encoding: 'utf8',
      }
    );

  return {
    root,
    vaultRoot,
    scratchRoot,
    runtimeDir,
    logsDir,
    downloadsDir,
    moviesDir,
    eventsFile: path.join(logsDir, 'import-events.tsv'),
    runImport,
    runImportScan,
  };
};

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('media importer move safety', () => {
  it('moves content with verification and removes source (forced copy-move path)', () => {
    const harness = createHarness({ MEDIA_IMPORT_FORCE_COPY_MOVE: 'true' });
    const source = path.join(harness.downloadsDir, 'movies', 'release-a.mkv');
    const dest = path.join(harness.moviesDir, 'release-a.mkv');
    writeFile(source, 'payload-a');

    const run = harness.runImport(source);
    expect(run.status).toBe(0);
    expect(fs.existsSync(source)).toBe(false);
    expect(readText(dest)).toBe('payload-a');
    expect(readText(harness.eventsFile)).toContain('\tmoved\t');
  }, 20000);

  it('does not overwrite existing destination and keeps source', () => {
    const harness = createHarness();
    const source = path.join(harness.downloadsDir, 'movies', 'dupe.mkv');
    const dest = path.join(harness.moviesDir, 'dupe.mkv');
    writeFile(source, 'new-content');
    writeFile(dest, 'existing-content');

    const run = harness.runImport(source);
    expect(run.status).toBe(0);
    expect(fs.existsSync(source)).toBe(true);
    expect(readText(dest)).toBe('existing-content');
    expect(readText(harness.eventsFile)).toContain('\tskipped-existing\t');
  }, 20000);

  it('rolls back atomic rename on interruption after rename', () => {
    const harness = createHarness({
      MEDIA_IMPORT_FAULT_INJECT: 'after-rename',
    });
    const source = path.join(harness.downloadsDir, 'movies', 'interrupt-rename.mkv');
    const dest = path.join(harness.moviesDir, 'interrupt-rename.mkv');
    writeFile(source, 'interrupt-rename');

    const run = harness.runImport(source);
    expect(run.status).toBe(0);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(dest)).toBe(false);
    expect(readText(harness.eventsFile)).toContain('injected fault after rename');
  }, 20000);

  it('rolls back staged move when interrupted after stage copy', () => {
    const harness = createHarness({
      MEDIA_IMPORT_FORCE_COPY_MOVE: 'true',
      MEDIA_IMPORT_FAULT_INJECT: 'after-stage-copy',
    });
    const source = path.join(harness.downloadsDir, 'movies', 'interrupt-stage.mkv');
    const dest = path.join(harness.moviesDir, 'interrupt-stage.mkv');
    writeFile(source, 'interrupt-stage');

    const run = harness.runImport(source);
    expect(run.status).toBe(0);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(dest)).toBe(false);
    expect(readText(harness.eventsFile)).toContain('injected fault after stage copy');
  }, 20000);

  it('rolls back promoted destination on partial failure', () => {
    const harness = createHarness({
      MEDIA_IMPORT_FORCE_COPY_MOVE: 'true',
      MEDIA_IMPORT_FAULT_INJECT: 'after-promote',
    });
    const source = path.join(harness.downloadsDir, 'movies', 'partial-promote.mkv');
    const dest = path.join(harness.moviesDir, 'partial-promote.mkv');
    writeFile(source, 'partial-promote');

    const run = harness.runImport(source);
    expect(run.status).toBe(0);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(dest)).toBe(false);
    expect(readText(harness.eventsFile)).toContain('injected fault after promote');
  }, 20000);

  it('continues importing remaining items after a destination collision', () => {
    const harness = createHarness();
    const seriesDownloads = path.join(harness.downloadsDir, 'series');
    const seriesVault = path.join(harness.vaultRoot, 'series');
    const ep1 = path.join(seriesDownloads, 'Show.S01E01.mkv');
    const ep2 = path.join(seriesDownloads, 'Show.S01E02.mkv');
    const ep3 = path.join(seriesDownloads, 'Show.S01E03.mkv');
    const ep2Dest = path.join(seriesVault, 'Show.S01E02.mkv');
    const ep1Dest = path.join(seriesVault, 'Show.S01E01.mkv');
    const ep3Dest = path.join(seriesVault, 'Show.S01E03.mkv');

    writeFile(ep1, 'episode-1');
    writeFile(ep2, 'episode-2-new');
    writeFile(ep3, 'episode-3');
    writeFile(ep2Dest, 'episode-2-existing');

    const run = harness.runImportScan();
    expect(run.status).toBe(0);
    expect(readText(ep1Dest)).toBe('episode-1');
    expect(readText(ep2Dest)).toBe('episode-2-existing');
    expect(readText(ep3Dest)).toBe('episode-3');
    expect(fs.existsSync(ep1)).toBe(false);
    expect(fs.existsSync(ep2)).toBe(true);
    expect(fs.existsSync(ep3)).toBe(false);
  }, 60000);
});
