import m from 'mithril';
import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { KeybindingRuntime } from '../../keybindings/dispatcher';
import type {
  ActionDescriptor,
  ActionInvocationContext,
  ClipboardState,
  Connection,
  EntryId,
  EntrySummary,
  Location,
  PaneId,
  PluginDescriptor,
  Settings,
  SortDescriptor,
  SystemLocation,
  TabId,
  TabProjection,
  WorkspaceProjection,
} from '../../models';
import {
  type AppState,
  applyAppPatches,
  deleteQuickFilterDraftPatch,
  setQuickFilterDraftPatch,
} from '../../state';
import { isCutLocation } from '../clipboard/clipboard';
import { loadConnections } from '../connections/connections-model';
import { SAMPLE_FILE_AGE_COLUMN } from '../directory-table/directory-table';
import type { NativeIconLoader } from '../directory-table/native-icon-loader';
import { operationForDrop, resolveDropTarget, validateDropTarget } from '../drag-drop/drag-drop';
import { FileEditor } from '../editor/file-editor';
import type { FileEditorController, FileEditorState } from '../editor/file-editor-controller';
import type { EntryFormatSettings } from '../entry-formatting/entry-formatting';
import { reorderFavourites } from '../favourites/favourites';
import { archiveRootForEntry } from '../navigation/archive-location';
import {
  type NavigationController,
  type PaneDirectoryView,
  parentLocation,
} from '../navigation/navigation';
import type { OperationsController } from '../operations/operations-controller';
import { isParentEntry, withParentEntry } from '../panes/parent-entry';
import { FileViewer } from '../preview/file-viewer';
import type { FileViewerController, FileViewerState } from '../preview/file-viewer-controller';
import { hiddenSelectedEntryCount } from '../quick-filter/quick-filter';
import type { SelectionPlatform } from '../selection/keybindings';
import {
  emptySelection,
  reduceSelection,
  type SelectionAction,
  type SelectionState,
} from '../selection/selection';
import { type SortModel, sortEntriesResponsive } from '../sorting/sorting';
import { dispatchWorkspaceCommand } from './dispatch-workspace-command';
import type { WorkspaceController } from './workspace-controller';
import { pathFromUri, type WorkspacePaneContent } from './workspace-layout';

type InitialSearch = {
  readonly query: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
};

export interface PaneContentContext {
  // Scalar state getters
  getWorkspace(): WorkspaceProjection | undefined;
  getCurrentSettings(): Settings | undefined;
  getSystemLocations(): readonly SystemLocation[];
  getSystemLocationsError(): string | undefined;
  getConnections(): readonly Connection[];
  getUnavailableLocations(): ReadonlySet<string>;
  getNativeIconLoader(): NativeIconLoader | undefined;
  getPlugins(): readonly PluginDescriptor[];
  getPlatform(): SelectionPlatform;
  getKeybindingRuntime(): KeybindingRuntime;
  getRegisteredActions(): readonly ActionDescriptor[];
  getDraggedLocations(): readonly Location[];
  getNativeDragOutSupported(): boolean;
  getNativeDropInProgress(): boolean;
  getAppState(): AppState | undefined;
  clipboard(): ClipboardState;

  // Map state (mutable reference — callers may .get()/.set()/.delete() directly)
  getDirectories(): Map<string, PaneDirectoryView>;
  getSelections(): Map<string, SelectionState>;
  getSortedEntries(): Map<
    string,
    {
      readonly input: readonly EntrySummary[];
      readonly key: string;
      readonly entries: readonly EntrySummary[];
    }
  >;
  getSortRequests(): Map<string, object>;
  getViewerByTab(): Map<
    string,
    {
      readonly paneId: PaneId;
      readonly tabId: TabId;
      readonly controller: FileViewerController;
      state: FileViewerState;
    }
  >;
  getEditorByPane(): Map<
    PaneId,
    { readonly controller: FileEditorController; state: FileEditorState }
  >;

  // Scalar state setters
  setConnections(conns: readonly Connection[]): void;
  setConnectionsManagerOpen(open: boolean): void;
  setAppState(state: AppState): void;
  setQuickFilterOpen(key: string, open: boolean): void;
  setDraggedLocations(locs: readonly Location[]): void;
  setClipboardMessage(msg: string | undefined): void;
  setMultiRenameOpen(open: boolean): void;
  setMultiRenameEntries(entries: readonly EntrySummary[]): void;
  setMultiRenameLocation(location: Location | undefined): void;
  setMultiRenameExistingNames(names: ReadonlySet<string>): void;

