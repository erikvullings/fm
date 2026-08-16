import { describe, expect, it } from 'vitest';

import type { ActionDescriptor, KeyChord, WorkspaceSummary } from '../../models';
import { buildNativeMenuSpec, type NativeMenuInputs, type NativeMenuTab } from './native-menu-spec';

function action(
  id: string,
  title: string,
  defaultShortcuts: KeyChord[] = [],
  category = 'test',
): ActionDescriptor {
  return {
    id,
    title,
    category,
    defaultShortcuts,
    contextRequirements: {},
    source: { kind: 'core' },
  };
}

function tab(overrides: Partial<NativeMenuTab> = {}): NativeMenuTab {
  return {
    paneId: 'pane-1',
    tabId: 'tab-1',
    tabKey: 'pane-1:tab-1',
    title: 'Documents',
    active: false,
    ...overrides,
  };
}

function workspaceSummary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'workspace-1',
    name: 'Default',
    revision: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function inputs(overrides: Partial<NativeMenuInputs> = {}): NativeMenuInputs {
  return {
    actions: [],
    favouriteActions: [],
    tabs: [],
    canOpenNewWindow: false,
    workspaces: [],
    currentWorkspaceId: undefined,
    ...overrides,
  };
}

describe('buildNativeMenuSpec', () => {
  it('emits every top-level menu in order', () => {
    const spec = buildNativeMenuSpec(inputs());
    expect(spec.menus.map((menu) => menu.title)).toEqual([
      'Procyon',
      'File',
      'Edit',
      'View',
      'Go',
      'Window',
      'Help',
    ]);
  });

  it('builds the App menu with Preferences and the standard AppKit roles', () => {
    const [appMenu] = buildNativeMenuSpec(inputs()).menus;
    expect(appMenu?.items).toEqual([
      { kind: 'role', role: 'about' },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'ui.openSettings',
        title: 'Preferences…',
        shortcut: { key: ',', meta: true },
        enabled: true,
        checked: false,
      },
      { kind: 'separator' },
      { kind: 'role', role: 'services' },
      { kind: 'separator' },
      { kind: 'role', role: 'hideApp' },
      { kind: 'role', role: 'hideOthers' },
      { kind: 'role', role: 'showAll' },
      { kind: 'separator' },
      { kind: 'role', role: 'quit' },
    ]);
  });

  it('populates the File menu from registered actions by id, in the given order', () => {
    const actions = [
      action('core.closeTab', 'Close Tab', [{ key: 'w', meta: true }]),
      action('core.newTab', 'New Tab', [{ key: 't', meta: true }]),
    ];
    const fileMenu = buildNativeMenuSpec(inputs({ actions })).menus.find(
      (menu) => menu.title === 'File',
    );
    expect(fileMenu?.items).toEqual([
      {
        kind: 'action',
        id: 'core.newTab',
        title: 'New Tab',
        shortcut: { key: 't', meta: true },
        enabled: true,
        checked: false,
      },
      {
        kind: 'action',
        id: 'core.closeTab',
        title: 'Close Tab',
        shortcut: { key: 'w', meta: true },
        enabled: true,
        checked: false,
      },
    ]);
  });

  it('skips File menu ids that are not currently registered instead of crashing', () => {
    const fileMenu = buildNativeMenuSpec(inputs({ actions: [] })).menus.find(
      (menu) => menu.title === 'File',
    );
    expect(fileMenu?.items).toEqual([]);
  });

  it('adds a New Window item first in the File menu when the host can open one', () => {
    const fileMenu = buildNativeMenuSpec(inputs({ canOpenNewWindow: true })).menus.find(
      (menu) => menu.title === 'File',
    );
    expect(fileMenu?.items).toEqual([
      {
        kind: 'action',
        id: 'ui.newWorkspaceWindow',
        title: 'New Window',
        shortcut: { key: 'n', meta: true, shift: true },
        enabled: true,
        checked: false,
      },
    ]);
  });

  it('omits New Window entirely on a host with no window concept', () => {
    const fileMenu = buildNativeMenuSpec(inputs({ canOpenNewWindow: false })).menus.find(
      (menu) => menu.title === 'File',
    );
    expect(
      fileMenu?.items.some((item) => 'id' in item && item.id === 'ui.newWorkspaceWindow'),
    ).toBe(false);
  });

  it('restricts the Edit menu to Copy, Paste and Select All only', () => {
    const actions = [
      action('core.copy', 'Copy'),
      action('core.paste', 'Paste'),
      action('core.selectAll', 'Select All'),
      action('core.rename', 'Rename'),
    ];
    const editMenu = buildNativeMenuSpec(inputs({ actions })).menus.find(
      (menu) => menu.title === 'Edit',
    );
    expect(editMenu?.items.map((item) => (item.kind === 'action' ? item.id : item.kind))).toEqual([
      'core.copy',
      'core.paste',
      'core.selectAll',
    ]);
  });

  it('populates the View menu from the sort-order toggle actions', () => {
    const actions = [
      action('core.sortByName', 'Sort by Name'),
      action('core.sortByExtension', 'Sort by Extension'),
      action('core.sortByDate', 'Sort by Date'),
      action('core.sortBySize', 'Sort by Size'),
      action('core.sortUnsorted', 'Unsorted'),
      action('core.copy', 'Copy'),
    ];
    const viewMenu = buildNativeMenuSpec(inputs({ actions })).menus.find(
      (menu) => menu.title === 'View',
    );
    expect(viewMenu?.items.map((item) => (item.kind === 'action' ? item.id : item.kind))).toEqual([
      'core.sortByName',
      'core.sortByExtension',
      'core.sortByDate',
      'core.sortBySize',
      'core.sortUnsorted',
    ]);
  });

  it('builds the Go menu from favourite actions, not the plain registered actions', () => {
    const favouriteActions = [
      action('core.favourites', 'Open favourites', [{ key: 'h', ctrl: true, shift: true }]),
      action('core.favourite.0', 'Open favourite: Downloads', [{ key: '1', ctrl: true }]),
    ];
    const goMenu = buildNativeMenuSpec(
      inputs({ actions: [action('core.copy', 'Copy')], favouriteActions }),
    ).menus.find((menu) => menu.title === 'Go');
    expect(goMenu?.items).toEqual([
      {
        kind: 'action',
        id: 'core.favourite.0',
        title: 'Open favourite: Downloads',
        shortcut: { key: '1', ctrl: true },
        enabled: true,
        checked: false,
      },
    ]);
  });

  it('excludes core.favourites from the Go menu (it opens the command palette, not a location)', () => {
    const favouriteActions = [
      action('core.favourites', 'Open favourites', [{ key: 'h', ctrl: true, shift: true }]),
    ];
    const goMenu = buildNativeMenuSpec(inputs({ favouriteActions })).menus.find(
      (menu) => menu.title === 'Go',
    );
    expect(goMenu?.items).toEqual([]);
  });

  it('builds the Window menu with the minimize/zoom roles and one item per open tab', () => {
    const tabs = [
      tab({ tabKey: 'pane-1:tab-1', title: 'Documents', active: true }),
      tab({ tabKey: 'pane-2:tab-1', title: 'Downloads', active: false }),
    ];
    const windowMenu = buildNativeMenuSpec(inputs({ tabs })).menus.find(
      (menu) => menu.title === 'Window',
    );
    expect(windowMenu?.items).toEqual([
      { kind: 'role', role: 'minimize' },
      { kind: 'role', role: 'zoom' },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'ui.window.tab.pane-1:tab-1',
        title: 'Documents',
        enabled: true,
        checked: true,
      },
      {
        kind: 'action',
        id: 'ui.window.tab.pane-2:tab-1',
        title: 'Downloads',
        enabled: true,
        checked: false,
      },
    ]);
  });

  it('omits the tab separator entirely when there are no open tabs', () => {
    const windowMenu = buildNativeMenuSpec(inputs({ tabs: [] })).menus.find(
      (menu) => menu.title === 'Window',
    );
    expect(windowMenu?.items).toEqual([
      { kind: 'role', role: 'minimize' },
      { kind: 'role', role: 'zoom' },
    ]);
  });

  it('marks only the active tab as checked, even with tabs across multiple panes', () => {
    const tabs = [
      tab({ tabKey: 'pane-1:tab-1', active: false }),
      tab({ tabKey: 'pane-1:tab-2', active: true }),
      tab({ tabKey: 'pane-2:tab-1', active: false }),
    ];
    const windowMenu = buildNativeMenuSpec(inputs({ tabs })).menus.find(
      (menu) => menu.title === 'Window',
    );
    const checkedIds = (windowMenu?.items ?? [])
      .filter((item): item is Extract<typeof item, { kind: 'action' }> => item.kind === 'action')
      .filter((item) => item.checked)
      .map((item) => item.id);
    expect(checkedIds).toEqual(['ui.window.tab.pane-1:tab-2']);
  });

  it('adds an Open Workspace submenu listing every workspace when the host can open windows', () => {
    const workspaces = [
      workspaceSummary({ id: 'workspace-1', name: 'Default' }),
      workspaceSummary({ id: 'workspace-2', name: 'Photos' }),
    ];
    const windowMenu = buildNativeMenuSpec(
      inputs({ canOpenNewWindow: true, workspaces, currentWorkspaceId: 'workspace-2' }),
    ).menus.find((menu) => menu.title === 'Window');
    expect(windowMenu?.items).toEqual([
      { kind: 'role', role: 'minimize' },
      { kind: 'role', role: 'zoom' },
      { kind: 'separator' },
      {
        kind: 'submenu',
        title: 'Open Workspace',
        items: [
          {
            kind: 'action',
            id: 'ui.window.openWorkspace.workspace-1',
            title: 'Default',
            enabled: true,
            checked: false,
          },
          {
            kind: 'action',
            id: 'ui.window.openWorkspace.workspace-2',
            title: 'Photos',
            enabled: true,
            checked: true,
          },
        ],
      },
    ]);
  });

  it('omits the Open Workspace submenu on a host with no window concept', () => {
    const windowMenu = buildNativeMenuSpec(
      inputs({ canOpenNewWindow: false, workspaces: [workspaceSummary()] }),
    ).menus.find((menu) => menu.title === 'Window');
    expect(windowMenu?.items).toEqual([
      { kind: 'role', role: 'minimize' },
      { kind: 'role', role: 'zoom' },
    ]);
  });

  it('populates the Help menu with the shortcuts-help action when registered', () => {
    const actions = [action('core.showShortcutsHelp', 'Keyboard Shortcuts')];
    const helpMenu = buildNativeMenuSpec(inputs({ actions })).menus.find(
      (menu) => menu.title === 'Help',
    );
    expect(helpMenu?.items).toEqual([
      {
        kind: 'action',
        id: 'core.showShortcutsHelp',
        title: 'Keyboard Shortcuts',
        shortcut: undefined,
        enabled: true,
        checked: false,
      },
    ]);
  });
});
