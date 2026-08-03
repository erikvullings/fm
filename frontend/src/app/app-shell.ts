import { getCurrentWindow } from '@tauri-apps/api/window';
import m, { type FactoryComponent } from 'mithril';
import { type Theme, ThemeManager } from 'mithril-materialized';

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
  copyToClipboard,
  cutToClipboard,
  emptyClipboard,
  isCutLocation,
  validatePasteTarget,
} from '../features/clipboard/clipboard';
import { CommandPalette } from '../features/command-palette/command-palette';
import {
  type CommandAvailabilityContext,
  evaluateActionAvailability,
  menuActionsForContext,
} from '../features/commands/availability';
import { ContextMenu as DirectoryContextMenu } from '../features/commands/context-menu';
import { SAMPLE_FILE_AGE_COLUMN } from '../features/directory-table/directory-table';
import {
  DEFAULT_ENTRY_FORMAT_SETTINGS,
  type EntryFormatSettings,
} from '../features/entry-formatting/entry-formatting';
import {
  createEntryMetadataLoader,
  type EntryMetadataLoader,
  type EntryMetadataView,
} from '../features/entry-metadata/entry-metadata-loader';
import {
  createNavigationController,
  type NavigationController,
  type PaneDirectoryView,
  parentLocation,
} from '../features/navigation/navigation';
import { ConflictDialog } from '../features/operations/conflict-dialog';
import { CreateDirectoryDialog } from '../features/operations/create-directory-dialog';
import { OperationCentre } from '../features/operations/operation-centre';
import {
  createOperationsState,
  dismissOperation,
  reduceOperationEvents,
  transitionOperationState,
} from '../features/operations/operation-state';
import { PermanentDeleteDialog } from '../features/operations/permanent-delete-dialog';
import { CloseLastTabDialog } from '../features/panes/close-last-tab-dialog';
import { isParentEntry, withParentEntry } from '../features/panes/parent-entry';
import { cycledTabIndex, tabIdForJump } from '../features/panes/tab-navigation';
import { filterEntries, hiddenSelectedEntryCount } from '../features/quick-filter/quick-filter';
import { FindFilesDialog } from '../features/search/find-files-dialog';
import type { SelectionPlatform } from '../features/selection/keybindings';
import {
  emptySelection,
  reduceSelection,
  type SelectionAction,
  type SelectionState,
} from '../features/selection/selection';
import { SettingsEditor } from '../features/settings/settings-editor';
import {
  type SortColumn,
  type SortModel,
  sortEntries,
  sortEntriesResponsive,
} from '../features/sorting/sorting';
import {
  dispatchWorkspaceCommand,
  isWorkspaceRevisionConflict,
} from '../features/workspace/dispatch-workspace-command';
import {
  pathFromUri,
  WorkspaceLayoutView,
  type WorkspacePaneContent,
} from '../features/workspace/workspace-layout';
import {
  firstAvailableWorkspaceId,
  sortWorkspaceSummaries,
} from '../features/workspace/workspace-manager';
import { WorkspaceSwitcher } from '../features/workspace/workspace-switcher';
import {
  dispatchKeybinding,
  footerFunctionKeyBindings,
  hasPrimaryModifier,
  type KeybindingRuntime,
} from '../keybindings/dispatcher';
import type {
  ActionDescriptor,
  ActionInvocationContext,
  BackendEvent,
  DirectoryDelta,
  EntryId,
  EntrySummary,
  Location,
  Operation,
  OperationConflict,
  OperationId,
  OperationState,
  PaneId,
  PluginDescriptor,
  PluginId,
  PluginLogEntry,
  Settings,
  SortDescriptor,
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
  clipboardPatch,
  connectionPatch,
  createInitialAppState,
} from '../state';
import { installCatppuccinIconTheme, restoreDefaultIconTheme } from '../themes/catppuccin-icons';
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

/**
 * Operations that reach a successful terminal state within this window of
 * their `createdAt` are dismissed without ever showing the operation centre:
 * no user can read a progress card that appears and disappears faster than
 * this, so surfacing it would only be visual noise.
 */
const FAST_OPERATION_DISMISS_THRESHOLD_MS = 500;

/**
 * Delay before a terminal, non-`failed` operation (completed, cancelled or
 * interrupted) auto-dismisses itself. Only failures require the user to
 * dismiss manually; everything else would otherwise pile up in the operation
 * centre forever, since dismissal is not persisted and every app restart
 * reloads the full backend history.
 */
const AUTO_DISMISS_DELAY_MS = 5_000;

/** States that auto-dismiss; `failed` is intentionally excluded. */
function isAutoDismissibleState(state: OperationState): boolean {
  return (
    state === 'completed' ||
    state === 'completedWithWarnings' ||
    state === 'cancelled' ||
    state === 'interrupted'
  );
}

/**
 * A factory component so that per-instance state lives in the closure rather
 * than on a shared module-level object.
 */
