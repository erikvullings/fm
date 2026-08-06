import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function read(...segments) {
  return readFileSync(join(repoRoot, ...segments), 'utf8');
}

function workflow(name) {
  return load(read('.github', 'workflows', name));
}

function workflowText(name) {
  return read('.github', 'workflows', name);
}

test('desktop Cargo metadata is the single source for product identity and bundle icons', () => {
  const cargo = read('apps', 'fm-desktop', 'src-tauri', 'Cargo.toml');
  const config = JSON.parse(read('apps', 'fm-desktop', 'src-tauri', 'tauri.conf.json'));

  assert.match(cargo, /version\.workspace = true/);
  assert.match(cargo, /\[package\.metadata\.desktop\]/);
  assert.match(cargo, /product-name = "Procyon"/);
  assert.match(cargo, /identifier = "dev\.fm\.desktop"/);
  assert.match(cargo, /icons = \[/);
  for (const duplicatedField of ['productName', 'version']) {
    assert.equal(
      config[duplicatedField],
      undefined,
      `${duplicatedField} must come from Cargo metadata`,
    );
  }
  assert.equal(
    config.identifier,
    'dev.fm.desktop',
    'Tauri requires a bootstrap identifier even when a generated overlay owns the final value',
  );
  assert.equal(config.bundle.icon, undefined, 'bundle icons must come from Cargo metadata');

  const derived = JSON.parse(
    execFileSync('node', ['scripts/build-tauri.mjs', '--print-config'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }),
  );
  assert.equal(derived.productName, 'Procyon');
  assert.equal(derived.version, '0.1.0');
  assert.equal(derived.identifier, config.identifier);
  assert.equal(derived.bundle.icon.length, 5);
});

test('the root Tauri build command uses the metadata-derived build wrapper', () => {
  const rootPackage = JSON.parse(read('package.json'));
  assert.equal(rootPackage.scripts['build:tauri'], 'node scripts/build-tauri.mjs');
});

test('Tauri targets installable macOS, Windows, and Linux bundle formats', () => {
  const config = JSON.parse(read('apps', 'fm-desktop', 'src-tauri', 'tauri.conf.json'));
  assert.deepEqual(config.bundle.targets, ['app', 'dmg', 'msi', 'nsis', 'deb', 'appimage']);
});

test('pull-request CI builds desktop bundles without any signing credentials', () => {
  const ciText = workflowText('ci.yml');
  const ci = workflow('ci.yml');
  assert.deepEqual([...ci.jobs.desktop.strategy.matrix.os].sort(), [
    'macos-latest',
    'windows-latest',
  ]);
  assert.match(JSON.stringify(ci.jobs.desktop), /build:tauri/);
  assert.doesNotMatch(ciText, /APPLE_|WINDOWS_|CERTIFICATE|SIGNING|notariz/i);
});

test('tag-only protected release workflow publishes unsigned desktop packages', () => {
  const releaseText = workflowText('release-desktop.yml');
  const release = workflow('release-desktop.yml');
  assert.deepEqual(release.on.push.tags, ['v*']);
  assert.equal(release.on.pull_request, undefined);

  for (const jobName of ['macos', 'windows', 'linux']) {
    assert.equal(release.jobs[jobName].environment, 'desktop-release');
  }

  assert.doesNotMatch(
    releaseText,
    /APPLE_|WINDOWS_CERTIFICATE|Developer ID|codesign|notariz|stapler|signtool/i,
  );
});

test('release workflow publishes unsigned macOS, Windows, and Linux packages', () => {
  const releaseText = workflowText('release-desktop.yml');
  const release = workflow('release-desktop.yml');

  assert.match(releaseText, /build:tauri --target universal-apple-darwin/);
  assert.equal(release.jobs.linux['runs-on'], 'ubuntu-22.04');
  assert.match(releaseText, /libwebkit2gtk-4\.1-dev/);
  assert.match(releaseText, /bundle\/deb\/\*\.deb/);
  assert.match(releaseText, /bundle\/appimage\/\*\.AppImage/);
  assert.deepEqual(release.jobs.homebrew.needs, ['macos']);
  assert.equal(release.jobs.homebrew.environment, 'desktop-release');
  assert.equal(release.jobs.chocolatey.needs, 'windows');
  assert.equal(release.jobs.chocolatey.environment, 'desktop-release');
  assert.match(releaseText, /vars\.HOMEBREW_TAP_REPOSITORY/);
  assert.match(releaseText, /secrets\.HOMEBREW_TAP_TOKEN/);
  assert.match(releaseText, /secrets\.CHOCOLATEY_API_KEY/);
  assert.match(releaseText, /choco pack/);
  assert.match(releaseText, /choco push/);
});

test('package-manager generator creates a Homebrew cask and Chocolatey installer package', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'procyon-packages-'));
  const checksum = 'a'.repeat(64);
  const commonArgs = ['--version', '1.2.3', '--sha256', checksum, '--repository', 'example/fm'];

  const caskPath = join(outputRoot, 'Casks', 'procyon.rb');
  execFileSync(
    'node',
    [
      'scripts/generate-package-manager-files.mjs',
      'homebrew',
      ...commonArgs,
      '--asset',
      'Procyon_1.2.3_universal.dmg',
      '--output',
      caskPath,
    ],
    { cwd: repoRoot },
  );
  const cask = readFileSync(caskPath, 'utf8');
  assert.match(cask, /cask "procyon" do/);
  assert.match(cask, /version "1\.2\.3"/);
  assert.match(cask, new RegExp(`sha256 "${checksum}"`));
  assert.match(cask, /releases\/download\/v1\.2\.3\/Procyon_1\.2\.3_universal\.dmg/);
  assert.match(cask, /app "Procyon\.app"/);

  const chocolateyDir = join(outputRoot, 'chocolatey');
  execFileSync(
    'node',
    [
      'scripts/generate-package-manager-files.mjs',
      'chocolatey',
      ...commonArgs,
      '--asset',
      'Procyon_1.2.3_x64-setup.exe',
      '--output',
      chocolateyDir,
    ],
    { cwd: repoRoot },
  );
  const nuspec = readFileSync(join(chocolateyDir, 'procyon.nuspec'), 'utf8');
  const install = readFileSync(join(chocolateyDir, 'tools', 'chocolateyinstall.ps1'), 'utf8');
  assert.match(nuspec, /<id>procyon<\/id>/);
  assert.match(nuspec, /<version>1\.2\.3<\/version>/);
  assert.match(install, /Install-ChocolateyPackage @packageArgs/);
  assert.match(install, /silentArgs\s*= '\/S'/);
  assert.match(install, new RegExp(`checksum64\\s+= '${checksum}'`));
});

