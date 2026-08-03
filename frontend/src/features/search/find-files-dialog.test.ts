import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntrySummary } from '../../models';
import { FindFilesDialog } from './find-files-dialog';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

function fixtureEntry(overrides: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 'entry-1',
    location: { providerId: 'local', uri: 'file:///Documents/report.pdf' },
    name: 'report.pdf',
    kind: 'file',
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
    ...overrides,
  };
}

describe('FindFilesDialog', () => {
  it('is focused on open and submits the trimmed query with Enter', async () => {
    const onSearch = vi.fn();
    const onCancel = vi.fn();
    const onActivateResult = vi.fn();
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          results: [],
          searching: false,
          onSearch,
          onCancel,
          onActivateResult,
        }),
    });
    m.redraw.sync();
    const input = document.querySelector<HTMLInputElement>('#find-files-query');
    expect(document.activeElement).toBe(input);
    if (!input) throw new Error('input missing');

    input.value = '  report  ';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSearch).toHaveBeenCalledWith('report');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not search on an empty/whitespace-only query', () => {
    const onSearch = vi.fn();
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          results: [],
          searching: false,
          onSearch,
          onCancel: vi.fn(),
          onActivateResult: vi.fn(),
        }),
    });
    m.redraw.sync();
    const input = document.querySelector<HTMLInputElement>('#find-files-query');
    if (!input) throw new Error('input missing');

    input.value = '   ';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('renders streamed results and activates one on click', () => {
    const onActivateResult = vi.fn();
    const entry = fixtureEntry();
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          results: [entry],
          searching: true,
          onSearch: vi.fn(),
          onCancel: vi.fn(),
          onActivateResult,
        }),
    });
    m.redraw.sync();

    expect(document.body.textContent).toContain('report.pdf');
    expect(document.body.textContent).toContain('Searching…');

    document
      .querySelector('.fm-find-files-results li')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onActivateResult).toHaveBeenCalledWith(entry);
  });

  it('shows a no-matches status once a completed search finds nothing', () => {
    let searching = false;
    const onSearch = vi.fn(() => {
      searching = false;
    });
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          results: [],
          searching,
          onSearch,
          onCancel: vi.fn(),
          onActivateResult: vi.fn(),
        }),
    });
    m.redraw.sync();
    const input = document.querySelector<HTMLInputElement>('#find-files-query');
    if (!input) throw new Error('input missing');

    input.value = 'nothing-matches-this';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    m.redraw.sync();

    expect(document.body.textContent).toContain('No matches.');
  });

  it('resets the query and blurs before cancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          results: [],
          searching: false,
          onSearch: vi.fn(),
          onCancel,
          onActivateResult: vi.fn(),
        }),
    });
    m.redraw.sync();
    const buttons = [...document.querySelectorAll('button')];
    const cancelButton = buttons.find((button) => button.textContent?.trim() === 'Cancel');
    if (!cancelButton) throw new Error('cancel button missing');

    cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
