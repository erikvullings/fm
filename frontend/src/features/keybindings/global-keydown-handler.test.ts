import { describe, expect, it, vi } from 'vitest';
import type {
  ActionDescriptor,
  EntrySummary,
  Location,
  PaneId,
  WorkspaceProjection,
} from '../../models';
import type { NavigationController, PaneDirectoryView } from '../navigation/navigation';
import type { OperationsController } from '../operations/operations-controller';
import type { TabController } from '../panes/tab-controller';
import type { SelectionState } from '../selection/selection';
import { createGlobalKeydownHandler, type GlobalKeydownContext } from './global-keydown-handler';

const ACTIONS: readonly ActionDescriptor[] = [
  { id: 'core.rootDirectory', title: 'Root', defaultShortcuts: [{ key: 'Backspace', ctrl: true }] },
  {
    id: 'core.openInNewTab',
    title: 'Open in new tab',
    defaultShortcuts: [{ key: 'ArrowUp', ctrl: true }],
  },
  {
    id: 'core.openInNewTabOtherPane',
    title: 'Open in new tab (other pane)',
    defaultShortcuts: [{ key: 'ArrowUp', ctrl: true, shift: true }],
  },
  {
    id: 'core.duplicateLocationToOtherPane',
    title: 'Duplicate directory',
    defaultShortcuts: [
      { key: 'ArrowLeft', ctrl: true },
      { key: 'ArrowRight', ctrl: true },
    ],
  },
  { id: 'core.swapPanes', title: 'Swap panes', defaultShortcuts: [{ key: 'u', ctrl: true }] },
  {
    id: 'core.compareDirectories',
    title: 'Compare directories',
    defaultShortcuts: [{ key: 'F2', shift: true }],
  },
  {
    id: 'core.swapPaneTabs',
    title: 'Swap pane tabs',
    defaultShortcuts: [{ key: 'u', ctrl: true, shift: true }],
  },
  {
    id: 'core.closeAllTabs',
    title: 'Close all tabs',
    defaultShortcuts: [{ key: 'w', ctrl: true, shift: true }],
  },
  {
    id: 'core.newConnection',
    title: 'New connection',
    defaultShortcuts: [{ key: 'n', ctrl: true }],
  },
  {
    id: 'core.reactivateQuickFilter',
    title: 'Reactivate quick filter',
    defaultShortcuts: [{ key: 's', ctrl: true, shift: true }],
  },
  {
    id: 'core.clearQuickFilter',
    title: 'Show all files',
    defaultShortcuts: [{ key: 'F10', ctrl: true }],
  },
  { id: 'core.sortByName', title: 'Sort by name', defaultShortcuts: [{ key: 'F3', ctrl: true }] },
  { id: 'core.createFile', title: 'New file', defaultShortcuts: [{ key: 'F4', shift: true }] },
  { id: 'core.duplicate', title: 'Duplicate', defaultShortcuts: [{ key: 'F5', shift: true }] },
  {
    id: 'core.openMultiRename',
    title: 'Multi-rename',
    defaultShortcuts: [{ key: 'm', ctrl: true }],
  },
  { id: 'core.quit', title: 'Quit', defaultShortcuts: [{ key: 'F4', alt: true }] },
  { id: 'core.showShortcutsHelp', title: 'Shortcuts', defaultShortcuts: [{ key: 'F1' }] },
].map(
  (action): ActionDescriptor => ({
    category: 'test',
    contextRequirements: {},
    source: { kind: 'core' },
    ...action,
  }),
);

const PANE_A = 'pane-a' as PaneId;
const PANE_B = 'pane-b' as PaneId;

function workspace(overrides: Partial<WorkspaceProjection> = {}): WorkspaceProjection {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    revision: 1,
    layout: {
      type: 'split',
      axis: 'horizontal',
      ratio: 0.5,
      first: { type: 'pane', paneId: PANE_A },
      second: { type: 'pane', paneId: PANE_B },
    },
    paneOrder: [PANE_A, PANE_B],
    panesById: {
      [PANE_A]: {
        id: PANE_A,
        tabOrder: ['tab-a' as never],
        tabsById: { 'tab-a': { id: 'tab-a' as never } } as never,
        activeTabId: 'tab-a' as never,
      },
      [PANE_B]: {
        id: PANE_B,
        tabOrder: ['tab-b' as never],
        tabsById: { 'tab-b': { id: 'tab-b' as never } } as never,
        activeTabId: 'tab-b' as never,
      },
    },
    activePaneId: PANE_A,
    operationCentre: { visible: false, height: 180 },
    ...overrides,
  };
}

