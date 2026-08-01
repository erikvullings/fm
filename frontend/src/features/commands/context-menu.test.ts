import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AvailableAction } from './availability';
import { ContextMenu } from './context-menu';

let root: HTMLElement;

const actions: readonly AvailableAction[] = [
  {
    action: {
      id: 'core.refresh',
      title: 'Refresh',
      category: 'navigation',
      defaultShortcuts: [],
      contextRequirements: {},
      source: { kind: 'core' },
    },
    available: true,
  },
  {
    action: {
      id: 'core.paste',
      title: 'Paste',
      category: 'fileOperations',
      defaultShortcuts: [],
      contextRequirements: {},
      source: { kind: 'core' },
    },
    available: false,
    reason: 'This location is read-only',
  },
];

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

describe('ContextMenu', () => {
  it('invokes available actions with Enter, disables unavailable ones, and returns focus', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const onInvoke = vi.fn();
    m.mount(root, {
      view: () => m(ContextMenu, { open: true, x: 10, y: 20, actions, onClose, onInvoke }),
    });

    const menu = root.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).toBe(document.activeElement);
    expect(
      root.querySelector<HTMLButtonElement>('[title="This location is read-only"]')?.disabled,
    ).toBe(true);
    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onInvoke).toHaveBeenCalledWith('core.refresh');
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
