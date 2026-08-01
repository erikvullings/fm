import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionDescriptor, EntryId, EntrySummary } from '../../models';
import { breadcrumbSegments, Pane, type PaneAttrs } from './pane';

let root: HTMLElement;

const entries: readonly EntrySummary[] = [
  {
    id: 'one' as EntryId,
    location: { providerId: 'file', uri: 'file:///home/erik/one.txt' },
    name: 'one.txt',
    kind: 'file',
    size: 1_024,
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
  },
  {
    id: 'two' as EntryId,
    location: { providerId: 'file', uri: 'file:///home/erik/two.txt' },
    name: 'two.txt',
    kind: 'file',
    size: 2_048,
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
  },
];

const keybindingActions = [
  { id: 'core.rename', title: 'Rename', defaultShortcuts: [{ key: 'F2' }] },
  {
    id: 'core.focusLocation',
    title: 'Focus location',
    defaultShortcuts: [{ key: 'L', ctrl: true }],
  },
  { id: 'core.open', title: 'Open', defaultShortcuts: [{ key: 'ENTER' }] },
  { id: 'core.parent', title: 'Parent directory', defaultShortcuts: [{ key: 'BACKSPACE' }] },
  { id: 'core.moveCursorDown', title: 'Move down', defaultShortcuts: [{ key: 'ARROWDOWN' }] },
  { id: 'core.moveCursorUp', title: 'Move up', defaultShortcuts: [{ key: 'ARROWUP' }] },
  { id: 'core.moveCursorPageDown', title: 'Page down', defaultShortcuts: [{ key: 'PAGEDOWN' }] },
  { id: 'core.moveCursorPageUp', title: 'Page up', defaultShortcuts: [{ key: 'PAGEUP' }] },
  { id: 'core.moveCursorFirst', title: 'First', defaultShortcuts: [{ key: 'HOME' }] },
  { id: 'core.moveCursorLast', title: 'Last', defaultShortcuts: [{ key: 'END' }] },
  {
    id: 'core.extendSelectionDown',
    title: 'Extend down',
    defaultShortcuts: [{ key: 'ARROWDOWN', shift: true }],
  },
  {
    id: 'core.extendSelectionUp',
    title: 'Extend up',
    defaultShortcuts: [{ key: 'ARROWUP', shift: true }],
  },
  { id: 'core.toggleSelection', title: 'Toggle selection', defaultShortcuts: [{ key: ' ' }] },
  { id: 'core.selectAll', title: 'Select all', defaultShortcuts: [{ key: 'A', ctrl: true }] },
].map(
  (action): ActionDescriptor => ({
    category: 'test',
    contextRequirements: {},
    source: { kind: 'core' },
    ...action,
  }),
);

function attrs(overrides: Partial<PaneAttrs> = {}): PaneAttrs {
  return {
    path: '/home/erik',
    tabTitle: 'erik',
    state: { type: 'loaded' },
    entries,
    sortLabel: 'Name ascending',
    sort: [{ columnId: 'core.name', direction: 'ascending' }],
    metadata: { state: 'idle' },
    selectedEntryIds: new Set<EntryId>(),
    cutEntryIds: new Set<EntryId>(),
    active: true,
    platform: 'linux',
    keybindingRuntime: 'desktop',
    actions: keybindingActions,
    keybindingOverrides: {},
    canNavigateBack: true,
    canNavigateForward: true,
    onBack: vi.fn(),
    onForward: vi.fn(),
    onParent: vi.fn(),
    onOpenEntry: vi.fn(),
    onSelectionAction: vi.fn(),
    onRetry: vi.fn(),
    onLoadNextPage: vi.fn(),
    onSortChange: vi.fn(),
    onNavigate: vi.fn(),
    onRename: vi.fn(),
    onContextMenu: vi.fn(),
    ...overrides,
  };
}