  // Helper functions
  tabKey(paneId: PaneId, tabId: TabId): string;
  effectiveSort(sort: readonly SortDescriptor[]): readonly SortDescriptor[];
  frontendSort(sort: readonly SortDescriptor[]): SortModel;
  sortLabel(sort: readonly SortDescriptor[]): string;
  entriesSortedFor(
    key: string,
    entries: readonly EntrySummary[],
    sort: readonly SortDescriptor[],
    foldersFirst: boolean,
  ): readonly EntrySummary[];
  entriesFilteredFor(
    key: string,
    entries: readonly EntrySummary[],
    query: string,
  ): readonly EntrySummary[];
  quickFilterQueryFor(key: string, tab: TabProjection | undefined): string;
  quickFilterOpenFor(key: string, tab: TabProjection | undefined): boolean;
  contentSearchInitialQuery(locationUri: string, entry: EntrySummary): InitialSearch | undefined;
  workspaceErrorMessage(error: unknown, fallback: string): string;
  locationForPath(current: Location, path: string): Location;
  activeDirectory(): { paneId: PaneId; location: Location } | undefined;

  // Controller accessors
  getNavigation(): NavigationController;
  getWorkspaceController(): WorkspaceController;
  getOpsController(): OperationsController;

  // Action functions
  openViewer(paneId: PaneId, entry: EntrySummary, initialSearch?: InitialSearch): void;
  closeViewer(paneId: PaneId): void;
  closeEditor(paneId: PaneId): void;
  updateLocationSettings(
    client: FileManagerClient,
    update: (settings: Settings) => Settings,
  ): Promise<void>;
  invokeActionById(actionId: string, params: unknown, ctx: ActionInvocationContext): void;
  openContextMenu(paneId: PaneId, entries: readonly EntrySummary[], x: number, y: number): void;
  refetchAffectedPanes(paneId?: PaneId): void;
  replaceWorkspace(next: WorkspaceProjection): void;
}

