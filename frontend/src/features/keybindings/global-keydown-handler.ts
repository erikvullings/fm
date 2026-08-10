import { toast } from 'mithril-materialized';
import {
  dispatchKeybinding,
  hasPrimaryModifier,
  type KeybindingRuntime,
} from '../../keybindings/dispatcher';
import type {
  ActionDescriptor,
  ActionInvocationContext,
  ClipboardState,
  EntrySummary,
  Location,
  PaneId,
  Settings,
  WorkspaceProjection,
} from '../../models';
import { type AppState, applyAppPatches, setQuickFilterDraftPatch } from '../../state';
import {
  clearClipboard,
  copyToClipboard,
  cutToClipboard,
  validatePasteTarget,
} from '../clipboard/clipboard';
import type { CommandAvailabilityContext } from '../commands/availability';
import type { NavigationController, PaneDirectoryView } from '../navigation/navigation';
import type { OperationsController } from '../operations/operations-controller';
import { isParentEntry } from '../panes/parent-entry';
import type { TabController } from '../panes/tab-controller';
import type { FileViewerController, FileViewerState } from '../preview/file-viewer-controller';
import type { SelectionPlatform } from '../selection/keybindings';
import { getSelectedEntries, type SelectionState } from '../selection/selection';

type ArchiveCreateRequest = {
  readonly sources: readonly Location[];
  readonly destinationDirectory: Location;
  readonly moveSources: boolean;
};

type InitialSearch = {
  readonly query: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
};

export interface GlobalKeydownContext {
  // State getters
  getCommandPaletteOpen(): boolean;
  getPlatform(): SelectionPlatform;
  getKeybindingRuntime(): KeybindingRuntime;
  getCurrentSettings(): Settings | undefined;
  getWorkspace(): WorkspaceProjection | undefined;
  getSelections(): Map<string, SelectionState>;
  getDirectories(): Map<string, PaneDirectoryView>;
  getRegisteredActions(): readonly ActionDescriptor[];
  clipboard(): ClipboardState;
  getFindFilesOpen(): boolean;
  getViewer(
    paneId: PaneId,
  ): { readonly controller: FileViewerController; state: FileViewerState } | undefined;
  getArchiveCreateRequest(): ArchiveCreateRequest | undefined;
  getCreateDirectoryOpen(): boolean;
  getAppState(): AppState | undefined;

  // State setters
  setCommandPaletteOpen(open: boolean): void;
  setClipboardMessage(msg: string | undefined): void;
  setArchiveCreateRequest(req: ArchiveCreateRequest | undefined): void;
  setCreateDirectoryOpen(open: boolean): void;
  setAppState(state: AppState): void;
  setQuickFilterOpen(key: string, open: boolean): void;

  // Controller accessors
  getTabController(): TabController;
  getOpsController(): OperationsController;
  getNavigation(): NavigationController;

