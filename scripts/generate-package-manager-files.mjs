import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [, , format, ...rawArgs] = process.argv;

/** @param {string[]} args */
function parseOptions(args) {
  /** @type {Record<string, string>} */
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value pairs, received: ${args.join(' ')}`);
    }
    options[flag.slice(2)] = value;
  }
  return options;
}

const options = parseOptions(rawArgs);
for (const name of ['version', 'sha256', 'repository', 'asset', 'output']) {
  if (!options[name]) throw new Error(`Missing required option --${name}`);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) {
  throw new Error(`Invalid release version: ${options.version}`);
}
if (!/^[0-9a-f]{64}$/i.test(options.sha256)) {
  throw new Error('SHA-256 must contain exactly 64 hexadecimal characters');
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
  throw new Error(`Invalid GitHub repository: ${options.repository}`);
}
if (!/^[A-Za-z0-9_.+-]+$/.test(options.asset)) {
  throw new Error(`Invalid release asset name: ${options.asset}`);
}

const assetUrl = `https://github.com/${options.repository}/releases/download/v${options.version}/${options.asset}`;

function generateHomebrew() {
  const cask = `cask "procyon" do
  version "${options.version}"
  sha256 "${options.sha256.toLowerCase()}"

  url "${assetUrl}"
  name "Procyon"
  desc "Dual-pane file manager"
  homepage "https://github.com/${options.repository}"

  app "Procyon.app"
end
`;
  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(options.output, cask, 'utf8');
}

function generateChocolatey() {
  const nuspec = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">
  <metadata>
    <id>procyon</id>
    <version>${options.version}</version>
    <title>Procyon</title>
    <authors>Erik Vullings</authors>
    <projectUrl>https://github.com/${options.repository}</projectUrl>
    <licenseUrl>https://github.com/${options.repository}/blob/main/LICENSE</licenseUrl>
    <requireLicenseAcceptance>false</requireLicenseAcceptance>
    <description>Dual-pane file manager with native Windows and macOS desktop hosts.</description>
    <tags>procyon file-manager desktop tauri</tags>
  </metadata>
</package>
`;
  const install = `$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = 'procyon'
  fileType       = 'exe'
  url64bit       = '${assetUrl}'
  checksum64     = '${options.sha256.toLowerCase()}'
  checksumType64 = 'sha256'
  silentArgs     = '/S'
  validExitCodes = @(0)
  softwareName   = 'Procyon*'
}

Install-ChocolateyPackage @packageArgs
`;
  const toolsDir = join(options.output, 'tools');
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(options.output, 'procyon.nuspec'), nuspec, 'utf8');
  writeFileSync(join(toolsDir, 'chocolateyinstall.ps1'), install, 'utf8');
}

if (format === 'homebrew') generateHomebrew();
else if (format === 'chocolatey') generateChocolatey();
else throw new Error(`Expected package format "homebrew" or "chocolatey", received: ${format}`);
