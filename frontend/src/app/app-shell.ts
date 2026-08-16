import m, { type FactoryComponent } from 'mithril';
import { IconButton, type Theme, ThemeManager, toast } from 'mithril-materialized';

import type { FileManagerClient } from '../api/client/file-manager-client';
import {
  activityIcon,
  arrowLeftIcon,
  arrowRightIcon,
  closeIcon,
  commandIcon,
  compareIcon,
  cornerLeftUpIcon,
  layoutGridIcon,
  searchIcon,
  settingsIcon,
} from '../components/tabler-icons';
import { tooltip } from '../components/tooltip';
import {
  type ActionCommandController,
  type ActionCommandControllerContext,
  createActionCommandController,
} from '../features/actions/action-command-controller';
import {
  type ChecksumController,
  type ChecksumControllerContext,
  createChecksumController,
} from '../features/checksums/checksum-controller';
import { ChecksumResultsView } from '../features/checksums/checksum-results-view';
import {
  type ChecksumState,
  type DuplicateState,
  initialChecksumState,
  initialDuplicateState,
  totalReclaimableBytes,
  wouldDeleteEveryCopy,
} from '../features/checksums/checksum-state';
import { DuplicateReviewView } from '../features/checksums/duplicate-review-view';
import { emptyClipboard } from '../features/clipboard/clipboard';
import { CommandPalette } from '../features/command-palette/command-palette';
import {
  evaluateActionAvailability,
  menuActionsForContext,
} from '../features/commands/availability';
import { ContextMenu as DirectoryContextMenu } from '../features/commands/context-menu';
import {
  type ComparisonController,
  type ComparisonControllerContext,
  createComparisonController,
} from '../features/comparison/comparison-controller';
import {
  type ComparisonState,
  differingEntryIds,
  initialComparisonState,
} from '../features/comparison/comparison-state';
import { DiagnosticsViewComponent } from '../features/diagnostics/diagnostics-view';
import { type AppDialogsContext, renderAppDialogs } from '../features/dialogs/app-dialogs';
import { createDialogUIController } from '../features/dialogs/dialog-ui-controller';
import type { NativeIconLoader } from '../features/directory-table/native-icon-loader';
import {
  createFileEditorController,
  type FileEditorController,
  type FileEditorState,
} from '../features/editor/file-editor-controller';
import {
  DEFAULT_ENTRY_FORMAT_SETTINGS,
  type EntryFormatSettings,
} from '../features/entry-formatting/entry-formatting';
import {
  type BackendEventContext,
  createBackendEventHandler,
} from '../features/events/backend-event-handler';
import { recordRecentLocation } from '../features/favourites/favourites';
import {
  createGlobalKeydownHandler,
  type GlobalKeydownContext,
} from '../features/keybindings/global-keydown-handler';
import { ShortcutsHelpDialog } from '../features/keybindings/shortcuts-help-dialog';
import {
  createNavigationController,
  type NavigationController,
  type PaneDirectoryView,
} from '../features/navigation/navigation';
import { createOperationsState, dismissOperation } from '../features/operations/operation-state';
import {
  createOperationsController,
  type OperationsController,
} from '../features/operations/operations-controller';
import { isParentEntry } from '../features/panes/parent-entry';
import {
  createTabController,
  type TabController,
  type TabControllerContext,
} from '../features/panes/tab-controller';
import {
  createFileViewerController,
  type FileViewerController,
  type FileViewerState,
} from '../features/preview/file-viewer-controller';
import { filterEntries } from '../features/quick-filter/quick-filter';
import {
  createFindFilesController,
  type FindFilesController,
  type FindFilesControllerContext,
} from '../features/search/find-files-controller';
import type { FindFilesSearchParams } from '../features/search/find-files-dialog';
import type { SelectionPlatform } from '../features/selection/keybindings';
import {
  emptySelection,
  getSelectedEntries,
  getSelectedEntriesOrCursor,
  reduceSelection,
  type SelectionState,
} from '../features/selection/selection';
import {
  createSettingsController,
  type SettingsController,
  type SettingsControllerContext,
} from '../features/settings/settings-controller';
import { SettingsEditor } from '../features/settings/settings-editor';
import {
  type SortColumn,
  type SortModel,
  sortEntries,
  sortEntriesResponsive,
} from '../features/sorting/sorting';
import { tauriTerminalClient } from '../features/terminal/terminal-client';
import { TerminalDrawer } from '../features/terminal/terminal-drawer';
import { isTerminalVisible } from '../features/terminal/terminal-state';
import { dispatchWorkspaceCommand } from '../features/workspace/dispatch-workspace-command';
import {
  createPaneContentBuilder,
  type PaneContentContext,
} from '../features/workspace/pane-content-builder';
import {
  createWorkspaceController,
  type WorkspaceController,
  type WorkspaceControllerContext,
} from '../features/workspace/workspace-controller';
import {
  WorkspaceLayoutView,
  type WorkspacePaneContent,
} from '../features/workspace/workspace-layout';
import { sortWorkspaceSummaries } from '../features/workspace/workspace-manager';
import { WorkspaceSwitcher } from '../features/workspace/workspace-switcher';
import { footerFunctionKeyBindings, type KeybindingRuntime } from '../keybindings/dispatcher';
import type {
  ActionDescriptor,
  BackendEvent,
  Connection,
  DirectoryDelta,
  EntrySummary,
  Location,
  OperationConflict,
  OperationId,
  OperationState,
  PaneId,
  PluginDescriptor,
  PluginId,
  PluginLogEntry,
  Settings,
  SortDescriptor,
  SystemLocation,
  TabId,
  TabProjection,
  WorkspaceId,
  WorkspaceLayout,
  WorkspaceProjection,
  WorkspaceSummary,
} from '../models';
import {
  type AppState,
  applyAppPatches,
  cacheContentMatchesPatch,
  clipboardPatch,
  connectionPatch,
  createInitialAppState,
  deleteQuickFilterDraftPatch,
} from '../state';
import type { RuntimeKind } from '../utilities/runtime';

/** Attributes of the application shell. */
export interface AppShellAttrs {
  /** Transport this build talks to, resolved from `VITE_RUNTIME`. */
  runtime: RuntimeKind;
  /** Transport-neutral client selected once by the application bootstrap. */
  client: FileManagerClient;
  /** Settings-owned presentation formats; task 0030 supplies these at bootstrap. */
  entryFormatSettings?: EntryFormatSettings;
}

const DEFAULT_THEME: Theme = 'auto';

/** Applies host-detected mount access metadata to a directory view. */
export function respectSystemLocationReadOnly(
  view: PaneDirectoryView,
  locations: readonly SystemLocation[],
): PaneDirectoryView {
  if (
    view.location === undefined ||
    !locations.some(
      ({ location, readOnly }) =>
        readOnly === true &&
        location.providerId === view.location?.providerId &&
        (location.uri === view.location.uri ||
          view.location.uri.startsWith(
            location.uri.endsWith('/') ? location.uri : `${location.uri}/`,
          )),
    )
  ) {
    return view;
  }
  return { ...view, writable: false };
}

const DISMISSED_OPERATIONS_STORAGE_KEY = 'fm.dismissedOperationIds';
const MAX_DISMISSED_OPERATIONS = 500;

