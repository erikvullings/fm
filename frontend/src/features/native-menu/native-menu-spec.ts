import type {
  ActionDescriptor,
  NativeMenu,
  NativeMenuItem,
  NativeMenuSpec,
  PaneId,
  TabId,
} from '../../models';

/** One open tab, flattened for the Window menu (task 0133). */
export interface NativeMenuTab {
  readonly paneId: PaneId;
  readonly tabId: TabId;
  /** The composite `${paneId}:${tabId}` key app-shell.ts already keys its per-tab caches by
   * (see its `tabKey` helper) - reused here so a menu click can be routed back to the exact tab
   * without re-deriving the encoding. */
  readonly tabKey: string;
  readonly title: string;
  readonly active: boolean;
}

/** Inputs the pure spec-builder needs; all sourced from app-shell.ts's own closures. */
export interface NativeMenuInputs {
  /** `registeredActions` - File/Edit/View/Help items are looked up from here. */
  readonly actions: readonly ActionDescriptor[];
  /** `favouriteActions()`'s output (`core.favourites` plus one `core.favourite.<index>` per
   * saved location) - the Go menu is built from this alone, not `actions`. */
  readonly favouriteActions: readonly ActionDescriptor[];
  /** Every open tab across every pane, in display order. */
  readonly tabs: readonly NativeMenuTab[];
}

const PREFERENCES_SHORTCUT = { key: ',', meta: true } as const;

function findAction(
  actions: readonly ActionDescriptor[],
  id: string,
): ActionDescriptor | undefined {
  return actions.find((action) => action.id === id);
}

function actionItem(action: ActionDescriptor): NativeMenuItem {
  const shortcut = action.defaultShortcuts[0];
  return {
    kind: 'action',
    id: action.id,
    title: action.title,
    ...(shortcut === undefined ? {} : { shortcut }),
    enabled: true,
    checked: false,
  };
}

/** Looks up each id in `actions`; ids that aren't currently registered (capabilities/plugins can
 * change what's registered) are silently skipped rather than crashing the whole menu. */
function actionItems(
  actions: readonly ActionDescriptor[],
  ids: readonly string[],
): NativeMenuItem[] {
  const items: NativeMenuItem[] = [];
  for (const id of ids) {
    const action = findAction(actions, id);
    if (action !== undefined) items.push(actionItem(action));
  }
  return items;
}

function appMenu(): NativeMenu {
  return {
    // The platform adapter also uses this as the process's displayed name (task 0133 follow-up),
    // so AppKit's bold app-menu title reads "Procyon" even in an unbundled `cargo tauri dev` run,
    // matching the title bar label elsewhere in this file.
    title: 'Procyon',
    items: [
      { kind: 'role', role: 'about' },
      { kind: 'separator' },
      {
        kind: 'action',
        id: 'ui.openSettings',
        title: 'Preferences…',
        shortcut: PREFERENCES_SHORTCUT,
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
    ],
  };
}

function fileMenu(actions: readonly ActionDescriptor[]): NativeMenu {
  return { title: 'File', items: actionItems(actions, ['core.newTab', 'core.closeTab']) };
}

/** Only Copy/Paste/Select All: this app has no Undo/Redo feature and no Cut action anywhere in
 * the registry. Native AppKit already gives Cut/Copy/Paste/Undo inside text fields (e.g. the
 * Preferences dialog) for free via the standard responder chain - no menu wiring needed there. */
function editMenu(actions: readonly ActionDescriptor[]): NativeMenu {
  return {
    title: 'Edit',
    items: actionItems(actions, ['core.copy', 'core.paste', 'core.selectAll']),
  };
}

/** The registry has no dedicated "view" category; the closest genuinely view-related actions are
 * the sort-order toggles (categorized "navigation" on the backend, but they change how the
 * listing displays, not where it navigates). */
function viewMenu(actions: readonly ActionDescriptor[]): NativeMenu {
  return {
    title: 'View',
    items: actionItems(actions, [
      'core.sortByName',
      'core.sortByExtension',
      'core.sortByDate',
      'core.sortBySize',
      'core.sortUnsorted',
    ]),
  };
}

/** Excludes `core.favourites` itself: invoking it opens the command palette pre-filtered to
 * favourites (its intended behaviour from the palette/keyboard), which makes no sense as a native
 * menu item - the Go menu already lists each saved favourite as its own `core.favourite.<index>`
 * item below, so it's the menu itself acting as the favourites browser, not a launcher for one. */
function goMenu(favouriteActions: readonly ActionDescriptor[]): NativeMenu {
  return {
    title: 'Go',
    items: favouriteActions.filter((action) => action.id !== 'core.favourites').map(actionItem),
  };
}

function windowMenu(tabs: readonly NativeMenuTab[]): NativeMenu {
  const items: NativeMenuItem[] = [
    { kind: 'role', role: 'minimize' },
    { kind: 'role', role: 'zoom' },
  ];
  if (tabs.length > 0) {
    items.push({ kind: 'separator' });
    for (const tab of tabs) {
      items.push({
        kind: 'action',
        id: `ui.window.tab.${tab.tabKey}`,
        title: tab.title,
        enabled: true,
        checked: tab.active,
      });
    }
  }
  return { title: 'Window', items };
}

function helpMenu(actions: readonly ActionDescriptor[]): NativeMenu {
  return { title: 'Help', items: actionItems(actions, ['core.showShortcutsHelp']) };
}

/**
 * Pure function computing the full native menu bar spec from app-shell.ts's own state. No I/O:
 * the caller diffs the result against what it last pushed and only then calls
 * `invoke('set_native_menu', ...)` (see `syncNativeMenu` in app-shell.ts).
 */
export function buildNativeMenuSpec(inputs: NativeMenuInputs): NativeMenuSpec {
  return {
    menus: [
      appMenu(),
      fileMenu(inputs.actions),
      editMenu(inputs.actions),
      viewMenu(inputs.actions),
      goMenu(inputs.favouriteActions),
      windowMenu(inputs.tabs),
      helpMenu(inputs.actions),
    ],
  };
}
