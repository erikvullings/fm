// Verifies the root dev scripts fail loudly (never silently no-op) while
// their underlying features are not implemented yet, per TASKS/0003.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function runScript(scriptName) {
  try {
    execFileSync('bash', [join('scripts', scriptName)], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stderr: '' };
  } catch (error) {
    return { exitCode: error.status, stderr: error.stderr };
  }
}

test('scripts/export-openapi.sh, generate-api.sh and not-implemented.sh are executable', () => {
  for (const name of ['export-openapi.sh', 'generate-api.sh', 'not-implemented.sh']) {
    const mode = statSync(join(repoRoot, 'scripts', name)).mode;
    assert.ok(mode & 0o111, `${name} should be executable`);
  }
});

test('scripts/export-openapi.sh fails clearly until task 0009 lands', () => {
  const { exitCode, stderr } = runScript('export-openapi.sh');
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /not implemented until task 0009/);
});

test('scripts/generate-api.sh fails clearly until task 0010 lands', () => {
  const { exitCode, stderr } = runScript('generate-api.sh');
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /not implemented until task 0010/);
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
