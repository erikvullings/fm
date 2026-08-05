import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(join(process.cwd(), 'src/themes/theme.css'), 'utf8');
const materializedCss = readFileSync(
  join(process.cwd(), 'src/themes/mithril-materialized-procyon.css'),
  'utf8',
);
const directoryTableCss = readFileSync(
  join(process.cwd(), 'src/features/directory-table/directory-table.css'),
  'utf8',
);
const paneCss = readFileSync(join(process.cwd(), 'src/features/panes/pane.css'), 'utf8');
const fileViewerCss = readFileSync(
  join(process.cwd(), 'src/features/preview/file-viewer.css'),
  'utf8',
);

const REQUIRED_TOKENS = [
  '--fm-background',
  '--fm-surface',
  '--fm-surface-elevated',
  '--fm-text',
  '--fm-text-muted',
  '--fm-border',
  '--fm-accent',
  '--fm-selection',
  '--fm-selection-inactive',
  '--fm-hover',
  '--fm-error',
  '--fm-warning',
  '--fm-success',
  '--fm-row-height',
  '--fm-font-family',
  '--fm-font-size',
  '--fm-radius',
  '--fm-shadow',
] as const;

function themeBlock(selector: RegExp): string {
  const block = themeCss.match(selector)?.[1];
  if (block === undefined) {
    throw new Error(`theme block ${selector.source} was not found`);
  }
  return block;
}

function tokenValue(block: string, token: string): string {
  const value = block.match(new RegExp(`${token}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
  if (value === undefined) {
    throw new Error(`${token} is not a six-digit hex colour`);
  }
  return value;
}

function relativeLuminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) {
    throw new Error(`invalid colour ${hex}`);
  }
  const linearChannel = (offset: number): number => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearChannel(1) + 0.7152 * linearChannel(3) + 0.0722 * linearChannel(5);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('theme stylesheet', () => {
  it('defines every file-manager design token', () => {
    for (const token of REQUIRED_TOKENS) {
      expect(themeCss).toContain(`${token}:`);
    }
  });

  it('provides explicit light and dark themes plus a system-dark fallback', () => {
    expect(themeCss).toMatch(/:root,\s*\[data-theme=["']light["']\]/);
    expect(themeCss).toMatch(/\[data-theme=["']dark["']\]/);
    expect(themeCss).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-theme\]\)/,
    );
  });

  it('maps mithril-materialized theme variables to file-manager tokens', () => {
    const mappings = [
      '--mm-primary-color: var(--fm-accent)',
      '--mm-background-color: var(--fm-background)',
      '--mm-surface-color: var(--fm-surface)',
      '--mm-modal-background: var(--fm-surface-elevated)',
      '--mm-text-primary: var(--fm-text)',
      '--mm-text-secondary: var(--fm-text-muted)',
      '--mm-border-color: var(--fm-border)',
      '--mm-error-color: var(--fm-error)',
    ] as const;

    for (const mapping of mappings) {
      expect(themeCss).toContain(mapping);
    }
  });

  it('densifies the mithril-materialized controls used by the application', () => {
    for (const selector of [
      '.modal',
      '.btn',
      '.btn-flat',
      '.input-field',
      '.switch',
      '.select-wrapper',
    ]) {
      expect(materializedCss).toContain(selector);
    }
    expect(materializedCss).toContain('var(--fm-row-height)');
  });

  it('removes transitions and animations when reduced motion is requested', () => {
    expect(themeCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration:\s*0\.01ms/,
    );
    expect(themeCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.01ms/,
    );
  });

  it('meets WCAG AA for text on surfaces and both selection states', () => {
    const themes = [
      themeBlock(/:root,\s*\[data-theme=["']light["']\]\s*\{([^}]*)\}/),
      themeBlock(/\[data-theme=["']dark["']\]\s*\{([^}]*)\}/),
    ];

    for (const theme of themes) {
      const text = tokenValue(theme, '--fm-text');
      for (const backgroundToken of ['--fm-surface', '--fm-selection', '--fm-selection-inactive']) {
        expect(contrastRatio(text, tokenValue(theme, backgroundToken))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('only paints selection in the active pane and keeps cursor styling distinct', () => {
    expect(themeCss).not.toMatch(/(?:^|\n)\.fm-selected-row\s*\{/);
    expect(themeCss).not.toMatch(/(?:^|\n)\.fm-cursor-row\s*\{/);
    expect(themeCss).toMatch(
      /\.fm-pane\[data-active="true"\]\s+\.fm-selected-row\s*\{[^}]*box-shadow:\s*inset/s,
    );
    expect(themeCss).toMatch(
      /\.fm-pane\[data-active="true"\]\s+\.fm-cursor-row\s*\{[^}]*background-color:/s,
    );
  });

  it('does not highlight directory rows on mouse hover', () => {
    expect(directoryTableCss).not.toMatch(/\.fm-directory-row:hover/);
  });

  it('keeps the arrow cursor over directory rows', () => {
    expect(directoryTableCss).toMatch(/\.fm-directory-row\s*[,{][^}]*cursor:\s*default/s);
  });

  it('keeps directory and viewer content inside its pane grid track', () => {
    expect(paneCss).toMatch(/\.fm-pane\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(fileViewerCss).toMatch(/\.fm-file-viewer\s*\{[^}]*min-width:\s*0/s);
  });
});
