import type { FileManagerClient } from '../../api/client/file-manager-client';
import type {
  ActionDescriptor,
  ActionInvocationContext,
  EntrySummary,
  Location,
  PaneId,
  Settings,
  WorkspaceProjection,
} from '../../models';
import type { ClipboardState } from '../clipboard/clipboard';
import { clearClipboard } from '../clipboard/clipboard';
import {
  copySelectionToClipboard,
  isCopySelectionAction,
} from '../clipboard/copy-selection-actions';
import type { CommandAvailabilityContext } from '../commands/availability';
import { evaluateActionAvailability } from '../commands/availability';
import type { NavigationController, PaneDirectoryView } from '../navigation/navigation';
import type { OperationsController } from '../operations/operations-controller';
import type { SelectionState } from '../selection/selection';

/** Context required by ActionCommandController for state access and dependencies. */
export interface ActionCommandControllerContext {
  // State getters
  getCommandPaletteOpen(): boolean;
  getContextMenu():
    | {
      readonly paneId: PaneId;
      readonly entries: readonly EntrySummary[];
      readonly x: number;
      readonly y: number;
    }
    | undefined;
  getCommandPaletteRecency(): Map<string, number>;

  // State setters
  setCommandPaletteOpen(open: boolean): void;
  setContextMenu(
    menu:
      | {
        readonly paneId: PaneId;
        readonly entries: readonly EntrySummary[];
        readonly x: number;
        readonly y: number;
      }
      | undefined,
  ): void;

  // Dependencies
  getActiveDirectory(): { paneId: PaneId; location: Location } | undefined;
  getActiveTabKey(paneId: PaneId): string;
  getSelections(): Map<string, SelectionState>;
  getDirectories(): Map<string, PaneDirectoryView>;
  getCurrentSettings(): Settings | undefined;
  getClient(): FileManagerClient;
  getRegisteredActions(): readonly ActionDescriptor[];
  getWorkspace(): WorkspaceProjection | undefined;
  getNavigation(): NavigationController;
  getOpsController(): OperationsController;
  getGetSelectedEntries(): (
    selection: SelectionState | undefined,
    entries: readonly EntrySummary[],
  ) => readonly EntrySummary[];
  getClipboard(): ClipboardState;
  replaceClipboard(next?: ClipboardState): void;
  toast(options: { html: string }): void;
  getOpenTerminalSupported(): boolean;
  openCreateDirectory(location?: import('../../models').Location): void;
  redraw(): void;
}

/** Controller interface for action and command invocation. */
export interface ActionCommandController {
  /**
   * Gets the current action invocation context based on the active pane and selections.
   */
  actionContext(): ActionInvocationContext;

  /**
   * Gets the command availability context for evaluating which actions are available.
   */
  commandAvailabilityContext(
    selectedEntries?: readonly EntrySummary[],
    paneId?: PaneId,
  ): CommandAvailabilityContext;

  /**
   * Builds platform-specific parameters (e.g., `{ uri }`) for certain core actions.
   */
  platformActionParameters(
    actionId: string,
    selectedEntries: readonly EntrySummary[],
    directoryLocation: Location | undefined,
  ): { uri: string } | undefined;

  /**
   * Invokes an action by ID, updating recency and handling errors.
   */
  invokeActionById(actionId: string, parameters: unknown, context: ActionInvocationContext): void;

  /**
   * Invokes an action from the command palette, with special handling for favorites, copy, etc.
   */
  invokePaletteAction(
    action: ActionDescriptor,
    parameters?: unknown,
    context?: ActionInvocationContext,
  ): void;

  /**
   * Opens the context menu at the given position for the specified entries.
   */
  openContextMenu(paneId: PaneId, entries: readonly EntrySummary[], x: number, y: number): void;

  /**
   * Invokes an action from the context menu, with special handling for paste, refresh, etc.
   */
  invokeContextMenuAction(actionId: string): void;
}

/**
 * Factory function to create an ActionCommandController.
 */
