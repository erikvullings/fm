import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermanentDeleteDialog } from './permanent-delete-dialog';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

describe('PermanentDeleteDialog', () => {
  it('states exact totals and defaults focus to cancel', () => {
    m.mount(root, {
      view: () =>
        m(PermanentDeleteDialog, {
          open: true,
          itemCount: 12,
          totalBytes: 4096,
          onConfirm: vi.fn(),
          onCancel: vi.fn(),
        }),
    });
    m.redraw.sync();

    expect(root.textContent).toContain('12 items (4096 bytes)');
    expect(root.textContent).toContain('irreversible');
    expect(document.activeElement?.textContent).toBe('Cancel');
  });
});