function loadDismissedOperationIds(): Set<OperationId> {
  try {
    const raw = globalThis.localStorage?.getItem(DISMISSED_OPERATIONS_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is OperationId => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

function persistDismissedOperationIds(ids: ReadonlySet<OperationId>): void {
  try {
    const recent = [...ids].slice(-MAX_DISMISSED_OPERATIONS);
    globalThis.localStorage?.setItem(DISMISSED_OPERATIONS_STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // localStorage can be unavailable in some runtimes; in-memory dismissal still works.
  }
}

/** States that auto-dismiss; `failed` is intentionally excluded. */
function isAutoDismissibleState(state: OperationState): boolean {
  return (
    state === 'completed' ||
    state === 'completedWithWarnings' ||
    state === 'cancelled' ||
    state === 'interrupted'
  );
}

/** Converts a displayed breadcrumb path back to its provider-specific location. */
export function locationForPath(current: Location, path: string): Location {
  if (current.providerId === 'archive') {
    const archiveSeparator = path.indexOf('!');
    const outerPath = archiveSeparator < 0 ? path : path.slice(0, archiveSeparator);
    const outerUrl = new URL('file:///');
    outerUrl.pathname = outerPath.replaceAll('\\', '/');
    if (archiveSeparator < 0) {
      return { providerId: 'local', uri: outerUrl.toString() };
    }
    const innerPath = path.slice(archiveSeparator + 1).replace(/^\/+/, '');
    return {
      providerId: 'archive',
      uri: `archive://${outerUrl.toString().slice('file://'.length)}!/${innerPath}`,
    };
  }
  const url = new URL(current.uri);
  url.pathname = path.startsWith('~') ? path : path.replaceAll('\\', '/');
  return { ...current, uri: url.toString() };
}

/**
 * A factory component so that per-instance state lives in the closure rather
 * than on a shared module-level object.
 */
export const AppShell: FactoryComponent<AppShellAttrs> = () => {
  let theme: Theme = DEFAULT_THEME;
  let currentSettings: Settings | undefined;
  let settingsDisclosureElement: HTMLDetailsElement | undefined;
  let settingsDialogOpen = false;
  let diagnosticsDialogOpen = false;
  let diagnosticsDisclosureElement: HTMLDetailsElement | undefined;
  let workspaceDisclosureElement: HTMLDetailsElement | undefined;
  let registeredActions: readonly ActionDescriptor[] = [];
  let systemLocations: readonly SystemLocation[] = [];
  let systemLocationsError: string | undefined;
  const unavailableLocations = new Set<string>();
  let plugins: readonly PluginDescriptor[] = [];
  let connections: readonly Connection[] = [];
  let connectionsManagerOpen = false;
  let shortcutsHelpOpen = false;
  /** Last non-empty Quick Filter query per tab key, for the Ctrl+Shift+S "reactivate" shortcut. */
  const lastQuickFilterQueryByTabKey = new Map<string, string>();

  function favouriteActions(): readonly ActionDescriptor[] {
    const favourites = currentSettings?.favouriteLocations ?? [];
    return [
      {
        id: 'core.favourites',
        title: 'Open favourites',
        description: 'Show saved locations in the command palette',
        category: 'navigation',
        defaultShortcuts: [{ key: 'h', ctrl: true, shift: true }],
        contextRequirements: {},
        source: { kind: 'core' },
      },
      ...favourites.map((favourite, index) => ({
        id: `core.favourite.${index}`,
        title: `Open favourite: ${favourite.label}`,
        description: favourite.location.uri,
        category: 'navigation',
        // TC-style quick-switch-to-saved-location: Ctrl/Cmd+1..9 for the first nine favourites
        // (task 0129's Alt+F1/Alt+F2 "switch panel to a different drive" row — fm has no drive
        // concept, but jumping to a saved favourite location is the closest equivalent).
        defaultShortcuts: index < 9 ? [{ key: String(index + 1), ctrl: true }] : [],
        contextRequirements: {},
        source: { kind: 'core' as const },
      })),
    ];
  }

  function actionsWithFavourites(): readonly ActionDescriptor[] {
    return [...registeredActions, ...favouriteActions()];
  }
  let installedIconThemeId: string | undefined;
  let keybindingRuntime: KeybindingRuntime = 'browser';
  let runtimeKind: RuntimeKind = 'http';
  let loadedEntryFormatSettings: EntryFormatSettings = DEFAULT_ENTRY_FORMAT_SETTINGS;
  let workspace: WorkspaceProjection | undefined;
  let workspaceError: string | undefined;
  let workspaceSummaries: readonly WorkspaceSummary[] = [];
  let workspaceActionError: string | undefined;
  let flushPendingLayoutUpdate: (() => void) | undefined;
  const dialogs = createDialogUIController();
  let findFilesOpen = false;
  let findFilesRoot: Location | undefined;
  let findFilesSearchId: string | undefined;
  let findFilesError: string | undefined;
  let findFilesGeneration = 0;
  const findFilesRootsByLocationUri = new Map<string, Location>();
  /** The query text each `search://` result location was started with, so the breadcrumb/tab can
   * show `search: <query>` instead of the opaque search id in the location's URI. */
  const findFilesQueriesByLocationUri = new Map<string, string>();
  /** The full search params each `search://` result location was started with - kept separately
   * from the display-label map above (which is a plain filename string when one was given, not
   * JSON) so F3's content-query lookup always has a real params object to read, instead of
   * needing to `JSON.parse` a string that usually isn't JSON at all. */
  const findFilesParamsByLocationUri = new Map<string, FindFilesSearchParams>();
  /** Panes with a `search.resultsBatch`-triggered reload already in flight - see the handler
   * below for why this debounce is needed to make results stream in incrementally. */
  const searchBatchReloadInFlight = new Set<PaneId>();
  /** Live directory-comparison overlay state (task 0075). Marks differing entries selected in
   * both panes once a comparison completes, Total-Commander-style, rather than surfacing a
   * separate review dialog. */
  let comparisonState: ComparisonState = initialComparisonState();
  /** Live checksum-job and duplicate-scan state (spec §18, task 0077). */
  let checksumState: ChecksumState = initialChecksumState();
  let duplicateState: DuplicateState = initialDuplicateState();
  /** Registered by `WorkspaceLayoutView` (task 0089): moves DOM focus into a pane so keyboard
   * cursor navigation works immediately, e.g. right after a filename search closes its dialog. */
  let focusPane: ((paneId: PaneId) => void) | undefined;
  let focusTerminal: (() => boolean) | undefined;
  let commandPaletteOpen = false;
  const openTerminalLocations = new Set<string>();
  let openTerminalSupported = false;
  let nativeIconLoader: NativeIconLoader | undefined;
  let contextMenu:
    | {
        readonly paneId: PaneId;
        readonly entries: readonly EntrySummary[];
        readonly x: number;
        readonly y: number;
      }
    | undefined;
  const commandPaletteRecency = new Map<string, number>();
  /**
   * Every per-tab runtime cache below is keyed by a composite `${paneId}:${tabId}`
   * string (see {@link tabKey}) rather than by `PaneId` alone, so switching tabs
   * never bleeds one tab's directory/selection/sort/filter state into another's
   * (spec §37).
   */
  const directories = new Map<string, PaneDirectoryView>();
  const selections = new Map<string, SelectionState>();
  /** The most recently started recursive folder-size walk (task 0071, Ctrl+.) - starting a new
   * one aborts whatever the previous one was still doing, since only one result is ever shown. */
  let folderSizeCalculation: AbortController | undefined;
  /** Lister sessions are owned by tabs, so switching tabs never closes or obscures them. */
  const viewerByTab = new Map<
    string,
    {
      readonly paneId: PaneId;
      readonly tabId: TabId;
      readonly controller: FileViewerController;
      state: FileViewerState;
    }
  >();
  const editorByPane = new Map<
    PaneId,
    { readonly controller: FileEditorController; state: FileEditorState }
  >();
  const sortedEntries = new Map<
    string,
    {
      readonly input: readonly EntrySummary[];
      readonly key: string;
      readonly entries: readonly EntrySummary[];
    }
  >();
  const sortRequests = new Map<string, object>();
  // Tokens guarding the async "moveCursorTo last" flow (pane-content-builder's onSelectionAction):
  // loading every page before landing the cursor takes real time, and if the user issues another
  // selection action (e.g. presses Up) before it resolves, the stale resolution must not clobber
  // whatever the newer action already set. Cleared/replaced by pane-content-builder itself.
  const cursorLoadTokens = new Map<string, object>();
  /** Whether the inline quick-filter box is shown for a pane, independent of a persisted query. */
  const quickFilterOpen = new Map<string, boolean>();
  const filteredEntries = new Map<
    string,
    {
      readonly input: readonly EntrySummary[];
      readonly query: string;
      readonly entries: readonly EntrySummary[];
    }
  >();
  /** Pending confirmation for closing a pane's only remaining tab (spec §37). */
  let closeTabConfirmation: { readonly paneId: PaneId; readonly tabId: TabId } | undefined;
  let platform: SelectionPlatform = 'unknown';
  let nativeDragOutSupported = false;
  let nativeDropInProgress = false;
  let draggedLocations: readonly Location[] = [];
  let workspaceRequest: AbortController | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  let unsubscribeNativeFileDrops: (() => void) | undefined;
  let unsubscribeConnection: (() => void) | undefined;
  let unsubscribeResynchronise: (() => void) | undefined;
  let appState: AppState | undefined;
  let operations = createOperationsState();
  let pendingConflict: OperationConflict | undefined;
  let clipboardMessage: string | undefined;
  let pendingOperationEvents: BackendEvent[] = [];
  let operationFrame: number | undefined;
  const autoDismissTimers = new Map<OperationId, ReturnType<typeof setTimeout>>();
  const dismissedOperationIds = loadDismissedOperationIds();
  let removed = false;

  function rememberDismissedOperation(operationId: OperationId): void {
    dismissedOperationIds.add(operationId);
    persistDismissedOperationIds(dismissedOperationIds);
  }

  function clearDismissedOperation(operationId: OperationId): void {
    if (!dismissedOperationIds.delete(operationId)) return;
    persistDismissedOperationIds(dismissedOperationIds);
  }

  /** (Re)schedules an operation to auto-dismiss unless it's manually dismissed first. */
  function scheduleAutoDismiss(operationId: OperationId, delayMs: number): void {
    const existing = autoDismissTimers.get(operationId);
    if (existing !== undefined) clearTimeout(existing);
    autoDismissTimers.set(
      operationId,
      setTimeout(() => {
        autoDismissTimers.delete(operationId);
        const current = operations.byId[operationId];
        if (current !== undefined && isAutoDismissibleState(current.state)) {
          operations = dismissOperation(operations, operationId);
          m.redraw();
        }
      }, delayMs),
    );
  }

  /** Clears a pending auto-dismiss timer, e.g. once the user dismisses manually. */
  function cancelAutoDismiss(operationId: OperationId): void {
    const existing = autoDismissTimers.get(operationId);
    if (existing === undefined) return;
    clearTimeout(existing);
    autoDismissTimers.delete(operationId);
  }
  const DEFAULT_SORT: readonly SortDescriptor[] = [
    { columnId: 'core.name', direction: 'ascending' },
  ];

  /**
   * Applies theme, font size, row height, date/size format and icon theme live (task 0083,
   * extended by task 0092): shared by the initial settings load, the settings editor's live
   * preview, a successful save, and reverting on cancel.
   */
  function applyAppearance(settings: Settings): void {
    settingsController.applyAppearance(settings);
  }

  async function applyShowHiddenFilesToAllTabs(
    client: FileManagerClient,
    showHidden: boolean,
  ): Promise<void> {
    await settingsController.applyShowHiddenFilesToAllTabs(client, showHidden);
  }

  function closeSettingsDialog(): void {
    settingsController.closeSettingsDialog();
  }

  /** Opens the Settings dialog (Cmd+,/Ctrl+,) - mirrors the settings toolbar button's "open"
   * branch (`settingsDisclosureElement.open = true`) rather than toggling, so pressing the
   * shortcut again while already open is a harmless no-op instead of closing it. */
  function openSettingsDialog(): void {
    if (settingsDisclosureElement === undefined || settingsDialogOpen) return;
    settingsDisclosureElement.open = true;
    settingsDialogOpen = true;
  }

  function applyIconTheme(themeId: string): void {
    settingsController.applyIconTheme(themeId);
  }

  const systemThemeQuery: MediaQueryList | undefined =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : undefined;
  function handleSystemThemeChange(): void {
    if (theme === 'auto') settingsController.syncTauriWindowBackground();
  }

  /** Restores real DOM keyboard focus to the active pane whenever the OS window regains it (e.g.
   * alt-tabbing back into the app). Without this, `document.activeElement` is left wherever it was
   * before the app lost focus (often nowhere useful), so the cursor row still *looks* highlighted
   * but arrow keys silently do nothing until the user clicks a row to re-establish focus manually. */
  function handleWindowFocus(): void {
    const activePaneId = workspace?.activePaneId;
    if (activePaneId === undefined) return;
    if (focusPane !== undefined) focusPane(activePaneId);
    else void activatePane(attrsClient, activePaneId);
  }

  async function loadSettings(client: FileManagerClient): Promise<void> {
    await settingsController.loadSettings(client);
  }

  function effectiveSort(sort: readonly SortDescriptor[]): readonly SortDescriptor[] {
    return sort.length === 0 ? DEFAULT_SORT : sort;
  }

  /** Composes the per-tab cache key every runtime-state Map above is keyed by. */
  function tabKey(paneId: PaneId, tabId: TabId): string {
    return `${paneId}:${tabId}`;
  }

  /** The composite key for whichever tab is currently active in `paneId`. */
  function activeTabKey(paneId: PaneId): string {
    const pane = workspace?.panesById[paneId];
    return tabKey(paneId, pane?.activeTabId ?? '');
  }

  function frontendSort(sort: readonly SortDescriptor[]): SortModel {
    const descriptor = sort[0];
    if (descriptor === undefined) return [];
    const columns: Readonly<Record<string, SortColumn>> = {
      'core.name': 'name',
      'core.extension': 'extension',
      'core.size': 'size',
      'core.modified': 'modified',
      'sample.fileAge': 'modified',
    };
    const column = columns[descriptor.columnId];
    return column === undefined ? [] : [{ column, direction: descriptor.direction }];
  }

  function sortLabel(sort: readonly SortDescriptor[]): string {
    const descriptor = sort[0];
    if (descriptor === undefined) return 'Unsorted';
    const labels: Readonly<Record<string, string>> = {
      'core.name': 'Name',
      'core.extension': 'Extension',
      'core.size': 'Size',
      'core.modified': 'Modified',
      'sample.fileAge': 'Age',
    };
    return `${labels[descriptor.columnId] ?? descriptor.columnId} ${descriptor.direction}`;
  }

  function entriesSortedFor(
    key: string,
    entries: readonly EntrySummary[],
    sort: readonly SortDescriptor[],
    foldersFirst: boolean,
  ): readonly EntrySummary[] {
    const cacheKey = JSON.stringify([sort, foldersFirst]);
    const cached = sortedEntries.get(key);
    if (cached?.input === entries && cached.key === cacheKey) {
      return cached.entries;
    }
    const model = frontendSort(sort);
    if (entries.length < 10_000) {
      const sorted = sortEntries(entries, model, foldersFirst);
      sortedEntries.set(key, { input: entries, key: cacheKey, entries: sorted });
      return sorted;
    }
    const request = {};
    sortRequests.set(key, request);
    void sortEntriesResponsive(entries, model, foldersFirst).then((sorted) => {
      if (sortRequests.get(key) === request) {
        sortedEntries.set(key, { input: entries, key: cacheKey, entries: sorted });
        sortRequests.delete(key);
        m.redraw();
      }
    });
    return cached?.entries ?? entries;
  }

  function entriesFilteredFor(
    key: string,
    entries: readonly EntrySummary[],
    query: string,
  ): readonly EntrySummary[] {
    const cached = filteredEntries.get(key);
    if (cached?.input === entries && cached.query === query) {
      return cached.entries;
    }
    const filtered = filterEntries(entries, query);
    filteredEntries.set(key, { input: entries, query, entries: filtered });
    return filtered;
  }

  function quickFilterQueryFor(key: string, tab: TabProjection | undefined): string {
    return appState?.quickFilterDrafts.byTabKey[key] ?? tab?.view.quickFilter?.query ?? '';
  }

  function quickFilterOpenFor(key: string, tab: TabProjection | undefined): boolean {
    return quickFilterOpen.get(key) === true || (tab?.view.quickFilter ?? null) !== null;
  }

  /** If `entry` came from a content-search results tab (`locationUri`) and has content matches,
   * returns the original content-search query so the viewer can pre-populate and highlight it
   * (task 0089 follow-up) - otherwise `undefined`. Shared by both the double-click/Enter open
   * path and the F3 view shortcut, so pressing either while a search result is selected jumps
   * straight to the match instead of opening a blank/unsearched viewer. */
  function contentSearchInitialQuery(
    locationUri: string,
    entry: EntrySummary,
  ):
    | {
        readonly query: string;
        readonly regex: boolean;
        readonly caseSensitive: boolean;
        readonly wholeWord: boolean;
      }
    | undefined {
    const params = findFilesParamsByLocationUri.get(locationUri);
    if (params?.contentQuery === undefined || params.contentQuery === '') return undefined;
    // A directory listing refetched via REST (`navigation.load()`, e.g. after a subsequent
    // search batch or a plain tab switch) never carries `contentMatches` - only the live
    // `search.resultsBatch` SSE event does (`EntrySummaryDto` has no such field) - so fall back
    // to whatever that event most recently cached for this entry's location.
    const matches = entry.contentMatches ?? appState?.contentMatches.byEntryUri[entry.location.uri];
    if (matches === undefined || matches.length === 0) return undefined;
    return {
      query: params.contentQuery,
      regex: params.contentRegex,
      caseSensitive: false,
      wholeWord: true,
    };
  }

  /** Recursively sums `entry`'s size (task 0071's Total Commander-style folder-size key, Ctrl+.)
   * and patches its row's `size` field locally once the walk completes - no backend event/delta is
   * involved, so a result that arrives after the user has navigated elsewhere (the entry no longer
   * present in `paneId`'s current listing) is silently discarded rather than misapplied. Only the
   * most recently started calculation is kept - starting a new one implicitly abandons any previous
   * still in flight (mirrors the single-viewer-at-a-time convention elsewhere in this file). */
  function calculateFolderSize(
    client: FileManagerClient,
    paneId: PaneId,
    entry: EntrySummary,
  ): void {
    folderSizeCalculation?.abort();
    const controller = new AbortController();
    folderSizeCalculation = controller;
    void client
      .calculateFolderSize({ location: entry.location }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const key = activeTabKey(paneId);
        const current = directories.get(key);
        if (current === undefined) return;
        directories.set(key, {
          ...current,
          entries: current.entries.map((candidate) =>
            candidate.id === entry.id ? { ...candidate, size: result.totalBytes } : candidate,
          ),
        });
        m.redraw();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        toast({
          html: `Couldn't calculate the size of "${entry.name}": ${error instanceof Error ? error.message : String(error)}`,
        });
      });
  }

  /** Opens the Lister-style viewer in a new tab in `paneId`. `openMetadata` shows the Alt+Space
   * info panel immediately (used when Alt+Space is pressed with no viewer already open, so the
   * shortcut works from the directory listing too, not just inside an already-open viewer). */
  function openViewer(
    client: FileManagerClient,
    paneId: PaneId,
    entry: EntrySummary,
    initialSearch?: {
      readonly query: string;
      readonly regex: boolean;
      readonly caseSensitive: boolean;
      readonly wholeWord: boolean;
    },
    openMetadata?: boolean,
  ): void {
    const existingViewer = [...viewerByTab.entries()][0];
    if (existingViewer !== undefined) {
      const [key, viewer] = existingViewer;
      if (viewer.state.entry.location.uri === entry.location.uri) {
        closeViewer(viewer.paneId, viewer.tabId);
        return;
      }
      viewer.controller.dispose();
      viewerByTab.delete(key);
      const controller = createFileViewerController({
        client,
        entry,
        ...(workspace ? { workspaceId: workspace.id } : {}),
        ...(initialSearch ? { initialSearch } : {}),
        initialMetadataPanelOpen: openMetadata === true,
        update: (state) => {
          const current = viewerByTab.get(key);
          if (current === undefined) return;
          if (state.status === 'unsupported') {
            closeViewer(viewer.paneId, viewer.tabId);
            toast({
              html: `Preview not available for "${entry.name}". Press Alt+F3 to open it in the default application.`,
            });
            return;
          }
          current.state = state;
          m.redraw();
        },
      });
      viewerByTab.set(key, {
        paneId: viewer.paneId,
        tabId: viewer.tabId,
        controller,
        state: { status: 'loading', entry },
      });
      tabController.activateTab(viewer.paneId, viewer.tabId);
      m.redraw();
      return;
    }
    const currentWorkspace = workspace;
    const pane = currentWorkspace?.panesById[paneId];
    const activeTab = pane?.tabsById[pane.activeTabId];
    if (currentWorkspace === undefined || activeTab === undefined) return;
    void dispatchWorkspaceCommand(
      client,
      {
        type: 'addTab',
        workspaceId: currentWorkspace.id,
        paneId,
        location: activeTab.location,
        expectedRevision: currentWorkspace.revision,
      },
      (next) => {
        replaceWorkspace(next);
        const tabId = next.panesById[paneId]?.activeTabId;
        if (tabId === undefined) return;
        const key = tabKey(paneId, tabId);
        const controller = createFileViewerController({
          client,
          entry,
          workspaceId: currentWorkspace.id,
          ...(initialSearch ? { initialSearch } : {}),
          initialMetadataPanelOpen: openMetadata === true,
          update: (state) => {
            const existing = viewerByTab.get(key);
            if (existing === undefined) return;
            if (state.status === 'unsupported') {
              closeViewer(paneId, tabId);
              toast({
                html: `Preview not available for "${entry.name}". Press Alt+F3 to open it in the default application.`,
              });
              return;
            }
            existing.state = state;
            m.redraw();
          },
        });
        viewerByTab.set(key, {
          paneId,
          tabId,
          controller,
          state: { status: 'loading', entry },
        });
        m.redraw();
      },
    ).catch(() => undefined);
  }

  function closeViewer(paneId: PaneId, tabId?: TabId): void {
    const resolvedTabId = tabId ?? workspace?.panesById[paneId]?.activeTabId;
    if (resolvedTabId === undefined) return;
    const key = tabKey(paneId, resolvedTabId);
    const viewer = viewerByTab.get(key);
    if (viewer === undefined) return;
    viewer.controller.dispose();
    viewerByTab.delete(key);
    tabController.performCloseTab(paneId, resolvedTabId);
  }

  function openEditor(client: FileManagerClient, paneId: PaneId, entry: EntrySummary): void {
    closeViewer(paneId);
    editorByPane.get(paneId)?.controller.dispose();
    const controller = createFileEditorController({
      client,
      entry,
      update: (state) => {
        const existing = editorByPane.get(paneId);
        if (existing !== undefined) {
          existing.state = state;
          m.redraw();
        }
      },
    });
    editorByPane.set(paneId, { controller, state: { status: 'loading', entry } });
    m.redraw();
  }

  function closeEditor(paneId: PaneId): void {
    editorByPane.get(paneId)?.controller.dispose();
    editorByPane.delete(paneId);
    m.redraw();
  }

  let navigation: NavigationController;

  /** Clears every per-tab runtime cache for a closed tab, cancelling its in-flight request. */
  function clearTabState(paneId: PaneId, tabId: TabId): void {
    const key = tabKey(paneId, tabId);
    viewerByTab.get(key)?.controller.dispose();
    viewerByTab.delete(key);
    navigation.abort(paneId, tabId);
    directories.delete(key);
    selections.delete(key);
    sortedEntries.delete(key);
    sortRequests.delete(key);
    if (appState !== undefined)
      appState = applyAppPatches(appState, deleteQuickFilterDraftPatch(key));
    quickFilterOpen.delete(key);
    filteredEntries.delete(key);
  }

  /** Releases every per-tab cache belonging to a workspace being switched away from. */
  function releaseWorkspaceTabState(outgoing: WorkspaceProjection): void {
    for (const paneId of outgoing.paneOrder) {
      for (const tabId of outgoing.panesById[paneId]?.tabOrder ?? []) {
        clearTabState(paneId, tabId);
      }
      editorByPane.get(paneId)?.controller.dispose();
      editorByPane.delete(paneId);
    }
  }

  /** Loads every pane's active tab, the currently active pane first (task 0084). */
  function loadPanesActiveFirst(loaded: WorkspaceProjection): void {
    void navigation.load(loaded.activePaneId);
    for (const paneId of loaded.paneOrder) {
      if (paneId !== loaded.activePaneId) void navigation.load(paneId);
    }
  }

  function workspaceErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  /** Flushes any pending layout edit and swaps in an already-fetched workspace projection. */

  /**
   * Switches the active workspace (task 0084): flushes any pending debounced
   * layout edit, releases the outgoing workspace's per-tab caches, restores
   * the target workspace's persisted layout, and loads its active pane's
   * tabs first. Never touches `operations` — running file operations must
   * survive a switch untouched.
   */
  async function switchWorkspace(workspaceId: WorkspaceId): Promise<void> {
    await workspaceController.switchWorkspace(workspaceId);
  }

  function refetchAffectedPanes(
    paneId?: PaneId,
    options?: { readonly background?: boolean },
  ): void {
    if (workspace === undefined) return;
    const background = options?.background ?? true;
    for (const candidate of workspace.paneOrder) {
      // Background refreshes are used for opportunistic reloads (e.g. deltas/watch events),
      // while some callers (operation completion) request a foreground reload to guarantee
      // authoritative source/destination listings after mutating actions.
      if (paneId === undefined || candidate === paneId) {
        void navigation.load(candidate, background ? { background: true } : undefined);
      }
    }
  }

  function applyDelta(paneId: PaneId, delta: DirectoryDelta): void {
    const key = activeTabKey(paneId);
    const current = directories.get(key);
    const revision = delta.type === 'reset' ? delta.snapshot.revision : delta.revision;
    if (current === undefined || current.revision === undefined) {
      refetchAffectedPanes(paneId);
      return;
    }
    if (revision <= current.revision) return;
    if (revision !== current.revision + 1 && delta.type !== 'reset') {
      refetchAffectedPanes(paneId);
      return;
    }
    if (delta.type === 'reset') {
      directories.set(
        key,
        respectSystemLocationReadOnly(
          {
            state: delta.snapshot.loadingState,
            entries: delta.snapshot.entries,
            location: delta.snapshot.location,
            writable: delta.snapshot.writable,
            requestId: delta.snapshot.requestId,
            revision,
            hasMore: delta.snapshot.hasMore,
            ...(delta.snapshot.continuationToken === undefined
              ? {}
              : { continuationToken: delta.snapshot.continuationToken }),
          },
          systemLocations,
        ),
      );
      m.redraw();
      return;
    }
    const entries = [...current.entries];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    if (delta.type === 'entriesRemoved') {
      if (!Array.isArray(delta.entryIds)) {
        refetchAffectedPanes(paneId);
        return;
      }
      for (const id of delta.entryIds) byId.delete(id);
    } else {
      if (!Array.isArray(delta.entries)) {
        refetchAffectedPanes(paneId);
        return;
      }
      for (const entry of delta.entries) byId.set(entry.id, entry);
    }
    const ordered = entries.flatMap((entry) => {
      const next = byId.get(entry.id);
      if (next === undefined) return [];
      byId.delete(entry.id);
      return [next];
    });
    directories.set(key, { ...current, revision, entries: [...ordered, ...byId.values()] });
    if (delta.type === 'entriesAdded' && dialogs.getState().pendingCreatedLocation !== undefined) {
      const created = delta.entries.find(
        (entry) => entry.location.uri === dialogs.getState().pendingCreatedLocation,
      );
      if (created !== undefined) {
        selections.set(
          key,
          reduceSelection(emptySelection, { type: 'selectOnly', entryId: created.id }, [
            created.id,
          ]),
        );
        dialogs.setPendingCreatedLocation(undefined);
      }
    }
    m.redraw();
  }

  function activeDirectory(): { paneId: PaneId; location: Location } | undefined {
    const paneId = workspace?.activePaneId;
    const location =
      paneId === undefined ? undefined : directories.get(activeTabKey(paneId))?.location;
    return paneId === undefined || location === undefined ? undefined : { paneId, location };
  }

  function clipboard() {
    return appState?.clipboard ?? emptyClipboard;
  }

  function replaceClipboard(next = emptyClipboard): void {
    if (appState !== undefined) {
      appState = applyAppPatches(appState, clipboardPatch(next));
    }
  }

  function selectedLocations(): readonly Location[] {
    const active = activeDirectory();
    const directory =
      active === undefined ? undefined : directories.get(activeTabKey(active.paneId));
    const selection =
      active === undefined ? undefined : selections.get(activeTabKey(active.paneId));
    return getSelectedEntriesOrCursor(selection, directory?.entries ?? []).map(
      (entry) => entry.location,
    );
  }

  /**
   * Clicking a footer function-key hint re-triggers the exact same keydown
   * path a real key press would (pane.ts's local handler, then this file's
   * global keydown handler), instead of duplicating each action's dispatch
   * logic here.
   */
  function invokeFunctionKeyShortcut(shortcut: string): void {
    const paneElement = document.querySelector<HTMLElement>('[data-active="true"] > .fm-pane');
    paneElement?.dispatchEvent(new KeyboardEvent('keydown', { key: shortcut, bubbles: true }));
  }

  const backendEventContext: BackendEventContext = {
    getWorkspaceId: () => workspace?.id,
    getWorkspaceRevision: () => workspace?.revision,
    replaceWorkspace,
    refreshWorkspaceSummaries: () => workspaceController.refreshWorkspaceSummaries(),
    setWorkspaceSummaries: (summaries) => {
      workspaceSummaries = summaries;
    },
    setWorkspaceActionError: (message) => {
      workspaceActionError = message;
    },
    recoverActiveWorkspace: (summaries) => workspaceController.recoverActiveWorkspace(summaries),
    listWorkspaces: () => attrsClient.listWorkspaces(),
    getWorkspace: (id) => attrsClient.getWorkspace(id),
    setPendingConflict: (conflict) => {
      pendingConflict = conflict;
    },
    getPendingOperationEvents: () => pendingOperationEvents,
    pushPendingOperationEvent: (event) => {
      pendingOperationEvents.push(event);
    },
    clearPendingOperationEvents: () => {
      const events = pendingOperationEvents;
      pendingOperationEvents = [];
      return events;
    },
    getOperationFrame: () => operationFrame,
    setOperationFrame: (frame) => {
      operationFrame = frame;
    },
    getOperations: () => operations,
    setOperations: (next) => {
      operations = next;
    },
    getDismissedOperationIds: () => dismissedOperationIds,
    clearDismissedOperation,
    scheduleAutoDismiss,
    getActiveDirectoryRevision: (paneId) => directories.get(activeTabKey(paneId))?.revision,
    applyDelta,
    refetchAffectedPanes,
    getPlugins: () => plugins,
    setPlugins: (next) => {
      plugins = next;
    },
    listPlugins: () => attrsClient.listPlugins(),
    getCurrentIconThemeSetting: () => currentSettings?.iconTheme,
    applyIconTheme,
    getConnections: () => connections,
    setConnections: (next) => {
      connections = next;
    },
    getConnection: (id) => attrsClient.getConnection(id),
    getComparisonState: () => comparisonState,
    setComparisonState: (next) => {
      comparisonState = next;
    },
    getChecksumState: () => checksumState,
    setChecksumState: (next) => {
      checksumState = next;
    },
    getDuplicateState: () => duplicateState,
    setDuplicateState: (next) => {
      duplicateState = next;
    },
    markComparisonDifferences: (state) => {
      for (const paneId of [state.leftPaneId, state.rightPaneId]) {
        if (paneId === undefined) continue;
        const key = activeTabKey(paneId);
        const directory = directories.get(key);
        if (directory === undefined) continue;
        const matchingIds = differingEntryIds(state, paneId, directory.entries);
        if (matchingIds.length === 0) continue;
        const orderedEntryIds = directory.entries.map((entry) => entry.id);
        selections.set(
          key,
          reduceSelection(
            selections.get(key) ?? emptySelection,
            { type: 'restore', entryIds: matchingIds },
            orderedEntryIds,
          ),
        );
      }
    },
    getFindFilesSearchId: () => findFilesSearchId,
    getSearchBatchReloadInFlight: () => searchBatchReloadInFlight,
    cacheContentMatches: (uri, matches) => {
      if (appState !== undefined)
        appState = applyAppPatches(appState, cacheContentMatchesPatch(uri, matches));
    },
    findPanesWithUri: (uri) =>
      workspace === undefined
        ? []
        : (
            Object.entries(workspace.panesById) as Array<
              [PaneId, WorkspaceProjection['panesById'][PaneId]]
            >
          )
            .filter(([, pane]) => pane.tabsById[pane.activeTabId]?.location.uri === uri)
            .map(([paneId]) => paneId),
    loadPane: (paneId, options) => navigation.load(paneId, options),
    redraw: () => m.redraw(),
  };
  const handleBackendEvent = createBackendEventHandler(backendEventContext);

  let attrsClient: FileManagerClient;
  let opsController: OperationsController;
  let workspaceController: WorkspaceController;
  let tabController: TabController;
  let settingsController: SettingsController;
  let globalKeydownHandler: (event: KeyboardEvent) => void;
  let findFilesController: FindFilesController;
  let comparisonController: ComparisonController;
  let checksumController: ChecksumController;
  let actionCommandController: ActionCommandController;

  const workspaceControllerContext: WorkspaceControllerContext = {
    getWorkspace: () => workspace,
    setWorkspace: (ws) => {
      workspace = ws;
    },
    getWorkspaceError: () => workspaceError,
    setWorkspaceError: (msg) => {
      workspaceError = msg;
    },
    getWorkspaceSummaries: () => workspaceSummaries,
    setWorkspaceSummaries: (summaries) => {
      workspaceSummaries = summaries;
    },
    getWorkspaceActionError: () => workspaceActionError,
    setWorkspaceActionError: (msg) => {
      workspaceActionError = msg;
    },
    getWorkspaceRequest: () => workspaceRequest,
    setWorkspaceRequest: (ac) => {
      workspaceRequest = ac;
    },
    getPlatform: () => platform,
    setPlatform: (p) => {
      platform = p;
    },
    getNativeDragOutSupported: () => nativeDragOutSupported,
    setNativeDragOutSupported: (v) => {
      nativeDragOutSupported = v;
    },
    getUnsubscribeNativeFileDrops: () => unsubscribeNativeFileDrops,
    setUnsubscribeNativeFileDrops: (fn) => {
      unsubscribeNativeFileDrops = fn;
    },
    subscribeNativeFileDrops: (callback) => attrsClient.subscribeNativeFileDrops(callback),
    setOpenTerminalSupported: (v) => {
      openTerminalSupported = v;
    },
    setNativeIconLoader: (loader) => {
      nativeIconLoader = loader;
    },
    getSystemLocations: () => systemLocations,
    setSystemLocations: (locs) => {
      systemLocations = locs;
    },
    setSystemLocationsError: (msg) => {
      systemLocationsError = msg;
    },
    getConnections: () => connections,
    setConnections: (conns) => {
      connections = conns;
    },
    setDraggedLocations: (locs) => {
      draggedLocations = locs;
    },
    getNativeDropInProgress: () => nativeDropInProgress,
    setNativeDropInProgress: (v) => {
      nativeDropInProgress = v;
    },
    setClipboardMessage: (msg) => {
      clipboardMessage = msg;
    },
    getNavigation: () => navigation,
    getFlushPendingLayoutUpdate: () => flushPendingLayoutUpdate,
    redraw: () => m.redraw(),
    releaseWorkspaceTabState: (outgoing) => releaseWorkspaceTabState(outgoing),
    loadPanesActiveFirst: (ws) => loadPanesActiveFirst(ws),
  };

  const tabControllerContext: TabControllerContext = {
    getWorkspace: () => workspace,
    setWorkspace: (ws) => {
      workspace = ws;
    },
    getAppState: () => appState,
    setAppState: (state) => {
      appState = state;
    },
    getNavigation: () => navigation,
    redraw: () => m.redraw(),
    applyCurrentShowHiddenSetting: (client, workspaceId, paneId, tabId, rev) =>
      settingsController.applyCurrentShowHiddenSetting(client, workspaceId, paneId, tabId, rev),
    clearTabState,
    getCloseTabConfirmation: () => closeTabConfirmation,
    setCloseTabConfirmation: (conf) => {
      closeTabConfirmation = conf;
    },
    hasCachedSnapshot: (paneId, tabId) =>
      directories.get(tabKey(paneId, tabId))?.state.type === 'loaded',
  };

  const settingsControllerContext: SettingsControllerContext = {
    setTheme: (t) => {
      theme = t;
    },
    setLoadedEntryFormatSettings: (s) => {
      loadedEntryFormatSettings = s;
    },
    getSettingsDialogOpen: () => settingsDialogOpen,
    setSettingsDialogOpen: (open) => {
      settingsDialogOpen = open;
    },
    getSettingsDisclosureElement: () => settingsDisclosureElement,
    getCurrentSettings: () => currentSettings,
    setCurrentSettings: (s) => {
      currentSettings = s;
    },
    getPlugins: () => plugins,
    getInstalledIconThemeId: () => installedIconThemeId,
    setInstalledIconThemeId: (id) => {
      installedIconThemeId = id;
    },
    getRuntimeKind: () => runtimeKind,
    getWorkspace: () => workspace,
    setWorkspace: (ws) => {
      workspace = ws;
    },
    getDirectories: () => directories,
    getNavigation: () => navigation,
    getClient: () => attrsClient,
    redraw: () => m.redraw(),
  };

  const globalKeydownHandlerContext: GlobalKeydownContext = {
    getCommandPaletteOpen: () => commandPaletteOpen,
    getPlatform: () => platform,
    getKeybindingRuntime: () => keybindingRuntime,
    getCurrentSettings: () => currentSettings,
    getWorkspace: () => workspace,
    getSelections: () => selections,
    getDirectories: () => directories,
    getRegisteredActions: () => registeredActions,
    clipboard,
    getFindFilesOpen: () => findFilesOpen,
    getViewer: (paneId) => {
      const tabId = workspace?.panesById[paneId]?.activeTabId;
      return tabId === undefined ? undefined : viewerByTab.get(tabKey(paneId, tabId));
    },
    getArchiveCreateRequest: () => dialogs.getState().archiveCreateRequest,
    getCreateDirectoryOpen: () => dialogs.getState().createDirectoryOpen,
    getCreateFileOpen: () => dialogs.getState().createFileOpen,
    getAppState: () => appState,
    getLastQuickFilterQuery: (paneId) => lastQuickFilterQueryByTabKey.get(activeTabKey(paneId)),
    getShortcutsHelpOpen: () => shortcutsHelpOpen,
    setCommandPaletteOpen: (open) => {
      commandPaletteOpen = open;
    },
    setClipboardMessage: (msg) => {
      clipboardMessage = msg;
    },
    setArchiveCreateRequest: (req) => {
      if (req !== undefined) dialogs.openArchiveCreate(req);
    },
    setCreateDirectoryOpen: (open) => {
      if (open) dialogs.openCreateDirectory();
      else dialogs.cancelCreateDirectory();
    },
    setCreateFileOpen: (open) => {
      if (open) dialogs.openCreateFile();
      else dialogs.cancelCreateFile();
    },
    setAppState: (state) => {
      appState = state;
    },
    setQuickFilterOpen: (key, open) => {
      quickFilterOpen.set(key, open);
    },
    setActiveTabQuickFilter: (paneId, query) => {
      const liveWorkspace = workspace;
      const pane = liveWorkspace?.panesById[paneId];
      const tab = pane === undefined ? undefined : pane.tabsById[pane.activeTabId];
      if (liveWorkspace === undefined || tab === undefined) return;
      const key = activeTabKey(paneId);
      const previous = tab.view.quickFilter?.query ?? '';
      if (query === undefined) {
        if (previous.length > 0) lastQuickFilterQueryByTabKey.set(key, previous);
        quickFilterOpen.set(key, false);
      } else {
        quickFilterOpen.set(key, true);
      }
      if (appState !== undefined)
        appState = applyAppPatches(appState, deleteQuickFilterDraftPatch(key));
      void dispatchWorkspaceCommand(
        attrsClient,
        {
          type: 'updateView',
          workspaceId: liveWorkspace.id,
          paneId,
          tabId: tab.id,
          patch: {
            quickFilter:
              query === undefined ? { type: 'clear' } : { type: 'set', filter: { query } },
          },
          expectedRevision: liveWorkspace.revision,
        },
        (next) => {
          workspace = next;
        },
      ).catch(() => undefined);
    },
    setConnectionsManagerOpen: (open) => {
      connectionsManagerOpen = open;
    },
    setShortcutsHelpOpen: (open) => {
      shortcutsHelpOpen = open;
    },
    getTabController: () => tabController,
    getOpsController: () => opsController,
    getNavigation: () => navigation,
    activeDirectory,
    activeTabKey,
    actionsWithFavourites,
    openFindFiles: () => findFilesController.openFindFiles(),
    replaceClipboard,
    selectedLocations,
    invokeActionById: (actionId, parameters, context) =>
      actionCommandController.invokeActionById(actionId, parameters, context),
    openViewer: (paneId, entry, initialSearch, openMetadata) =>
      openViewer(attrsClient, paneId, entry, initialSearch, openMetadata),
    openEditor: (paneId, entry) => openEditor(attrsClient, paneId, entry),
    calculateFolderSize: (paneId, entry) => calculateFolderSize(attrsClient, paneId, entry),
    actionContext: () => actionCommandController.actionContext(),
    commandAvailabilityContext: (selectedEntries, paneId) =>
      actionCommandController.commandAvailabilityContext(selectedEntries, paneId),
    contentSearchInitialQuery,
    refetchAffectedPanes,
    platformActionParameters: (actionId, selectedEntries, directoryLocation) =>
      actionCommandController.platformActionParameters(
        actionId,
        selectedEntries,
        directoryLocation,
      ),
    activatePane: (paneId) => activatePane(attrsClient, paneId),
    focusPane: (paneId) => {
      if (focusPane !== undefined) focusPane(paneId);
      else void activatePane(attrsClient, paneId);
    },
    toggleTerminal: () => {
      if (runtimeKind !== 'tauri') return;
      const activeLocation = activeDirectory()?.location;
      if (activeLocation === undefined) return;
      if (openTerminalLocations.has(activeLocation.uri)) {
        openTerminalLocations.delete(activeLocation.uri);
      } else {
        openTerminalLocations.add(activeLocation.uri);
        requestAnimationFrame(() => focusTerminal?.());
      }
    },
    redraw: () => m.redraw(),
    setSort: (paneId, sort) => {
      const liveWorkspace = workspace;
      const pane = liveWorkspace?.panesById[paneId];
      const tab = pane === undefined ? undefined : pane.tabsById[pane.activeTabId];
      if (liveWorkspace === undefined || tab === undefined) return;
      void dispatchWorkspaceCommand(
        attrsClient,
        {
          type: 'updateView',
          workspaceId: liveWorkspace.id,
          paneId,
          tabId: tab.id,
          patch: { sort: [...sort] },
          expectedRevision: liveWorkspace.revision,
        },
        (next) => {
          workspace = next;
        },
      ).catch(() => undefined);
    },
    swapPaneTabSets: (paneAId, paneBId) => {
      const liveWorkspace = workspace;
      if (liveWorkspace === undefined) return;
      const paneA = liveWorkspace.panesById[paneAId];
      const paneB = liveWorkspace.panesById[paneBId];
      if (paneA === undefined || paneB === undefined) return;
      // No backend command swaps a whole tab set atomically (task 0128 Agent Notes) - this
      // mutates the local projection directly, the same optimistic-update pattern
      // `activateTab` uses, rather than round-tripping through `dispatchWorkspaceCommand`.
      workspace = {
        ...liveWorkspace,
        panesById: {
          ...liveWorkspace.panesById,
          [paneAId]: {
            ...paneA,
            tabOrder: paneB.tabOrder,
            tabsById: paneB.tabsById,
            activeTabId: paneB.activeTabId,
          },
          [paneBId]: {
            ...paneB,
            tabOrder: paneA.tabOrder,
            tabsById: paneA.tabsById,
            activeTabId: paneA.activeTabId,
          },
        },
      };
      void navigation.load(paneAId);
      void navigation.load(paneBId);
    },
    openMultiRenameForActivePane: () => {
      const active = activeDirectory();
      if (active === undefined) return;
      const key = activeTabKey(active.paneId);
      const directory = directories.get(key);
      if (directory === undefined) return;
      const selection = selections.get(key);
      const selected = getSelectedEntries(selection, directory.entries).filter(
        (entry) => !isParentEntry(entry.id),
      );
      // Total Commander's Multi Rename Tool defaults to every entry in the directory when
      // nothing is selected, rather than requiring a selection first.
      const entriesToRename =
        selected.length > 0
          ? selected
          : directory.entries.filter((entry) => !isParentEntry(entry.id));
      if (entriesToRename.length === 0) return;
      const selectedIds = new Set(entriesToRename.map((entry) => entry.id));
      dialogs.openMultiRename(
        entriesToRename,
        active.location,
        new Set(
          directory.entries
            .filter((entry) => !selectedIds.has(entry.id))
            .map((entry) => entry.name),
        ),
      );
      m.redraw();
    },
    quitApplication: () => {
      if (keybindingRuntime !== 'desktop') return;
      void attrsClient.quit?.();
    },
    startComparison: () => comparisonController.startComparison('sizeAndTimestamp'),
    calculateChecksums: () => checksumController.calculateChecksums(['sha256']),
    findDuplicates: () => checksumController.findDuplicates(),
    openSettingsDialog,
  };

  const findFilesControllerContext: FindFilesControllerContext = {
    getFindFilesOpen: () => findFilesOpen,
    setFindFilesOpen: (open) => {
      findFilesOpen = open;
    },
    getFindFilesRoot: () => findFilesRoot,
    setFindFilesRoot: (root) => {
      findFilesRoot = root;
    },
    getFindFilesSearchId: () => findFilesSearchId,
    setFindFilesSearchId: (searchId) => {
      findFilesSearchId = searchId;
    },
    getFindFilesError: () => findFilesError,
    setFindFilesError: (error) => {
      findFilesError = error;
    },
    getFindFilesGeneration: () => findFilesGeneration,
    setFindFilesGeneration: (generation) => {
      findFilesGeneration = generation;
    },
    getFindFilesRootsByLocationUri: () => findFilesRootsByLocationUri,
    getFindFilesQueriesByLocationUri: () => findFilesQueriesByLocationUri,
    getFindFilesParamsByLocationUri: () => findFilesParamsByLocationUri,
    getActiveDirectory: () => activeDirectory(),
    getWorkspace: () => workspace,
    getNavigation: () => navigation,
    getClient: () => attrsClient,
    getFocusPane: () => focusPane,
    redraw: () => m.redraw(),
  };

  const comparisonControllerContext: ComparisonControllerContext = {
    getState: () => comparisonState,
    setState: (next) => {
      comparisonState = next;
    },
    getWorkspace: () => workspace,
    getClient: () => attrsClient,
    redraw: () => m.redraw(),
  };

  const checksumControllerContext: ChecksumControllerContext = {
    getChecksumState: () => checksumState,
    setChecksumState: (next) => {
      checksumState = next;
    },
    getDuplicateState: () => duplicateState,
    setDuplicateState: (next) => {
      duplicateState = next;
    },
    getWorkspace: () => workspace,
    getClient: () => attrsClient,
    getSelectedEntries: () => {
      const active = activeDirectory();
      if (active === undefined) return [];
      const key = activeTabKey(active.paneId);
      return getSelectedEntriesOrCursor(selections.get(key), directories.get(key)?.entries ?? []);
    },
    getActiveLocation: () => activeDirectory()?.location,
    // Reuses the same operation call `core.delete` makes, so duplicate
    // deletion inherits its confirmation, conflict handling and audit trail
    // instead of introducing a second delete path (spec §35, task 0077).
    requestDelete: (locations) => {
      if (locations.length === 0) return;
      void opsController.delete(
        [...locations],
        currentSettings?.confirmPermanentDelete === false,
        false,
      );
    },
    redraw: () => m.redraw(),
  };

  const actionCommandControllerContext: ActionCommandControllerContext = {
    getCommandPaletteOpen: () => commandPaletteOpen,
    setCommandPaletteOpen: (open) => {
      commandPaletteOpen = open;
    },
    getContextMenu: () => contextMenu,
    setContextMenu: (menu) => {
      contextMenu = menu;
    },
    getCommandPaletteRecency: () => commandPaletteRecency,
    getActiveDirectory: () => activeDirectory(),
    getActiveTabKey: (paneId) => activeTabKey(paneId),
    getSelections: () => selections,
    getDirectories: () => directories,
    getCurrentSettings: () => currentSettings,
    getClient: () => attrsClient,
    getRegisteredActions: () => registeredActions,
    getWorkspace: () => workspace,
    getNavigation: () => navigation,
    getOpsController: () => opsController,
    getGetSelectedEntries: () => getSelectedEntriesOrCursor,
    getClipboard: () => clipboard(),
    replaceClipboard: (next) => replaceClipboard(next),
    toast: (options) => toast(options),
    getOpenTerminalSupported: () => openTerminalSupported,
    openCreateDirectory: (location) => dialogs.openCreateDirectory(location),
    setArchiveCreateRequest: (request) => dialogs.openArchiveCreate(request),
    redraw: () => m.redraw(),
  };

  let paneContentBuilder: (
    client: FileManagerClient,
    entryFormatSettings: EntryFormatSettings,
    paneId: PaneId,
  ) => WorkspacePaneContent;

  const paneContentBuilderContext: PaneContentContext = {
    getWorkspace: () => workspace,
    getCurrentSettings: () => currentSettings,
    getSystemLocations: () => systemLocations,
    getSystemLocationsError: () => systemLocationsError,
    getConnections: () => connections,
    getUnavailableLocations: () => unavailableLocations,
    getNativeIconLoader: () => nativeIconLoader,
    getPlugins: () => plugins,
    getPlatform: () => platform,
    getKeybindingRuntime: () => keybindingRuntime,
    getRegisteredActions: () => registeredActions,
    getDraggedLocations: () => draggedLocations,
    getNativeDragOutSupported: () => nativeDragOutSupported,
    getNativeDropInProgress: () => nativeDropInProgress,
    getAppState: () => appState,
    clipboard,
    getDirectories: () => directories,
    getSelections: () => selections,
    getSortedEntries: () => sortedEntries,
    getSortRequests: () => sortRequests,
    getCursorLoadTokens: () => cursorLoadTokens,
    getViewerByTab: () => viewerByTab,
    getEditorByPane: () => editorByPane,
    setConnections: (conns) => {
      connections = conns;
    },
    setConnectionsManagerOpen: (open) => {
      connectionsManagerOpen = open;
    },
    setAppState: (state) => {
      appState = state;
    },
    setQuickFilterOpen: (key, open) => {
      quickFilterOpen.set(key, open);
    },
    setDraggedLocations: (locs) => {
      draggedLocations = locs;
    },
    setClipboardMessage: (msg) => {
      clipboardMessage = msg;
    },
    setMultiRenameOpen: (open) => {
      if (!open) dialogs.cancelMultiRename();
    },
    setMultiRenameEntries: (entries) => {
      dialogs.getState().multiRenameEntries = entries;
    },
    setMultiRenameLocation: (location) => {
      dialogs.getState().multiRenameLocation = location;
    },
    setMultiRenameExistingNames: (names) => {
      dialogs.getState().multiRenameExistingNames = names;
    },
    tabKey,
    effectiveSort,
    frontendSort,
    sortLabel,
    entriesSortedFor,
    entriesFilteredFor,
    quickFilterQueryFor,
    quickFilterOpenFor,
    contentSearchInitialQuery,
    workspaceErrorMessage,
    locationForPath,
    activeDirectory,
    getNavigation: () => navigation,
    getWorkspaceController: () => workspaceController,
    getOpsController: () => opsController,
    openViewer: (paneId, entry, initialSearch, openMetadata) =>
      openViewer(attrsClient, paneId, entry, initialSearch, openMetadata),
    closeViewer,
    closeEditor,
    updateLocationSettings,
    invokeActionById: (actionId, parameters, context) =>
      actionCommandController.invokeActionById(actionId, parameters, context),
    openContextMenu: (paneId, entries, x, y) =>
      actionCommandController.openContextMenu(paneId, entries, x, y),
    refetchAffectedPanes,
    replaceWorkspace,
  };

  function replaceWorkspace(next: WorkspaceProjection): void {
    workspace = next;
    m.redraw();
  }

  async function updateLocationSettings(
    client: FileManagerClient,
    update: (settings: Settings) => Settings,
  ): Promise<void> {
    if (currentSettings === undefined) return;
    currentSettings = await client.updateSettings(update(currentSettings));
    m.redraw();
  }

  async function activatePane(client: FileManagerClient, paneId: PaneId): Promise<void> {
    if (workspace === undefined || workspace.activePaneId === paneId) {
      return;
    }
    const previousWorkspace = workspace;
    replaceWorkspace({ ...previousWorkspace, activePaneId: paneId });
    try {
      await dispatchWorkspaceCommand(
        client,
        {
          type: 'setActivePane',
          workspaceId: previousWorkspace.id,
          paneId,
          expectedRevision: previousWorkspace.revision,
        },
        replaceWorkspace,
      );
    } catch (error) {
      if (workspace?.revision === previousWorkspace.revision) replaceWorkspace(previousWorkspace);
      throw error;
    }
  }

  function selectTab(client: FileManagerClient, paneId: PaneId, tabId: TabId): void {
    if (workspace?.panesById[paneId]?.activeTabId === tabId) {
      // Already the active tab - no tab switch, but still worth refreshing: the user is
      // deliberately revisiting this listing (e.g. clicking back onto it after an external change
      // like a browser download landed while it sat idle), so `activateTab` refreshes it too.
      void activatePane(client, paneId).catch(() => undefined);
      tabController.activateTab(paneId, tabId);
      return;
    }
    tabController.activateTab(paneId, tabId);
  }

  function updateLayout(client: FileManagerClient, layout: WorkspaceLayout): void {
    if (workspace === undefined) {
      return;
    }
    void dispatchWorkspaceCommand(
      client,
      {
        type: 'updateLayout',
        workspaceId: workspace.id,
        layout,
        expectedRevision: workspace.revision,
      },
      replaceWorkspace,
    ).catch(() => undefined);
  }

  const appDialogsContext: AppDialogsContext = {
    getOperations: () => operations,
    setOperations: (next) => {
      operations = next;
    },
    getPendingConflict: () => pendingConflict,
    setPendingConflict: (conflict) => {
      pendingConflict = conflict;
    },
    getConnections: () => connections,
    setConnections: (conns) => {
      connections = conns;
    },
    getConnectionsManagerOpen: () => connectionsManagerOpen,
    setConnectionsManagerOpen: (open) => {
      connectionsManagerOpen = open;
    },
    getFindFilesOpen: () => findFilesOpen,
    getFindFilesRoot: () => findFilesRoot,
    getFindFilesError: () => findFilesError,
    getCloseTabConfirmation: () => closeTabConfirmation,
    setCloseTabConfirmation: (conf) => {
      closeTabConfirmation = conf;
    },
    getDialogs: () => dialogs,
    getFindFilesController: () => findFilesController,
    getTabController: () => tabController,
    getOpsController: () => opsController,
    getActiveDirectoryLocation: () => activeDirectory()?.location,
    openEditorForCreatedFile: (location, name) => {
      const active = activeDirectory();
      if (active === undefined) return;
      refetchAffectedPanes(active.paneId);
      openEditor(attrsClient, active.paneId, {
        id: crypto.randomUUID(),
        location,
        name,
        kind: 'file',
        hidden: false,
        readOnly: false,
        metadataRevision: 0,
      });
    },
    cancelAutoDismiss,
    rememberDismissedOperation,
    refetchAffectedPanes,
    redraw: () => m.redraw(),
  };

  return {
    oninit: ({ attrs }) => {
      attrsClient = attrs.client;
      opsController = createOperationsController(attrs.client);
      workspaceController = createWorkspaceController(attrs.client, workspaceControllerContext);
      tabController = createTabController(attrs.client, tabControllerContext);
      settingsController = createSettingsController(settingsControllerContext);
      globalKeydownHandler = createGlobalKeydownHandler(globalKeydownHandlerContext);
      findFilesController = createFindFilesController(findFilesControllerContext);
      comparisonController = createComparisonController(comparisonControllerContext);
      checksumController = createChecksumController(checksumControllerContext);
      actionCommandController = createActionCommandController(actionCommandControllerContext);
      paneContentBuilder = createPaneContentBuilder(paneContentBuilderContext);
      keybindingRuntime = attrs.runtime === 'http' ? 'browser' : 'desktop';
      runtimeKind = attrs.runtime;
      document.addEventListener('keydown', globalKeydownHandler);
      systemThemeQuery?.addEventListener('change', handleSystemThemeChange);
      window.addEventListener('focus', handleWindowFocus);
      appState = applyAppPatches(
        createInitialAppState(attrs.runtime),
        connectionPatch({ status: attrs.client.connection.get() }),
      );
      navigation = createNavigationController({
        client: attrs.client,
        getWorkspace: () => workspace,
        replaceWorkspace: (next) => replaceWorkspace(next),
        onLocationVisited: (workspaceId, location) => {
          unavailableLocations.delete(`${location.providerId}:${location.uri}`);
          void updateLocationSettings(attrs.client, (settings) => ({
            ...settings,
            recentLocationsByWorkspace: {
              ...settings.recentLocationsByWorkspace,
              [workspaceId]: recordRecentLocation(
                settings.recentLocationsByWorkspace[workspaceId] ?? [],
                location,
              ),
            },
          }));
        },
        onLocationUnavailable: (_workspaceId, location) => {
          unavailableLocations.add(`${location.providerId}:${location.uri}`);
          m.redraw();
        },
        requestArchivePassword: (location, invalid) => {
          dialogs.getState().pendingArchiveCredential?.resolve(false);
          dialogs.clearArchiveCredential();
          return new Promise<boolean>((resolve) => {
            dialogs.setPendingArchiveCredential({ location, invalid, resolve });
            m.redraw();
          });
        },
        updatePane: (paneId, tabId, view, preferredCursorName) => {
          const key = tabKey(paneId, tabId);
          const previous = directories.get(key);
          directories.set(key, respectSystemLocationReadOnly(view, systemLocations));
          if (view.entries.length === 0) {
            selections.set(key, emptySelection);
          } else if (
            selections.get(key)?.cursorEntryId === undefined ||
            previous?.location?.uri !== view.location?.uri
          ) {
            // After `..` navigation, land the cursor back on the child directory
            // just navigated away from instead of always the listing's first entry.
            const preferredEntry = view.entries.find((entry) => entry.name === preferredCursorName);
            const firstEntry = preferredEntry ?? view.entries[0];
            selections.set(key, {
              selectedEntryIds: firstEntry === undefined ? [] : [firstEntry.id],
              ...(firstEntry === undefined
                ? {}
                : { cursorEntryId: firstEntry.id, anchorEntryId: firstEntry.id }),
            });
          }
          m.redraw();
        },
      });
      // Specification §26 keeps settings on the backend rather than in browser
      // storage, so the theme manager's own localStorage persistence stays off;
      // task 0030 restores the theme from the settings service instead.
      ThemeManager.setUseLocalStorage(false);
      ThemeManager.initialize(theme);
      void loadSettings(attrs.client);
      void attrs.client
        .listActions()
        .then((actions) => {
          registeredActions = actions;
          m.redraw();
        })
        .catch(() => undefined);
      void attrs.client
        .listPlugins()
        .then((listed) => {
          plugins = listed;
          if (currentSettings !== undefined) applyIconTheme(currentSettings.iconTheme);
          m.redraw();
        })
        .catch(() => undefined);
      void workspaceController.loadWorkspace();
      void Promise.resolve()
        .then(() => attrs.client.listOperations())
        .then((listed) => {
          if (!removed) {
            // History is loaded from a PAST session - the user never watched these
            // run, so an auto-dismissible one (completed/cancelled/interrupted) would
            // only flash and vanish a few seconds later for no reason. Only surface
            // ones that still need attention (failed) or are still genuinely active.
            const relevant = listed.filter(
              (operation) =>
                !isAutoDismissibleState(operation.state) &&
                !dismissedOperationIds.has(operation.id),
            );
            operations = createOperationsState(relevant);
            m.redraw();
          }
        })
        .catch(() => undefined);
      unsubscribeConnection = attrs.client.connection.subscribe((status) => {
        if (appState !== undefined) {
          appState = applyAppPatches(appState, connectionPatch({ status }));
        }
        m.redraw();
      });
      unsubscribeResynchronise = attrs.client.onResynchronise(() => refetchAffectedPanes());
      void attrs.client.subscribe(handleBackendEvent).then((unsubscribe) => {
        if (removed) unsubscribe();
        else unsubscribeEvents = unsubscribe;
      });
    },

    onremove: () => {
      removed = true;
      dialogs.getState().pendingArchiveCredential?.resolve(false);
      dialogs.clearArchiveCredential();
      document.removeEventListener('keydown', globalKeydownHandler);
      systemThemeQuery?.removeEventListener('change', handleSystemThemeChange);
      window.removeEventListener('focus', handleWindowFocus);
      if (operationFrame !== undefined) cancelAnimationFrame(operationFrame);
      for (const timer of autoDismissTimers.values()) clearTimeout(timer);
      autoDismissTimers.clear();
      workspaceRequest?.abort();
      unsubscribeEvents?.();
      unsubscribeNativeFileDrops?.();
      unsubscribeConnection?.();
      unsubscribeResynchronise?.();
      attrsClient.disconnect();
      navigation.dispose();
      document.documentElement.style.removeProperty('--fm-font-size');
      document.documentElement.style.removeProperty('--fm-row-height');
    },

    view: ({ attrs }) => {
      const pendingDelete = Object.values(operations.byId).find(
        (operation) =>
          operation?.kind === 'delete' && operation.state === 'waitingForConflictResolution',
      );
      // macOS's overlay title bar (spec follow-up) keeps the native traffic lights, but
      // draws our own centred title in a reserved CSS row instead of the OS title text
      // (hidden via hiddenTitle) -- this is what makes the frame colour match, since a
      // plain "Transparent" title bar still let the OS render its own vibrancy behind it.
      // The web build doesn't need this: the browser tab already shows the title.
      const isMacOverlay = runtimeKind === 'tauri' && platform === 'macos';
      return m(
        '.fm-app-shell',
        { 'data-mac-titlebar-overlay': isMacOverlay ? 'true' : undefined },
        [
          isMacOverlay
            ? m('.fm-titlebar-spacer', { 'data-tauri-drag-region': '' }, [
                m('span.fm-titlebar-label', 'Procyon'),
              ])
            : null,
          m('.fm-workspace-toolbar', [
            m('.fm-navigation-controls', { 'aria-label': 'Active pane navigation' }, [
              tooltip(
                'Back',
                m(
                  IconButton,
                  {
                    disabled:
                      workspace?.panesById[workspace.activePaneId]?.tabsById[
                        workspace.panesById[workspace.activePaneId]?.activeTabId ?? ''
                      ]?.canNavigateBack !== true,
                    'aria-label': 'Back',
                    onclick: () => void navigation.back(workspace?.activePaneId ?? ''),
                  },
                  arrowLeftIcon(),
                ),
              ),
              tooltip(
                'Forward',
                m(
                  IconButton,
                  {
                    disabled:
                      workspace?.panesById[workspace.activePaneId]?.tabsById[
                        workspace.panesById[workspace.activePaneId]?.activeTabId ?? ''
                      ]?.canNavigateForward !== true,
                    'aria-label': 'Forward',
                    onclick: () => void navigation.forward(workspace?.activePaneId ?? ''),
                  },
                  arrowRightIcon(),
                ),
              ),
              tooltip(
                'Parent directory',
                m(
                  IconButton,
                  {
                    disabled: workspace === undefined,
                    'aria-label': 'Parent directory',
                    onclick: () => void navigation.parent(workspace?.activePaneId ?? ''),
                  },
                  cornerLeftUpIcon(),
                ),
              ),
            ]),
            tooltip(
              'Find files',
              m(
                IconButton,
                {
                  disabled: activeDirectory() === undefined,
                  'aria-label': 'Find files',
                  onclick: () => {
                    findFilesController.openFindFiles();
                  },
                },
                searchIcon(),
              ),
            ),
            tooltip(
              'Select the entries that differ between the two panes (Shift+F2)',
              m(
                IconButton,
                {
                  disabled: (workspace?.paneOrder.length ?? 0) < 2,
                  'aria-label': 'Compare panes',
                  onclick: () => comparisonController.startComparison('sizeAndTimestamp'),
                },
                compareIcon(),
              ),
            ),
            tooltip(
              'Command palette',
              m(
                IconButton,
                {
                  className: 'fm-command-palette-trigger',
                  disabled: registeredActions.length === 0,
                  'aria-label': 'Command palette',
                  onclick: () => {
                    commandPaletteOpen = true;
                  },
                },
                commandIcon(),
              ),
            ),
            tooltip(
              `Switch workspace — current: ${workspace?.name ?? 'none'}`,
              m(
                IconButton,
                {
                  className: 'fm-workspace-switcher-button',
                  'aria-label': `Workspace switcher, current workspace: ${workspace?.name ?? 'none'}`,
                  onclick: () => {
                    if (workspaceDisclosureElement !== undefined) {
                      workspaceDisclosureElement.open = !workspaceDisclosureElement.open;
                    }
                  },
                },
                layoutGridIcon(),
              ),
            ),
            m(
              'details.fm-workspace-disclosure',
              {
                oncreate: ({ dom }) => {
                  workspaceDisclosureElement = dom as HTMLDetailsElement;
                },
                onremove: () => {
                  workspaceDisclosureElement = undefined;
                },
              },
              [
                m('summary.fm-disclosure-summary-hidden'),
                m('.fm-workspace-switcher-backdrop', {
                  onclick: (event: MouseEvent) => {
                    const disclosure = (event.currentTarget as HTMLElement).closest('details');
                    if (disclosure instanceof HTMLDetailsElement) disclosure.open = false;
                  },
                }),
                m('.fm-workspace-switcher-panel', { role: 'dialog', 'aria-label': 'Workspaces' }, [
                  m('.fm-workspace-switcher-heading', [
                    m('strong', 'Workspaces'),
                    m(
                      'button',
                      {
                        type: 'button',
                        'aria-label': 'Close workspaces',
                        onclick: (event: MouseEvent) => {
                          const disclosure = (event.currentTarget as HTMLElement).closest(
                            'details',
                          );
                          if (disclosure instanceof HTMLDetailsElement) disclosure.open = false;
                        },
                      },
                      closeIcon(),
                    ),
                  ]),
                  m(WorkspaceSwitcher, {
                    summaries: sortWorkspaceSummaries(workspaceSummaries),
                    activeWorkspaceId: workspace?.id,
                    error: workspaceActionError,
                    onSwitch: (workspaceId) => {
                      void switchWorkspace(workspaceId);
                    },
                    onCreate: () => workspaceController.createWorkspaceAction(),
                    onRename: (workspaceId, name) =>
                      workspaceController.renameWorkspaceAction(workspaceId, name),
                    onDelete: (workspaceId) =>
                      workspaceController.deleteWorkspaceAction(workspaceId),
                  }),
                ]),
              ],
            ),
            tooltip(
              'Show system diagnostics',
              m(
                IconButton,
                {
                  className: 'fm-diagnostics-button',
                  'aria-label': 'Diagnostics',
                  onclick: () => {
                    if (diagnosticsDisclosureElement === undefined) return;
                    diagnosticsDisclosureElement.open = !diagnosticsDisclosureElement.open;
                    diagnosticsDialogOpen = diagnosticsDisclosureElement.open;
                    m.redraw();
                  },
                },
                activityIcon(),
              ),
            ),
            m(
              'details.fm-diagnostics-disclosure',
              {
                oncreate: ({ dom }) => {
                  diagnosticsDisclosureElement = dom as HTMLDetailsElement;
                },
                onremove: () => {
                  diagnosticsDisclosureElement = undefined;
                },
              },
              [
                m('summary.fm-disclosure-summary-hidden'),
                m(
                  '.fm-diagnostics-editor',
                  {
                    role: 'dialog',
                    'aria-label': 'System Diagnostics',
                    onclick: (event: MouseEvent) => {
                      if (event.target === event.currentTarget) {
                        if (diagnosticsDisclosureElement !== undefined)
                          diagnosticsDisclosureElement.open = false;
                        diagnosticsDialogOpen = false;
                      }
                    },
                  },
                  [
                    m('.fm-settings-editor-panel', [
                      m('.fm-settings-editor-heading', [
                        m('strong', 'System Diagnostics'),
                        m(
                          'button',
                          {
                            type: 'button',
                            'aria-label': 'Close diagnostics',
                            onclick: () => {
                              if (diagnosticsDisclosureElement !== undefined)
                                diagnosticsDisclosureElement.open = false;
                              diagnosticsDialogOpen = false;
                            },
                          },
                          closeIcon(),
                        ),
                      ]),
                      diagnosticsDialogOpen ? m(DiagnosticsViewComponent) : undefined,
                    ]),
                  ],
                ),
              ],
            ),
            tooltip(
              'Open settings',
              m(
                IconButton,
                {
                  className: 'fm-settings-button',
                  'aria-label': 'Settings',
                  onclick: () => {
                    if (settingsDisclosureElement === undefined) return;
                    settingsDisclosureElement.open = !settingsDisclosureElement.open;
                    settingsDialogOpen = settingsDisclosureElement.open;
                    if (!settingsDialogOpen && currentSettings !== undefined) {
                      applyAppearance(currentSettings);
                    }
                    m.redraw();
                  },
                },
                settingsIcon(),
              ),
            ),
            m(
              'details.fm-settings-disclosure',
              {
                oncreate: ({ dom }) => {
                  settingsDisclosureElement = dom as HTMLDetailsElement;
                },
                onremove: () => {
                  settingsDisclosureElement = undefined;
                },
              },
              [
                m('summary.fm-disclosure-summary-hidden'),
                m(
                  '.fm-settings-editor',
                  {
                    role: 'dialog',
                    'aria-label': 'Settings',
                    onclick: (event: MouseEvent) => {
                      if (event.target === event.currentTarget) {
                        closeSettingsDialog();
                      }
                    },
                  },
                  [
                    m('.fm-settings-editor-panel', [
                      m('.fm-settings-editor-heading', [
                        m('strong', 'Settings'),
                        m(
                          'button',
                          {
                            type: 'button',
                            'aria-label': 'Close settings',
                            onclick: () => closeSettingsDialog(),
                          },
                          closeIcon(),
                        ),
                      ]),
                      currentSettings === undefined
                        ? m('p', 'Loading settings…')
                        : settingsDialogOpen
                          ? m(SettingsEditor, {
                              settings: currentSettings,
                              actions: registeredActions,
                              platform,
                              runtime: keybindingRuntime,
                              plugins,
                              onPreview: (draft: Settings) => {
                                applyAppearance(draft);
                                m.redraw();
                              },
                              onSave: async (draft: Settings) => {
                                const showHiddenChanged =
                                  currentSettings !== undefined &&
                                  currentSettings.showHiddenFiles !== draft.showHiddenFiles;
                                await attrs.client.updateSettings(draft);
                                currentSettings = draft;
                                applyAppearance(draft);
                                closeSettingsDialog();
                                if (showHiddenChanged) {
                                  void applyShowHiddenFilesToAllTabs(
                                    attrs.client,
                                    draft.showHiddenFiles,
                                  );
                                }
                              },
                              onCancel: () => {
                                if (currentSettings !== undefined) applyAppearance(currentSettings);
                                closeSettingsDialog();
                              },
                              onTogglePlugin: (pluginId: PluginId, enabled: boolean) =>
                                attrs.client.setPluginEnabled(pluginId, enabled),
                              onRequestPluginLogs: (
                                pluginId: PluginId,
                              ): Promise<readonly PluginLogEntry[]> =>
                                attrs.client.getPluginLogs(pluginId),
                            })
                          : undefined,
                    ]),
                  ],
                ),
              ],
            ),
          ]),
          m('main.fm-workspace', [
            workspace === undefined
              ? m('.fm-workspace-loading', workspaceError ?? 'Loading workspace…')
              : m(WorkspaceLayoutView, {
                  workspace,
                  paneContent: (paneId) =>
                    paneContentBuilder(
                      attrs.client,
                      attrs.entryFormatSettings ?? loadedEntryFormatSettings,
                      paneId,
                    ),
                  onActivatePane: (paneId) =>
                    void activatePane(attrs.client, paneId).catch(() => undefined),
                  onUpdateLayout: (layout) => updateLayout(attrs.client, layout),
                  onSelectTab: (paneId, tabId) => selectTab(attrs.client, paneId, tabId),
                  onCloseTab: (paneId, tabId) => tabController.requestCloseTab(paneId, tabId),
                  onNewTab: (paneId) => tabController.openTab(paneId),
                  onFocusTerminal: () => focusTerminal?.() ?? false,
                  registerFlush: (flush) => {
                    flushPendingLayoutUpdate = flush;
                  },
                  registerFocusPane: (focus) => {
                    focusPane = focus;
                  },
                  searchQueryForLocationUri: (uri) => findFilesQueriesByLocationUri.get(uri),
                }),
            // Checksum and duplicate panels sit below the panes, visible only
            // while their job/scan is tracked (task 0077).
            checksumState.jobId !== undefined &&
              m(ChecksumResultsView, {
                algorithms: checksumState.algorithms,
                entries: checksumState.entries,
                totalEntries: checksumState.totalEntries,
                isComplete: checksumState.isComplete,
                isCancelled: checksumState.isCancelled,
                ...(checksumState.verification === undefined
                  ? {}
                  : { verification: checksumState.verification }),
                ...(checksumState.error === undefined ? {} : { error: checksumState.error }),
                onCopy: (algorithm) => {
                  void checksumController.copyChecksums(algorithm).then((content) => {
                    if (content !== undefined) void navigator.clipboard?.writeText(content);
                  });
                },
                onSave: (algorithm) => {
                  void checksumController.renderChecksumFile(algorithm).then((file) => {
                    if (file === undefined) return;
                    // Writing the file goes through the editor's own save path,
                    // which the user confirms; nothing is written silently.
                    void navigator.clipboard?.writeText(file.content);
                  });
                },
                onVerify: (content) => checksumController.verifyAgainst(content),
                onCancel: () => checksumController.cancelChecksums(),
                onClose: () => checksumController.closeChecksums(),
              }),
            duplicateState.scanId !== undefined &&
              m(DuplicateReviewView, {
                groups: duplicateState.groups,
                isComplete: duplicateState.isComplete,
                isCancelled: duplicateState.isCancelled,
                warningsCount: duplicateState.warningsCount,
                selectedUris: duplicateState.selectedUris,
                totalReclaimableBytes: totalReclaimableBytes(duplicateState),
                ...(duplicateState.error === undefined ? {} : { error: duplicateState.error }),
                isLastCopy: (uri) => wouldDeleteEveryCopy(duplicateState, uri),
                onToggle: (uri) => checksumController.toggleDuplicateSelection(uri),
                onDeleteSelected: () => checksumController.deleteSelectedDuplicates(),
                onCancel: () => checksumController.cancelDuplicateScan(),
                onClose: () => checksumController.closeDuplicates(),
              }),
          ]),
          runtimeKind === 'tauri'
            ? m(TerminalDrawer, {
                open: isTerminalVisible(openTerminalLocations, activeDirectory()?.location),
                location: activeDirectory()?.location,
                client: tauriTerminalClient,
                onToggle: globalKeydownHandlerContext.toggleTerminal,
                onSwitchPane: () => {
                  if (workspace === undefined) return;
                  const index = workspace.paneOrder.indexOf(workspace.activePaneId);
                  const nextPaneId = workspace.paneOrder[(index + 1) % workspace.paneOrder.length];
                  if (nextPaneId !== undefined) focusPane?.(nextPaneId);
                },
                onCycleTab: (direction) => {
                  if (workspace === undefined) return;
                  const paneId = workspace.activePaneId;
                  tabController.cycleTab(paneId, direction);
                  focusPane?.(paneId);
                },
                onFocusFolder: () => {
                  if (workspace !== undefined) focusPane?.(workspace.activePaneId);
                },
                registerFocus: (focus) => {
                  focusTerminal = focus;
                },
              })
            : undefined,
          clipboardMessage === undefined
            ? undefined
            : m('.fm-clipboard-message', { role: 'alert' }, clipboardMessage),
          m(CommandPalette, {
            open: commandPaletteOpen,
            actions: actionsWithFavourites(),
            recency: commandPaletteRecency,
            context: actionCommandController.actionContext(),
            availabilityContext: actionCommandController.commandAvailabilityContext(),
            onClose: () => {
              commandPaletteOpen = false;
            },
            onInvoke: actionCommandController.invokePaletteAction,
          }),
          m(DirectoryContextMenu, {
            open: contextMenu !== undefined,
            x: contextMenu?.x ?? 0,
            y: contextMenu?.y ?? 0,
            actions:
              contextMenu === undefined
                ? []
                : menuActionsForContext(
                    registeredActions,
                    actionCommandController.commandAvailabilityContext(
                      contextMenu.entries,
                      contextMenu.paneId,
                    ),
                  ),
            onClose: () => {
              contextMenu = undefined;
            },
            onInvoke: actionCommandController.invokeContextMenuAction,
          }),
          m(ShortcutsHelpDialog, {
            open: shortcutsHelpOpen,
            actions: registeredActions,
            keybindings: currentSettings?.keybindings ?? {},
            platform,
            runtime: keybindingRuntime,
            onClose: () => {
              shortcutsHelpOpen = false;
            },
          }),
          ...renderAppDialogs(attrs.client, pendingDelete, appDialogsContext),
          m(
            '.fm-function-key-bar',
            footerFunctionKeyBindings(
              registeredActions,
              currentSettings?.keybindings ?? {},
              {
                scope: 'table',
                platform,
                runtime: attrs.runtime === 'http' ? 'browser' : 'desktop',
              },
              (action) =>
                evaluateActionAvailability(
                  action.id === 'core.edit' || action.id === 'core.view'
                    ? {
                        ...action,
                        contextRequirements: {
                          ...action.contextRequirements,
                          featureAvailable: true,
                        },
                      }
                    : action,
                  actionCommandController.commandAvailabilityContext(),
                ).available,
            ).map((binding) =>
              m(
                'span.fm-function-key',
                {
                  key: binding.actionId,
                  role: 'button',
                  tabindex: binding.actionAvailable ? 0 : -1,
                  'aria-disabled': binding.actionAvailable ? undefined : 'true',
                  onclick: binding.actionAvailable
                    ? () => invokeFunctionKeyShortcut(binding.shortcut)
                    : undefined,
                },
                `${binding.shortcut} ${binding.title}`,
              ),
            ),
          ),
        ],
      );
    },
  };
};
