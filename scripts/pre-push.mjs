#!/usr/bin/env node
// Pre-push safety net: runs the same checks CI runs (see .github/workflows/ci.yml),
// so a broken push fails fast locally instead of burning a CI cycle. Deliberately
// not run on every commit - pre-commit.mjs stays fast (format + clippy only) so
// local commit iteration isn't blocked by the full test suite; this hook fires
// once per push instead, which is a much lower-frequency event.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

function run(command, args) {
  console.log(`pre-push: running \`${command} ${args.join(' ')}\``);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  if (result.error !== undefined) {
    console.error(`pre-push: failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('pnpm', ['run', 'lint']);
run('pnpm', ['run', 'test']);