describe('Pane inline rename', () => {
  it('starts with F2, preselects the basename, validates, cancels, and commits with Enter', () => {
    const onRename = vi.fn();
    mount(attrs({ cursorIndex: 0, selectedEntryIds: new Set(['one' as EntryId]), onRename }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    m.redraw.sync();
    let input = root.querySelector<HTMLInputElement>('.fm-inline-rename-input');
    expect(input?.value).toBe('one.txt');
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(3);

    if (input === null) throw new Error('rename input missing');
    input.value = '../bad';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('single');
    expect(onRename).not.toHaveBeenCalled();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-inline-rename-input')).toBeNull();

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    m.redraw.sync();
    input = root.querySelector<HTMLInputElement>('.fm-inline-rename-input');
    if (input === null) throw new Error('rename input missing');
    input.value = 'renamed.txt';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onRename).toHaveBeenCalledWith(entries[0], 'renamed.txt');
  });
});

function mount(paneAttrs: PaneAttrs): void {
  m.mount(root, { view: () => m(Pane, paneAttrs) });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

describe('breadcrumbSegments', () => {
  it('represents a POSIX root as one clickable segment', () => {
    expect(breadcrumbSegments('/')).toEqual([{ label: '/', path: '/' }]);
  });

  it('builds cumulative paths for POSIX segments', () => {
    expect(breadcrumbSegments('/home/erik/My Files')).toEqual([
      { label: '/', path: '/' },
      { label: 'home', path: '/home' },
      { label: 'erik', path: '/home/erik' },
      { label: 'My Files', path: '/home/erik/My Files' },
    ]);
  });

  it('preserves the UNC server and share root', () => {
    expect(breadcrumbSegments('\\\\server\\share\\Projects')).toEqual([
      { label: '\\\\server\\share', path: '\\\\server\\share' },
      { label: 'Projects', path: '\\\\server\\share\\Projects' },
    ]);
  });

  it('uses home and drive roots as breadcrumb targets', () => {
    expect(breadcrumbSegments('~/My Files')).toEqual([
      { label: '~', path: '~' },
      { label: 'My Files', path: '~/My Files' },
    ]);
    expect(breadcrumbSegments('C:\\Users\\Erik')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'Erik', path: 'C:\\Users\\Erik' },
    ]);
  });
});

describe('Pane breadcrumb editing', () => {
  it('enters edit mode on breadcrumb click and cancels with Escape', () => {
    mount(attrs());

    root.querySelector<HTMLButtonElement>('.fm-breadcrumb-edit-target')?.click();
    m.redraw.sync();
    expect(root.querySelector<HTMLInputElement>('.fm-path-input')?.value).toBe('/home/erik');

    root
      .querySelector<HTMLInputElement>('.fm-path-input')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-path-input')).toBeNull();
    expect(root.querySelectorAll('.fm-breadcrumb-segment')).toHaveLength(3);
  });

  it('enters edit mode with Ctrl+L and submits paths containing spaces', async () => {
    const onNavigate = vi.fn();
    mount(attrs({ onNavigate }));

    root
      .querySelector<HTMLElement>('.fm-pane')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, bubbles: true }));
    m.redraw.sync();
    const input = root.querySelector<HTMLInputElement>('.fm-path-input');
    expect(input).not.toBeNull();
    if (input === null) return;
    input.value = '~/My Files';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith('~/My Files'));
    await vi.waitFor(() => expect(root.querySelector('.fm-path-input')).toBeNull());
  });

  it('navigates to a clicked breadcrumb target', async () => {
    const onNavigate = vi.fn();
    mount(attrs({ onNavigate }));

    root.querySelectorAll<HTMLButtonElement>('.fm-breadcrumb-segment')[1]?.click();

    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/home'));
  });

  it('shows rejected paths inline without replacing the current directory', async () => {
    mount(attrs({ onNavigate: () => Promise.reject(new Error('Path does not exist')) }));

    root.querySelector<HTMLButtonElement>('.fm-breadcrumb-edit-target')?.click();
    m.redraw.sync();
    const input = root.querySelector<HTMLInputElement>('.fm-path-input');
    if (input === null) return;
    input.value = '/missing path';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('.fm-path-error')?.textContent).toBe('Path does not exist'),
    );
    expect(root.textContent).toContain('one.txt');
  });
});

