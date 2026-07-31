import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntryId, EntrySummary } from '../../models';
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

function attrs(overrides: Partial<PaneAttrs> = {}): PaneAttrs {
  return {
    path: '/home/erik',
    tabTitle: 'erik',
    state: { type: 'loaded' },
    entries,
    sortLabel: 'Name ascending',
    selectedEntryIds: new Set<EntryId>(),
    active: true,
    onNavigate: vi.fn(),
    ...overrides,
  };
}

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
});
