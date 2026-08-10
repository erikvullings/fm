import m, { type FactoryComponent } from 'mithril';
import { IconButton, type Theme, ThemeManager, toast } from 'mithril-materialized';

import type { FileManagerClient } from '../api/client/file-manager-client';
import {
  arrowLeftIcon,
  arrowRightIcon,
  closeIcon,
  commandIcon,
  cornerLeftUpIcon,
  layoutGridIcon,
  searchIcon,
  settingsIcon,
} from '../components/tabler-icons';
import {
  clearClipboard,
  emptyClipboard,
} from '../features/clipboard/clipboard';
import {
  copySelectionToClipboard,
  isCopySelectionAction,
} from '../features/clipboard/copy-selection-actions';
import { CommandPalette } from '../features/command-palette/command-palette';
import {
  type CommandAvailabilityContext,
  evaluateActionAvailability,
  menuActionsForContext,
} from '../features/commands/availability';
import { ContextMenu as DirectoryContextMenu } from '../features/commands/context-menu';
import { ConnectionsManager } from '../features/connections/connection-editor';
import {
  acceptSshHostKey as acceptSshHostKeyRequest,
  connectConnection as connectConnectionRequest,
  deleteConnection as deleteConnectionRequest,
  disconnectConnection as disconnectConnectionRequest,
  loadConnections,
  probeSshHostKey as probeSshHostKeyRequest,
  saveConnection,
  testConnection as testConnectionRequest,
  upsertConnection,
  withoutConnection,
} from '../features/connections/connections-model';
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
import { ArchivePasswordDialog } from '../features/navigation/archive-password-dialog';
import {
  createNavigationController,
  type NavigationController,
  type PaneDirectoryView,
} from '../features/navigation/navigation';
import {
  ArchiveCreateDialog,
  type ArchiveFormat,
} from '../features/operations/archive-create-dialog';
import { ConflictDialog } from '../features/operations/conflict-dialog';
import { CreateDirectoryDialog } from '../features/operations/create-directory-dialog';
import { MultiRenameDialog } from '../features/operations/multi-rename-dialog';
import { OperationCentre } from '../features/operations/operation-centre';
import {
  createOperationsState,
  dismissOperation,
  transitionOperationState,
} from '../features/operations/operation-state';
import {
  createOperationsController,
  type OperationsController,
} from '../features/operations/operations-controller';
import { PermanentDeleteDialog } from '../features/operations/permanent-delete-dialog';
import { CloseLastTabDialog } from '../features/panes/close-last-tab-dialog';
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
import type { FindFilesSearchParams } from '../features/search/find-files-dialog';
import { FindFilesDialog } from '../features/search/find-files-dialog';
import type { SelectionPlatform } from '../features/selection/keybindings';
import {
  emptySelection,
  getSelectedEntries,
  getSelectedEntryLocations,
  reduceSelection,
  type SelectionState,
} from '../features/selection/selection';
import { SettingsEditor } from '../features/settings/settings-editor';
import {
  createSettingsController,
  type SettingsController,
  type SettingsControllerContext,
} from '../features/settings/settings-controller';
import {
  createGlobalKeydownHandler,
  type GlobalKeydownContext,
} from '../features/keybindings/global-keydown-handler';
import {
  type SortColumn,
  type SortModel,
  sortEntries,
  sortEntriesResponsive,
} from '../features/sorting/sorting';
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
  pathFromUri,
  WorkspaceLayoutView,
  type WorkspacePaneContent,
} from '../features/workspace/workspace-layout';
import { sortWorkspaceSummaries } from '../features/workspace/workspace-manager';
import { WorkspaceSwitcher } from '../features/workspace/workspace-switcher';
import {
  footerFunctionKeyBindings,
  type KeybindingRuntime,
} from '../keybindings/dispatcher';
import type {
  ActionDescriptor,
  ActionInvocationContext,
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
  let workspaceDisclosureElement: HTMLDetailsElement | undefined;
  let registeredActions: readonly ActionDescriptor[] = [];
  let systemLocations: readonly SystemLocation[] = [];
  let systemLocationsError: string | undefined;
  const unavailableLocations = new Set<string>();
  let plugins: readonly PluginDescriptor[] = [];
  let connections: readonly Connection[] = [];
  let connectionsManagerOpen = false;

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
        defaultShortcuts: [],
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
  let createDirectoryOpen = false;
  let createDirectoryLocation: Location | undefined;
  let archiveCreateRequest:
    | {
      readonly sources: readonly Location[];
      readonly destinationDirectory: Location;
      readonly moveSources: boolean;
    }
    | undefined;
  let multiRenameOpen = false;
  let multiRenameEntries: readonly EntrySummary[] = [];
  let multiRenameLocation: Location | undefined;
  let multiRenameExistingNames: ReadonlySet<string> = new Set();
  let pendingArchiveCredential:
    | {
      readonly location: Location;
      readonly invalid: boolean;
      readonly resolve: (supplied: boolean) => void;
    }
    | undefined;
  let archiveCredentialError: string | undefined;
  let findFilesOpen = false;
  let findFilesRoot: Location | undefined;
  let findFilesSearchId: string | undefined;
  let findFilesError: string | undefined;
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
  /** Registered by `WorkspaceLayoutView` (task 0089): moves DOM focus into a pane so keyboard
   * cursor navigation works immediately, e.g. right after a filename search closes its dialog. */
  let focusPane: ((paneId: PaneId) => void) | undefined;
  let commandPaletteOpen = false;
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
  let pendingCreatedLocation: string | undefined;
  /**
   * Every per-tab runtime cache below is keyed by a composite `${paneId}:${tabId}`
   * string (see {@link tabKey}) rather than by `PaneId` alone, so switching tabs
   * never bleeds one tab's directory/selection/sort/filter state into another's
   * (spec §37).
   */
  const directories = new Map<string, PaneDirectoryView>();
  const selections = new Map<string, SelectionState>();
  /**
   * The Lister-style viewer (task 0088) opened for a pane via F3 `core.view` — keyed by `PaneId`
   * (not `${paneId}:${tabId}`) since it replaces the whole pane's surface regardless of tab.
   */
  const viewerByPane = new Map<
    PaneId,
    { readonly controller: FileViewerController; state: FileViewerState }
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

  /** Opens the Lister-style viewer (task 0088) for `entry` in `paneId`, replacing any viewer
   * already open there. */
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
  ): void {
    viewerByPane.get(paneId)?.controller.dispose();
    const controller = createFileViewerController({
      client,
      entry,
      ...(initialSearch ? { initialSearch } : {}),
      update: (state) => {
        const existing = viewerByPane.get(paneId);
        if (existing === undefined) return;
        if (state.status === 'unsupported') {
          // Leaving an empty viewer pane open just for the user to close it manually is
          // pointless busywork; dismiss it immediately and use a self-disappearing toast
          // instead (Alt+F3 opens the same file in the OS default application).
          closeViewer(paneId);
          toast({
            html: `Preview not available for "${entry.name}". Press Alt+F3 to open it in the default application.`,
          });
          return;
        }
        existing.state = state;
        m.redraw();
      },
    });
    viewerByPane.set(paneId, { controller, state: { status: 'loading', entry } });
    m.redraw();
  }

  function closeViewer(paneId: PaneId): void {
    viewerByPane.get(paneId)?.controller.dispose();
    viewerByPane.delete(paneId);
    m.redraw();
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
      viewerByPane.get(paneId)?.controller.dispose();
      viewerByPane.delete(paneId);
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

  function refetchAffectedPanes(paneId?: PaneId): void {
    if (workspace === undefined) return;
    for (const candidate of workspace.paneOrder) {
      // `background: true` - this is a filesystem-watch-triggered refresh, not a user-requested
      // one. It must never abort an explicit navigation already in flight for the pane's tab
      // (e.g. `navigate()` to a fresh `search://` location), or it silently discards that
      // navigation's own snapshot fetch with no error and no results ever appearing.
      if (paneId === undefined || candidate === paneId) {
        void navigation.load(candidate, { background: true });
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
    if (delta.type === 'entriesAdded' && pendingCreatedLocation !== undefined) {
      const created = delta.entries.find((entry) => entry.location.uri === pendingCreatedLocation);
      if (created !== undefined) {
        selections.set(
          key,
          reduceSelection(emptySelection, { type: 'selectOnly', entryId: created.id }, [
            created.id,
          ]),
        );
        pendingCreatedLocation = undefined;
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

  /** The active tab's current "show hidden files" setting, so a new search respects it. */
  function activeShowHidden(paneId: PaneId): boolean {
    const pane = workspace?.panesById[paneId];
    const tab = pane === undefined ? undefined : pane.tabsById[pane.activeTabId];
    return tab?.view.showHidden ?? false;
  }

  /** Opens filename search at the real directory that produced a virtual search location. */
  function openFindFiles(): void {
    const active = activeDirectory();
    if (active === undefined) return;
    findFilesRoot = findFilesRootsByLocationUri.get(active.location.uri) ?? active.location;
    findFilesOpen = true;
  }

  /**
   * Invalidates any in-flight `startSearch` resolution and running search
   * when incremented, without depending on backend-assigned search ids
   * (which are not yet known synchronously) for correlation.
   */
  let findFilesGeneration = 0;

  function closeFindFiles(): void {
    if (findFilesSearchId !== undefined) {
      void attrsClient.cancelSearch(findFilesSearchId).catch(() => undefined);
    }
    findFilesGeneration += 1;
    findFilesOpen = false;
    findFilesRoot = undefined;
    findFilesSearchId = undefined;
    findFilesError = undefined;
  }

  /** Closes the query dialog without cancelling the search now displayed in the active pane. */
  function dismissFindFiles(): void {
    findFilesOpen = false;
    findFilesRoot = undefined;
    findFilesError = undefined;
  }

  /** Starts (or restarts) a search rooted at the dialog's current directory. */
  function startFindFilesSearch(params: FindFilesSearchParams): void {
    const root = findFilesRoot;
    if (root === undefined || workspace === undefined) return;
    if (findFilesSearchId !== undefined) {
      void attrsClient.cancelSearch(findFilesSearchId).catch(() => undefined);
    }
    findFilesGeneration += 1;
    const generation = findFilesGeneration;
    findFilesError = undefined;
    findFilesSearchId = undefined;
    const searchPaneId = activeDirectory()?.paneId ?? workspace.activePaneId;
    void attrsClient
      .startSearch({
        query: params.filenameQuery,
        contentQuery: params.contentQuery,
        contentRegex: params.contentRegex,
        contentCaseSensitive: false,
        contentWholeWord: true,
        recurse: params.recurse,
        showHidden: searchPaneId === undefined ? false : activeShowHidden(searchPaneId),
        roots: [root],
        workspaceId: workspace.id,
      })
      .then((result) => {
        if (generation !== findFilesGeneration) {
          void attrsClient.cancelSearch(result.searchId).catch(() => undefined);
          return;
        }
        findFilesSearchId = result.searchId;
        findFilesRootsByLocationUri.set(result.location.uri, root);
        findFilesQueriesByLocationUri.set(
          result.location.uri,
          params.filenameQuery || JSON.stringify(params),
        );
        findFilesParamsByLocationUri.set(result.location.uri, params);
        const paneId = activeDirectory()?.paneId ?? workspace?.activePaneId;
        if (paneId === undefined) return;
        dismissFindFiles();
        void navigation.navigate(paneId, result.location).then(() => {
          // Land keyboard focus in the pane so arrow keys move the cursor immediately,
          // matching the UX of navigating there by clicking (task 0089 follow-up).
          focusPane?.(paneId);
          m.redraw();
        });
      })
      .catch((error: unknown) => {
        if (generation !== findFilesGeneration) return;
        findFilesError = error instanceof Error ? error.message : 'Unable to start search';
        m.redraw();
      });
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
    return getSelectedEntryLocations(selection, directory?.entries ?? []);
  }

  function actionContext() {
    const active = activeDirectory();
    const selection =
      active === undefined ? undefined : selections.get(activeTabKey(active.paneId));
    return {
      ...(active === undefined ? {} : { paneId: active.paneId }),
      ...(selection === undefined || selection.selectedEntryIds.length === 0
        ? {}
        : { selectedEntryIds: [...selection.selectedEntryIds] }),
      ...(selection?.cursorEntryId === undefined ? {} : { cursorEntryId: selection.cursorEntryId }),
    };
  }

  function commandAvailabilityContext(
    selectedEntries?: readonly EntrySummary[],
    paneId?: PaneId,
  ): CommandAvailabilityContext {
    const active = activeDirectory();
    const effectivePaneId = paneId ?? active?.paneId;
    const effectiveKey = effectivePaneId === undefined ? undefined : activeTabKey(effectivePaneId);
    const effectiveEntries =
      selectedEntries ??
      (effectiveKey === undefined
        ? []
        : getSelectedEntries(
          selections.get(effectiveKey),
          directories.get(effectiveKey)?.entries ?? [],
        ));
    const directory = effectiveKey === undefined ? undefined : directories.get(effectiveKey);
    return {
      selectedEntries: effectiveEntries,
      locationWritable: directory?.writable === true,
      clipboardHasEntries: clipboard().locations.length > 0,
      openTerminalSupported,
    };
  }

  /**
   * `core.open`/`core.view`/`core.edit`/`core.openWith`/
   * `core.revealInSystemFileManager` act on a single entry and
   * `core.openTerminal` acts on the current directory (task 0061); the
   * backend cannot resolve an opaque `EntryId` back to a path itself (there
   * is no server-side entry registry, mirroring plugin action invocation),
   * so the frontend must supply the target as an explicit `{ uri }`
   * parameter built from the already-loaded `Location`.
   */
  function platformActionParameters(
    actionId: string,
    selectedEntries: readonly EntrySummary[],
    directoryLocation: Location | undefined,
  ): { uri: string } | undefined {
    if (
      actionId === 'core.open' ||
      actionId === 'core.view' ||
      actionId === 'core.edit' ||
      actionId === 'core.openWith' ||
      actionId === 'core.revealInSystemFileManager'
    ) {
      const entry = selectedEntries[0];
      return entry === undefined ? undefined : { uri: entry.location.uri };
    }
    if (actionId === 'core.openTerminal') {
      return directoryLocation === undefined ? undefined : { uri: directoryLocation.uri };
    }
    return undefined;
  }

  function invokeActionById(
    actionId: string,
    parameters: unknown,
    context: ActionInvocationContext,
  ): void {
    void attrsClient
      .invokeAction({
        actionId,
        ...(parameters === undefined ? {} : { parameters }),
        context,
      })
      .then(() => {
        commandPaletteRecency.set(actionId, Date.now());
        m.redraw();
      })
      .catch((error: unknown) => {
        // Action-invocation failures are transient and user-actionable (e.g. "no default
        // application registered") - a toast is enough; never leave a persistent banner
        // above the command bar for these.
        toast({ html: error instanceof Error ? error.message : 'Unable to run command.' });
        m.redraw();
      });
  }

  function invokePaletteAction(
    action: ActionDescriptor,
    parameters?: unknown,
    context = actionContext(),
  ): void {
    if (action.id === 'core.palette') return;
    if (action.id === 'core.favourites') {
      commandPaletteOpen = true;
      return;
    }
    if (action.id.startsWith('core.favourite.')) {
      const index = Number(action.id.slice('core.favourite.'.length));
      const favourite = currentSettings?.favouriteLocations[index];
      if (favourite !== undefined && context.paneId !== undefined) {
        void navigation.navigate(context.paneId, favourite.location);
      }
      return;
    }
    if (action.id === 'core.createDirectory') {
      createDirectoryLocation = undefined;
      createDirectoryOpen = true;
      return;
    }
    const paneId = context.paneId;
    const directory = paneId === undefined ? undefined : directories.get(activeTabKey(paneId));
    const selectedEntries =
      directory === undefined || context.selectedEntryIds === undefined
        ? []
        : directory.entries.filter((entry) => new Set(context.selectedEntryIds).has(entry.id));
    if (isCopySelectionAction(action.id)) {
      if (directory === undefined || directory.location === undefined) return;
      void copySelectionToClipboard(action.id, selectedEntries, directory.location)
        .then((copied) => {
          if (copied) commandPaletteRecency.set(action.id, Date.now());
          m.redraw();
        })
        .catch((error: unknown) => {
          toast({
            html:
              error instanceof Error ? error.message : 'Unable to write to the system clipboard.',
          });
          m.redraw();
        });
      return;
    }
    const effectiveParameters =
      parameters ?? platformActionParameters(action.id, selectedEntries, directory?.location);
    invokeActionById(action.id, effectiveParameters, context);
  }

  function openContextMenu(
    paneId: PaneId,
    entries: readonly EntrySummary[],
    x: number,
    y: number,
  ): void {
    contextMenu = { paneId, entries, x, y };
    m.redraw();
  }

  function invokeContextMenuAction(actionId: string): void {
    const menu = contextMenu;
    if (menu === undefined) return;
    const action = registeredActions.find((candidate) => candidate.id === actionId);
    const directory = directories.get(activeTabKey(menu.paneId));
    if (action === undefined || directory === undefined) return;
    if (
      !evaluateActionAvailability(action, commandAvailabilityContext(menu.entries, menu.paneId))
        .available
    ) {
      return;
    }
    if (action.id === 'core.createDirectory') {
      createDirectoryLocation = directory.location;
      createDirectoryOpen = true;
      return;
    }
    if (action.id === 'core.refresh') {
      void navigation.load(menu.paneId);
      return;
    }
    if (action.id === 'core.paste') {
      const currentClipboard = clipboard();
      const mode = currentClipboard.mode;
      if (mode === undefined || directory.location === undefined) return;
      void (
        mode === 'move'
          ? opsController.move(currentClipboard.locations, directory.location)
          : opsController.copy(currentClipboard.locations, directory.location)
      ).then(() => {
        if (mode === 'move') replaceClipboard(clearClipboard(currentClipboard));
        m.redraw();
      });
      return;
    }
    invokePaletteAction(action, undefined, {
      paneId: menu.paneId,
      selectedEntryIds: menu.entries.map((entry) => entry.id),
      ...(menu.entries[0] === undefined ? {} : { cursorEntryId: menu.entries[0].id }),
    });
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
    getViewer: (paneId) => viewerByPane.get(paneId),
    getArchiveCreateRequest: () => archiveCreateRequest,
    getCreateDirectoryOpen: () => createDirectoryOpen,
    getAppState: () => appState,
    setCommandPaletteOpen: (open) => {
      commandPaletteOpen = open;
    },
    setClipboardMessage: (msg) => {
      clipboardMessage = msg;
    },
    setArchiveCreateRequest: (req) => {
      archiveCreateRequest = req;
    },
    setCreateDirectoryOpen: (open) => {
      createDirectoryOpen = open;
    },
    setAppState: (state) => {
      appState = state;
    },
    setQuickFilterOpen: (key, open) => {
      quickFilterOpen.set(key, open);
    },
    getTabController: () => tabController,
    getOpsController: () => opsController,
    getNavigation: () => navigation,
    activeDirectory,
    activeTabKey,
    actionsWithFavourites,
    openFindFiles,
    replaceClipboard,
    selectedLocations,
    invokeActionById,
    openViewer: (paneId, entry, initialSearch) =>
      openViewer(attrsClient, paneId, entry, initialSearch),
    openEditor: (paneId, entry) => openEditor(attrsClient, paneId, entry),
    actionContext,
    commandAvailabilityContext,
    contentSearchInitialQuery,
    refetchAffectedPanes,
    platformActionParameters,
    activatePane: (paneId) => activatePane(attrsClient, paneId),
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
    getViewerByPane: () => viewerByPane,
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
      multiRenameOpen = open;
    },
    setMultiRenameEntries: (entries) => {
      multiRenameEntries = entries;
    },
    setMultiRenameLocation: (location) => {
      multiRenameLocation = location;
    },
    setMultiRenameExistingNames: (names) => {
      multiRenameExistingNames = names;
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
    openViewer: (paneId, entry, initialSearch) =>
      openViewer(attrsClient, paneId, entry, initialSearch),
    closeViewer,
    closeEditor,
    updateLocationSettings,
    invokeActionById,
    openContextMenu,
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

  function activatePane(client: FileManagerClient, paneId: PaneId): void {
    if (workspace === undefined || workspace.activePaneId === paneId) {
      return;
    }
    void dispatchWorkspaceCommand(
      client,
      {
        type: 'setActivePane',
        workspaceId: workspace.id,
        paneId,
        expectedRevision: workspace.revision,
      },
      replaceWorkspace,
    ).catch(() => undefined);
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

  /** Opens a new tab in `paneId`, starting at the pane's currently active location. */

  return {
    oninit: ({ attrs }) => {
      attrsClient = attrs.client;
      opsController = createOperationsController(attrs.client);
      workspaceController = createWorkspaceController(attrs.client, workspaceControllerContext);
      tabController = createTabController(attrs.client, tabControllerContext);
      settingsController = createSettingsController(settingsControllerContext);
      globalKeydownHandler = createGlobalKeydownHandler(globalKeydownHandlerContext);
      paneContentBuilder = createPaneContentBuilder(paneContentBuilderContext);
      keybindingRuntime = attrs.runtime === 'http' ? 'browser' : 'desktop';
      runtimeKind = attrs.runtime;
      document.addEventListener('keydown', globalKeydownHandler);
      systemThemeQuery?.addEventListener('change', handleSystemThemeChange);
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
          pendingArchiveCredential?.resolve(false);
          archiveCredentialError = undefined;
          return new Promise<boolean>((resolve) => {
            pendingArchiveCredential = { location, invalid, resolve };
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
      pendingArchiveCredential?.resolve(false);
      pendingArchiveCredential = undefined;
      document.removeEventListener('keydown', globalKeydownHandler);
      systemThemeQuery?.removeEventListener('change', handleSystemThemeChange);
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
              m(
                IconButton,
                {
                  disabled:
                    workspace?.panesById[workspace.activePaneId]?.tabsById[
                      workspace.panesById[workspace.activePaneId]?.activeTabId ?? ''
                    ]?.canNavigateBack !== true,
                  'aria-label': 'Back',
                  'data-tooltip': 'Back',
                  onclick: () => void navigation.back(workspace?.activePaneId ?? ''),
                },
                arrowLeftIcon(),
              ),
              m(
                IconButton,
                {
                  disabled:
                    workspace?.panesById[workspace.activePaneId]?.tabsById[
                      workspace.panesById[workspace.activePaneId]?.activeTabId ?? ''
                    ]?.canNavigateForward !== true,
                  'aria-label': 'Forward',
                  'data-tooltip': 'Forward',
                  onclick: () => void navigation.forward(workspace?.activePaneId ?? ''),
                },
                arrowRightIcon(),
              ),
              m(
                IconButton,
                {
                  disabled: workspace === undefined,
                  'aria-label': 'Parent directory',
                  'data-tooltip': 'Parent directory',
                  onclick: () => void navigation.parent(workspace?.activePaneId ?? ''),
                },
                cornerLeftUpIcon(),
              ),
            ]),
            m(
              IconButton,
              {
                disabled: activeDirectory() === undefined,
                'aria-label': 'Find files',
                'data-tooltip': 'Find files',
                onclick: () => {
                  openFindFiles();
                },
              },
              searchIcon(),
            ),
            m(
              IconButton,
              {
                className: 'fm-command-palette-trigger',
                disabled: registeredActions.length === 0,
                'aria-label': 'Command palette',
                'data-tooltip': 'Command palette',
                onclick: () => {
                  commandPaletteOpen = true;
                },
              },
              commandIcon(),
            ),
            m(
              IconButton,
              {
                className: 'fm-workspace-switcher-button',
                'aria-label': `Workspace switcher, current workspace: ${workspace?.name ?? 'none'}`,
                tooltip: `Switch workspace — current: ${workspace?.name ?? 'none'}`,
                onclick: () => {
                  if (workspaceDisclosureElement !== undefined) {
                    workspaceDisclosureElement.open = !workspaceDisclosureElement.open;
                  }
                },
              },
              layoutGridIcon(),
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
            m(
              IconButton,
              {
                className: 'fm-settings-button',
                'aria-label': 'Settings',
                tooltip: 'Open settings',
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
                onActivatePane: (paneId) => activatePane(attrs.client, paneId),
                onUpdateLayout: (layout) => updateLayout(attrs.client, layout),
                onSelectTab: (paneId, tabId) => tabController.activateTab(paneId, tabId),
                onCloseTab: (paneId, tabId) => tabController.requestCloseTab(paneId, tabId),
                onNewTab: (paneId) => tabController.openTab(paneId),
                registerFlush: (flush) => {
                  flushPendingLayoutUpdate = flush;
                },
                registerFocusPane: (focus) => {
                  focusPane = focus;
                },
                searchQueryForLocationUri: (uri) => findFilesQueriesByLocationUri.get(uri),
              }),
          ]),
          clipboardMessage === undefined
            ? undefined
            : m('.fm-clipboard-message', { role: 'alert' }, clipboardMessage),
          m(CommandPalette, {
            open: commandPaletteOpen,
            actions: actionsWithFavourites(),
            recency: commandPaletteRecency,
            context: actionContext(),
            availabilityContext: commandAvailabilityContext(),
            onClose: () => {
              commandPaletteOpen = false;
            },
            onInvoke: invokePaletteAction,
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
                  commandAvailabilityContext(contextMenu.entries, contextMenu.paneId),
                ),
            onClose: () => {
              contextMenu = undefined;
            },
            onInvoke: invokeContextMenuAction,
          }),
          m(OperationCentre, {
            state: operations,
            onCancel: (operationId) => {
              operations = transitionOperationState(operations, operationId, 'cancelling');
              void attrs.client.cancelOperation(operationId).catch(() => undefined);
            },
            onPause: (operationId) => {
              operations = transitionOperationState(operations, operationId, 'paused');
              void attrs.client.pauseOperation(operationId).catch(() => undefined);
            },
            onResume: (operationId) => {
              operations = transitionOperationState(operations, operationId, 'running');
              void attrs.client.resumeOperation(operationId).catch(() => undefined);
            },
            onDismiss: (operationId) => {
              cancelAutoDismiss(operationId);
              rememberDismissedOperation(operationId);
              operations = dismissOperation(operations, operationId);
            },
          }),
          m(CreateDirectoryDialog, {
            open: createDirectoryOpen,
            onCancel: () => {
              createDirectoryOpen = false;
              createDirectoryLocation = undefined;
            },
            onConfirm: (name: string) => {
              const location = createDirectoryLocation ?? activeDirectory()?.location;
              if (location === undefined) return;
              createDirectoryOpen = false;
              createDirectoryLocation = undefined;
              pendingCreatedLocation = `${location.uri.replace(/\/$/u, '')}/${encodeURIComponent(name)}`;
              void opsController.createDirectory(location, name).catch(() => {
                pendingCreatedLocation = undefined;
              });
            },
          }),
          m(ArchiveCreateDialog, {
            open: archiveCreateRequest !== undefined,
            moveSources: archiveCreateRequest?.moveSources ?? false,
            onCancel: () => {
              archiveCreateRequest = undefined;
            },
            onConfirm: (name: string, format: ArchiveFormat, compressionLevel?: number) => {
              const request = archiveCreateRequest;
              if (request === undefined) return;
              archiveCreateRequest = undefined;
              void opsController.pack(
                request.sources,
                {
                  ...request.destinationDirectory,
                  uri: `${request.destinationDirectory.uri.replace(/\/$/u, '')}/${encodeURIComponent(name)}`,
                },
                request.moveSources,
                format,
                compressionLevel,
              );
            },
          }),
          m(MultiRenameDialog, {
            open: multiRenameOpen,
            entries: multiRenameEntries,
            existingSiblingNames: multiRenameExistingNames,
            onCancel: () => {
              multiRenameOpen = false;
              multiRenameEntries = [];
              multiRenameLocation = undefined;
              multiRenameExistingNames = new Set();
            },
            onApply: (renamed) => {
              const location = multiRenameLocation;
              multiRenameOpen = false;
              if (location === undefined) return;
              const entriesById = new Map(multiRenameEntries.map((entry) => [entry.id, entry]));
              const sources: Location[] = [];
              const destinations: Location[] = [];
              for (const { id, newName } of renamed) {
                const entry = entriesById.get(id);
                if (entry === undefined) continue;
                const destinationUri = `${location.uri.replace(/\/$/u, '')}/${encodeURIComponent(newName)}`;
                sources.push(entry.location);
                destinations.push({ ...entry.location, uri: destinationUri });
              }
              multiRenameEntries = [];
              multiRenameLocation = undefined;
              multiRenameExistingNames = new Set();
              if (sources.length === 0) return;
              void opsController.multiRename(sources, destinations);
            },
          }),
          m(ArchivePasswordDialog, {
            open: pendingArchiveCredential !== undefined,
            invalid: pendingArchiveCredential?.invalid ?? false,
            archiveLabel:
              pendingArchiveCredential === undefined
                ? ''
                : pathFromUri(pendingArchiveCredential.location.uri),
            ...(archiveCredentialError === undefined ? {} : { error: archiveCredentialError }),
            onCancel: () => {
              const pending = pendingArchiveCredential;
              pendingArchiveCredential = undefined;
              archiveCredentialError = undefined;
              pending?.resolve(false);
            },
            onConfirm: (password: string) => {
              const pending = pendingArchiveCredential;
              if (pending === undefined) return;
              void attrs.client
                .cacheArchivePassword({ location: pending.location, password })
                .then(() => {
                  if (pendingArchiveCredential === pending) {
                    pendingArchiveCredential = undefined;
                    archiveCredentialError = undefined;
                    pending.resolve(true);
                    m.redraw();
                  }
                })
                .catch((error: unknown) => {
                  archiveCredentialError =
                    error instanceof Error ? error.message : 'Unable to cache archive password';
                  m.redraw();
                });
            },
          }),
          m(ConnectionsManager, {
            open: connectionsManagerOpen,
            connections,
            onRefresh: async () => {
              connections = await loadConnections(attrs.client);
            },
            onClose: () => {
              connectionsManagerOpen = false;
              m.redraw();
            },
            onSave: async (draft, editingId) => {
              const result = await saveConnection(attrs.client, draft, editingId);
              if (result.ok) {
                connections = upsertConnection(connections, result.connection);
              }
              return result;
            },
            onDelete: async (id) => {
              await deleteConnectionRequest(attrs.client, id);
              connections = withoutConnection(connections, id);
            },
            onConnect: async (id) => {
              const updated = await connectConnectionRequest(attrs.client, id);
              connections = upsertConnection(connections, updated);
              return updated;
            },
            onDisconnect: async (id) => {
              const updated = await disconnectConnectionRequest(attrs.client, id);
              connections = upsertConnection(connections, updated);
              return updated;
            },
            onTest: async (id) => {
              const updated = await testConnectionRequest(attrs.client, id);
              connections = upsertConnection(connections, updated);
              return updated;
            },
            onProbeHostKey: (id) => probeSshHostKeyRequest(attrs.client, id),
            onAcceptHostKey: (id, fingerprint) =>
              acceptSshHostKeyRequest(attrs.client, id, fingerprint),
          }),
          m(FindFilesDialog, {
            open: findFilesOpen,
            scopeLabel: findFilesRoot === undefined ? '' : pathFromUri(findFilesRoot.uri),
            ...(findFilesError === undefined ? {} : { error: findFilesError }),
            onSearch: (params: FindFilesSearchParams) => startFindFilesSearch(params),
            onCancel: () => closeFindFiles(),
          }),
          m(PermanentDeleteDialog, {
            open: pendingDelete !== undefined,
            itemCount: pendingDelete?.progress.totalItems ?? 0,
            totalBytes: pendingDelete?.progress.totalBytes ?? 0,
            onCancel: () => {
              if (pendingDelete !== undefined) void attrs.client.cancelOperation(pendingDelete.id);
            },
            onConfirm: () => {
              if (pendingDelete !== undefined) {
                void attrs.client
                  .resolveConflict({
                    operationId: pendingDelete.id,
                    resolution: 'confirm',
                    applyToAllSimilar: false,
                  })
                  .then(() => {
                    refetchAffectedPanes();
                    m.redraw();
                  });
              }
            },
          }),
          m(ConflictDialog, {
            conflict: pendingConflict,
            onResolve: (resolution, applyToAllSimilar) => {
              const conflict = pendingConflict;
              if (conflict === undefined) return;
              void attrs.client
                .resolveConflict({
                  operationId: conflict.operationId,
                  resolution,
                  applyToAllSimilar,
                })
                .then(() => {
                  if (pendingConflict?.conflictId === conflict.conflictId) {
                    pendingConflict = undefined;
                    refetchAffectedPanes();
                    m.redraw();
                  }
                });
            },
          }),
          m(CloseLastTabDialog, {
            open: closeTabConfirmation !== undefined,
            onConfirm: () => {
              const confirmation = closeTabConfirmation;
              closeTabConfirmation = undefined;
              if (confirmation !== undefined) {
                tabController.performCloseTab(confirmation.paneId, confirmation.tabId);
              }
            },
            onCancel: () => {
              closeTabConfirmation = undefined;
            },
          }),
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
                  commandAvailabilityContext(),
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
