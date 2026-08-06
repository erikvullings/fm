import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MultiRenameDialog } from './multi-rename-dialog';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

const entries = [
  { id: '1', name: 'alpha.txt' },
  { id: '2', name: 'beta.txt' },
];

function findButton(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (button === undefined) throw new Error(`button "${text}" missing`);
  return button;
}

describe('MultiRenameDialog', () => {
  it('renders a preview row per entry, unchanged by default', () => {
    m.mount(root, {
      view: () =>
        m(MultiRenameDialog, {
          open: true,
          entries,
          existingSiblingNames: new Set<string>(),
          onApply: vi.fn(),
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    const rows = [...document.querySelectorAll('.fm-multi-rename-preview tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('alpha.txt');
    expect(findButton('Rename').hasAttribute('disabled')).toBe(true);
  });

  it('updates the preview live as search/replace rules change', () => {
    m.mount(root, {
      view: () =>
        m(MultiRenameDialog, {
          open: true,
          entries,
          existingSiblingNames: new Set<string>(),
          onApply: vi.fn(),
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    const search = document.querySelector<HTMLInputElement>('#multi-rename-search');
    const replace = document.querySelector<HTMLInputElement>('#multi-rename-replace');
    if (!search || !replace) throw new Error('rule inputs missing');
    search.value = 'alpha';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    replace.value = 'gamma';
    replace.dispatchEvent(new InputEvent('input', { bubbles: true }));
    m.redraw.sync();

    const rows = [...document.querySelectorAll('.fm-multi-rename-preview tbody tr')];
    expect(rows[0]?.textContent).toContain('gamma.txt');
    expect(findButton('Rename').hasAttribute('disabled')).toBe(false);
  });

  it('applies only the changed entries with their new names', () => {
    const onApply = vi.fn();
    m.mount(root, {
      view: () =>
        m(MultiRenameDialog, {
          open: true,
          entries,
          existingSiblingNames: new Set<string>(),
          onApply,
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    const prefix = document.querySelector<HTMLInputElement>('#multi-rename-prefix');
    if (!prefix) throw new Error('prefix input missing');
    prefix.value = 'new-';
    prefix.dispatchEvent(new InputEvent('input', { bubbles: true }));
    m.redraw.sync();

    findButton('Rename').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onApply).toHaveBeenCalledWith([
      { id: '1', newName: 'new-alpha.txt' },
      { id: '2', newName: 'new-beta.txt' },
    ]);
  });

  it('disables Rename and shows an error for an invalid regex, without throwing', () => {
    m.mount(root, {
      view: () =>
        m(MultiRenameDialog, {
          open: true,
          entries,
          existingSiblingNames: new Set<string>(),
          onApply: vi.fn(),
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    const regexCheckbox = document.querySelector<HTMLInputElement>(
      '.fm-multi-rename-checkbox input[type="checkbox"]',
    );
    const search = document.querySelector<HTMLInputElement>('#multi-rename-search');
    if (!regexCheckbox || !search) throw new Error('inputs missing');
    regexCheckbox.checked = true;
    regexCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    search.value = '(unterminated';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    m.redraw.sync();

    expect(document.querySelector('.fm-field-error')?.textContent).toBeTruthy();
    expect(findButton('Rename').hasAttribute('disabled')).toBe(true);
  });

  it('blocks Rename and flags the row when a collision would occur', () => {
    m.mount(root, {
      view: () =>
        m(MultiRenameDialog, {
          open: true,
          entries,
          existingSiblingNames: new Set(['same.txt']),
          onApply: vi.fn(),
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    const search = document.querySelector<HTMLInputElement>('#multi-rename-search');
    const replace = document.querySelector<HTMLInputElement>('#multi-rename-replace');
    if (!search || !replace) throw new Error('rule inputs missing');
    search.value = 'alpha';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    replace.value = 'same';
    replace.dispatchEvent(new InputEvent('input', { bubbles: true }));
    m.redraw.sync();

    expect(document.querySelector('.fm-multi-rename-row--problem')).not.toBeNull();
    expect(findButton('Rename').hasAttribute('disabled')).toBe(true);
  });

  it('cancels without applying when Cancel is clicked', () => {
    const onCancel = vi.fn();
    const onApply = vi.fn();
    m.mount(root, {
      view: () =>
        m(MultiRenameDialog, {
          open: true,
          entries,
          existingSiblingNames: new Set<string>(),
          onApply,
          onCancel,
        }),
    });
    m.redraw.sync();

    findButton('Cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('resets rules on each open transition', () => {
    let open = true;
    m.mount(root, {
      view: () =>
        m(MultiRenameDialog, {
          open,
          entries,
          existingSiblingNames: new Set<string>(),
          onApply: vi.fn(),
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    const prefix = document.querySelector<HTMLInputElement>('#multi-rename-prefix');
    if (!prefix) throw new Error('prefix input missing');
    prefix.value = 'temp-';
    prefix.dispatchEvent(new InputEvent('input', { bubbles: true }));
    m.redraw.sync();
    expect(prefix.value).toBe('temp-');

    open = false;
    m.redraw.sync();
    open = true;
    m.redraw.sync();

    const reopenedPrefix = document.querySelector<HTMLInputElement>('#multi-rename-prefix');
    expect(reopenedPrefix?.value).toBe('');
  });
});
