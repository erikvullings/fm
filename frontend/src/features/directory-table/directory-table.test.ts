import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGeneratedDirectory } from '../../api/client/mock-directory-generator';
import type { EntrySummary } from '../../models';
import { DirectoryTable, type DirectoryTableAttrs, entryArraySource } from './directory-table';

let root: HTMLElement;

function entry(overrides: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 'entry-1',
    location: { providerId: 'file', uri: 'mock:///report.txt' },
    name: 'report.txt',
    kind: 'file',
    size: 1_024,
    modifiedAt: '2026-07-30T12:00:00.000Z',
    hidden: false,
    readOnly: false,
    extension: 'txt',
    metadataRevision: 1,
    ...overrides,
  };
}

function mount(attrs: DirectoryTableAttrs): void {
  m.mount(root, { view: () => m(DirectoryTable, attrs) });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

describe('DirectoryTable states', () => {
  it('renders bounded loading placeholders with an accessible status', () => {
    mount({ state: { type: 'loading' }, viewportHeight: 120 });

    expect(root.querySelector('[role="status"]')?.textContent).toContain('Loading directory');
    expect(root.querySelectorAll('.fm-directory-placeholder')).toHaveLength(4);
  });

  it('renders an empty directory message', () => {
    mount({ state: { type: 'loaded' }, source: entryArraySource([]), viewportHeight: 120 });

    expect(root.querySelector('[role="status"]')?.textContent).toBe('This directory is empty.');
  });

  it('renders an error without requiring a source', () => {
    mount({ state: { type: 'error', message: 'Permission denied' }, viewportHeight: 120 });

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Permission denied');
  });
});

describe('DirectoryTable rows', () => {
  it('renders semantic columns and textual hidden and link indicators', () => {
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([
        entry({ hidden: true }),
        entry({
          id: 'entry-2',
          name: 'current',
          kind: 'symlink',
        }),
      ]),
      viewportHeight: 120,
    });

    const grid = root.querySelector('[role="grid"]');
    expect(grid?.getAttribute('aria-colcount')).toBe('4');
    expect(root.querySelectorAll('[role="columnheader"]')).toHaveLength(4);
    expect(root.querySelectorAll('[role="row"]')).toHaveLength(3);
    expect(root.textContent).toContain('Hidden');
    expect(root.textContent).toContain('↗ Link');
    expect(root.querySelector('.fm-hidden-entry')).not.toBeNull();
  });

  it.each([1_000, 10_000, 100_000])(
    'keeps the mounted row count bounded for %i materialized entries',
    (entryCount) => {
      const entries = Array.from({ length: entryCount }, (_, index) =>
        entry({
          id: `real-${index}`,
          name: `real-${index}.txt`,
          location: { providerId: 'file', uri: `mock:///real-${index}.txt` },
        }),
      );
      mount({
        state: { type: 'loaded' },
        source: entryArraySource(entries),
        viewportHeight: 120,
      });

      expect(root.querySelectorAll('.fm-directory-row').length).toBeLessThanOrEqual(10);
    },
  );

  it('keeps the mounted row count bounded while scrolling a lazy million-entry source', () => {
    const generated = createGeneratedDirectory(1_000_000, 24);
    mount({
      state: { type: 'loaded' },
      source: {
        length: generated.totalEntries,
        entryAt: (index) => generated.page(index, 1)[0],
      },
      viewportHeight: 120,
    });
    const grid = root.querySelector<HTMLElement>('[role="grid"]');
    if (grid === null) {
      throw new Error('directory grid was not rendered');
    }

    grid.scrollTop = 15_000_000;
    grid.dispatchEvent(new Event('scroll'));
    m.redraw.sync();

    expect(root.querySelectorAll('.fm-directory-row').length).toBeLessThanOrEqual(10);
    expect(root.textContent).toContain('generated-050000');
  });

  it('keeps a row DOM node when its stable entry id is patched', () => {
    let source = entryArraySource([entry()]);
    m.mount(root, { view: () => m(DirectoryTable, { state: { type: 'loaded' }, source }) });
    const originalRow = root.querySelector('.fm-directory-row');

    source = entryArraySource([entry({ name: 'renamed.txt' })]);
    m.redraw.sync();

    expect(root.querySelector('.fm-directory-row')).toBe(originalRow);
    expect(originalRow?.textContent).toContain('renamed.txt');
  });

  it('announces and scrolls a cursor supplied by the navigation layer', () => {
    const entries = Array.from({ length: 100 }, (_, index) =>
      entry({ id: `entry-${index}`, name: `entry-${index}.txt` }),
    );
    let cursorIndex = 0;
    m.mount(root, {
      view: () =>
        m(DirectoryTable, {
          state: { type: 'loaded' },
          source: entryArraySource(entries),
          cursorIndex,
          viewportHeight: 120,
        }),
    });

    cursorIndex = 50;
    m.redraw.sync();

    const grid = root.querySelector<HTMLElement>('[role="grid"]');
    expect(grid?.getAttribute('aria-activedescendant')).toMatch(/^fm-directory-row-/);
    expect(root.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Focused entry-50.txt',
    );
    expect(grid?.scrollTop).toBeGreaterThan(0);
  });
});
