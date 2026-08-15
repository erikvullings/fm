import type { ActionDescriptor } from '../../models';

/** Frontend-local id for the App menu's Preferences item; never an action-registry id (there is
 * no `core.preferences` backend action - Preferences is, and must remain, a pure UI toggle). */
export const OPEN_SETTINGS_MENU_ID = 'ui.openSettings';

/** Prefix for a Window-menu tab item's id, followed by the tab's `${paneId}:${tabId}` key. */
export const WINDOW_TAB_MENU_ID_PREFIX = 'ui.window.tab.';

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
  /** The single dispatch function already used by the command palette/context menu
   * (`action-command-controller.ts`'s `invokePaletteAction`) - reused here rather than duplicated
   * or bypassed, so its `core.favourites`/`core.favourite.N`/`core.createDirectory`/clipboard
   * special-casing stays in exactly one place. */
  readonly invokeAction: (action: ActionDescriptor) => void;
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
  const action = context.findAction(id);
  if (action === undefined) return;
  context.invokeAction(action);
}
