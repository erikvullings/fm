import type { ActionDescriptor, PaneId, SortDescriptor, WorkspaceId } from '../../models';
import { SORT_SHORTCUT_DESCRIPTORS } from '../keybindings/global-keydown-handler';

/** Frontend-local id for the App menu's Preferences item; never an action-registry id (there is
 * no `core.preferences` backend action - Preferences is, and must remain, a pure UI toggle). */
export const OPEN_SETTINGS_MENU_ID = 'ui.openSettings';

/** Prefix for a Window-menu tab item's id, followed by the tab's `${paneId}:${tabId}` key. */
export const WINDOW_TAB_MENU_ID_PREFIX = 'ui.window.tab.';

/** File menu's "New Window" item; never an action-registry id, like `OPEN_SETTINGS_MENU_ID` -
 * opening a workspace in a new OS window (task 0143) is desktop-window plumbing, not a backend
 * action. */
export const NEW_WORKSPACE_WINDOW_MENU_ID = 'ui.newWorkspaceWindow';

/** Prefix for the Window menu's "Open Workspace" submenu item ids, followed by the target
 * workspace's id - opens that workspace in its own OS window, mirroring the workspace switcher's
 * "open in new window" button (task 0143 follow-up). */
export const WINDOW_OPEN_WORKSPACE_MENU_ID_PREFIX = 'ui.window.openWorkspace.';

/** Context the click router needs; kept minimal so it's independently testable from app-shell.ts's
 * closures rather than left inline and untestable. */
export interface NativeMenuDispatchContext {
  /** Looked up by id for anything that isn't a frontend-local menu id - typically
   * `actionsWithFavourites()`, since the Go menu's favourites are synthetic entries not present in
   * the plain action registry. */
  readonly findAction: (id: string) => ActionDescriptor | undefined;
  readonly openSettingsDialog: () => void;
  /** Activates the tab encoded in a `ui.window.tab.<tabKey>` id (the `${paneId}:${tabId}` key
   * app-shell.ts's tab caches are keyed by). */
  readonly activateTabByKey: (tabKey: string) => void;
  /** The pane the sort-menu items apply to - same "active pane" concept the Ctrl+F3..Ctrl+F7
   * shortcuts use (`activeDirectory()`'s `paneId` in app-shell.ts). */
  readonly activePaneId: () => PaneId | undefined;
  /** Applies a sort-menu item's fixed sort to a pane - the same local view-state update the
   * Ctrl+F3..Ctrl+F7 shortcuts make (`GlobalKeydownContext.setSort`), not a backend action
   * dispatch: `core.sortByName` etc. have no backend effect to invoke, exactly like
   * `core.preferences` has none - sorting is frontend-owned workspace view state. */
  readonly setSort: (paneId: PaneId, sort: readonly SortDescriptor[]) => void;
  /** The single dispatch function already used by the command palette/context menu
   * (`action-command-controller.ts`'s `invokePaletteAction`) - reused here rather than duplicated
   * or bypassed, so its `core.favourites`/`core.favourite.N`/`core.createDirectory`/clipboard
   * special-casing stays in exactly one place. */
  readonly invokeAction: (action: ActionDescriptor) => void;
  /** Opens the current workspace in a new OS window (task 0143); absent on hosts with no window
   * concept, in which case `NEW_WORKSPACE_WINDOW_MENU_ID` clicks are silently ignored - the item
   * is never added to the menu spec on those hosts in the first place (see
   * `native-menu-spec.ts`'s `NativeMenuInputs.canOpenNewWindow`), so this should be unreachable in
   * practice. */
  readonly openNewWorkspaceWindow?: () => void;
  /** Opens the given workspace (any workspace, not just the current one) in its own OS window -
   * backs the Window menu's "Open Workspace" submenu. Same desktop-only absence rule as
   * `openNewWorkspaceWindow`. */
  readonly openWorkspaceWindowById?: (workspaceId: WorkspaceId) => void;
}

/**
 * Routes one `{ id }` click received from the native menu bar's `subscribe_native_menu_actions`
 * channel. A stale id from a menu the backend hasn't rebuilt yet is a silent no-op, never a throw.
 */
export function dispatchNativeMenuAction(context: NativeMenuDispatchContext, id: string): void {
  if (id === OPEN_SETTINGS_MENU_ID) {
    context.openSettingsDialog();
    return;
  }
  if (id.startsWith(WINDOW_TAB_MENU_ID_PREFIX)) {
    context.activateTabByKey(id.slice(WINDOW_TAB_MENU_ID_PREFIX.length));
    return;
  }
  if (id === NEW_WORKSPACE_WINDOW_MENU_ID) {
    context.openNewWorkspaceWindow?.();
    return;
  }
  if (id.startsWith(WINDOW_OPEN_WORKSPACE_MENU_ID_PREFIX)) {
    context.openWorkspaceWindowById?.(
      id.slice(WINDOW_OPEN_WORKSPACE_MENU_ID_PREFIX.length) as WorkspaceId,
    );
    return;
  }
  if (id in SORT_SHORTCUT_DESCRIPTORS) {
    const paneId = context.activePaneId();
    if (paneId === undefined) return;
    context.setSort(paneId, SORT_SHORTCUT_DESCRIPTORS[id] ?? []);
    return;
  }
  const action = context.findAction(id);
  if (action === undefined) return;
  context.invokeAction(action);
}
