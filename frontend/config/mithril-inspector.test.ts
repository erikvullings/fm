/* @vitest-environment node */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, resolveConfig } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

// `URL.pathname` would yield `/C:/dev/...` on Windows, which is not a usable path.
const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const viteConfigFile = join(frontendRoot, 'vite.config.ts');
const temporaryDirectories: string[] = [];

async function readFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      contents.push(...(await readFilesRecursively(path)));
    } else {
      contents.push(await readFile(path, 'utf8'));
    }
  }

  return contents;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  );
});

describe('Mithril Inspector Vite integration', () => {
  it('registers the inspector plugins for the development server', async () => {
    const config = await resolveConfig({ configFile: viteConfigFile }, 'serve');

    expect(config.plugins.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['mithril-inspector:pre', 'mithril-inspector:serve']),
    );
  });

  it('leaves no inspector reference in a production build', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'fm-inspector-build-'));
    temporaryDirectories.push(outputRoot);
    const outDir = join(outputRoot, 'dist');

    await build({
      configFile: viteConfigFile,
      build: {
        outDir,
      },
    });

    const productionOutput = (await readFilesRecursively(outDir)).join('\n');
    expect(productionOutput).not.toMatch(/mithril-inspector|__MITHRIL_INSPECTOR__|data-mi=/i);
  });
});