function makeContext(overrides: Partial<GlobalKeydownContext> = {}): GlobalKeydownContext {
  const base: GlobalKeydownContext = {
    getCommandPaletteOpen: () => false,
    getPlatform: () => 'linux',
    getKeybindingRuntime: () => 'browser',
    getCurrentSettings: () => undefined,
    getWorkspace: () => workspace(),
    getSelections: () => new Map<string, SelectionState>(),
    getDirectories: () => new Map<string, PaneDirectoryView>(),
    getRegisteredActions: () => ACTIONS,
    clipboard: () => ({ locations: [] }),
    getFindFilesOpen: () => false,
    getViewer: () => undefined,
    getArchiveCreateRequest: () => undefined,
    getCreateDirectoryOpen: () => false,
    getCreateFileOpen: () => false,
    getAppState: () => undefined,
    getLastQuickFilterQuery: () => undefined,
    getShortcutsHelpOpen: () => false,
    setCommandPaletteOpen: vi.fn(),
    setClipboardMessage: vi.fn(),
    setArchiveCreateRequest: vi.fn(),
    setCreateDirectoryOpen: vi.fn(),
    setCreateFileOpen: vi.fn(),
    setAppState: vi.fn(),
    setQuickFilterOpen: vi.fn(),
    setActiveTabQuickFilter: vi.fn(),
    setConnectionsManagerOpen: vi.fn(),
    setShortcutsHelpOpen: vi.fn(),
    getTabController: () =>
      ({
        openTabAt: vi.fn(),
        closeAllTabs: vi.fn(),
      }) as unknown as TabController,
    getOpsController: () =>
      ({
        duplicate: vi.fn().mockResolvedValue({}),
      }) as unknown as OperationsController,
    getNavigation: () =>
      ({
        navigate: vi.fn().mockResolvedValue(undefined),
      }) as unknown as NavigationController,
    activeDirectory: () => ({
      paneId: PANE_A,
      location: { providerId: 'local', uri: 'file:///a/b/c' },
    }),
    activeTabKey: (paneId) => `${paneId}:tab`,
    actionsWithFavourites: () => ACTIONS,
    openFindFiles: vi.fn(),
    replaceClipboard: vi.fn(),
    selectedLocations: () => [],
    invokeActionById: vi.fn(),
    openViewer: vi.fn(),
    openEditor: vi.fn(),
    actionContext: () => ({ selectedEntryIds: [] }),
    commandAvailabilityContext: () => ({}) as never,
    contentSearchInitialQuery: () => undefined,
    refetchAffectedPanes: vi.fn(),
    platformActionParameters: () => undefined,
    activatePane: vi.fn(),
    focusPane: vi.fn(),
    redraw: vi.fn(),
    toggleTerminal: vi.fn(),
    setSort: vi.fn(),
    swapPaneTabSets: vi.fn(),
    openMultiRenameForActivePane: vi.fn(),
    quitApplication: vi.fn(),
    startComparison: vi.fn(),
  };
  return { ...base, ...overrides };
}

function keydown(key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
}

