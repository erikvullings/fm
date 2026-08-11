import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalClient } from './terminal-client';
import { handleTerminalKeyEvent, showTerminalSurface, TerminalDrawer } from './terminal-drawer';

describe('TerminalDrawer', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    m.mount(root, null);
    root.remove();
  });

  it('renders a terminal location without mixing keyed and unkeyed children', () => {
    const client: TerminalClient = {
      open: vi.fn(async () => 'session-1'),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
    };

    expect(() =>
      m.mount(root, {
        view: () =>
          m(TerminalDrawer, {
            open: false,
            location: { providerId: 'local', uri: 'file:///home' },
            client,
            onToggle: vi.fn(),
          }),
      }),
    ).not.toThrow();
  });

  it('returns F12 to the file manager while xterm has focus', () => {
    const toggle = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'F12', cancelable: true });
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    expect(handleTerminalKeyEvent(event, { onToggle: toggle })).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('returns Ctrl+backtick to the file manager while xterm has focus', () => {
    const toggle = vi.fn();
    const event = new KeyboardEvent('keydown', {
      key: 'Dead',
      code: 'Backquote',
      ctrlKey: true,
      cancelable: true,
    });

    expect(handleTerminalKeyEvent(event, { onToggle: toggle })).toBe(false);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('returns pane and tab navigation keys to the file manager while xterm has focus', () => {
    const switchPane = vi.fn();
    const cycleTab = vi.fn();
    const focusFolder = vi.fn();

    expect(
      handleTerminalKeyEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }), {
        onToggle: vi.fn(),
        onSwitchPane: switchPane,
        onCycleTab: cycleTab,
        onFocusFolder: focusFolder,
      }),
    ).toBe(false);
    expect(
      handleTerminalKeyEvent(
        new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, cancelable: true }),
        {
          onToggle: vi.fn(),
          onSwitchPane: switchPane,
          onCycleTab: cycleTab,
          onFocusFolder: focusFolder,
        },
      ),
    ).toBe(false);
    expect(
      handleTerminalKeyEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }),
        {
          onToggle: vi.fn(),
          onSwitchPane: switchPane,
          onCycleTab: cycleTab,
          onFocusFolder: focusFolder,
        },
      ),
    ).toBe(false);

    expect(switchPane).toHaveBeenCalledOnce();
    expect(cycleTab).toHaveBeenCalledExactlyOnceWith(1);
    expect(focusFolder).toHaveBeenCalledOnce();
  });

  it('restores each folder terminal after another folder terminal used the drawer', () => {
    const drawerHost = document.createElement('div');
    const folder2Terminal = document.createElement('div');
    folder2Terminal.dataset.location = 'folder-2';
    const folder3Terminal = document.createElement('div');
    folder3Terminal.dataset.location = 'folder-3';

    showTerminalSurface(drawerHost, folder2Terminal);
    showTerminalSurface(drawerHost, folder3Terminal);
    showTerminalSurface(drawerHost, folder2Terminal);

    expect(drawerHost.firstElementChild).toBe(folder2Terminal);
  });
});