  // Helper functions
  activeDirectory(): { paneId: PaneId; location: Location } | undefined;
  activeTabKey(paneId: PaneId): string;
  actionsWithFavourites(): readonly ActionDescriptor[];
  openFindFiles(): void;
  replaceClipboard(next?: ClipboardState): void;
  selectedLocations(): readonly Location[];
  invokeActionById(actionId: string, parameters: unknown, ctx: ActionInvocationContext): void;
  openViewer(paneId: PaneId, entry: EntrySummary, initialSearch?: InitialSearch): void;
  openEditor(paneId: PaneId, entry: EntrySummary): void;
  actionContext(): ActionInvocationContext;
  commandAvailabilityContext(
    entries?: readonly EntrySummary[],
    paneId?: PaneId,
  ): CommandAvailabilityContext;
  contentSearchInitialQuery(locationUri: string, entry: EntrySummary): InitialSearch | undefined;
  refetchAffectedPanes(paneId?: PaneId): void;
  platformActionParameters(
    actionId: string,
    entries: readonly EntrySummary[],
    location: Location | undefined,
  ): { uri: string } | undefined;
  activatePane(paneId: PaneId): void;
  redraw(): void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function createGlobalKeydownHandler(
  context: GlobalKeydownContext,
): (event: KeyboardEvent) => void {
  return function handleGlobalKeydown(event: KeyboardEvent): void {
    if (context.getCommandPaletteOpen()) return;
    if (
      hasPrimaryModifier(event, context.getPlatform()) &&
      !event.altKey &&
      event.key.toLowerCase() === 'p'
    ) {
      event.preventDefault();
      context.setCommandPaletteOpen(true);
      context.redraw();
      return;
    }
    const dispatchedAction = dispatchKeybinding(
      event,
      {
        scope: isEditableTarget(event.target) ? 'pathInput' : 'table',
        platform: context.getPlatform(),
        runtime: context.getKeybindingRuntime(),
      },
      context.actionsWithFavourites(),
      context.getCurrentSettings()?.keybindings ?? {},
    );
    // Alt+F3 forces the OS default application instead of the in-app Lister viewer. It never
    // matches `core.view`'s registered F3 chord (whose `alt` flag must be false), so it is
    // special-cased here rather than resolved through `dispatchKeybinding`.
    const forceSystemView =
      !isEditableTarget(event.target) && event.altKey && event.key.toUpperCase() === 'F3';
    const forceSystemEdit =
      !isEditableTarget(event.target) &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toUpperCase() === 'F4';
    if (dispatchedAction === 'core.favourites') {
      event.preventDefault();
      context.setCommandPaletteOpen(true);
      context.redraw();
      return;
    }
    if (dispatchedAction?.startsWith('core.favourite.')) {
      const index = Number(dispatchedAction.slice('core.favourite.'.length));
      const favourite = context.getCurrentSettings()?.favouriteLocations[index];
      const active = context.activeDirectory();
      if (favourite !== undefined && active !== undefined) {
        event.preventDefault();
        void context.getNavigation().navigate(active.paneId, favourite.location);
      }
      return;
    }
    if (
      !isEditableTarget(event.target) &&
      hasPrimaryModifier(event, context.getPlatform()) &&
      !event.altKey
    ) {
      const key = event.key.toLowerCase();
      const sources = context.selectedLocations();
      if ((key === 'c' || key === 'x') && sources.length > 0) {
        event.preventDefault();
        context.replaceClipboard(
          key === 'c'
            ? copyToClipboard(context.clipboard(), sources)
            : cutToClipboard(context.clipboard(), sources),
        );
        context.setClipboardMessage(undefined);
        context.redraw();
        return;
      }
      if (key === 'v') {
        event.preventDefault();
        const active = context.activeDirectory();
        const directory =
          active === undefined
            ? undefined
            : context.getDirectories().get(context.activeTabKey(active.paneId));
        const currentClipboard = context.clipboard();
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
          context.setClipboardMessage(validation.message);
          context.redraw();
          return;
        }
        const mode = currentClipboard.mode;
        if (mode === undefined || active === undefined) return;
        context.setClipboardMessage(undefined);
        void (
          mode === 'move'
            ? context.getOpsController().move(currentClipboard.locations, active.location)
            : context.getOpsController().copy(currentClipboard.locations, active.location)
        )
          .then(() => {
            if (mode === 'move') context.replaceClipboard(clearClipboard(currentClipboard));
            context.redraw();
          })
          .catch((error: unknown) => {
            context.setClipboardMessage(
              error instanceof Error ? error.message : 'Unable to paste clipboard entries.',
            );
            context.redraw();
          });
        return;
      }
      if (key >= '1' && key <= '9') {
        const active = context.activeDirectory();
        if (active !== undefined) {
          event.preventDefault();
          context.getTabController().jumpToTab(active.paneId, Number(key));
        }
        return;
      }
    }
    if (dispatchedAction === 'core.copy') {
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      const workspace = context.getWorkspace();
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      const destination =
        otherPaneId === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(otherPaneId))?.location;
      if (selected.length > 0 && destination !== undefined) {
        event.preventDefault();
        void context.getOpsController().copy(
          selected.map((entry) => entry.location),
          destination,
        );
      }
      return;
    }
    if (dispatchedAction === 'core.pack') {
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      if (selected.length > 0 && directory?.location !== undefined) {
        event.preventDefault();
        context.setArchiveCreateRequest({
          sources: selected.map((entry) => entry.location),
          destinationDirectory: directory.location,
          moveSources: false,
        });
      }
      return;
    }
    if (dispatchedAction === 'core.moveToArchive') {
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      if (selected.length > 0 && directory?.location !== undefined) {
        event.preventDefault();
        context.setArchiveCreateRequest({
          sources: selected.map((entry) => entry.location),
          destinationDirectory: directory.location,
          moveSources: true,
        });
      }
      return;
    }
    if (dispatchedAction === 'core.extract') {
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const cursor = selection?.cursorEntryId;
      const selected = directory?.entries.filter((entry) => entry.id === cursor);
      const workspace = context.getWorkspace();
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      const destination =
        otherPaneId === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(otherPaneId))?.location;
      const selectedEntry = selected?.length === 1 ? selected[0] : undefined;
      if (selectedEntry !== undefined && destination !== undefined) {
        event.preventDefault();
        void context.getOpsController().extract(selectedEntry.location, destination);
      }
      return;
    }
    if (dispatchedAction === 'core.move') {
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      const workspace = context.getWorkspace();
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      const destination =
        otherPaneId === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(otherPaneId))?.location;
      if (selected.length > 0 && destination !== undefined) {
        event.preventDefault();
        void context.getOpsController().move(
          selected.map((entry) => entry.location),
          destination,
        );
      }
      return;
    }
    if (dispatchedAction === 'core.trash') {
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      if (selected.length > 0) {
        event.preventDefault();
        void context.getOpsController().trash(selected.map((entry) => entry.location));
      }
      return;
    }
    if (dispatchedAction === 'core.delete') {
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      if (selected.length > 0) {
        event.preventDefault();
        void context.getOpsController().delete(
          selected.map((entry) => entry.location),
          context.getCurrentSettings()?.confirmPermanentDelete === false,
          false,
        );
      }
      return;
    }
    if (
      dispatchedAction === 'core.createDirectory' &&
      !context.getCreateDirectoryOpen() &&
      context.activeDirectory() !== undefined
    ) {
      event.preventDefault();
      context.setCreateDirectoryOpen(true);
      context.redraw();
      return;
    }
    if (dispatchedAction === 'core.findFiles' && !context.getFindFilesOpen()) {
      const active = context.activeDirectory();
      if (active === undefined) return;
      event.preventDefault();
      context.openFindFiles();
      context.redraw();
      return;
    }
    if (dispatchedAction === 'core.quickFilter') {
      const active = context.activeDirectory();
      if (active === undefined) return;
      event.preventDefault();
      const key = context.activeTabKey(active.paneId);
      context.setQuickFilterOpen(key, true);
      const appState = context.getAppState();
      if (!(key in (appState?.quickFilterDrafts.byTabKey ?? {}))) {
        const workspace = context.getWorkspace();
        const pane = workspace?.panesById[active.paneId];
        const tab = pane?.tabsById[pane.activeTabId];
        context.setAppState(
          applyAppPatches(
            appState!,
            setQuickFilterDraftPatch(key, tab?.view.quickFilter?.query ?? ''),
          ),
        );
      }
      context.redraw();
      return;
    }
    if (dispatchedAction === 'core.newTab') {
      const active = context.activeDirectory();
      if (active === undefined) return;
      event.preventDefault();
      context.getTabController().openTab(active.paneId);
      return;
    }
    if (dispatchedAction === 'core.switchPane') {
      const workspace = context.getWorkspace();
      if (workspace === undefined) return;
      event.preventDefault();
      const paneOrder = workspace.paneOrder;
      if (paneOrder.length < 2) return;
      const currentIndex = paneOrder.indexOf(workspace.activePaneId);
      if (currentIndex < 0) return;
      const direction = event.shiftKey ? -1 : 1;
      const nextIndex = (currentIndex + direction + paneOrder.length) % paneOrder.length;
      const nextPaneId = paneOrder[nextIndex];
      if (nextPaneId !== undefined) context.activatePane(nextPaneId);
      return;
    }
    if (dispatchedAction === 'core.closeTab') {
      const workspace = context.getWorkspace();
      if (workspace === undefined) return;
      const paneId = workspace.activePaneId;
      const pane = workspace.panesById[paneId];
      if (pane === undefined) return;
      event.preventDefault();
      context.getTabController().requestCloseTab(paneId, pane.activeTabId);
      return;
    }
    if (dispatchedAction === 'core.nextTab' || dispatchedAction === 'core.previousTab') {
      const workspace = context.getWorkspace();
      if (workspace === undefined) return;
      event.preventDefault();
      context
        .getTabController()
        .cycleTab(workspace.activePaneId, dispatchedAction === 'core.nextTab' ? 1 : -1);
      return;
    }
    if (dispatchedAction === 'core.reopenClosedTab') {
      const workspace = context.getWorkspace();
      if (workspace === undefined) return;
      event.preventDefault();
      context.getTabController().reopenClosedTab(workspace.activePaneId);
      return;
    }
    if (dispatchedAction === 'core.view' && !forceSystemView) {
      // If a viewer is open in the active pane, F3 navigates to the next search match.
      const workspace = context.getWorkspace();
      const activeViewer =
        workspace === undefined ? undefined : context.getViewer(workspace.activePaneId);
      if (activeViewer !== undefined) {
        event.preventDefault();
        activeViewer.controller.goToNextMatch();
        return;
      }
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      const viewEntry = selected?.length === 1 ? selected[0] : undefined;
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      // Only intercept single-file selections into the in-app viewer (task 0088); directories,
      // multi-selections, and single-pane workspaces (no opposite pane to open into) fall through
      // to the generic core.view/core.edit/core.openWith block below, which opens the OS default
      // application instead. The viewer itself closes and shows a toast for content that turns
      // out to be binary once its first chunk is fetched, rather than falling back further.
      if (
        viewEntry !== undefined &&
        viewEntry.kind === 'file' &&
        !isParentEntry(viewEntry.id) &&
        otherPaneId !== undefined
      ) {
        event.preventDefault();
        context.openViewer(
          otherPaneId,
          viewEntry,
          active === undefined
            ? undefined
            : context.contentSearchInitialQuery(active.location.uri, viewEntry),
        );
        return;
      }
    }
    if (dispatchedAction === 'core.edit' && !forceSystemEdit) {
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      const editEntry = selected?.length === 1 ? selected[0] : undefined;
      const workspace = context.getWorkspace();
      const otherPaneId = workspace?.paneOrder.find((paneId) => paneId !== active?.paneId);
      if (editEntry?.kind === 'file' && !isParentEntry(editEntry.id) && otherPaneId !== undefined) {
        event.preventDefault();
        context.openEditor(otherPaneId, editEntry);
        return;
      }
    }
    // `forceSystemView` (Alt+F3) always resolves to `core.view`, which the backend maps to the
    // same "open with OS default application" behaviour as `core.open` (see PlatformActionKind).
    const viewActionId = forceSystemView
      ? 'core.view'
      : forceSystemEdit
        ? 'core.edit'
        : dispatchedAction;
    if (
      viewActionId === 'core.view' ||
      viewActionId === 'core.edit' ||
      viewActionId === 'core.openWith'
    ) {
      const registeredActions = context.getRegisteredActions();
      const action = registeredActions.find((candidate) => candidate.id === viewActionId);
      // `core.view` itself is never permanently gated (task 0088: its in-app viewer works on
      // every host), but every path that reaches this block dispatches the OS-open fallback
      // instead (directories, multi-selections, single-pane workspaces, forced Alt+F3) - so
      // check `core.open`'s capability, which mirrors what the backend will actually dispatch to.
      const capabilityAction =
        viewActionId === 'core.view'
          ? registeredActions.find((candidate) => candidate.id === 'core.open')
          : action;
      if (capabilityAction?.contextRequirements.featureAvailable === false) {
        // The shortcut is still reachable by keyboard even though its footer
        // hint is hidden (task 0061 follow-up): warn briefly instead of
        // invoking, which would otherwise surface a persistent top-of-screen
        // error from the backend rejecting a known-unavailable action.
        event.preventDefault();
        toast({ html: `${action?.title ?? 'View'} isn't available in the browser.` });
        return;
      }
      const active = context.activeDirectory();
      const selection =
        active === undefined
          ? undefined
          : context.getSelections().get(context.activeTabKey(active.paneId));
      const directory =
        active === undefined
          ? undefined
          : context.getDirectories().get(context.activeTabKey(active.paneId));
      const selected = getSelectedEntries(selection, directory?.entries ?? []);
      const parameters = context.platformActionParameters(
        viewActionId,
        selected ?? [],
        directory?.location,
      );
      if (parameters !== undefined) {
        event.preventDefault();
        context.invokeActionById(viewActionId, parameters, context.actionContext());
      }
      return;
    }
  };
}