describe('Pane status bar', () => {
  it('shows entry, selection, selected-size and sort counters', () => {
    mount(attrs({ selectedEntryIds: new Set<EntryId>(['one' as EntryId]) }));

    const status = root.querySelector('.fm-pane-status')?.textContent;
    expect(status).toContain('2 entries');
    expect(status).toContain('1 selected');
    expect(status).toContain('1 KB');
    expect(status).toContain('Name ascending');
  });

  it('marks active and inactive panes for selection styling', () => {
    mount(attrs({ active: false, selectedEntryIds: new Set<EntryId>(['one' as EntryId]) }));

    expect(root.querySelector('.fm-pane')?.getAttribute('data-active')).toBe('false');
    expect(root.querySelector('.fm-selected-row')).not.toBeNull();
  });

  it('shows lazily loaded details for the cursor entry in the metadata area', () => {
    mount(
      attrs({
        metadata: {
          state: 'loaded',
          entry: entries[0] as EntrySummary,
          metadata: {
            entryId: 'one' as EntryId,
            ownership: { owner: 'erik' },
            permissions: { readable: true, writable: true, executable: false },
            extendedAttributes: {},
            checksums: {},
            pluginFields: {},
          },
        },
      }),
    );

    const summary = root.querySelector('.fm-entry-metadata')?.textContent;
    expect(summary).toContain('one.txt');
    expect(summary).toContain('1 KiB');
    expect(summary).toContain('Owner: erik');
    expect(summary).toContain('Permissions: read, write');
  });
});

