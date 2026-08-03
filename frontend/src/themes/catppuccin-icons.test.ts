import { describe, expect, it } from 'vitest';
import {
  createDefaultEntryIconRegistry,
  type EntryIconRegistry,
} from '../features/directory-table/entry-icons';
import { installCatppuccinIconTheme, restoreDefaultIconTheme } from './catppuccin-icons';

describe('catppuccin icon theme', () => {
  function freshRegistry(): EntryIconRegistry {
    return createDefaultEntryIconRegistry();
  }

  it('overwrites kind, extension and mime-prefix icons with Catppuccin renderers', () => {
    const registry = freshRegistry();
    const defaultFolderIcon = registry.kindIcons.get('directory');
    const defaultTsIcon = registry.extensionIcons.get('ts');
    const defaultImageIcon = registry.mimePrefixIcons.get('image/');

    installCatppuccinIconTheme(registry);

    expect(registry.kindIcons.get('directory')).not.toBe(defaultFolderIcon);
    expect(registry.kindIcons.get('symlink')).toBeDefined();
    expect(registry.kindIcons.get('file')).toBeDefined();
    expect(registry.extensionIcons.get('ts')).not.toBe(defaultTsIcon);
    expect(registry.extensionIcons.get('tsx')).toBeDefined();
    expect(registry.extensionIcons.get('py')).toBeDefined();
    expect(registry.extensionIcons.get('rs')).toBeDefined();
    expect(registry.mimePrefixIcons.get('image/')).not.toBe(defaultImageIcon);
    expect(registry.mimePrefixIcons.get('application/pdf')).toBeDefined();
  });

  it('defaults to mutating the shared entryIconRegistry singleton', async () => {
    const { entryIconRegistry } = await import('../features/directory-table/entry-icons');
    const defaultFolderIcon = entryIconRegistry.kindIcons.get('directory');

    installCatppuccinIconTheme();
    expect(entryIconRegistry.kindIcons.get('directory')).not.toBe(defaultFolderIcon);

    restoreDefaultIconTheme();
    expect(entryIconRegistry.kindIcons.get('directory')).toBe(defaultFolderIcon);
  });

  it('restores the built-in default icon set', () => {
    const registry = freshRegistry();
    const defaults = createDefaultEntryIconRegistry();

    installCatppuccinIconTheme(registry);
    restoreDefaultIconTheme(registry);

    expect(registry.kindIcons.get('directory')).toBe(defaults.kindIcons.get('directory'));
    expect(registry.kindIcons.get('symlink')).toBe(defaults.kindIcons.get('symlink'));
    expect(registry.kindIcons.get('file')).toBe(defaults.kindIcons.get('file'));
    expect(registry.extensionIcons.size).toBe(defaults.extensionIcons.size);
    expect(registry.mimePrefixIcons.size).toBe(defaults.mimePrefixIcons.size);
    // Catppuccin-only extensions must not linger after restoring defaults.
    expect(registry.extensionIcons.has('ts')).toBe(false);
  });

  it('renders an icon as an svg vnode with the expected viewBox and class', () => {
    const registry = freshRegistry();
    installCatppuccinIconTheme(registry);
    const folderRenderer = registry.kindIcons.get('directory');
    expect(folderRenderer).toBeDefined();

    const vnode = folderRenderer?.({ size: 20, className: 'extra' });
    expect(vnode).toMatchObject({
      tag: 'svg',
      attrs: expect.objectContaining({
        viewBox: '0 0 16 16',
        width: 20,
        height: 20,
      }),
    });
  });
});
