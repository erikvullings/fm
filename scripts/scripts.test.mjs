// Verifies the root dev scripts fail loudly (never silently no-op) while
// their underlying features are not implemented yet, per TASKS/0003.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function runScript(scriptName, args = []) {
  try {
    const stdout = execFileSync('bash', [join('scripts', scriptName), ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      exitCode: error.status,
      stdout: error.stdout ?? '',
      stderr: error.stderr,
    };
  }
}

/** Maps every file under `dir` to its contents, for before/after diffing. */
function snapshotDir(dir) {
  const entries = readdirSync(dir, {
    recursive: true,
    encoding: 'utf8',
  }).filter((entry) => statSync(join(dir, entry)).isFile());
  return Object.fromEntries(entries.sort().map((entry) => [entry, readFileSync(join(dir, entry))]));
}

test('scripts/export-openapi.sh, generate-api.sh and not-implemented.sh are executable', () => {
  for (const name of ['export-openapi.sh', 'generate-api.sh', 'not-implemented.sh']) {
    const mode = statSync(join(repoRoot, 'scripts', name)).mode;
    assert.ok(mode & 0o111, `${name} should be executable`);
  }
});

test('scripts/export-openapi.sh writes a deterministic OpenAPI document (task 0009)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fm-export-openapi-'));
  const outputPath = join(dir, 'openapi.json');

  try {
    const first = runScript('export-openapi.sh', [outputPath]);
    assert.equal(first.exitCode, 0, first.stderr);
    const firstBytes = readFileSync(outputPath);

    const second = runScript('export-openapi.sh', [outputPath]);
    assert.equal(second.exitCode, 0, second.stderr);
    const secondBytes = readFileSync(outputPath);

    assert.deepEqual(firstBytes, secondBytes, 're-running the export must produce no diff');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('scripts/generate-api.sh regenerates a byte-identical client (task 0010)', () => {
  const generatedDir = join(repoRoot, 'frontend', 'src', 'api', 'generated');
  const before = snapshotDir(generatedDir);

  const result = runScript('generate-api.sh');
  assert.equal(result.exitCode, 0, result.stderr);

  const after = snapshotDir(generatedDir);
  assert.deepEqual(after, before, 're-running the generator must produce no diff');
});

test('scripts/not-implemented.sh reports the script name and task number', () => {
  let stderr = '';
  let exitCode = 0;
  try {
    execFileSync('bash', ['scripts/not-implemented.sh', 'dev:tauri', '0015'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  } catch (error) {
    exitCode = error.status;
    stderr = error.stderr;
  }
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /dev:tauri/);
  assert.match(stderr, /0015/);
});

test('Tauri lifecycle commands select its transport and resolve the frontend from their working directory', () => {
  const config = JSON.parse(
    readFileSync(join(repoRoot, 'apps', 'fm-desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );

  assert.equal(config.build.devUrl, 'http://127.0.0.1:5181');
  assert.match(config.build.beforeDevCommand, /VITE_RUNTIME=tauri/);
  assert.match(config.build.beforeDevCommand, /--dir \.\.\/\.\.\/frontend exec vite --port 5181$/);
  assert.match(config.build.beforeBuildCommand, /VITE_RUNTIME=tauri/);
  assert.match(config.build.beforeBuildCommand, /--dir \.\.\/\.\.\/frontend build$/);
});