describe('Pane navigation input', () => {
  it('emits cursor, page and edge movement actions', () => {
    const onSelectionAction = vi.fn();
    mount(attrs({ cursorIndex: 0, onSelectionAction }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'moveCursor', offset: 1 },
      { type: 'moveCursor', offset: -1 },
      { type: 'moveCursor', offset: 10 },
      { type: 'moveCursor', offset: -10 },
      { type: 'moveCursorTo', edge: 'first' },
      { type: 'moveCursorTo', edge: 'last' },
    ]);
  });

  it('emits range, toggle and platform select-all actions', () => {
    const onSelectionAction = vi.fn();
    mount(attrs({ cursorIndex: 0, platform: 'macos', onSelectionAction }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
    );
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'extendRange', offset: 1 },
      { type: 'toggle', entryId: 'one' },
      { type: 'selectAll' },
    ]);
  });

  it('selects clicked rows and type-selects the first in-word match', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const onSelectionAction = vi.fn();
    mount(attrs({ cursorIndex: 0, onSelectionAction }));

    root.querySelectorAll<HTMLElement>('.fm-directory-row')[1]?.click();
    root
      .querySelector<HTMLElement>('.fm-pane')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'selectOnly', entryId: 'two' },
      { type: 'setCursor', entryId: 'one' },
    ]);
    vi.useRealTimers();
  });

  it('opens a double-clicked row', () => {
    const onOpenEntry = vi.fn();
    mount(attrs({ onOpenEntry }));

    root
      .querySelector<HTMLElement>('.fm-directory-row')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onOpenEntry).toHaveBeenCalledWith(entries[0]);
  });

  it('keeps and highlights a matching typeahead prefix until explicitly cleared', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    mount(
      attrs({
        entries: [
          ...entries,
          {
            ...(entries[0] as EntrySummary),
            id: 'document',
            name: 'document.txt',
          },
        ],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'docu') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    m.redraw.sync();

    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('docu');
    expect(root.querySelector('.fm-typeahead-match')?.textContent).toBe('docu');

    vi.advanceTimersByTime(5_000);
    m.redraw.sync();
    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('docu');
    expect(root.querySelector('.fm-typeahead-match')?.textContent).toBe('docu');
    vi.useRealTimers();
  });

  it('briefly marks an unmatched prefix as an error, then keeps it editable', () => {
    vi.useFakeTimers();
    mount(
      attrs({
        entries: [{ ...(entries[0] as EntrySummary), id: 'document', name: 'document.txt' }],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'dox') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    m.redraw.sync();

    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('dox');
    expect(root.querySelector('.fm-typeahead-status')?.classList).toContain(
      'fm-typeahead-status-error',
    );

    vi.runAllTimers();
    m.redraw.sync();
    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('dox');
    expect(root.querySelector('.fm-typeahead-status')?.classList).not.toContain(
      'fm-typeahead-status-error',
    );

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    m.redraw.sync();
    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('do');
    expect(root.querySelector('.fm-typeahead-match')?.textContent).toBe('do');
    vi.useRealTimers();
  });

  it('uses Backspace to edit typeahead before navigating to the parent', () => {
    const onParent = vi.fn();
    mount(
      attrs({
        onParent,
        entries: [{ ...(entries[0] as EntrySummary), id: 'document', name: 'document.txt' }],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'doc') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    m.redraw.sync();

    expect(root.querySelector('.fm-typeahead-status')?.textContent).toBe('do');
    expect(onParent).not.toHaveBeenCalled();
  });

  it('clears typeahead and the file selection with Escape', () => {
    const onSelectionAction = vi.fn();
    mount(
      attrs({
        selectedEntryIds: new Set(['one']),
        onSelectionAction,
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.redraw.sync();

    expect(root.querySelector('.fm-typeahead-status')).toBeNull();
    expect(onSelectionAction).toHaveBeenLastCalledWith({ type: 'clear' });
  });

  it('limits cursor navigation to entries containing the active text', () => {
    const onSelectionAction = vi.fn();
    mount(
      attrs({
        cursorIndex: 0,
        onSelectionAction,
        entries: [
          { ...(entries[0] as EntrySummary), id: 'document', name: 'document.txt' },
          { ...(entries[0] as EntrySummary), id: 'other', name: 'other.txt' },
          { ...(entries[0] as EntrySummary), id: 'amendment', name: 'amendment.txt' },
        ],
      }),
    );
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    for (const typed of 'men') {
      pane?.dispatchEvent(new KeyboardEvent('keydown', { key: typed, bubbles: true }));
    }
    onSelectionAction.mockClear();
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));

    expect(onSelectionAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'setCursor', entryId: 'amendment' },
      { type: 'setCursor', entryId: 'amendment' },
      { type: 'setCursor', entryId: 'document' },
      { type: 'setCursor', entryId: 'amendment' },
    ]);
  });

  it('opens the directory under the cursor with Enter and navigates parent with Backspace', () => {
    const onOpenEntry = vi.fn();
    const onParent = vi.fn();
    mount(attrs({ cursorIndex: 0, onOpenEntry, onParent }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    pane?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));

    expect(onOpenEntry).toHaveBeenCalledWith(entries[0]);
    expect(onParent).toHaveBeenCalledOnce();
  });

  it('supports history keyboard shortcuts and auxiliary mouse buttons', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    mount(attrs({ onBack, onForward }));
    const pane = root.querySelector<HTMLElement>('.fm-pane');

    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }),
    );
    pane?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }),
    );
    pane?.dispatchEvent(new MouseEvent('auxclick', { button: 3, bubbles: true }));
    pane?.dispatchEvent(new MouseEvent('auxclick', { button: 4, bubbles: true }));

    expect(onBack).toHaveBeenCalledTimes(2);
    expect(onForward).toHaveBeenCalledTimes(2);
  });
});