export function createActionCommandController(
  context: ActionCommandControllerContext,
): ActionCommandController {
  function actionContext(): ActionInvocationContext {
    const active = context.getActiveDirectory();
    const selection =
      active === undefined
        ? undefined
        : context.getSelections().get(context.getActiveTabKey(active.paneId));
    return {
      ...(active === undefined ? {} : { paneId: active.paneId }),
      ...(selection?.selectedEntryIds.length === 0 || selection?.selectedEntryIds === undefined
        ? {}
        : { selectedEntryIds: [...selection.selectedEntryIds] }),
      ...(selection?.cursorEntryId === undefined ? {} : { cursorEntryId: selection.cursorEntryId }),
    };
  }

  function commandAvailabilityContext(
    selectedEntries?: readonly EntrySummary[],
    paneId?: PaneId,
  ): CommandAvailabilityContext {
    const active = context.getActiveDirectory();
    const effectivePaneId = paneId ?? active?.paneId;
    const effectiveKey =
      effectivePaneId === undefined ? undefined : context.getActiveTabKey(effectivePaneId);
    const effectiveEntries =
      selectedEntries ??
      (effectiveKey === undefined
        ? []
        : context.getGetSelectedEntries()(
          context.getSelections().get(effectiveKey),
          context.getDirectories().get(effectiveKey)?.entries ?? [],
        ));
    const directory =
      effectiveKey === undefined ? undefined : context.getDirectories().get(effectiveKey);
    return {
      selectedEntries: effectiveEntries,
      locationWritable: directory?.writable === true,
      clipboardHasEntries: context.getClipboard().locations.length > 0,
      openTerminalSupported: context.getOpenTerminalSupported(),
    };
  }

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
    actionContext: ActionInvocationContext,
  ): void {
    void context
      .getClient()
      .invokeAction({
        actionId,
        ...(parameters === undefined ? {} : { parameters }),
        context: actionContext,
      })
      .then(() => {
        context.getCommandPaletteRecency().set(actionId, Date.now());
        context.redraw();
      })
      .catch((error: unknown) => {
        context.toast({
          html: error instanceof Error ? error.message : 'Unable to run command.',
        });
        context.redraw();
      });
  }

  function invokePaletteAction(
    action: ActionDescriptor,
    parameters?: unknown,
    contextParam = actionContext(),
  ): void {
    if (action.id === 'core.palette') return;
    if (action.id === 'core.favourites') {
      context.setCommandPaletteOpen(true);
      return;
    }
    if (action.id.startsWith('core.favourite.')) {
      const index = Number(action.id.slice('core.favourite.'.length));
      const favourite = context.getCurrentSettings()?.favouriteLocations[index];
      if (favourite !== undefined && contextParam.paneId !== undefined) {
        void context.getNavigation().navigate(contextParam.paneId, favourite.location);
      }
      return;
    }
    if (action.id === 'core.createDirectory') {
      context.openCreateDirectory(undefined);
      return;
    }
    const paneId = contextParam.paneId;
    const directory =
      paneId === undefined
        ? undefined
        : context.getDirectories().get(context.getActiveTabKey(paneId));
    const selectedEntries =
      directory === undefined || contextParam.selectedEntryIds === undefined
        ? []
        : directory.entries.filter((entry) => new Set(contextParam.selectedEntryIds).has(entry.id));
    if (isCopySelectionAction(action.id)) {
      if (directory === undefined || directory.location === undefined) return;
      void copySelectionToClipboard(action.id, selectedEntries, directory.location)
        .then((copied) => {
          if (copied) context.getCommandPaletteRecency().set(action.id, Date.now());
          context.redraw();
        })
        .catch((error: unknown) => {
          context.toast({
            html:
              error instanceof Error ? error.message : 'Unable to write to the system clipboard.',
          });
          context.redraw();
        });
      return;
    }
    const effectiveParameters =
      parameters ?? platformActionParameters(action.id, selectedEntries, directory?.location);
    invokeActionById(action.id, effectiveParameters, contextParam);
  }

  function openContextMenu(
    paneId: PaneId,
    entries: readonly EntrySummary[],
    x: number,
    y: number,
  ): void {
    context.setContextMenu({ paneId, entries, x, y });
    context.redraw();
  }

  function invokeContextMenuAction(actionId: string): void {
    const menu = context.getContextMenu();
    if (menu === undefined) return;
    const action = context.getRegisteredActions().find((candidate) => candidate.id === actionId);
    const directory = context.getDirectories().get(context.getActiveTabKey(menu.paneId));
    if (action === undefined || directory === undefined) return;
    if (
      !evaluateActionAvailability(action, commandAvailabilityContext(menu.entries, menu.paneId))
        .available
    ) {
      return;
    }
    if (action.id === 'core.createDirectory') {
      context.openCreateDirectory(directory.location);
      return;
    }
    if (action.id === 'core.refresh') {
      void context.getNavigation().load(menu.paneId);
      return;
    }
    if (action.id === 'core.paste') {
      const currentClipboard = context.getClipboard();
      const mode = currentClipboard.mode;
      if (mode === undefined || directory.location === undefined) return;
      void (
        mode === 'move'
          ? context.getOpsController().move(currentClipboard.locations, directory.location)
          : context.getOpsController().copy(currentClipboard.locations, directory.location)
      ).then(() => {
        if (mode === 'move') context.replaceClipboard(clearClipboard(currentClipboard));
        context.redraw();
      });
      return;
    }
    invokePaletteAction(action, undefined, {
      paneId: menu.paneId,
      selectedEntryIds: menu.entries.map((entry) => entry.id),
      ...(menu.entries[0] === undefined ? {} : { cursorEntryId: menu.entries[0].id }),
    });
  }

  return {
    actionContext,
    commandAvailabilityContext,
    platformActionParameters,
    invokeActionById,
    invokePaletteAction,
    openContextMenu,
    invokeContextMenuAction,
  };
}
