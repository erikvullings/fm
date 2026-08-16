import { describe, expect, it, vi } from 'vitest';

import type { ActionDescriptor, PaneId, SortDescriptor } from '../../models';
import {
  dispatchNativeMenuAction,
  type NativeMenuDispatchContext,
  NEW_WORKSPACE_WINDOW_MENU_ID,
  OPEN_SETTINGS_MENU_ID,
} from './native-menu-dispatch';

function action(id: string): ActionDescriptor {
  return {
    id,
    title: id,
    category: 'test',
    defaultShortcuts: [],
    contextRequirements: {},
    source: { kind: 'core' },
  };
}

interface ContextMocks {
  readonly findAction: ReturnType<typeof vi.fn<(id: string) => ActionDescriptor | undefined>>;
  readonly openSettingsDialog: ReturnType<typeof vi.fn<() => void>>;
  readonly activateTabByKey: ReturnType<typeof vi.fn<(tabKey: string) => void>>;
  readonly activePaneId: ReturnType<typeof vi.fn<() => PaneId | undefined>>;
  readonly setSort: ReturnType<
    typeof vi.fn<(paneId: PaneId, sort: readonly SortDescriptor[]) => void>
  >;
  readonly invokeAction: ReturnType<typeof vi.fn<(action: ActionDescriptor) => void>>;
  readonly openNewWorkspaceWindow: ReturnType<typeof vi.fn<() => void>>;
}

function contextMocks(
  paneId?: PaneId,
): ContextMocks & { readonly context: NativeMenuDispatchContext } {
  const findAction = vi.fn<(id: string) => ActionDescriptor | undefined>(() => undefined);
  const openSettingsDialog = vi.fn<() => void>();
  const activateTabByKey = vi.fn<(tabKey: string) => void>();
  const activePaneId = vi.fn<() => PaneId | undefined>(() => paneId);
  const setSort = vi.fn<(paneId: PaneId, sort: readonly SortDescriptor[]) => void>();
  const invokeAction = vi.fn<(action: ActionDescriptor) => void>();
  const openNewWorkspaceWindow = vi.fn<() => void>();
  return {
    findAction,
    openSettingsDialog,
    activateTabByKey,
    activePaneId,
    setSort,
    invokeAction,
    openNewWorkspaceWindow,
    context: {
      findAction,
      openSettingsDialog,
      activateTabByKey,
      activePaneId,
      setSort,
      invokeAction,
      openNewWorkspaceWindow,
    },
  };
}

describe('dispatchNativeMenuAction', () => {
  it('opens Settings for the frontend-local ui.openSettings id without touching the registry', () => {
    const mocks = contextMocks();
    dispatchNativeMenuAction(mocks.context, OPEN_SETTINGS_MENU_ID);
    expect(mocks.openSettingsDialog).toHaveBeenCalledOnce();
    expect(mocks.activateTabByKey).not.toHaveBeenCalled();
    expect(mocks.invokeAction).not.toHaveBeenCalled();
  });

  it('activates the tab encoded after the ui.window.tab. prefix', () => {
    const mocks = contextMocks();
    dispatchNativeMenuAction(mocks.context, 'ui.window.tab.pane-1:tab-2');
    expect(mocks.activateTabByKey).toHaveBeenCalledExactlyOnceWith('pane-1:tab-2');
    expect(mocks.openSettingsDialog).not.toHaveBeenCalled();
    expect(mocks.invokeAction).not.toHaveBeenCalled();
  });

  it('opens a new workspace window for the frontend-local ui.newWorkspaceWindow id', () => {
    const mocks = contextMocks();
    dispatchNativeMenuAction(mocks.context, NEW_WORKSPACE_WINDOW_MENU_ID);
    expect(mocks.openNewWorkspaceWindow).toHaveBeenCalledOnce();
    expect(mocks.invokeAction).not.toHaveBeenCalled();
  });

  it('looks up any other id in the action registry and invokes it via invokePaletteAction', () => {
    const copy = action('core.copy');
    const mocks = contextMocks();
    mocks.findAction.mockImplementation((id) => (id === 'core.copy' ? copy : undefined));
    dispatchNativeMenuAction(mocks.context, 'core.copy');
    expect(mocks.invokeAction).toHaveBeenCalledExactlyOnceWith(copy);
  });

  it('silently no-ops for a stale id no longer present in the registry', () => {
    const mocks = contextMocks();
    expect(() => dispatchNativeMenuAction(mocks.context, 'core.longRemovedAction')).not.toThrow();
    expect(mocks.invokeAction).not.toHaveBeenCalled();
    expect(mocks.openSettingsDialog).not.toHaveBeenCalled();
    expect(mocks.activateTabByKey).not.toHaveBeenCalled();
    expect(mocks.openNewWorkspaceWindow).not.toHaveBeenCalled();
  });

  it('applies a sort-menu id as a local setSort call to the active pane, not a registry dispatch', () => {
    const mocks = contextMocks('pane-1' as PaneId);
    dispatchNativeMenuAction(mocks.context, 'core.sortByName');
    expect(mocks.setSort).toHaveBeenCalledExactlyOnceWith('pane-1', [
      { columnId: 'core.name', direction: 'ascending' },
    ]);
    expect(mocks.invokeAction).not.toHaveBeenCalled();
    expect(mocks.findAction).not.toHaveBeenCalled();
  });

  it('applies core.sortUnsorted as an empty sort', () => {
    const mocks = contextMocks('pane-1' as PaneId);
    dispatchNativeMenuAction(mocks.context, 'core.sortUnsorted');
    expect(mocks.setSort).toHaveBeenCalledExactlyOnceWith('pane-1', []);
  });

  it('no-ops a sort-menu click when there is no active pane', () => {
    const mocks = contextMocks(undefined);
    dispatchNativeMenuAction(mocks.context, 'core.sortByName');
    expect(mocks.setSort).not.toHaveBeenCalled();
  });
});
