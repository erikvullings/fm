import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGeneratedDirectory } from '../../api/client/mock-directory-generator';
import type { EntrySummary } from '../../models';
import {
  DirectoryTable,
  type DirectoryTableAttrs,
  entryArraySource,
  SAMPLE_FILE_AGE_COLUMN,
} from './directory-table';
import type { NativeIconLoader } from './native-icon-loader';

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
  it('pins its hidden cursor announcement inside the scroll viewport', () => {
    mount({ state: { type: 'loaded' }, source: entryArraySource([entry()]), viewportHeight: 120 });

    const status = root.querySelector<HTMLElement>('.fm-visually-hidden');
    expect(status).not.toBeNull();
    if (status === null) return;
    const style = getComputedStyle(status);
    expect(style.top).toBe('0px');
    expect(style.left).toBe('0px');
  });

  it('overlays a loaded native icon and otherwise keeps the themed icon', () => {
    const nativeIconLoader = {
      iconDataUri: vi.fn().mockReturnValue('data:image/png;base64,iVBORw=='),
    } as unknown as NativeIconLoader;
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([entry()]),
      viewportHeight: 120,
      nativeIconLoader,
    });

    const icon = root.querySelector<HTMLImageElement>('img.fm-native-entry-icon');
    expect(icon?.src).toBe('data:image/png;base64,iVBORw==');
    expect(icon?.width).toBe(16);
    expect(icon?.height).toBe(16);
    expect(root.querySelector('.fm-entry-icon:not(.fm-native-entry-icon)')).toBeNull();
  });

  it('renders bounded loading placeholders with an accessible status', () => {
    mount({ state: { type: 'loading' }, viewportHeight: 120 });

    expect(root.querySelector('[role="status"]')?.textContent).toContain('Loading directory');
    expect(root.querySelectorAll('.fm-directory-placeholder')).toHaveLength(6);
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
  it('clips the final filler stripe to the unused viewport height', () => {
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([entry()]),
      viewportHeight: 113,
    });

    const fillers = root.querySelectorAll<HTMLElement>('.fm-directory-row-filler');
    expect(fillers).toHaveLength(5);
    expect(fillers.item(4).style.height).toBe('13px');
  });

  it('renders the themed icon matching each entry kind and extension', () => {
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([
        entry({ id: 'dir', name: 'Photos', kind: 'directory' }),
        entry({ id: 'link', name: 'shortcut', kind: 'symlink' }),
        entry({ id: 'image', name: 'photo.png', extension: 'png' }),
        entry({ id: 'plain', name: 'notes.txt', extension: 'txt' }),
      ]),
    });

    const rows = root.querySelectorAll('.fm-directory-row');
    expect(rows[0]?.querySelector('svg')?.getAttribute('class')).toContain('fm-icon-folder');
    expect(rows[1]?.querySelector('svg')?.getAttribute('class')).toContain('fm-icon-symlink');
    expect(rows[2]?.querySelector('svg')?.getAttribute('class')).toContain('fm-icon-image');
    expect(rows[3]?.querySelector('svg')?.getAttribute('class')).toContain('fm-icon-file');
  });

  it('renders a declarative file-age column alongside core columns', () => {
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([
        entry({ modifiedAt: new Date(Date.now() - 3_600_000).toISOString() }),
      ]),
      pluginColumns: [SAMPLE_FILE_AGE_COLUMN],
    });

    expect(root.querySelector('[role="grid"]')?.getAttribute('aria-colcount')).toBe('5');
    expect(root.querySelector('[data-column-id="sample.fileAge"]')?.textContent).toContain('Age');
    expect(root.querySelectorAll('.fm-directory-file-age').item(1)?.textContent).toBe('1h');
  });

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

  it('shows the full location for entries in a virtual search directory, without the leading slash or extension', () => {
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([
        entry({
          location: { providerId: 'local', uri: 'file:///Users/erik/Documents/report.txt' },
        }),
      ]),
      showFullPath: true,
    });

    expect(root.querySelector('.fm-entry-name')?.textContent).toBe('Users/erik/Documents/report');
  });

  it('shows the full location unmodified for a directory match (no extension to strip)', () => {
    const { extension: _extension, ...directory } = entry({
      kind: 'directory',
      location: { providerId: 'local', uri: 'file:///Users/erik/Documents/Reports' },
    });
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([directory]),
      showFullPath: true,
    });

    expect(root.querySelector('.fm-entry-name')?.textContent).toBe('Users/erik/Documents/Reports');
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

    expect(onCursorChange).toHaveBeenCalledWith(1, { shiftKey: false, ctrlKey: false });
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

  it('reports pointer and keyboard context-menu requests for the current row', () => {
    const onContextMenu = vi.fn();
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([entry()]),
      cursorIndex: 0,
      onContextMenu,
    });

    root
      .querySelector<HTMLElement>('.fm-directory-row')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 }));
    root
      .querySelector<HTMLElement>('[role="grid"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));

    expect(onContextMenu.mock.calls[0]).toEqual([0, 40, 50]);
    expect(onContextMenu.mock.calls[1]?.[0]).toBe(0);
  });

  it('fills its container when no explicit viewport height is supplied', () => {
    mount({ state: { type: 'loaded' }, source: entryArraySource([entry()]) });

    expect(root.querySelector<HTMLElement>('.fm-directory-table')?.style.height).toBe('100%');
  });

  it('renders semantic columns and a hidden icon and a symlink icon indicator', () => {
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
    expect(root.querySelector('[aria-label="Hidden entry"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="Link entry"]')).not.toBeNull();
    expect(root.querySelector('.fm-entry-symlink-indicator svg')?.getAttribute('class')).toContain(
      'fm-icon-link',
    );
    expect(root.textContent).not.toContain('Link');
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

  it('leaves parent and link metadata columns empty', () => {
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([
        entry({ id: 'fm:parent:/folder', name: '..', kind: 'directory' }),
        entry({ id: 'link', name: 'OneDrive', kind: 'symlink', size: Number.NaN }),
      ]),
    });

    const rows = root.querySelectorAll('.fm-directory-row');
    expect(rows[0]?.querySelector('.fm-directory-size')?.textContent).toBe('');
    expect(rows[0]?.querySelector('.fm-directory-modified')?.textContent).toBe('');
    expect(rows[1]?.querySelector('.fm-directory-size')?.textContent).toBe('');
    expect(rows[1]?.querySelector('.fm-directory-type')?.textContent).toBe('');
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
    expect(root.textContent).toContain('generated-0749999');
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

  it('remeasures its viewport after a sibling info bar changes the post-layout height', async () => {
    mount({ state: { type: 'loaded' }, source: entryArraySource([entry()]) });
    const grid = root.querySelector<HTMLElement>('[role="grid"]');
    if (grid === null) throw new Error('directory grid was not rendered');

    Object.defineProperty(grid, 'clientHeight', { configurable: true, value: 300 });
    m.redraw.sync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    m.redraw.sync();
    expect(root.querySelector<HTMLElement>('.fm-directory-body')?.style.height).toBe('300px');

    let measurements = 0;
    Object.defineProperty(grid, 'clientHeight', {
      configurable: true,
      get: () => (measurements++ === 0 ? 300 : 278),
    });
    const redraw = vi.spyOn(m, 'redraw');
    m.redraw.sync();
    expect(redraw).toHaveBeenCalledOnce();
    redraw.mockRestore();

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.fm-directory-body')?.style.height).toBe('278px'),
    );
  });

  it('requests another page when scrolling reaches the loaded end', () => {
    const onEndReached = vi.fn();
    mount({
      state: { type: 'loaded' },
      source: entryArraySource([entry()]),
      viewportHeight: 120,
      onEndReached,
    });
    const grid = root.querySelector<HTMLElement>('[role="grid"]');
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

  it('requests more data as soon as the visible window reaches unloaded entries, before the physical scroll bottom', () => {
    const onEndReached = vi.fn();
    const loaded = [entry({ id: 'entry-0', name: 'entry-0.txt' })];
    mount({
      state: { type: 'loaded' },
      // Only one entry is loaded, but the source reports a much larger real total (as the
      // backend does via `totalKnownEntries`), so the very first render's window already spans
      // unloaded indices — that gap must trigger a fetch immediately, not only once physically
      // scrolled all the way to the (much further away) bottom of the full virtual list.
      source: entryArraySource(loaded, 10_000),
      viewportHeight: 120,
      onEndReached,
    });

    expect(onEndReached).toHaveBeenCalled();
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

  it('re-scrolls to a pinned cursor once the source grows, even though the cursor index itself is unchanged', () => {
    // Regression test: `moveCursorTo`/edge:'last' can land the cursor on an index that
    // exceeds what's loaded so far (the source reports its eventual total via
    // `totalKnownEntries` before every page has arrived). The first sync clamps the
    // scroll target to whatever was available; once later pages arrive the entryCount
    // grows but `cursorIndex` never changes again, so tracking cursorIndex alone would
    // never trigger a re-sync, permanently stranding the viewport short of the real
    // last entry (visually appearing unscrolled, even though the cursor is logically
    // correct).
    const entries = Array.from({ length: 500 }, (_, index) =>
      entry({ id: `entry-${index}`, name: `entry-${index}.txt` }),
    );
    let loadedCount = 60;
    m.mount(root, {
      view: () =>
        m(DirectoryTable, {
          state: { type: 'loaded' },
          source: entryArraySource(entries.slice(0, loadedCount), loadedCount),
          cursorIndex: 459,
          viewportHeight: 120,
        }),
    });

    expect(root.querySelector('.fm-cursor-row')).toBeNull();

    loadedCount = 500;
    m.redraw.sync();

    const grid = root.querySelector<HTMLElement>('[role="grid"]');
    expect(root.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Focused entry-459.txt',
    );
    expect(root.querySelector('.fm-cursor-row')?.textContent).toContain('entry-459.txt');
    expect(grid?.scrollTop).toBeGreaterThan(8_000);
  });
});