describe('createGlobalKeydownHandler - task 0128 shortcuts', () => {
  it('Ctrl+Backspace navigates to the root of the active location', () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const context = makeContext({
      getNavigation: () => ({ navigate }) as unknown as NavigationController,
    });
    createGlobalKeydownHandler(context)(keydown('Backspace', { ctrlKey: true }));
    expect(navigate).toHaveBeenCalledWith(PANE_A, { providerId: 'local', uri: 'file:///' });
  });

  it('Ctrl+Up opens the directory under the cursor as a new tab in the same pane', () => {
    const openTabAt = vi.fn();
    const cursorDir: EntrySummary = {
      id: 'dir-1' as never,
      location: { providerId: 'local', uri: 'file:///a/dir' },
      name: 'dir',
      kind: 'directory',
      hidden: false,
      readOnly: false,
      metadataRevision: 0,
    };
    const context = makeContext({
      getTabController: () => ({ openTabAt, closeAllTabs: vi.fn() }) as unknown as TabController,
      getSelections: () =>
        new Map([['pane-a:tab', { selectedEntryIds: [], cursorEntryId: 'dir-1' as never }]]),
      getDirectories: () =>
        new Map([['pane-a:tab', { entries: [cursorDir] } as unknown as PaneDirectoryView]]),
    });
    createGlobalKeydownHandler(context)(keydown('ArrowUp', { ctrlKey: true }));
    expect(openTabAt).toHaveBeenCalledWith(PANE_A, cursorDir.location);
  });

  it('Ctrl+Shift+Up opens the directory under the cursor as a new tab in the other pane', () => {
    const openTabAt = vi.fn();
    const cursorDir: EntrySummary = {
      id: 'dir-1' as never,
      location: { providerId: 'local', uri: 'file:///a/dir' },
      name: 'dir',
      kind: 'directory',
      hidden: false,
      readOnly: false,
      metadataRevision: 0,
    };
    const context = makeContext({
      getTabController: () => ({ openTabAt, closeAllTabs: vi.fn() }) as unknown as TabController,
      getSelections: () =>
        new Map([['pane-a:tab', { selectedEntryIds: [], cursorEntryId: 'dir-1' as never }]]),
      getDirectories: () =>
        new Map([['pane-a:tab', { entries: [cursorDir] } as unknown as PaneDirectoryView]]),
    });
    createGlobalKeydownHandler(context)(keydown('ArrowUp', { ctrlKey: true, shiftKey: true }));
    expect(openTabAt).toHaveBeenCalledWith(PANE_B, cursorDir.location);
  });

  it('Ctrl+Left duplicates the active location into the other pane', () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const context = makeContext({
      getNavigation: () => ({ navigate }) as unknown as NavigationController,
    });
    createGlobalKeydownHandler(context)(keydown('ArrowLeft', { ctrlKey: true }));
    expect(navigate).toHaveBeenCalledWith(PANE_B, { providerId: 'local', uri: 'file:///a/b/c' });
  });

  it('Ctrl+U swaps the two panes active locations (desktop runtime - Ctrl+U is browser-reserved)', () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const locA: Location = { providerId: 'local', uri: 'file:///left' };
    const locB: Location = { providerId: 'local', uri: 'file:///right' };
    const context = makeContext({
      getKeybindingRuntime: () => 'desktop',
      getNavigation: () => ({ navigate }) as unknown as NavigationController,
      getDirectories: () =>
        new Map([
          ['pane-a:tab', { location: locA } as unknown as PaneDirectoryView],
          ['pane-b:tab', { location: locB } as unknown as PaneDirectoryView],
        ]),
    });
    createGlobalKeydownHandler(context)(keydown('u', { ctrlKey: true }));
    expect(navigate).toHaveBeenCalledWith(PANE_A, locB);
    expect(navigate).toHaveBeenCalledWith(PANE_B, locA);
  });

  it('Ctrl+U does nothing in browser runtime (Chrome reserves it for View Source)', () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const context = makeContext({
      getKeybindingRuntime: () => 'browser',
      getNavigation: () => ({ navigate }) as unknown as NavigationController,
    });
    createGlobalKeydownHandler(context)(keydown('u', { ctrlKey: true }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+U swaps the two panes tab sets', () => {
    const swapPaneTabSets = vi.fn();
    const context = makeContext({ swapPaneTabSets });
    createGlobalKeydownHandler(context)(keydown('u', { ctrlKey: true, shiftKey: true }));
    expect(swapPaneTabSets).toHaveBeenCalledWith(PANE_A, PANE_B);
  });

  it('Ctrl+Shift+W closes every tab except the active one', () => {
    const closeAllTabs = vi.fn();
    const context = makeContext({
      getTabController: () => ({ openTabAt: vi.fn(), closeAllTabs }) as unknown as TabController,
    });
    createGlobalKeydownHandler(context)(keydown('w', { ctrlKey: true, shiftKey: true }));
    expect(closeAllTabs).toHaveBeenCalledWith(PANE_A);
  });

  it('Ctrl+N opens the new-connection dialog (desktop runtime - Ctrl+N is browser-reserved)', () => {
    const setConnectionsManagerOpen = vi.fn();
    const context = makeContext({
      getKeybindingRuntime: () => 'desktop',
      setConnectionsManagerOpen,
    });
    createGlobalKeydownHandler(context)(keydown('n', { ctrlKey: true }));
    expect(setConnectionsManagerOpen).toHaveBeenCalledWith(true);
  });

  it('Ctrl+N does nothing in browser runtime (Chrome reserves it for a new window)', () => {
    const setConnectionsManagerOpen = vi.fn();
    const context = makeContext({
      getKeybindingRuntime: () => 'browser',
      setConnectionsManagerOpen,
    });
    createGlobalKeydownHandler(context)(keydown('n', { ctrlKey: true }));
    expect(setConnectionsManagerOpen).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+S reactivates the last non-empty Quick Filter query', () => {
    const setActiveTabQuickFilter = vi.fn();
    const context = makeContext({
      getLastQuickFilterQuery: () => 'report',
      setActiveTabQuickFilter,
    });
    createGlobalKeydownHandler(context)(keydown('s', { ctrlKey: true, shiftKey: true }));
    expect(setActiveTabQuickFilter).toHaveBeenCalledWith(PANE_A, 'report');
  });

  it('Ctrl+Shift+S does nothing when no prior query was cached', () => {
    const setActiveTabQuickFilter = vi.fn();
    const context = makeContext({
      getLastQuickFilterQuery: () => undefined,
      setActiveTabQuickFilter,
    });
    createGlobalKeydownHandler(context)(keydown('s', { ctrlKey: true, shiftKey: true }));
    expect(setActiveTabQuickFilter).not.toHaveBeenCalled();
  });

  it('Ctrl+F10 clears the active Quick Filter', () => {
    const setActiveTabQuickFilter = vi.fn();
    const context = makeContext({ setActiveTabQuickFilter });
    createGlobalKeydownHandler(context)(keydown('F10', { ctrlKey: true }));
    expect(setActiveTabQuickFilter).toHaveBeenCalledWith(PANE_A, undefined);
  });

  it('Ctrl+F3 sorts the active pane by name', () => {
    const setSort = vi.fn();
    const context = makeContext({ setSort });
    createGlobalKeydownHandler(context)(keydown('F3', { ctrlKey: true }));
    expect(setSort).toHaveBeenCalledWith(PANE_A, [
      { columnId: 'core.name', direction: 'ascending' },
    ]);
  });

  it('Shift+F4 opens the create-file dialog', () => {
    const setCreateFileOpen = vi.fn();
    const context = makeContext({ setCreateFileOpen });
    createGlobalKeydownHandler(context)(keydown('F4', { shiftKey: true }));
    expect(setCreateFileOpen).toHaveBeenCalledWith(true);
  });

  it('Shift+F5 duplicates the selected entries', async () => {
    const duplicate = vi.fn().mockResolvedValue({});
    const src: Location = { providerId: 'local', uri: 'file:///a.txt' };
    const context = makeContext({
      selectedLocations: () => [src],
      getOpsController: () => ({ duplicate }) as unknown as OperationsController,
    });
    createGlobalKeydownHandler(context)(keydown('F5', { shiftKey: true }));
    await Promise.resolve();
    expect(duplicate).toHaveBeenCalledWith([src]);
  });

  it('Ctrl+M opens the Multi-Rename Tool directly', () => {
    const openMultiRenameForActivePane = vi.fn();
    const context = makeContext({ openMultiRenameForActivePane });
    createGlobalKeydownHandler(context)(keydown('m', { ctrlKey: true }));
    expect(openMultiRenameForActivePane).toHaveBeenCalled();
  });

  it('Alt+F4 quits in desktop runtime', () => {
    const quitApplication = vi.fn();
    const context = makeContext({ getKeybindingRuntime: () => 'desktop', quitApplication });
    createGlobalKeydownHandler(context)(keydown('F4', { altKey: true }));
    expect(quitApplication).toHaveBeenCalled();
  });

  it('Alt+F4 is a no-op in browser runtime', () => {
    const quitApplication = vi.fn();
    const context = makeContext({ getKeybindingRuntime: () => 'browser', quitApplication });
    createGlobalKeydownHandler(context)(keydown('F4', { altKey: true }));
    expect(quitApplication).not.toHaveBeenCalled();
  });

  it('Shift+F2 starts a directory comparison', () => {
    const startComparison = vi.fn();
    const context = makeContext({ startComparison });
    createGlobalKeydownHandler(context)(keydown('F2', { shiftKey: true }));
    expect(startComparison).toHaveBeenCalled();
  });

  it('F1 opens the shortcuts help overlay', () => {
    const setShortcutsHelpOpen = vi.fn();
    const context = makeContext({ setShortcutsHelpOpen });
    createGlobalKeydownHandler(context)(keydown('F1'));
    expect(setShortcutsHelpOpen).toHaveBeenCalledWith(true);
  });
});
