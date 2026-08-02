import m, { type FactoryComponent } from 'mithril';
import { type Theme, ThemeManager, ThemeSwitcher } from 'mithril-materialized';

import type { FileManagerClient } from '../api/client/file-manager-client';
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
import { isParentEntry, withParentEntry } from '../features/panes/parent-entry';
import { PluginManagement } from '../features/plugin-management/plugin-management';
import { filterEntries, hiddenSelectedEntryCount } from '../features/quick-filter/quick-filter';
import type { SelectionPlatform } from '../features/selection/keybindings';
import {
  emptySelection,
  reduceSelection,
  type SelectionAction,
  type SelectionState,
} from '../features/selection/selection';
import {
  type SortColumn,
  type SortModel,
  sortEntries,
  sortEntriesResponsive,
} from '../features/sorting/sorting';
import { dispatchWorkspaceCommand } from '../features/workspace/dispatch-workspace-command';
import {
  pathFromUri,
  WorkspaceLayoutView,
  type WorkspacePaneContent,
} from '../features/workspace/workspace-layout';
import {
  dispatchKeybinding,
  getLiveBindings,
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
  OperationConflict,
  PaneId,
  PluginDescriptor,
  PluginId,
  PluginLogEntry,
  Settings,
  SortDescriptor,
  TabProjection,
  WorkspaceLayout,
  WorkspaceProjection,
} from '../models';
import {
  type AppState,
  applyAppPatches,
  clipboardPatch,
  connectionPatch,
  createInitialAppState,
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
  let loadedEntryFormatSettings: EntryFormatSettings = DEFAULT_ENTRY_FORMAT_SETTINGS;
  let workspace: WorkspaceProjection | undefined;
  let workspaceError: string | undefined;
  let createDirectoryOpen = false;
  let createDirectoryLocation: Location | undefined;
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
  const directories = new Map<PaneId, PaneDirectoryView>();
  const selections = new Map<PaneId, SelectionState>();
  const metadataLoaders = new Map<PaneId, EntryMetadataLoader>();
  const metadataViews = new Map<PaneId, EntryMetadataView>();
  const sortedEntries = new Map<
    PaneId,
    {
      readonly input: readonly EntrySummary[];
      readonly key: string;
      readonly entries: readonly EntrySummary[];
    }
  >();
  const sortRequests = new Map<PaneId, object>();
  /** Live, uncommitted-per-keystroke quick-filter text; committed to the tab's view on blur/close. */
  const quickFilterDrafts = new Map<PaneId, string>();
  /** Whether the inline quick-filter box is shown for a pane, independent of a persisted query. */
  const quickFilterOpen = new Map<PaneId, boolean>();
  const filteredEntries = new Map<
    PaneId,
    {
      readonly input: readonly EntrySummary[];
      readonly query: string;
      readonly entries: readonly EntrySummary[];
    }
  >();
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
  let removed = false;
  const DEFAULT_SORT: readonly SortDescriptor[] = [
    { columnId: 'core.name', direction: 'ascending' },
  ];

  async function loadSettings(client: FileManagerClient): Promise<void> {
    try {
      const settings = await client.getSettings();
      currentSettings = settings;
      theme = settings.theme;
      loadedEntryFormatSettings = {
        dateFormat: settings.dateFormat,
        sizeFormat: settings.sizeFormat,
        locale: navigator.language,
      };
      document.documentElement.style.setProperty('--fm-font-size', `${settings.fontSize}px`);
      document.documentElement.style.setProperty('--fm-row-height', `${settings.rowHeight}px`);
      ThemeManager.setTheme(theme);
      m.redraw();
    } catch {
      // A transport failure leaves the application usable with defaults.
    }
  }

  function effectiveSort(sort: readonly SortDescriptor[]): readonly SortDescriptor[] {
    return sort.length === 0 ? DEFAULT_SORT : sort;
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
    paneId: PaneId,
    entries: readonly EntrySummary[],
    sort: readonly SortDescriptor[],
    foldersFirst: boolean,
  ): readonly EntrySummary[] {
    const key = JSON.stringify([sort, foldersFirst]);
    const cached = sortedEntries.get(paneId);
    if (cached?.input === entries && cached.key === key) {
      return cached.entries;
    }
    const model = frontendSort(sort);
    if (entries.length < 10_000) {
      const sorted = sortEntries(entries, model, foldersFirst);
      sortedEntries.set(paneId, { input: entries, key, entries: sorted });
      return sorted;
    }
    const request = {};
    sortRequests.set(paneId, request);
    void sortEntriesResponsive(entries, model, foldersFirst).then((sorted) => {
      if (sortRequests.get(paneId) === request) {
        sortedEntries.set(paneId, { input: entries, key, entries: sorted });
        sortRequests.delete(paneId);
        m.redraw();
      }
    });
    return cached?.entries ?? entries;
  }

  function entriesFilteredFor(
    paneId: PaneId,
    entries: readonly EntrySummary[],
    query: string,
  ): readonly EntrySummary[] {
    const cached = filteredEntries.get(paneId);
    if (cached?.input === entries && cached.query === query) {
      return cached.entries;
    }
    const filtered = filterEntries(entries, query);
    filteredEntries.set(paneId, { input: entries, query, entries: filtered });
    return filtered;
  }

  function quickFilterQueryFor(paneId: PaneId, tab: TabProjection | undefined): string {
    return quickFilterDrafts.get(paneId) ?? tab?.view.quickFilter?.query ?? '';
  }

  function quickFilterOpenFor(paneId: PaneId, tab: TabProjection | undefined): boolean {
    return quickFilterOpen.get(paneId) === true || (tab?.view.quickFilter ?? null) !== null;
  }

  function metadataLoader(client: FileManagerClient, paneId: PaneId): EntryMetadataLoader {
    const existing = metadataLoaders.get(paneId);
    if (existing !== undefined) return existing;
    const loader = createEntryMetadataLoader({
      client,
      update: (view) => {
        metadataViews.set(paneId, view);
        m.redraw();
      },
    });
    metadataLoaders.set(paneId, loader);
    return loader;
  }

  function locationForPath(current: Location, path: string): Location {
    const url = new URL(current.uri);
    url.pathname = path.startsWith('~') ? path : path.replaceAll('\\', '/');
    return { ...current, uri: url.toString() };
  }

  let navigation: NavigationController;

  async function loadWorkspace(client: FileManagerClient): Promise<void> {
    workspaceRequest = new AbortController();
    try {
      const capabilities = await client.getRuntimeCapabilities(workspaceRequest.signal);
      platform = capabilities.platform;
      openTerminalSupported = capabilities.openTerminal;
      const summaries = await client.listWorkspaces(workspaceRequest.signal);
      const loaded =
        summaries[0] === undefined
          ? await client.createWorkspace({ name: 'Default' }, workspaceRequest.signal)
          : await client.openWorkspace(summaries[0].id, workspaceRequest.signal);
      workspace = loaded;
      for (const paneId of loaded.paneOrder) {
        void navigation.load(paneId);
      }
    } catch (error: unknown) {
      if (workspaceRequest.signal.aborted) {
        return;
      }
      workspaceError = error instanceof Error ? error.message : 'Unable to load workspace';
    }
    m.redraw();
  }

  function refetchAffectedPanes(paneId?: PaneId): void {
    if (workspace === undefined) return;
    for (const candidate of workspace.paneOrder) {
      if (paneId === undefined || candidate === paneId) void navigation.load(candidate);
    }
  }

  function applyDelta(paneId: PaneId, delta: DirectoryDelta): void {
    const current = directories.get(paneId);
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
      directories.set(paneId, {
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
    directories.set(paneId, { ...current, revision, entries: [...ordered, ...byId.values()] });
    if (delta.type === 'entriesAdded' && pendingCreatedLocation !== undefined) {
      const created = delta.entries.find((entry) => entry.location.uri === pendingCreatedLocation);
      if (created !== undefined) {
        selections.set(
          paneId,
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
    const location = paneId === undefined ? undefined : directories.get(paneId)?.location;
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
    const directory = active === undefined ? undefined : directories.get(active.paneId);
    const selection = active === undefined ? undefined : selections.get(active.paneId);
    return (
      directory?.entries
        .filter((entry) => selection?.selectedEntryIds.includes(entry.id) === true)
        .map((entry) => entry.location) ?? []
    );
  }

  function actionContext() {
    const active = activeDirectory();
    const selection = active === undefined ? undefined : selections.get(active.paneId);
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
    const effectiveEntries =
      selectedEntries ??
      (effectivePaneId === undefined
        ? []
        : (directories
            .get(effectivePaneId)
            ?.entries.filter(
              (entry) =>
                selections.get(effectivePaneId)?.selectedEntryIds.includes(entry.id) === true,
            ) ?? []));
    const directory = effectivePaneId === undefined ? undefined : directories.get(effectivePaneId);
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
    const directory = paneId === undefined ? undefined : directories.get(paneId);
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
    const directory = directories.get(menu.paneId);
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
        const directory = active === undefined ? undefined : directories.get(active.paneId);
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
    }
    if (dispatchedAction === 'core.copy') {
      const active = activeDirectory();
      const selection = active === undefined ? undefined : selections.get(active.paneId);
      const directory = active === undefined ? undefined : directories.get(active.paneId);
      const selected = directory?.entries.filter(
        (entry) => selection?.selectedEntryIds.includes(entry.id) === true && entry.kind === 'file',
      );
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      const destination =
        otherPaneId === undefined ? undefined : directories.get(otherPaneId)?.location;
      const source = selected?.length === 1 ? selected[0] : undefined;
      if (source !== undefined && destination !== undefined) {
        event.preventDefault();
        void attrsClient.startOperation({
          type: 'copy',
          sources: [source.location],
          destination,
          conflictPolicy: 'ask',
        });
      }
      return;
    }
    if (dispatchedAction === 'core.move') {
      const active = activeDirectory();
      const selection = active === undefined ? undefined : selections.get(active.paneId);
      const directory = active === undefined ? undefined : directories.get(active.paneId);
      const selected = directory?.entries.filter(
        (entry) => selection?.selectedEntryIds.includes(entry.id) === true,
      );
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      const destination =
        otherPaneId === undefined ? undefined : directories.get(otherPaneId)?.location;
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
    if (dispatchedAction === 'core.delete') {
      const active = activeDirectory();
      const selection = active === undefined ? undefined : selections.get(active.paneId);
      const directory = active === undefined ? undefined : directories.get(active.paneId);
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
    if (dispatchedAction === 'core.quickFilter') {
      const active = activeDirectory();
      if (active === undefined) return;
      event.preventDefault();
      quickFilterOpen.set(active.paneId, true);
      if (!quickFilterDrafts.has(active.paneId)) {
        const pane = workspace?.panesById[active.paneId];
        const tab = pane?.tabsById[pane.activeTabId];
        quickFilterDrafts.set(active.paneId, tab?.view.quickFilter?.query ?? '');
      }
      m.redraw();
    }
  }

  function handleBackendEvent(event: BackendEvent): void {
    if (event.workspaceId !== undefined && event.workspaceId !== workspace?.id) return;
    const payload = event.payload;
    if (payload.type === 'operation.conflict') {
      pendingConflict = payload;
      m.redraw();
    }
    if (payload.type.startsWith('operation.')) {
      pendingOperationEvents.push(event);
      if (operationFrame === undefined) {
        operationFrame = requestAnimationFrame(() => {
          operationFrame = undefined;
          operations = reduceOperationEvents(operations, pendingOperationEvents);
          pendingOperationEvents = [];
          m.redraw();
        });
      }
      return;
    }
    if (payload.type === 'directory.snapshot') {
      const current = directories.get(payload.snapshot.paneId);
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

  function setTheme(client: FileManagerClient, next: Theme): void {
    theme = next;
    ThemeManager.setTheme(next);
    if (currentSettings !== undefined) {
      const updated = { ...currentSettings, theme: next };
      currentSettings = updated;
      void client.updateSettings(updated);
    }
  }

  function paneContent(
    client: FileManagerClient,
    entryFormatSettings: EntryFormatSettings,
    paneId: PaneId,
  ): WorkspacePaneContent {
    const directory = directories.get(paneId) ?? {
      state: { type: 'idle' } as const,
      entries: [],
      hasMore: false,
    };
    const pane = workspace?.panesById[paneId];
    const tab = pane?.tabsById[pane.activeTabId];
    const selection = selections.get(paneId) ?? emptySelection;
    const sorted =
      tab === undefined
        ? directory.entries
        : entriesSortedFor(
            paneId,
            directory.entries,
            effectiveSort(tab.view.sort),
            tab.view.foldersFirst,
          );
    const quickFilterQuery = quickFilterQueryFor(paneId, tab);
    const filtered = entriesFilteredFor(paneId, sorted, quickFilterQuery);
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
      filterOpen: quickFilterOpenFor(paneId, tab),
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
      metadata: metadataViews.get(paneId) ?? { state: 'idle' },
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
        const orderedEntryIds =
          action.type === 'selectAll' || action.type === 'invert'
            ? directory.entries.map((entry) => entry.id)
            : entryIds;
        const next = reduceSelection(selection, action, orderedEntryIds);
        selections.set(paneId, next);
        const cursorEntry = entries.find((entry) => entry.id === next.cursorEntryId);
        void metadataLoader(client, paneId).select(
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
        quickFilterDrafts.set(paneId, query);
        m.redraw();
      },
      onFilterCommit: () => {
        const draft = quickFilterDrafts.get(paneId);
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
        quickFilterOpen.set(paneId, false);
        quickFilterDrafts.delete(paneId);
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
      document.addEventListener('keydown', handleGlobalKeydown);
      appState = applyAppPatches(
        createInitialAppState(attrs.runtime),
        connectionPatch({ status: attrs.client.connection.get() }),
      );
      navigation = createNavigationController({
        client: attrs.client,
        getWorkspace: () => workspace,
        replaceWorkspace: (next) => replaceWorkspace(next),
        updatePane: (paneId, view) => {
          const previous = directories.get(paneId);
          directories.set(paneId, view);
          if (view.entries.length === 0) {
            selections.set(paneId, emptySelection);
            void metadataLoader(attrs.client, paneId).select(undefined);
          } else if (
            selections.get(paneId)?.cursorEntryId === undefined ||
            previous?.location?.uri !== view.location?.uri
          ) {
            const firstEntry = view.entries[0];
            selections.set(paneId, {
              selectedEntryIds: [],
              ...(firstEntry === undefined ? {} : { cursorEntryId: firstEntry.id }),
            });
            void metadataLoader(attrs.client, paneId).select(firstEntry);
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
      if (operationFrame !== undefined) cancelAnimationFrame(operationFrame);
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
      return m('.fm-app-shell', [
        m('.fm-workspace-toolbar', [
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
              '←',
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
              '→',
            ),
            m(
              'button',
              {
                type: 'button',
                disabled: workspace === undefined,
                'aria-label': 'Parent directory',
                onclick: () => void navigation.parent(workspace?.activePaneId ?? ''),
              },
              '↑',
            ),
          ]),
          m('span', 'Search'),
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
            'Command palette',
          ),
          m('details.fm-settings-disclosure', [
            m('summary.fm-settings-button', 'Settings'),
            m('.fm-settings-editor', { role: 'dialog', 'aria-label': 'Settings' }, [
              m('.fm-settings-editor-heading', [
                m('strong', 'Appearance'),
                m(
                  'button',
                  {
                    type: 'button',
                    'aria-label': 'Close settings',
                    onclick: (event: MouseEvent) => {
                      const disclosure = (event.currentTarget as HTMLElement).closest('details');
                      if (disclosure instanceof HTMLDetailsElement) disclosure.open = false;
                    },
                  },
                  '×',
                ),
              ]),
              m(ThemeSwitcher, {
                theme,
                showLabels: true,
                onThemeChange: (next: Theme) => setTheme(attrs.client, next),
              }),
              m('.fm-settings-editor-heading', [m('strong', 'Plugins')]),
              m(PluginManagement, {
                plugins,
                onToggle: (pluginId: PluginId, enabled: boolean) =>
                  attrs.client.setPluginEnabled(pluginId, enabled),
                onRequestLogs: (pluginId: PluginId): Promise<readonly PluginLogEntry[]> =>
                  attrs.client.getPluginLogs(pluginId),
              }),
            ]),
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
        m(
          '.fm-function-key-bar',
          getLiveBindings(registeredActions, currentSettings?.keybindings ?? {}, {
            scope: 'table',
            platform,
            runtime: attrs.runtime === 'http' ? 'browser' : 'desktop',
          })
            .filter((binding) => /^F(?:2|5|6|7|8)$/u.test(binding.shortcut))
            .flatMap((binding) => {
              const action = registeredActions.find(
                (candidate) => candidate.id === binding.actionId,
              );
              if (
                action === undefined ||
                !evaluateActionAvailability(action, commandAvailabilityContext()).available
              )
                return [];
              return [m('span', `${binding.shortcut} ${action.title}`)];
            }),
        ),
      ]);
    },
  };
};
