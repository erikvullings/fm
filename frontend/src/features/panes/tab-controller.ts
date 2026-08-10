import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { PaneId, TabId, WorkspaceProjection } from '../../models';
import {
  type AppState,
  applyAppPatches,
  deleteClosedTabStackPatch,
  setClosedTabStackPatch,
} from '../../state';
import type { NavigationController } from '../navigation/navigation';
import { dispatchWorkspaceCommand } from '../workspace/dispatch-workspace-command';
import { cycledTabIndex, tabIdForJump } from './tab-navigation';

export interface TabControllerContext {
  getWorkspace(): WorkspaceProjection | undefined;
  setWorkspace(ws: WorkspaceProjection): void;
  getAppState(): AppState | undefined;
  setAppState(state: AppState): void;
  getNavigation(): NavigationController;
  redraw(): void;
  applyCurrentShowHiddenSetting(
    client: FileManagerClient,
    workspaceId: string,
    paneId: PaneId,
    tabId: TabId,
    revision: number,
  ): Promise<void>;
  clearTabState(paneId: PaneId, tabId: TabId): void;
  getCloseTabConfirmation(): { readonly paneId: PaneId; readonly tabId: TabId } | undefined;
  setCloseTabConfirmation(conf?: { readonly paneId: PaneId; readonly tabId: TabId }): void;
  hasCachedSnapshot(paneId: PaneId, tabId: TabId): boolean;
}

export interface TabController {
  openTab(paneId: PaneId): void;
  activateTab(paneId: PaneId, tabId: TabId): void;
  performCloseTab(paneId: PaneId, tabId: TabId): void;
  requestCloseTab(paneId: PaneId, tabId: TabId): void;
  reopenClosedTab(paneId: PaneId): void;
  cycleTab(paneId: PaneId, direction: 1 | -1): void;
  jumpToTab(paneId: PaneId, oneBasedIndex: number): void;
}

export function createTabController(
  client: FileManagerClient,
  context: TabControllerContext,
): TabController {
  function replaceWorkspace(next: WorkspaceProjection): void {
    context.setWorkspace(next);
  }

  return {
    openTab(paneId: PaneId): void {
      const workspace = context.getWorkspace();
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
          const newTabId = next.panesById[paneId]?.activeTabId;
          if (newTabId === undefined) {
            void context.getNavigation().load(paneId);
            return;
          }
          void context
            .applyCurrentShowHiddenSetting(client, next.id, paneId, newTabId, next.revision)
            .then(() => context.getNavigation().load(paneId));
        },
      ).catch(() => undefined);
    },

    activateTab(paneId: PaneId, tabId: TabId): void {
      const workspace = context.getWorkspace();
      if (workspace === undefined) return;
      const pane = workspace.panesById[paneId];
      if (pane === undefined || pane.activeTabId === tabId) return;
      const previousTabId = pane.activeTabId;
      // Task 0069's acceptance criteria: "switching tabs is instant: the previous snapshot is
      // reused if still valid, otherwise refetched."
      const hasCachedSnapshot = context.hasCachedSnapshot(paneId, tabId);
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
          context.getNavigation().abort(paneId, previousTabId);
          if (!hasCachedSnapshot) void context.getNavigation().load(paneId);
        },
      ).catch(() => undefined);
    },

    performCloseTab(paneId: PaneId, tabId: TabId): void {
      const workspace = context.getWorkspace();
      if (workspace === undefined) return;
      const closedTab = workspace.panesById[paneId]?.tabsById[tabId];
      let appState = context.getAppState();
      if (closedTab !== undefined && appState !== undefined) {
        appState = applyAppPatches(appState, setClosedTabStackPatch(paneId, closedTab));
        context.setAppState(appState);
      }
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
          context.clearTabState(paneId, tabId);
          replaceWorkspace(next);
          void context.getNavigation().load(paneId);
        },
      ).catch(() => undefined);
    },

    requestCloseTab(paneId: PaneId, tabId: TabId): void {
      const workspace = context.getWorkspace();
      const pane = workspace?.panesById[paneId];
      if (pane === undefined) return;
      if (pane.tabOrder.length <= 1) {
        context.setCloseTabConfirmation({ paneId, tabId });
        context.redraw();
        return;
      }
      this.performCloseTab(paneId, tabId);
    },

    reopenClosedTab(paneId: PaneId): void {
      const workspace = context.getWorkspace();
      let appState = context.getAppState();
      const closed = appState?.closedTabStacks.byPaneId[paneId];
      if (workspace === undefined || closed === undefined) return;
      appState = applyAppPatches(appState!, deleteClosedTabStackPatch(paneId));
      context.setAppState(appState);
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
          const newTabId = next.panesById[paneId]?.activeTabId;
          if (newTabId === undefined) {
            void context.getNavigation().load(paneId);
            return;
          }
          void context
            .applyCurrentShowHiddenSetting(client, next.id, paneId, newTabId, next.revision)
            .then(() => context.getNavigation().load(paneId));
        },
      ).catch(() => undefined);
    },

    cycleTab(paneId: PaneId, direction: 1 | -1): void {
      const workspace = context.getWorkspace();
      const pane = workspace?.panesById[paneId];
      if (pane === undefined) return;
      const currentIndex = pane.tabOrder.indexOf(pane.activeTabId);
      const nextTabId =
        pane.tabOrder[cycledTabIndex(currentIndex, pane.tabOrder.length, direction)];
      if (nextTabId !== undefined) this.activateTab(paneId, nextTabId);
    },

    jumpToTab(paneId: PaneId, oneBasedIndex: number): void {
      const workspace = context.getWorkspace();
      const pane = workspace?.panesById[paneId];
      if (pane === undefined) return;
      const tabId = tabIdForJump(pane.tabOrder, oneBasedIndex);
      if (tabId !== undefined) this.activateTab(paneId, tabId);
    },
  };
}