export function createPaneContentBuilder(
  context: PaneContentContext,
): (
  client: FileManagerClient,
  entryFormatSettings: EntryFormatSettings,
  paneId: PaneId,
) => WorkspacePaneContent {
  return function paneContent(
    client: FileManagerClient,
    entryFormatSettings: EntryFormatSettings,
    paneId: PaneId,
  ): WorkspacePaneContent {
    const workspace = context.getWorkspace();
    const pane = workspace?.panesById[paneId];
    const tab = pane?.tabsById[pane.activeTabId];
    const key = tab === undefined ? undefined : context.tabKey(paneId, tab.id);
    const directories = context.getDirectories();
    const selections = context.getSelections();
    const directory: PaneDirectoryView = (key === undefined ? undefined : directories.get(key)) ?? {
      state: { type: 'idle' } as const,
      entries: [],
      hasMore: false,
    };
    const selection = (key === undefined ? undefined : selections.get(key)) ?? emptySelection;
    const sorted =
      tab === undefined || key === undefined
        ? directory.entries
        : context.entriesSortedFor(
            key,
            directory.entries,
            context.effectiveSort(tab.view.sort),
            tab.view.foldersFirst,
          );
    const quickFilterQuery = key === undefined ? '' : context.quickFilterQueryFor(key, tab);
    const filtered =
      key === undefined ? sorted : context.entriesFilteredFor(key, sorted, quickFilterQuery);
    const entries =
      tab === undefined ? filtered : withParentEntry(pathFromUri(tab.location.uri), filtered);
    const entryIds = entries.map((entry) => entry.id);
    const cursorIndex =
      selection.cursorEntryId === undefined ? undefined : entryIds.indexOf(selection.cursorEntryId);
    const selectedEntryIds = new Set<EntryId>(selection.selectedEntryIds);
    // While filtering, the true directory total can't be projected past what's loaded and
    // matched so far; otherwise use the backend's real count (plus the synthetic ".." row)
    // so the scrollbar is sized correctly from the very first page, not just once fully loaded.
    const totalKnownEntries =
      quickFilterQuery.trim() === ''
        ? (directory.totalKnownEntries ?? directory.entries.length) +
          (entries.length - filtered.length)
        : entries.length;
    const currentSettings = context.getCurrentSettings();
    const systemLocationsError = context.getSystemLocationsError();
    const nativeIconLoader = context.getNativeIconLoader();
    const viewerTitles = new Map(
      (pane?.tabOrder ?? []).flatMap((tabId) => {
        const title = context.getViewerByTab().get(context.tabKey(paneId, tabId))?.state.entry.name;
        return title === undefined ? [] : [[tabId, title] as const];
      }),
    );
    return {
      ...directory,
      viewerTitles,
      ...(tab === undefined ? {} : { location: tab.location }),
      favouriteLocations: currentSettings?.favouriteLocations ?? [],
      recentLocations:
        workspace === undefined || currentSettings === undefined
          ? []
          : (currentSettings.recentLocationsByWorkspace[workspace.id] ?? []),
      systemLocations: context.getSystemLocations(),
      ...(systemLocationsError === undefined ? {} : { systemLocationsError }),
      onRetrySystemLocations: () => context.getWorkspaceController().loadSystemLocations(),
      connections: context.getConnections(),
      onManageConnections: () => {
        context.setConnectionsManagerOpen(true);
        m.redraw();
      },
      onRefreshConnections: async () => {
        context.setConnections(await loadConnections(client));
      },
      unavailableLocations: context.getUnavailableLocations(),
      entries,
      selectedEntryIds,
      cutEntryIds: new Set<EntryId>(
        directory.entries
          .filter((entry) => isCutLocation(context.clipboard(), entry.location))
          .map((entry) => entry.id),
      ),
      sortLabel: context.sortLabel(context.effectiveSort(tab?.view.sort ?? [])),
      sort: context.effectiveSort(tab?.view.sort ?? []),
      totalEntryCount: directory.entries.length,
      totalKnownEntries,
      hiddenSelectedCount: hiddenSelectedEntryCount(directory.entries, filtered, selectedEntryIds),
      filterOpen: key === undefined ? false : context.quickFilterOpenFor(key, tab),
      filterQuery: quickFilterQuery,
      formatSettings: entryFormatSettings,
      ...(nativeIconLoader === undefined ? {} : { nativeIconLoader }),
      pluginColumns:
        context
          .getPlugins()
          .some(
            (plugin) =>
              plugin.enabled && plugin.columns?.some((column) => column.id === 'sample.fileAge'),
          ) &&
        tab?.view.columns.some((column) => column.columnId === 'sample.fileAge' && column.visible)
          ? [SAMPLE_FILE_AGE_COLUMN]
          : [],
      platform: context.getPlatform(),
      keybindingRuntime: context.getKeybindingRuntime(),
      actions: context.getRegisteredActions(),
      keybindingOverrides: currentSettings?.keybindings ?? {},
      ...(cursorIndex === undefined || cursorIndex < 0 ? {} : { cursorIndex }),
      onNavigate: async (path) => {
        if (tab !== undefined) {
          await context
            .getNavigation()
            .navigate(paneId, context.locationForPath(tab.location, path));
        }
      },
      onNavigateLocation: async (location) => {
        await context.getNavigation().navigate(paneId, location);
      },
      onAddFavourite: (label, location) =>
        context.updateLocationSettings(client, (settings) => ({
          ...settings,
          favouriteLocations: [...settings.favouriteLocations, { label, location }],
        })),
      onDeleteFavourite: (location) =>
        context.updateLocationSettings(client, (settings) => ({
          ...settings,
          favouriteLocations: settings.favouriteLocations.filter(
            (favourite) =>
              favourite.location.providerId !== location.providerId ||
              favourite.location.uri !== location.uri,
          ),
          recentLocationsByWorkspace: Object.fromEntries(
            Object.entries(settings.recentLocationsByWorkspace).map(([workspaceId, locations]) => [
              workspaceId,
              locations.filter(
                (candidate) =>
                  candidate.providerId !== location.providerId || candidate.uri !== location.uri,
              ),
            ]),
          ),
        })),
      onReorderFavourites: (from, to) =>
        context.updateLocationSettings(client, (settings) => ({
          ...settings,
          favouriteLocations: reorderFavourites(settings.favouriteLocations, from, to),
        })),
      onBack: () => context.getNavigation().back(paneId),
      onForward: () => context.getNavigation().forward(paneId),
      onParent: () =>
        tab?.location.uri.startsWith('search://')
          ? context.getNavigation().back(paneId)
          : context.getNavigation().parent(paneId),
      onOpenEntry: (entry) => {
        if (isParentEntry(entry.id)) {
          return tab?.location.uri.startsWith('search://')
            ? context.getNavigation().back(paneId)
            : context.getNavigation().parent(paneId);
        }
        if (tab?.location.uri.startsWith('search://')) {
          const initialSearch = context.contentSearchInitialQuery(tab.location.uri, entry);
          if (initialSearch !== undefined) {
            const otherPaneId = workspace?.paneOrder.find(
              (candidatePaneId) => candidatePaneId !== paneId,
            );
            if (otherPaneId) {
              return context.openViewer(otherPaneId, entry, initialSearch);
            }
          }
          return context
            .getNavigation()
            .navigate(paneId, parentLocation(entry.location), entry.name);
        }
        const systemLocations = context.getSystemLocations();
        const isSystemLocation = systemLocations.some(
          ({ location }) =>
            location.providerId === entry.location.providerId &&
            location.uri === entry.location.uri,
        );
        if (entry.kind === 'directory' || isSystemLocation) {
          return context.getNavigation().navigate(paneId, entry.location);
        }
        const archiveRoot = archiveRootForEntry(entry);
        if (archiveRoot !== undefined) return context.getNavigation().navigate(paneId, archiveRoot);
        return context.invokeActionById(
          'core.open',
          { uri: entry.location.uri },
          { paneId, selectedEntryIds: [entry.id], cursorEntryId: entry.id },
        );
      },
      onSelectionAction: (action: SelectionAction) => {
        if (key === undefined) return;
        if (action.type === 'moveCursorTo' && action.edge === 'last' && directory.hasMore) {
          // The loaded prefix doesn't include the real last entry yet: fetch every remaining
          // page (cheap, cache-backed slices on the backend) before landing the cursor, rather
          // than jumping to the last entry loaded so far.
          void context
            .getNavigation()
            .loadAllPages(paneId)
            .then(async () => {
              // `entriesSortedFor`'s cache is only refreshed by a redraw, and no redraw happens
              // between the background page fetches above. For directories at/over its 10k
              // responsive-sort threshold, reading the cache right now would otherwise return a
              // stale sort of a much smaller (pre-`loadAllPages`) prefix and land the cursor on
              // the wrong entry. Force a fresh, correctly-ordered sort of the fully-loaded
              // entries first, and seed the cache with it so this call (and the next redraw) see
              // the real order.
              //
              // This must stay scoped to `tab`/`key` as captured when the action was dispatched,
              // never re-derived from `pane.activeTabId` — the user may have switched to a
              // different tab while the pages were still loading in the background, and applying
              // the result to whichever tab is active *now* would write this tab's cursor/entry
              // into the wrong tab's selection state.
              const freshDirectory = context.getDirectories().get(key);
              if (tab !== undefined && freshDirectory !== undefined) {
                const sortDescriptors = context.effectiveSort(tab.view.sort);
                const cacheKey = JSON.stringify([sortDescriptors, tab.view.foldersFirst]);
                // Invalidate any in-flight sort of an earlier (smaller) entries snapshot so it
                // can't overwrite the fresh result seeded below once it resolves.
                context.getSortRequests().set(key, {});
                const sorted = await sortEntriesResponsive(
                  freshDirectory.entries,
                  context.frontendSort(sortDescriptors),
                  tab.view.foldersFirst,
                );
                context.getSortedEntries().set(key, {
                  input: freshDirectory.entries,
                  key: cacheKey,
                  entries: sorted,
                });
                context.getSortRequests().delete(key);
              }
              const sortedFresh =
                tab === undefined
                  ? (context.getDirectories().get(key)?.entries ?? [])
                  : context.entriesSortedFor(
                      key,
                      context.getDirectories().get(key)?.entries ?? [],
                      context.effectiveSort(tab.view.sort),
                      tab.view.foldersFirst,
                    );
              const filteredFresh = context.entriesFilteredFor(
                key,
                sortedFresh,
                context.quickFilterQueryFor(key, tab),
              );
              const loadedEntries =
                tab === undefined
                  ? filteredFresh
                  : withParentEntry(pathFromUri(tab.location.uri), filteredFresh);
              const loadedEntryIds = loadedEntries.map((entry) => entry.id);
              const next = reduceSelection(
                context.getSelections().get(key) ?? selection,
                action,
                loadedEntryIds,
              );
              context.getSelections().set(key, next);
              m.redraw();
            });
          return;
        }
        const next = reduceSelection(selection, action, entryIds);
        context.getSelections().set(key, next);
        m.redraw();
      },
      onRetry: () => context.getNavigation().retry(paneId),
      onLoadNextPage: () => context.getNavigation().loadNextPage(paneId),
      onSortChange: (sort) => {
        const liveWorkspace = context.getWorkspace();
        if (liveWorkspace === undefined || tab === undefined) return;
        void dispatchWorkspaceCommand(
          client,
          {
            type: 'updateView',
            workspaceId: liveWorkspace.id,
            paneId,
            tabId: tab.id,
            patch: { sort: [...sort] },
            expectedRevision: liveWorkspace.revision,
          },
          context.replaceWorkspace,
        ).catch(() => undefined);
      },
      onFilterQueryChange: (query) => {
        if (key === undefined) return;
        context.setAppState(
          applyAppPatches(context.getAppState()!, setQuickFilterDraftPatch(key, query)),
        );
        m.redraw();
      },
      onFilterCommit: () => {
        if (key === undefined) return;
        const draft = context.getAppState()?.quickFilterDrafts.byTabKey[key];
        const liveWorkspace = context.getWorkspace();
        if (liveWorkspace === undefined || tab === undefined || draft === undefined) return;
        const committed = tab.view.quickFilter?.query ?? '';
        if (draft === committed) return;
        void dispatchWorkspaceCommand(
          client,
          {
            type: 'updateView',
            workspaceId: liveWorkspace.id,
            paneId,
            tabId: tab.id,
            patch: {
              quickFilter:
                draft.trim() === '' ? { type: 'clear' } : { type: 'set', filter: { query: draft } },
            },
            expectedRevision: liveWorkspace.revision,
          },
          context.replaceWorkspace,
        ).catch(() => undefined);
      },
      onFilterClose: () => {
        if (key !== undefined) {
          context.setQuickFilterOpen(key, false);
          context.setAppState(
            applyAppPatches(context.getAppState()!, deleteQuickFilterDraftPatch(key)),
          );
        }
        const liveWorkspace = context.getWorkspace();
        if (liveWorkspace !== undefined && tab !== undefined && tab.view.quickFilter != null) {
          void dispatchWorkspaceCommand(
            client,
            {
              type: 'updateView',
              workspaceId: liveWorkspace.id,
              paneId,
              tabId: tab.id,
              patch: { quickFilter: { type: 'clear' } },
              expectedRevision: liveWorkspace.revision,
            },
            context.replaceWorkspace,
          ).catch(() => undefined);
        }
        m.redraw();
      },
      onRename: (entry, name) => {
        const active = context.activeDirectory();
        if (active === undefined || active.paneId !== paneId) return;
        const destinationUri = `${active.location.uri.replace(/\/$/u, '')}/${encodeURIComponent(name)}`;
        void context
          .getOpsController()
          .rename(entry.location, { ...entry.location, uri: destinationUri });
      },
      onContextMenu: (entries, x, y) => context.openContextMenu(paneId, entries, x, y),
      onDragStart: (draggedEntries, event) => {
        context.setDraggedLocations(draggedEntries.map((entry) => entry.location));
        if (context.getNativeDragOutSupported()) {
          event.preventDefault();
          void client
            .startNativeDrag(draggedEntries.map((entry) => entry.location))
            .catch((error: unknown) => {
              context.setClipboardMessage(
                context.workspaceErrorMessage(error, 'Unable to start native drag'),
              );
              m.redraw();
            });
          return;
        }
        event.dataTransfer?.setData('application/x-fm-locations', 'internal');
        if (event.dataTransfer != null) event.dataTransfer.effectAllowed = 'copyMove';
      },
      onDragOver: (entry, event) => {
        const target = tab === undefined ? undefined : resolveDropTarget(tab.location, entry);
        const validation = validateDropTarget(
          context.getDraggedLocations(),
          target,
          directory.writable === true,
        );
        if (!validation.ok) return false;
        if (event.dataTransfer != null) {
          event.dataTransfer.dropEffect = operationForDrop(context.getPlatform(), event);
        }
        return true;
      },
      onDrop: (entry, event) => {
        if (tab === undefined) return;
        const target = resolveDropTarget(tab.location, entry);
        const validation = validateDropTarget(
          context.getDraggedLocations(),
          target,
          directory.writable === true,
        );
        if (!validation.ok) {
          context.setClipboardMessage(validation.message);
          return;
        }
        const sources = context.getDraggedLocations();
        context.setDraggedLocations([]);
        void (context.getNativeDropInProgress() ||
        operationForDrop(context.getPlatform(), event) === 'copy'
          ? context.getOpsController().copy(sources, target)
          : context.getOpsController().move(sources, target));
      },
      onTabDragOver: (targetTabId, event) => {
        const targetTab = pane?.tabsById[targetTabId];
        const targetDirectory = directories.get(context.tabKey(paneId, targetTabId));
        const validation = validateDropTarget(
          context.getDraggedLocations(),
          targetTab?.location,
          targetDirectory?.writable === true,
        );
        if (!validation.ok) return false;
        if (event.dataTransfer != null)
          event.dataTransfer.dropEffect = operationForDrop(context.getPlatform(), event);
        return true;
      },
      onTabDrop: (targetTabId, event) => {
        const targetTab = pane?.tabsById[targetTabId];
        const targetDirectory = directories.get(context.tabKey(paneId, targetTabId));
        const validation = validateDropTarget(
          context.getDraggedLocations(),
          targetTab?.location,
          targetDirectory?.writable === true,
        );
        if (!validation.ok || targetTab === undefined) {
          if (!validation.ok) context.setClipboardMessage(validation.message);
          return;
        }
        const sources = context.getDraggedLocations();
        context.setDraggedLocations([]);
        void (context.getNativeDropInProgress() ||
        operationForDrop(context.getPlatform(), event) === 'copy'
          ? context.getOpsController().copy(sources, targetTab.location)
          : context.getOpsController().move(sources, targetTab.location));
      },
      onMultiRename: (selected) => {
        if (tab === undefined) return;
        context.setMultiRenameOpen(true);
        context.setMultiRenameEntries(selected);
        context.setMultiRenameLocation(tab.location);
        const selectedIds = new Set(selected.map((entry) => entry.id));
        context.setMultiRenameExistingNames(
          new Set(
            directory.entries
              .filter((entry) => !selectedIds.has(entry.id))
              .map((entry) => entry.name),
          ),
        );
      },
      ...(context.getEditorByPane().has(paneId)
        ? {
            viewerContent: (() => {
              const editor = context.getEditorByPane().get(paneId);
              return editor === undefined
                ? undefined
                : m(FileEditor, {
                    state: editor.state,
                    controller: editor.controller,
                    onClose: () => context.closeEditor(paneId),
                  });
            })(),
          }
        : key !== undefined && context.getViewerByTab().has(key)
          ? {
              viewerContent: (() => {
                const viewer = context.getViewerByTab().get(key);
                if (viewer === undefined) return undefined;
                return m(FileViewer, {
                  state: viewer.state,
                  onLoadMore: () => void viewer.controller.loadMore(),
                  onSearchQueryChange: (query) => viewer.controller.setSearchOptions({ query }),
                  onSearchOptionChange: (patch) => viewer.controller.setSearchOptions(patch),
                  onRunSearch: () => void viewer.controller.runSearch(),
                  onNextMatch: () => void viewer.controller.goToNextMatch(),
                  onPreviousMatch: () => void viewer.controller.goToPreviousMatch(),
                  onZoomIn: () => viewer.controller.zoomIn(),
                  onZoomOut: () => viewer.controller.zoomOut(),
                  onResetZoom: () => viewer.controller.resetZoom(),
                  onClose: () => context.closeViewer(paneId),
                });
              })(),
            }
          : {}),
    };
  };
}
