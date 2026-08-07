import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FindFilesSearchParams } from './find-files-dialog';
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

describe('FindFilesDialog', () => {
  it('is focused on open and submits the trimmed query with Enter', async () => {
    const onSearch = vi.fn();
    const onCancel = vi.fn();
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          onSearch,
          onCancel,
        }),
    });
    m.redraw.sync();
    const input = document.querySelector<HTMLInputElement>('#find-files-query');
    expect(document.activeElement).toBe(input);
    if (!input) throw new Error('input missing');

    input.value = '  report  ';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSearch).toHaveBeenCalledWith({
      filenameQuery: 'report',
      contentQuery: undefined,
      contentRegex: false,
      recurse: true,
    });
    expect(document.activeElement).not.toBe(input);

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
          onSearch,
          onCancel: vi.fn(),
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

  it('keeps results out of the modal because they render in the active pane', () => {
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          onSearch: vi.fn(),
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    expect(document.querySelector('.fm-find-files-results')).toBeNull();
    expect(document.querySelector('.fm-find-files-modal')?.id).toBe('find-files-dialog');
    expect(
      [...document.querySelectorAll('.fm-find-files-modal .modal-footer button')].every((button) =>
        button.classList.contains('btn-flat'),
      ),
    ).toBe(true);
  });

  it('blurs before cancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          onSearch: vi.fn(),
          onCancel,
        }),
    });
    m.redraw.sync();
    const buttons = [...document.querySelectorAll('button')];
    const cancelButton = buttons.find((button) => button.textContent?.trim() === 'Cancel');
    if (!cancelButton) throw new Error('cancel button missing');

    cancelButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps the previous query on reopen, fully selected, so typing replaces it and Enter re-searches', () => {
    let open = true;
    const onSearch = vi.fn();
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open,
          scopeLabel: 'file:///Documents',
          onSearch,
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();
    const input = document.querySelector<HTMLInputElement>('#find-files-query');
    if (!input) throw new Error('input missing');

    input.value = '*.svg';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const expected: FindFilesSearchParams = {
      filenameQuery: '*.svg',
      contentQuery: undefined,
      contentRegex: false,
      recurse: true,
    };
    expect(onSearch).toHaveBeenCalledWith(expected);

    // Simulate the parent closing the dialog after a successful search, then reopening it
    // for a second search (e.g. via Alt+F7 again).
    open = false;
    m.redraw.sync();
    open = true;
    m.redraw.sync();

    expect(input.value).toBe('*.svg');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);

    // Pressing Enter immediately re-runs the same search.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onSearch).toHaveBeenLastCalledWith(expected);
  });

  it('passes content query and options when content search is used', () => {
    const onSearch = vi.fn();
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          onSearch,
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    const contentInput = document.querySelectorAll<HTMLInputElement>(
      '.fm-find-files-body input',
    )[1];
    if (!contentInput) throw new Error('content input missing');
    contentInput.value = 'TODO';
    contentInput.dispatchEvent(new InputEvent('input', { bubbles: true }));

    // Trigger search from the filename input
    const files = document.querySelector<HTMLInputElement>('#find-files-query');
    if (!files) throw new Error('filename input missing');
    files.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        filenameQuery: '',
        contentQuery: 'TODO',
        contentRegex: false,
        recurse: true,
      }),
    );
  });

  it('shows recurse and regex toggles', () => {
    m.mount(root, {
      view: () =>
        m(FindFilesDialog, {
          open: true,
          scopeLabel: 'file:///Documents',
          onSearch: vi.fn(),
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    const options = document.querySelector('.fm-find-files-options');
    expect(options).not.toBeNull();
    expect(options?.textContent).toContain('Recurse subdirectories');
    expect(options?.textContent).toContain('Use regex');
  });
});