export const AppShell: FactoryComponent<AppShellAttrs> = () => {
  let theme: Theme = DEFAULT_THEME;
  let currentSettings: Settings | undefined;
  let registeredActions: readonly ActionDescriptor[] = [];
  let plugins: readonly PluginDescriptor[] = [];
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
  let findFilesOpen = false;
  let findFilesRoot: Location | undefined;
  let findFilesSearchId: string | undefined;
  let findFilesResults: readonly EntrySummary[] = [];
  let findFilesSearching = false;
  let findFilesError: string | undefined;
  let commandPaletteOpen = false;
  let commandPaletteError: string | undefined;
  let openTerminalSupported = false;
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
  const metadataLoaders = new Map<string, EntryMetadataLoader>();
  const metadataViews = new Map<string, EntryMetadataView>();
  const sortedEntries = new Map<
    string,
    {
      readonly input: readonly EntrySummary[];
      readonly key: string;
      readonly entries: readonly EntrySummary[];
    }
  >();
  const sortRequests = new Map<string, object>();
  /** Live, uncommitted-per-keystroke quick-filter text; committed to the tab's view on blur/close. */
  const quickFilterDrafts = new Map<string, string>();
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
  /** Last tab closed per pane (depth 1), for `core.reopenClosedTab`; restores the location only. */
  const closedTabStacks = new Map<PaneId, TabProjection>();
  /** Pending confirmation for closing a pane's only remaining tab (spec §37). */
  let closeTabConfirmation: { readonly paneId: PaneId; readonly tabId: TabId } | undefined;
  let platform: SelectionPlatform = 'unknown';
  let workspaceRequest: AbortController | undefined;
  let unsubscribeEvents: (() => void) | undefined;
  let unsubscribeConnection: (() => void) | undefined;
  let unsubscribeResynchronise: (() => void) | undefined;
  let appState: AppState | undefined;
  let operations = createOperationsState();
  let pendingConflict: OperationConflict | undefined;
  let clipboardMessage: string | undefined;
  let pendingOperationEvents: BackendEvent[] = [];
  let operationFrame: number | undefined;
  const autoDismissTimers = new Map<OperationId, ReturnType<typeof setTimeout>>();
  let removed = false;

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
    theme = settings.theme;
    loadedEntryFormatSettings = {
      dateFormat: settings.dateFormat,
      sizeFormat: settings.sizeFormat,
      locale: navigator.language,
    };
    document.documentElement.style.setProperty('--fm-font-size', `${settings.fontSize}px`);
    document.documentElement.style.setProperty('--fm-row-height', `${settings.rowHeight}px`);
    ThemeManager.setTheme(theme);
    if (settings.iconTheme === 'catppuccin') {
      installCatppuccinIconTheme();
    } else {
      restoreDefaultIconTheme();
    }
    syncTauriWindowBackground();
  }

  /**
   * Keeps the native Tauri window frame (background + title bar chrome) in
   * step with the resolved theme (light/dark/auto) so it never mismatches the
   * toolbar's own --fm-surface-elevated, e.g. on launch or when the OS
   * appearance changes. `setTheme` drives the title bar's own light/dark
   * rendering, which `setBackgroundColor` alone doesn't affect on macOS.
   */
  function syncTauriWindowBackground(): void {
    if (runtimeKind !== 'tauri') return;
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue('--fm-surface-elevated')
      .trim();
    if (resolved.length === 0) return;
    const window = getCurrentWindow();
    void window.setBackgroundColor(resolved);
    // 'auto' -> null lets the OS decide, matching the CSS `@media` fallback.
    void window.setTheme(theme === 'auto' ? null : theme);
  }

  const systemThemeQuery: MediaQueryList | undefined =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : undefined;
  function handleSystemThemeChange(): void {
    if (theme === 'auto') syncTauriWindowBackground();
  }

  async function loadSettings(client: FileManagerClient): Promise<void> {
    try {
      const settings = await client.getSettings();
      currentSettings = settings;
      applyAppearance(settings);
      m.redraw();
    } catch {
      // A transport failure leaves the application usable with defaults.
    }
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
    return quickFilterDrafts.get(key) ?? tab?.view.quickFilter?.query ?? '';
  }

  function quickFilterOpenFor(key: string, tab: TabProjection | undefined): boolean {
    return quickFilterOpen.get(key) === true || (tab?.view.quickFilter ?? null) !== null;
  }

  function metadataLoader(client: FileManagerClient, key: string): EntryMetadataLoader {
    const existing = metadataLoaders.get(key);
    if (existing !== undefined) return existing;
    const loader = createEntryMetadataLoader({
      client,
      update: (view) => {
        metadataViews.set(key, view);
        m.redraw();
      },
    });
    metadataLoaders.set(key, loader);
    return loader;
  }

  function locationForPath(current: Location, path: string): Location {
    const url = new URL(current.uri);
    url.pathname = path.startsWith('~') ? path : path.replaceAll('\\', '/');
    return { ...current, uri: url.toString() };
  }

  let navigation: NavigationController;

  /** Clears every per-tab runtime cache for a closed tab, cancelling its in-flight request. */
  function clearTabState(paneId: PaneId, tabId: TabId): void {
    const key = tabKey(paneId, tabId);
    navigation.abort(paneId, tabId);
    directories.delete(key);
    selections.delete(key);
    metadataLoaders.get(key)?.dispose();
    metadataLoaders.delete(key);
    metadataViews.delete(key);
    sortedEntries.delete(key);
    sortRequests.delete(key);
    quickFilterDrafts.delete(key);
    quickFilterOpen.delete(key);
    filteredEntries.delete(key);
  }

  /** Releases every per-tab cache belonging to a workspace being switched away from. */
  function releaseWorkspaceTabState(outgoing: WorkspaceProjection): void {
    for (const paneId of outgoing.paneOrder) {
      for (const tabId of outgoing.panesById[paneId]?.tabOrder ?? []) {
        clearTabState(paneId, tabId);
      }
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
  function activateWorkspace(loaded: WorkspaceProjection): void {
    flushPendingLayoutUpdate?.();
    if (workspace !== undefined) {
      releaseWorkspaceTabState(workspace);
    }
    workspace = loaded;
    workspaceError = undefined;
    loadPanesActiveFirst(loaded);
  }

  /** Opens the first persisted workspace, or creates the global-default one if none exist. */
  async function openOrCreateDefaultWorkspace(
    client: FileManagerClient,
    signal?: AbortSignal,
  ): Promise<{ loaded: WorkspaceProjection; summaries: readonly WorkspaceSummary[] }> {
    const summaries = await client.listWorkspaces(signal);
    const loaded =
      summaries[0] === undefined
        ? await client.createWorkspace({ name: 'Default' }, signal)
        : await client.openWorkspace(summaries[0].id, signal);
    const refreshedSummaries =
      summaries[0] === undefined ? await client.listWorkspaces(signal) : summaries;
    return { loaded, summaries: refreshedSummaries };
  }

  /** Chooses and activates a replacement workspace once the active one is no longer valid. */
  async function recoverActiveWorkspace(
    client: FileManagerClient,
    summaries: readonly WorkspaceSummary[],
  ): Promise<void> {
    const nextId = firstAvailableWorkspaceId(summaries);
    if (nextId === undefined) {
      const created = await client.createWorkspace({ name: 'Default' });
      activateWorkspace(created);
      workspaceSummaries = await client.listWorkspaces();
      return;
    }
    await switchWorkspace(client, nextId);
  }

  async function loadWorkspace(client: FileManagerClient): Promise<void> {
    workspaceRequest = new AbortController();
    try {
      const capabilities = await client.getRuntimeCapabilities(workspaceRequest.signal);
      platform = capabilities.platform;
      openTerminalSupported = capabilities.openTerminal;
      const { loaded, summaries } = await openOrCreateDefaultWorkspace(
        client,
        workspaceRequest.signal,
      );
      activateWorkspace(loaded);
      workspaceSummaries = summaries;
    } catch (error: unknown) {
      if (workspaceRequest.signal.aborted) {
        return;
      }
      workspaceError = workspaceErrorMessage(error, 'Unable to load workspace');
    }
    m.redraw();
  }

  /**
   * Switches the active workspace (task 0084): flushes any pending debounced
   * layout edit, releases the outgoing workspace's per-tab caches, restores
   * the target workspace's persisted layout, and loads its active pane's
   * tabs first. Never touches `operations` — running file operations must
   * survive a switch untouched.
   */
  async function switchWorkspace(
    client: FileManagerClient,
    workspaceId: WorkspaceId,
  ): Promise<void> {
    if (workspace?.id === workspaceId) return;
    workspaceRequest?.abort();
    const request = new AbortController();
    workspaceRequest = request;
    workspaceActionError = undefined;
    try {
      const loaded = await client.openWorkspace(workspaceId, request.signal);
      activateWorkspace(loaded);
      workspaceSummaries = await client.listWorkspaces(request.signal);
    } catch (error: unknown) {
      if (request.signal.aborted) return;
      workspaceActionError = workspaceErrorMessage(error, 'Unable to switch workspace');
    }
    m.redraw();
  }

  function refreshWorkspaceSummaries(client: FileManagerClient): void {
    void client
      .listWorkspaces()
      .then((summaries) => {
        workspaceSummaries = summaries;
        m.redraw();
      })
      .catch(() => undefined);
  }

  function revisionForWorkspace(workspaceId: WorkspaceId): number {
    if (workspace?.id === workspaceId) return workspace.revision;
    return workspaceSummaries.find((summary) => summary.id === workspaceId)?.revision ?? 0;
  }

  function createWorkspaceAction(client: FileManagerClient): void {
    workspaceActionError = undefined;
    void client
      .createWorkspace({})
      .then(async (created) => {
        activateWorkspace(created);
        workspaceSummaries = await client.listWorkspaces();
        m.redraw();
      })
      .catch((error: unknown) => {
        workspaceActionError = workspaceErrorMessage(error, 'Unable to create workspace');
        m.redraw();
      });
  }

  function renameWorkspaceAction(
    client: FileManagerClient,
    workspaceId: WorkspaceId,
    name: string,
  ): void {
    workspaceActionError = undefined;
    void client
      .renameWorkspace(workspaceId, name, revisionForWorkspace(workspaceId))
      .then(async (updated) => {
        if (workspace?.id === workspaceId) workspace = updated;
        workspaceSummaries = await client.listWorkspaces();
        m.redraw();
      })
      .catch(async (error: unknown) => {
        if (isWorkspaceRevisionConflict(error)) {
          workspaceSummaries = await client.listWorkspaces().catch(() => workspaceSummaries);
          workspaceActionError =
            'This workspace changed elsewhere; refresh and try renaming again.';
        } else {
          workspaceActionError = workspaceErrorMessage(error, 'Unable to rename workspace');
        }
        m.redraw();
      });
  }

  function deleteWorkspaceAction(client: FileManagerClient, workspaceId: WorkspaceId): void {
    workspaceActionError = undefined;
    const wasActive = workspace?.id === workspaceId;
    void client
      .deleteWorkspace(workspaceId, revisionForWorkspace(workspaceId))
      .then(async () => {
        const summaries = await client.listWorkspaces();
        workspaceSummaries = summaries;
        if (wasActive) await recoverActiveWorkspace(client, summaries);
        m.redraw();
      })
      .catch((error: unknown) => {
        workspaceActionError = isWorkspaceRevisionConflict(error)
          ? 'This workspace changed elsewhere; refresh and try deleting again.'
          : workspaceErrorMessage(error, 'Unable to delete workspace');
        m.redraw();
      });
  }

  function refetchAffectedPanes(paneId?: PaneId): void {
    if (workspace === undefined) return;
    for (const candidate of workspace.paneOrder) {
      if (paneId === undefined || candidate === paneId) void navigation.load(candidate);
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
      directories.set(key, {
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
      });
      m.redraw();
      return;
    }
    const entries = [...current.entries];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    if (delta.type === 'entriesRemoved') {
      for (const id of delta.entryIds) byId.delete(id);
    } else {
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
    findFilesResults = [];
    findFilesSearching = false;
    findFilesError = undefined;
  }

  /** Starts (or restarts) a filename search rooted at the dialog's current directory. */
  function startFindFilesSearch(query: string): void {
    const root = findFilesRoot;
    if (root === undefined || workspace === undefined) return;
    if (findFilesSearchId !== undefined) {
      void attrsClient.cancelSearch(findFilesSearchId).catch(() => undefined);
    }
    findFilesGeneration += 1;
    const generation = findFilesGeneration;
    findFilesResults = [];
    findFilesSearching = true;
    findFilesError = undefined;
    findFilesSearchId = undefined;
    void attrsClient
      .startSearch({ query, roots: [root], workspaceId: workspace.id })
      .then((result) => {
        if (generation !== findFilesGeneration) {
          void attrsClient.cancelSearch(result.searchId).catch(() => undefined);
          return;
        }
        findFilesSearchId = result.searchId;
        m.redraw();
      })
      .catch((error: unknown) => {
        if (generation !== findFilesGeneration) return;
        findFilesSearching = false;
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
    return (
      directory?.entries
        .filter((entry) => selection?.selectedEntryIds.includes(entry.id) === true)
        .map((entry) => entry.location) ?? []
    );
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
        : (directories
            .get(effectiveKey)
            ?.entries.filter(
              (entry) => selections.get(effectiveKey)?.selectedEntryIds.includes(entry.id) === true,
            ) ?? []));
    const directory = effectiveKey === undefined ? undefined : directories.get(effectiveKey);
    return {
      selectedEntries: effectiveEntries,
      locationWritable: directory?.writable === true,
      clipboardHasEntries: clipboard().locations.length > 0,
      openTerminalSupported,
    };
  }

  /**
   * `core.open`/`core.openWith`/`core.revealInSystemFileManager` act on a
   * single entry and `core.openTerminal` acts on the current directory
   * (task 0061); the backend cannot resolve an opaque `EntryId` back to a
   * path itself (there is no server-side entry registry, mirroring plugin
   * action invocation), so the frontend must supply the target as an
   * explicit `{ uri }` parameter built from the already-loaded `Location`.
   */
  function platformActionParameters(
    actionId: string,
    selectedEntries: readonly EntrySummary[],
    directoryLocation: Location | undefined,
  ): { uri: string } | undefined {
    if (
      actionId === 'core.open' ||
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
        commandPaletteError = error instanceof Error ? error.message : 'Unable to run command.';
        m.redraw();
      });
  }

  function invokePaletteAction(
    action: ActionDescriptor,
    parameters?: unknown,
    context = actionContext(),
  ): void {
    if (action.id === 'core.palette') return;
    if (action.id === 'core.createDirectory') {
      createDirectoryLocation = undefined;
      createDirectoryOpen = true;
      return;
    }
    const paneId = context.paneId;
    const directory = paneId === undefined ? undefined : directories.get(activeTabKey(paneId));
    const selectedEntries =
      directory === undefined
        ? []
        : directory.entries.filter((entry) => context.selectedEntryIds?.includes(entry.id));
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
      void attrsClient
        .startOperation({
          type: mode,
          sources: currentClipboard.locations,
          destination: directory.location,
          conflictPolicy: 'ask',
        })
        .then(() => {
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

  function isEditableTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (commandPaletteOpen) return;
    if (hasPrimaryModifier(event, platform) && !event.altKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      commandPaletteOpen = true;
      commandPaletteError = undefined;
      m.redraw();
      return;
    }
    const dispatchedAction = dispatchKeybinding(
      event,
      {
        scope: isEditableTarget(event.target) ? 'pathInput' : 'table',
        platform,
        runtime: keybindingRuntime,
      },
      registeredActions,
      currentSettings?.keybindings ?? {},
    );
    if (!isEditableTarget(event.target) && hasPrimaryModifier(event, platform) && !event.altKey) {
      const key = event.key.toLowerCase();
      const sources = selectedLocations();
      if ((key === 'c' || key === 'x') && sources.length > 0) {
        event.preventDefault();
        replaceClipboard(
          key === 'c'
            ? copyToClipboard(clipboard(), sources)
            : cutToClipboard(clipboard(), sources),
        );
        clipboardMessage = undefined;
        m.redraw();
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        const active = activeDirectory();
        const directory =
          active === undefined ? undefined : directories.get(activeTabKey(active.paneId));
        const currentClipboard = clipboard();
        const target =
          active === undefined || directory === undefined
            ? undefined
            : {
                location: active.location,
                writable: directory.writable === true,
                loaded: directory.state.type === 'loaded',
              };
        const validation = validatePasteTarget(currentClipboard, target);
        if (!validation.ok) {
          clipboardMessage = validation.message;
          m.redraw();
          return;
        }
        const mode = currentClipboard.mode;
        if (mode === undefined || active === undefined) return;
        clipboardMessage = undefined;
        void attrsClient
          .startOperation({
            type: mode,
            sources: currentClipboard.locations,
            destination: active.location,
            conflictPolicy: 'ask',
          })
          .then(() => {
            if (mode === 'move') replaceClipboard(clearClipboard(currentClipboard));
            m.redraw();
          })
          .catch((error: unknown) => {
            clipboardMessage =
              error instanceof Error ? error.message : 'Unable to paste clipboard entries.';
            m.redraw();
          });
        return;
      }
      if (key >= '1' && key <= '9') {
        const active = activeDirectory();
        if (active !== undefined) {
          event.preventDefault();
          jumpToTab(attrsClient, active.paneId, Number(key));
        }
        return;
      }
    }
    if (dispatchedAction === 'core.copy') {
      const active = activeDirectory();
      const selection =
        active === undefined ? undefined : selections.get(activeTabKey(active.paneId));
      const directory =
        active === undefined ? undefined : directories.get(activeTabKey(active.paneId));
      const selected = directory?.entries.filter(
        (entry) => selection?.selectedEntryIds.includes(entry.id) === true,
      );
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      const destination =
        otherPaneId === undefined
          ? undefined
          : directories.get(activeTabKey(otherPaneId))?.location;
      if (selected !== undefined && selected.length > 0 && destination !== undefined) {
        event.preventDefault();
        void attrsClient.startOperation({
          type: 'copy',
          sources: selected.map((entry) => entry.location),
          destination,
          conflictPolicy: 'ask',
        });
      }
      return;
    }
    if (dispatchedAction === 'core.move') {
      const active = activeDirectory();
      const selection =
        active === undefined ? undefined : selections.get(activeTabKey(active.paneId));
      const directory =
        active === undefined ? undefined : directories.get(activeTabKey(active.paneId));
      const selected = directory?.entries.filter(
        (entry) => selection?.selectedEntryIds.includes(entry.id) === true,
      );
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      const destination =
        otherPaneId === undefined
          ? undefined
          : directories.get(activeTabKey(otherPaneId))?.location;
      if (selected !== undefined && selected.length > 0 && destination !== undefined) {
        event.preventDefault();
        void attrsClient.startOperation({
          type: 'move',
          sources: selected.map((entry) => entry.location),
          destination,
          conflictPolicy: 'ask',
        });
      }
      return;
    }
    if (dispatchedAction === 'core.trash') {
      const active = activeDirectory();
      const selection =
        active === undefined ? undefined : selections.get(activeTabKey(active.paneId));
      const directory =
        active === undefined ? undefined : directories.get(activeTabKey(active.paneId));
      const selected = directory?.entries.filter(
        (entry) => selection?.selectedEntryIds.includes(entry.id) === true,
      );
      if (selected !== undefined && selected.length > 0) {
        event.preventDefault();
        void attrsClient.startOperation({
          type: 'trash',
          sources: selected.map((entry) => entry.location),
          conflictPolicy: 'ask',
        });
      }
      return;
    }
    if (dispatchedAction === 'core.delete') {
      const active = activeDirectory();
      const selection =
        active === undefined ? undefined : selections.get(activeTabKey(active.paneId));
      const directory =
        active === undefined ? undefined : directories.get(activeTabKey(active.paneId));
      const selected = directory?.entries.filter(
        (entry) => selection?.selectedEntryIds.includes(entry.id) === true,
      );
      if (selected !== undefined && selected.length > 0) {
        event.preventDefault();
        void attrsClient.startOperation({
          type: 'delete',
          sources: selected.map((entry) => entry.location),
          conflictPolicy: 'ask',
          permanentDeleteConfirmed: currentSettings?.confirmPermanentDelete === false,
          overrideReadOnly: false,
        });
      }
      return;
    }
    if (
      dispatchedAction === 'core.createDirectory' &&
      !createDirectoryOpen &&
      activeDirectory() !== undefined
    ) {
      event.preventDefault();
      createDirectoryOpen = true;
      m.redraw();
      return;
    }
    if (dispatchedAction === 'core.findFiles' && !findFilesOpen) {
      const active = activeDirectory();
      if (active === undefined) return;
      event.preventDefault();
      findFilesRoot = active.location;
      findFilesOpen = true;
      m.redraw();
      return;
    }
    if (dispatchedAction === 'core.quickFilter') {
      const active = activeDirectory();
      if (active === undefined) return;
      event.preventDefault();
      const key = activeTabKey(active.paneId);
      quickFilterOpen.set(key, true);
      if (!quickFilterDrafts.has(key)) {
        const pane = workspace?.panesById[active.paneId];
        const tab = pane?.tabsById[pane.activeTabId];
        quickFilterDrafts.set(key, tab?.view.quickFilter?.query ?? '');
      }
      m.redraw();
      return;
    }
    if (dispatchedAction === 'core.newTab') {
      const active = activeDirectory();
      if (active === undefined) return;
      event.preventDefault();
      openTab(attrsClient, active.paneId);
      return;
    }
    if (dispatchedAction === 'core.closeTab') {
      if (workspace === undefined) return;
      const paneId = workspace.activePaneId;
      const pane = workspace.panesById[paneId];
      if (pane === undefined) return;
      event.preventDefault();
      requestCloseTab(attrsClient, paneId, pane.activeTabId);
      return;
    }
    if (dispatchedAction === 'core.nextTab' || dispatchedAction === 'core.previousTab') {
      if (workspace === undefined) return;
      event.preventDefault();
      cycleTab(attrsClient, workspace.activePaneId, dispatchedAction === 'core.nextTab' ? 1 : -1);
      return;
    }
    if (dispatchedAction === 'core.reopenClosedTab') {
      if (workspace === undefined) return;
      event.preventDefault();
      reopenClosedTab(attrsClient, workspace.activePaneId);
    }
  }

  function handleBackendEvent(event: BackendEvent): void {
    const payload = event.payload;
    // Workspace lifecycle events must refresh the switcher's summary list
    // regardless of which workspace they pertain to (task 0084); every other
    // payload stays scoped to the active workspace by the filter below.
    if (
      payload.type === 'workspace.created' ||
      payload.type === 'workspace.renamed' ||
      payload.type === 'workspace.deleted'
    ) {
      refreshWorkspaceSummaries(attrsClient);
      if (payload.type === 'workspace.deleted' && event.workspaceId === workspace?.id) {
        void attrsClient
          .listWorkspaces()
          .then((summaries) => {
            workspaceSummaries = summaries;
            return recoverActiveWorkspace(attrsClient, summaries);
          })
          .catch((error: unknown) => {
            workspaceActionError = workspaceErrorMessage(error, 'Unable to recover workspace');
          })
          .finally(() => m.redraw());
        return;
      }
    }
    if (event.workspaceId !== undefined && event.workspaceId !== workspace?.id) return;
    if (payload.type === 'operation.conflict') {
      pendingConflict = payload;
      m.redraw();
    }
    if (payload.type.startsWith('operation.')) {
      pendingOperationEvents.push(event);
      if (operationFrame === undefined) {
        operationFrame = requestAnimationFrame(() => {
          operationFrame = undefined;
          const events = pendingOperationEvents;
          pendingOperationEvents = [];
          const previous = operations;
          let next = reduceOperationEvents(previous, events);
          let panesNeedRefresh = false;
          for (const [id, current] of Object.entries(next.byId) as Array<
            [OperationId, Operation | undefined]
          >) {
            if (current === undefined) continue;
            const previousState = previous.byId[id]?.state;
            if (previousState === current.state) continue;
            if (current.state === 'completed' || current.state === 'completedWithWarnings') {
              panesNeedRefresh = true;
            }
            if (!isAutoDismissibleState(current.state)) continue;
            if (Date.now() - Date.parse(current.createdAt) < FAST_OPERATION_DISMISS_THRESHOLD_MS) {
              next = dismissOperation(next, id);
            } else {
              scheduleAutoDismiss(id, AUTO_DISMISS_DELAY_MS);
            }
          }
          operations = next;
          if (panesNeedRefresh) refetchAffectedPanes();
          m.redraw();
        });
      }
      return;
    }
    if (payload.type === 'directory.snapshot') {
      const current = directories.get(activeTabKey(payload.snapshot.paneId));
      if (current?.revision !== undefined && payload.snapshot.revision <= current.revision) return;
      applyDelta(payload.snapshot.paneId, { type: 'reset', snapshot: payload.snapshot });
      return;
    }
    if (payload.type === 'directory.delta') {
      applyDelta(payload.paneId, payload.delta);
      return;
    }
    if (payload.type === 'plugin.changed') {
      const changed = payload.plugin;
      plugins = plugins.some((plugin) => plugin.id === changed.id)
        ? plugins.map((plugin) => (plugin.id === changed.id ? { ...plugin, ...changed } : plugin))
        : plugins;
      m.redraw();
      return;
    }
    if (payload.type === 'search.resultsBatch') {
      if (payload.searchId !== findFilesSearchId) return;
      findFilesResults = [...findFilesResults, ...payload.entries];
      findFilesSearching = !payload.isComplete;
      m.redraw();
      return;
    }
    if ('revision' in payload && workspace !== undefined) {
      if (payload.revision <= workspace.revision) return;
      void attrsClient.getWorkspace(workspace.id).then(replaceWorkspace);
    }
  }

  let attrsClient: FileManagerClient;

  function replaceWorkspace(next: WorkspaceProjection): void {
    workspace = next;
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
  function openTab(client: FileManagerClient, paneId: PaneId): void {
    if (workspace === undefined) return;
    const pane = workspace.panesById[paneId];
    const activeTab = pane?.tabsById[pane.activeTabId];
    if (activeTab === undefined) return;
    void dispatchWorkspaceCommand(
      client,
      {
        type: 'addTab',
        workspaceId: workspace.id,
        paneId,
        location: activeTab.location,
        expectedRevision: workspace.revision,
      },
      (next) => {
        replaceWorkspace(next);
        void navigation.load(paneId);
      },
    ).catch(() => undefined);
  }

  /** Switches `paneId`'s active tab, cancelling any in-flight request for the tab being hidden. */
  function activateTab(client: FileManagerClient, paneId: PaneId, tabId: TabId): void {
    if (workspace === undefined) return;
    const pane = workspace.panesById[paneId];
    if (pane === undefined || pane.activeTabId === tabId) return;
    const previousTabId = pane.activeTabId;
    void dispatchWorkspaceCommand(
      client,
      {
        type: 'activateTab',
        workspaceId: workspace.id,
        paneId,
        tabId,
        expectedRevision: workspace.revision,
      },
      (next) => {
        replaceWorkspace(next);
        navigation.abort(paneId, previousTabId);
        void navigation.load(paneId);
      },
    ).catch(() => undefined);
  }

  /**
   * Closes `tabId` in `paneId` (spec §37). The backend picks whichever tab
   * becomes active next (and replaces a pane's last tab with a fresh one at
   * the home directory rather than leaving an empty pane) — the frontend
   * just clears the closed tab's caches and trusts the returned projection.
   */
  function performCloseTab(client: FileManagerClient, paneId: PaneId, tabId: TabId): void {
    if (workspace === undefined) return;
    const closedTab = workspace.panesById[paneId]?.tabsById[tabId];
    if (closedTab !== undefined) closedTabStacks.set(paneId, closedTab);
    void dispatchWorkspaceCommand(
      client,
      {
        type: 'closeTab',
        workspaceId: workspace.id,
        paneId,
        tabId,
        expectedRevision: workspace.revision,
      },
      (next) => {
        clearTabState(paneId, tabId);
        replaceWorkspace(next);
        void navigation.load(paneId);
      },
    ).catch(() => undefined);
  }

  /**
   * Gates closing a pane's only remaining tab behind confirmation (spec
   * §37) — the backend would otherwise silently replace it with a blank
   * tab, which is surprising without warning.
   */
  function requestCloseTab(client: FileManagerClient, paneId: PaneId, tabId: TabId): void {
    const pane = workspace?.panesById[paneId];
    if (pane === undefined) return;
    if (pane.tabOrder.length <= 1) {
      closeTabConfirmation = { paneId, tabId };
      m.redraw();
      return;
    }
    performCloseTab(client, paneId, tabId);
  }

  /** Reopens the most recently closed tab in `paneId` (depth 1), restoring its location only. */
  function reopenClosedTab(client: FileManagerClient, paneId: PaneId): void {
    const closed = closedTabStacks.get(paneId);
    if (workspace === undefined || closed === undefined) return;
    closedTabStacks.delete(paneId);
    void dispatchWorkspaceCommand(
      client,
      {
        type: 'addTab',
        workspaceId: workspace.id,
        paneId,
        location: closed.location,
        expectedRevision: workspace.revision,
      },
      (next) => {
        replaceWorkspace(next);
        void navigation.load(paneId);
      },
    ).catch(() => undefined);
  }

  /** Activates the next/previous tab in `paneId`, wrapping around at the ends. */
  function cycleTab(client: FileManagerClient, paneId: PaneId, direction: 1 | -1): void {
    const pane = workspace?.panesById[paneId];
    if (pane === undefined) return;
    const currentIndex = pane.tabOrder.indexOf(pane.activeTabId);
    const nextTabId = pane.tabOrder[cycledTabIndex(currentIndex, pane.tabOrder.length, direction)];
    if (nextTabId !== undefined) activateTab(client, paneId, nextTabId);
  }

  /** Activates the `oneBasedIndex`-th tab in `paneId`, if one exists (Ctrl+1-9 jump). */
  function jumpToTab(client: FileManagerClient, paneId: PaneId, oneBasedIndex: number): void {
    const pane = workspace?.panesById[paneId];
    if (pane === undefined) return;
    const tabId = tabIdForJump(pane.tabOrder, oneBasedIndex);
    if (tabId !== undefined) activateTab(client, paneId, tabId);
  }

  function paneContent(
    client: FileManagerClient,
    entryFormatSettings: EntryFormatSettings,
    paneId: PaneId,
  ): WorkspacePaneContent {
    const pane = workspace?.panesById[paneId];
    const tab = pane?.tabsById[pane.activeTabId];
    const key = tab === undefined ? undefined : tabKey(paneId, tab.id);
    const directory = (key === undefined ? undefined : directories.get(key)) ?? {
      state: { type: 'idle' } as const,
      entries: [],
      hasMore: false,
    };
    const selection = (key === undefined ? undefined : selections.get(key)) ?? emptySelection;
    const sorted =
      tab === undefined || key === undefined
        ? directory.entries
        : entriesSortedFor(
            key,
            directory.entries,
            effectiveSort(tab.view.sort),
            tab.view.foldersFirst,
          );
    const quickFilterQuery = key === undefined ? '' : quickFilterQueryFor(key, tab);
    const filtered = key === undefined ? sorted : entriesFilteredFor(key, sorted, quickFilterQuery);
    const entries =
      tab === undefined ? filtered : withParentEntry(pathFromUri(tab.location.uri), filtered);
    const entryIds = entries.map((entry) => entry.id);
    const cursorIndex =
      selection.cursorEntryId === undefined ? undefined : entryIds.indexOf(selection.cursorEntryId);
    const selectedEntryIds = new Set<EntryId>(selection.selectedEntryIds);
    return {
      ...directory,
      entries,
      selectedEntryIds,
      cutEntryIds: new Set<EntryId>(
        directory.entries
          .filter((entry) => isCutLocation(clipboard(), entry.location))
          .map((entry) => entry.id),
      ),
      sortLabel: sortLabel(effectiveSort(tab?.view.sort ?? [])),
      sort: effectiveSort(tab?.view.sort ?? []),
      totalEntryCount: directory.entries.length,
      hiddenSelectedCount: hiddenSelectedEntryCount(directory.entries, filtered, selectedEntryIds),
      filterOpen: key === undefined ? false : quickFilterOpenFor(key, tab),
      filterQuery: quickFilterQuery,
      formatSettings: entryFormatSettings,
      pluginColumns:
        plugins.some(
          (plugin) =>
            plugin.enabled && plugin.columns?.some((column) => column.id === 'sample.fileAge'),
        ) &&
        tab?.view.columns.some((column) => column.columnId === 'sample.fileAge' && column.visible)
          ? [SAMPLE_FILE_AGE_COLUMN]
          : [],
      metadata: (key === undefined ? undefined : metadataViews.get(key)) ?? { state: 'idle' },
      platform,
      keybindingRuntime,
      actions: registeredActions,
      keybindingOverrides: currentSettings?.keybindings ?? {},
      ...(cursorIndex === undefined || cursorIndex < 0 ? {} : { cursorIndex }),
      onNavigate: async (path) => {
        if (tab !== undefined) {
          await navigation.navigate(paneId, locationForPath(tab.location, path));
        }
      },
      onBack: () => navigation.back(paneId),
      onForward: () => navigation.forward(paneId),
      onParent: () => navigation.parent(paneId),
      onOpenEntry: (entry) =>
        isParentEntry(entry.id)
          ? navigation.parent(paneId)
          : entry.kind === 'directory'
            ? navigation.navigate(paneId, entry.location)
            : invokeActionById(
                'core.open',
                { uri: entry.location.uri },
                { paneId, selectedEntryIds: [entry.id], cursorEntryId: entry.id },
              ),
      onSelectionAction: (action: SelectionAction) => {
        if (key === undefined) return;
        const next = reduceSelection(selection, action, entryIds);
        selections.set(key, next);
        const cursorEntry = entries.find((entry) => entry.id === next.cursorEntryId);
        void metadataLoader(client, key).select(
          cursorEntry === undefined || isParentEntry(cursorEntry.id) ? undefined : cursorEntry,
        );
        m.redraw();
      },
      onRetry: () => navigation.retry(paneId),
      onLoadNextPage: () => navigation.loadNextPage(paneId),
      onSortChange: (sort) => {
        if (workspace === undefined || tab === undefined) return;
        void dispatchWorkspaceCommand(
          client,
          {
            type: 'updateView',
            workspaceId: workspace.id,
            paneId,
            tabId: tab.id,
            patch: { sort: [...sort] },
            expectedRevision: workspace.revision,
          },
          replaceWorkspace,
        ).catch(() => undefined);
      },
      onFilterQueryChange: (query) => {
        if (key === undefined) return;
        quickFilterDrafts.set(key, query);
        m.redraw();
      },
      onFilterCommit: () => {
        if (key === undefined) return;
        const draft = quickFilterDrafts.get(key);
        if (workspace === undefined || tab === undefined || draft === undefined) return;
        const committed = tab.view.quickFilter?.query ?? '';
        if (draft === committed) return;
        void dispatchWorkspaceCommand(
          client,
          {
            type: 'updateView',
            workspaceId: workspace.id,
            paneId,
            tabId: tab.id,
            patch: {
              quickFilter:
                draft.trim() === '' ? { type: 'clear' } : { type: 'set', filter: { query: draft } },
            },
            expectedRevision: workspace.revision,
          },
          replaceWorkspace,
        ).catch(() => undefined);
      },
      onFilterClose: () => {
        if (key !== undefined) {
          quickFilterOpen.set(key, false);
          quickFilterDrafts.delete(key);
        }
        if (workspace !== undefined && tab !== undefined && tab.view.quickFilter != null) {
          void dispatchWorkspaceCommand(
            client,
            {
              type: 'updateView',
              workspaceId: workspace.id,
              paneId,
              tabId: tab.id,
              patch: { quickFilter: { type: 'clear' } },
              expectedRevision: workspace.revision,
            },
            replaceWorkspace,
          ).catch(() => undefined);
        }
        m.redraw();
      },
      onRename: (entry, name) => {
        const active = activeDirectory();
        if (active === undefined || active.paneId !== paneId) return;
        const destinationUri = `${active.location.uri.replace(/\/$/u, '')}/${encodeURIComponent(name)}`;
        void client.startOperation({
          type: 'rename',
          sources: [entry.location],
          destination: { ...entry.location, uri: destinationUri },
          conflictPolicy: 'ask',
        });
      },
      onContextMenu: (entries, x, y) => openContextMenu(paneId, entries, x, y),
    };
  }

  return {
    oninit: ({ attrs }) => {
      attrsClient = attrs.client;
      keybindingRuntime = attrs.runtime === 'http' ? 'browser' : 'desktop';
      runtimeKind = attrs.runtime;
      document.addEventListener('keydown', handleGlobalKeydown);
      systemThemeQuery?.addEventListener('change', handleSystemThemeChange);
      appState = applyAppPatches(
        createInitialAppState(attrs.runtime),
        connectionPatch({ status: attrs.client.connection.get() }),
      );
      navigation = createNavigationController({
        client: attrs.client,
        getWorkspace: () => workspace,
        replaceWorkspace: (next) => replaceWorkspace(next),
        updatePane: (paneId, tabId, view, preferredCursorName) => {
          const key = tabKey(paneId, tabId);
          const previous = directories.get(key);
          directories.set(key, view);
          if (view.entries.length === 0) {
            selections.set(key, emptySelection);
            void metadataLoader(attrs.client, key).select(undefined);
          } else if (
            selections.get(key)?.cursorEntryId === undefined ||
            previous?.location?.uri !== view.location?.uri
          ) {
            // After `..` navigation, land the cursor back on the child directory
            // just navigated away from instead of always the listing's first entry.
            const preferredEntry = view.entries.find((entry) => entry.name === preferredCursorName);
            const firstEntry = preferredEntry ?? view.entries[0];
            selections.set(key, {
              selectedEntryIds: [],
              ...(firstEntry === undefined ? {} : { cursorEntryId: firstEntry.id }),
            });
            void metadataLoader(attrs.client, key).select(firstEntry);
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
          m.redraw();
        })
        .catch(() => undefined);
      void loadWorkspace(attrs.client);
      void Promise.resolve()
        .then(() => attrs.client.listOperations())
        .then((listed) => {
          if (!removed) {
            operations = createOperationsState(listed);
            for (const operation of listed) {
              if (isAutoDismissibleState(operation.state)) {
                scheduleAutoDismiss(operation.id, AUTO_DISMISS_DELAY_MS);
              }
            }
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
      document.removeEventListener('keydown', handleGlobalKeydown);
      systemThemeQuery?.removeEventListener('change', handleSystemThemeChange);
      if (operationFrame !== undefined) cancelAnimationFrame(operationFrame);
      for (const timer of autoDismissTimers.values()) clearTimeout(timer);
      autoDismissTimers.clear();
      workspaceRequest?.abort();
      unsubscribeEvents?.();
      unsubscribeConnection?.();
      unsubscribeResynchronise?.();
      attrsClient.disconnect();
      navigation.dispose();
      for (const loader of metadataLoaders.values()) loader.dispose();
      document.documentElement.style.removeProperty('--fm-font-size');
      document.documentElement.style.removeProperty('--fm-row-height');
    },

    view: ({ attrs }) => {
      const pendingDelete = Object.values(operations.byId).find(
        (operation) =>
          operation?.kind === 'delete' && operation.state === 'waitingForConflictResolution',
      );
      // macOS's overlay title bar (spec follow-up) removes the reserved native title
      // strip so the toolbar itself extends under the traffic lights, painted by our
      // own CSS -- this is what actually makes the frame colour match, since a plain
      // "Transparent" title bar still let the OS render its own vibrancy behind it.
      const isMacOverlay = runtimeKind === 'tauri' && platform === 'macos';
      return m(
        '.fm-app-shell',
        { 'data-mac-titlebar-overlay': isMacOverlay ? 'true' : undefined },
        [
        m('.fm-workspace-toolbar', { 'data-tauri-drag-region': isMacOverlay ? '' : undefined }, [
          m('.fm-navigation-controls', { 'aria-label': 'Active pane navigation' }, [
            m(
              'button',
              {
                type: 'button',
                disabled:
                  workspace?.panesById[workspace.activePaneId]?.tabsById[
                    workspace.panesById[workspace.activePaneId]?.activeTabId ?? ''
                  ]?.canNavigateBack !== true,
                'aria-label': 'Back',
                onclick: () => void navigation.back(workspace?.activePaneId ?? ''),
              },
              arrowLeftIcon(),
            ),
            m(
              'button',
              {
                type: 'button',
                disabled:
                  workspace?.panesById[workspace.activePaneId]?.tabsById[
                    workspace.panesById[workspace.activePaneId]?.activeTabId ?? ''
                  ]?.canNavigateForward !== true,
                'aria-label': 'Forward',
                onclick: () => void navigation.forward(workspace?.activePaneId ?? ''),
              },
              arrowRightIcon(),
            ),
            m(
              'button',
              {
                type: 'button',
                disabled: workspace === undefined,
                'aria-label': 'Parent directory',
                onclick: () => void navigation.parent(workspace?.activePaneId ?? ''),
              },
              cornerLeftUpIcon(),
            ),
          ]),
          m(
            'button',
            {
              type: 'button',
              disabled: activeDirectory() === undefined,
              'aria-label': 'Find files',
              onclick: () => {
                const active = activeDirectory();
                if (active === undefined) return;
                findFilesRoot = active.location;
                findFilesOpen = true;
              },
            },
            [searchIcon(), m('span', 'Find files')],
          ),
          m(
            'button',
            {
              type: 'button',
              disabled: registeredActions.length === 0,
              onclick: () => {
                commandPaletteOpen = true;
                commandPaletteError = undefined;
              },
            },
            [commandIcon(), m('span', 'Command palette')],
          ),
          m('details.fm-workspace-disclosure', [
            m(
              'summary.fm-workspace-switcher-button',
              {
                title: 'Switch or manage workspaces',
                'aria-label': `Workspace switcher, current workspace: ${workspace?.name ?? 'none'}`,
              },
              [
                layoutGridIcon(),
                m('span.fm-workspace-switcher-label', workspace?.name ?? 'Workspace'),
              ],
            ),
            m('.fm-workspace-switcher-panel', { role: 'dialog', 'aria-label': 'Workspaces' }, [
              m('.fm-workspace-switcher-heading', [
                m('strong', 'Workspaces'),
                m(
                  'button',
                  {
                    type: 'button',
                    'aria-label': 'Close workspaces',
                    onclick: (event: MouseEvent) => {
                      const disclosure = (event.currentTarget as HTMLElement).closest('details');
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
                  void switchWorkspace(attrs.client, workspaceId);
                },
                onCreate: () => createWorkspaceAction(attrs.client),
                onRename: (workspaceId, name) =>
                  renameWorkspaceAction(attrs.client, workspaceId, name),
                onDelete: (workspaceId) => deleteWorkspaceAction(attrs.client, workspaceId),
              }),
            ]),
          ]),
          m('details.fm-settings-disclosure', [
            m('summary.fm-settings-button', [settingsIcon(), m('span', 'Settings')]),
            m(
              '.fm-settings-editor',
              {
                role: 'dialog',
                'aria-label': 'Settings',
                onclick: (event: MouseEvent) => {
                  if (event.target === event.currentTarget) {
                    const disclosure = (event.currentTarget as HTMLElement).closest('details');
                    if (disclosure instanceof HTMLDetailsElement) disclosure.open = false;
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
                  currentSettings === undefined
                    ? m('p', 'Loading settings…')
                    : m(SettingsEditor, {
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
                          await attrs.client.updateSettings(draft);
                          currentSettings = draft;
                          applyAppearance(draft);
                        },
                        onCancel: () => {
                          if (currentSettings !== undefined) applyAppearance(currentSettings);
                        },
                        onTogglePlugin: (pluginId: PluginId, enabled: boolean) =>
                          attrs.client.setPluginEnabled(pluginId, enabled),
                        onRequestPluginLogs: (
                          pluginId: PluginId,
                        ): Promise<readonly PluginLogEntry[]> =>
                          attrs.client.getPluginLogs(pluginId),
                      }),
                ]),
              ],
            ),
          ]),
        ]),
        m('main.fm-workspace', [
          workspace === undefined
            ? m('.fm-workspace-loading', workspaceError ?? 'Loading workspace…')
            : m(WorkspaceLayoutView, {
                workspace,
                paneContent: (paneId) =>
                  paneContent(
                    attrs.client,
                    attrs.entryFormatSettings ?? loadedEntryFormatSettings,
                    paneId,
                  ),
                onActivatePane: (paneId) => activatePane(attrs.client, paneId),
                onUpdateLayout: (layout) => updateLayout(attrs.client, layout),
                onSelectTab: (paneId, tabId) => activateTab(attrs.client, paneId, tabId),
                onCloseTab: (paneId, tabId) => requestCloseTab(attrs.client, paneId, tabId),
                onNewTab: (paneId) => openTab(attrs.client, paneId),
                registerFlush: (flush) => {
                  flushPendingLayoutUpdate = flush;
                },
              }),
        ]),
        clipboardMessage === undefined
          ? undefined
          : m('.fm-clipboard-message', { role: 'alert' }, clipboardMessage),
        commandPaletteError === undefined
          ? undefined
          : m('.fm-command-palette-error', { role: 'alert' }, commandPaletteError),
        m(CommandPalette, {
          open: commandPaletteOpen,
          actions: registeredActions,
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
            void attrs.client
              .startOperation({
                type: 'createDirectory',
                sources: [],
                destination: location,
                conflictPolicy: 'ask',
                name,
                createIntermediateDirectories: false,
              })
              .catch(() => {
                pendingCreatedLocation = undefined;
              });
          },
        }),
        m(FindFilesDialog, {
          open: findFilesOpen,
          scopeLabel: findFilesRoot === undefined ? '' : pathFromUri(findFilesRoot.uri),
          results: findFilesResults,
          searching: findFilesSearching,
          ...(findFilesError === undefined ? {} : { error: findFilesError }),
          onSearch: (query: string) => startFindFilesSearch(query),
          onCancel: () => closeFindFiles(),
          onActivateResult: (entry: EntrySummary) => {
            const paneId = activeDirectory()?.paneId ?? workspace?.activePaneId;
            if (paneId === undefined) return;
            closeFindFiles();
            void navigation.navigate(paneId, parentLocation(entry.location), entry.name);
          },
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
              void attrs.client.resolveConflict({
                operationId: pendingDelete.id,
                resolution: 'confirm',
                applyToAllSimilar: false,
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
              performCloseTab(attrs.client, confirmation.paneId, confirmation.tabId);
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
            { scope: 'table', platform, runtime: attrs.runtime === 'http' ? 'browser' : 'desktop' },
            (action) => evaluateActionAvailability(action, commandAvailabilityContext()).available,
          ).map((binding) =>
            m(
              'span.fm-function-key',
              {
                key: binding.actionId,
                'aria-disabled': binding.actionAvailable ? undefined : 'true',
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
