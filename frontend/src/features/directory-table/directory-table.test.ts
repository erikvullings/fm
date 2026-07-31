import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('keeps existing rows visible while the next directory loads', () => {
    mount({
      state: { type: 'loading' },
      source: entryArraySource([entry()]),
      viewportHeight: 120,
    });

    expect(root.querySelector('.fm-directory-row')?.textContent).toContain('report.txt');
    expect(root.querySelectorAll('.fm-directory-placeholder')).toHaveLength(0);
    expect(root.querySelector('[role="grid"]')?.getAttribute('aria-busy')).toBe('true');
  });

  it('renders an empty directory message', () => {
    mount({ state: { type: 'loaded' }, source: entryArraySource([]), viewportHeight: 120 });

    expect(root.querySelector('[role="status"]')?.textContent).toBe('This directory is empty.');
  });

  it('renders an error without requiring a source', () => {
    const onRetry = vi.fn();
    mount({
      state: { type: 'error', message: 'Permission denied' },
      viewportHeight: 120,
      onRetry,
    });

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Permission denied');
    root.querySelector<HTMLButtonElement>('.fm-directory-retry')?.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('DirectoryTable rows', () => {
  it('activates sortable headers by click and keyboard and indicates the active direction', () => {
    const onSortChange = vi.fn();
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([entry()]),
      sort: [{ columnId: 'core.name', direction: 'ascending' }],
      onSortChange,
    });

    const nameHeader = root.querySelector<HTMLButtonElement>('[data-column-id="core.name"]');
    const sizeHeader = root.querySelector<HTMLButtonElement>('[data-column-id="core.size"]');

    expect(nameHeader?.getAttribute('aria-sort')).toBe('ascending');
    const indicator = nameHeader?.querySelector<SVGElement>('svg.fm-sort-indicator');
    expect(indicator?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(indicator?.getAttribute('width')).toBe('12');
    expect(indicator?.getAttribute('height')).toBe('12');
    expect(indicator?.querySelector('path')?.getAttribute('d')).toBe('M4 9 8 5l4 4');
    nameHeader?.click();
    sizeHeader?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSortChange.mock.calls.map(([sort]) => sort)).toEqual([
      [{ columnId: 'core.name', direction: 'descending' }],
      [{ columnId: 'core.size', direction: 'ascending' }],
    ]);
  });

  it('highlights only the first in-word occurrence in every matching name', () => {
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([
        entry({ id: 'banana', name: 'banana-an.txt' }),
        entry({ id: 'cabana', name: 'cabana.txt' }),
      ]),
      nameMatchPrefix: 'an',
    });

    const matches = [...root.querySelectorAll('.fm-typeahead-match')];
    expect(matches.map((match) => match.textContent)).toEqual(['an', 'an']);
    expect(root.querySelectorAll('.fm-directory-row')[0]?.textContent).toContain('banana-an.txt');
  });

  it('moves the cursor to a clicked row', () => {
    const onCursorChange = vi.fn();
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([
        entry({ id: 'entry-1' }),
        entry({ id: 'entry-2', name: 'second.txt' }),
      ]),
      cursorIndex: 0,
      onCursorChange,
    });

    root.querySelectorAll<HTMLElement>('.fm-directory-row')[1]?.click();

    expect(onCursorChange).toHaveBeenCalledWith(1);
  });

  it('does not scroll when a clicked row is already visible', () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      entry({ id: `entry-${index}`, name: `entry-${index}.txt` }),
    );
    let cursorIndex: number | undefined;
    m.mount(root, {
      view: () =>
        m(DirectoryTable, {
          state: { type: 'loaded' },
          source: entryArraySource(entries),
          ...(cursorIndex === undefined ? {} : { cursorIndex }),
          viewportHeight: 120,
          onCursorChange: (index) => {
            cursorIndex = index;
          },
        }),
    });

    const grid = root.querySelector<HTMLElement>('[role="grid"]');
    root.querySelectorAll<HTMLElement>('.fm-directory-row')[2]?.click();
    m.redraw.sync();

    expect(grid?.scrollTop).toBe(0);
  });

  it('activates a double-clicked row', () => {
    const onActivate = vi.fn();
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([entry()]),
      onActivate,
    });

    root
      .querySelector<HTMLElement>('.fm-directory-row')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onActivate).toHaveBeenCalledWith(0);
  });

  it('fills its container when no explicit viewport height is supplied', () => {
    mount({ state: { type: 'loaded' }, source: entryArraySource([entry()]) });

    expect(root.querySelector<HTMLElement>('.fm-directory-table')?.style.height).toBe('100%');
  });

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

  it('leaves the extension blank for directories and uses two dashes for their size', () => {
    const { extension: _extension, ...directory } = entry({ kind: 'directory' });
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([directory]),
    });

    const row = root.querySelector('.fm-directory-row');
    expect(row?.querySelector('.fm-directory-type')?.textContent).toBe('');
    expect(row?.querySelector('.fm-directory-size')?.textContent).toBe('--');
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

  it('requests another page when scrolling reaches the loaded end', () => {
    const onEndReached = vi.fn();
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([entry()]),
      viewportHeight: 120,
      onEndReached,
    });
    const grid = root.querySelector<HTMLElement>('.fm-directory-table');
    if (grid === null) {
      throw new Error('directory grid was not rendered');
    }
    Object.defineProperties(grid, {
      clientHeight: { value: 120 },
      scrollHeight: { value: 120 },
      scrollTop: { value: 0, writable: true },
    });

    grid.dispatchEvent(new Event('scroll'));

    expect(onEndReached).toHaveBeenCalledOnce();
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