test('desktop CI runs platform packaging smoke tests after building', () => {
  const desktop = workflow('ci.yml').jobs.desktop;
  const commands = (desktop.steps ?? [])
    .map((step) => step.run)
    .filter((command) => typeof command === 'string');
  assert.ok(commands.some((command) => /smoke-desktop-package\.mjs/.test(command)));
});

test('README documents release versioning, package managers, smoke checks, and no auto-update', () => {
  const readme = read('README.md');
  assert.match(readme, /## Desktop releases/);
  assert.match(readme, /Cargo\.toml/);
  assert.match(readme, /v<version>/);
  assert.match(readme, /release notes/i);
  assert.match(readme, /unsigned macOS/i);
  assert.match(readme, /Gatekeeper/i);
  assert.match(readme, /SmartScreen/i);
  assert.doesNotMatch(
    readme,
    /APPLE_CERTIFICATE|APPLE_ID|APPLE_PASSWORD|APPLE_TEAM_ID|WINDOWS_CERTIFICATE/,
  );
  assert.match(readme, /manual smoke/i);
  assert.match(readme, /brew install --cask/);
  assert.match(readme, /choco install procyon/);
  assert.match(readme, /HOMEBREW_TAP_TOKEN/);
  assert.match(readme, /CHOCOLATEY_API_KEY/);
  assert.match(readme, /auto-update is not included/i);
  assert.match(readme, /\.deb/);
  assert.match(readme, /AppImage/);
});
