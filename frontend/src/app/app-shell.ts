import m, { type FactoryComponent } from 'mithril';
import { type Theme, ThemeManager, ThemeSwitcher } from 'mithril-materialized';

import type { FileManagerClient } from '../api/client/file-manager-client';
import {
  createNavigationController,
  type NavigationController,
  type PaneDirectoryView,
} from '../features/navigation/navigation';
import { isParentEntry, withParentEntry } from '../features/panes/parent-entry';
import type { SelectionPlatform } from '../features/selection/keybindings';
import {
  emptySelection,
  reduceSelection,
  type SelectionAction,
  type SelectionState,
} from '../features/selection/selection';
import { dispatchWorkspaceCommand } from '../features/workspace/dispatch-workspace-command';
import {
  pathFromUri,
  WorkspaceLayoutView,
  type WorkspacePaneContent,
} from '../features/workspace/workspace-layout';
import type { EntryId, Location, PaneId, WorkspaceLayout, WorkspaceProjection } from '../models';
import type { RuntimeKind } from '../utilities/runtime';

/** Attributes of the application shell. */
export interface AppShellAttrs {
  /** Transport this build talks to, resolved from `VITE_RUNTIME`. */
  runtime: RuntimeKind;
  /** Transport-neutral client selected once by the application bootstrap. */
  client: FileManagerClient;
}

const DEFAULT_THEME: Theme = 'auto';

/**
 * A factory component so that per-instance state lives in the closure rather
 * than on a shared module-level object.
 */
export const AppShell: FactoryComponent<AppShellAttrs> = () => {
  let theme: Theme = DEFAULT_THEME;
  let workspace: WorkspaceProjection | undefined;
  let workspaceError: string | undefined;
  const directories = new Map<PaneId, PaneDirectoryView>();
  const selections = new Map<PaneId, SelectionState>();
  let platform: SelectionPlatform = 'unknown';
  let workspaceRequest: AbortController | undefined;

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

  function paneContent(
    _client: FileManagerClient,
    _runtime: RuntimeKind,
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
    const entries =
      tab === undefined
        ? directory.entries
        : withParentEntry(pathFromUri(tab.location.uri), directory.entries);
    const entryIds = entries.map((entry) => entry.id);
    const cursorIndex =
      selection.cursorEntryId === undefined ? undefined : entryIds.indexOf(selection.cursorEntryId);
    return {
      ...directory,
      entries,
      selectedEntryIds: new Set<EntryId>(selection.selectedEntryIds),
      sortLabel: 'Name ascending',
      platform,
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
            : undefined,
      onSelectionAction: (action: SelectionAction) => {
        const orderedEntryIds =
          action.type === 'selectAll' || action.type === 'invert'
            ? directory.entries.map((entry) => entry.id)
            : entryIds;
        selections.set(paneId, reduceSelection(selection, action, orderedEntryIds));
        m.redraw();
      },
      onRetry: () => navigation.retry(paneId),
      onLoadNextPage: () => navigation.loadNextPage(paneId),
    };
  }

  return {
    oninit: ({ attrs }) => {
      navigation = createNavigationController({
        client: attrs.client,
        getWorkspace: () => workspace,
        replaceWorkspace: (next) => replaceWorkspace(next),
        updatePane: (paneId, view) => {
          const previous = directories.get(paneId);
          directories.set(paneId, view);
          if (view.entries.length === 0) {
            selections.set(paneId, emptySelection);
          } else if (
            selections.get(paneId)?.cursorEntryId === undefined ||
            previous?.location?.uri !== view.location?.uri
          ) {
            const firstEntry = view.entries[0];
            selections.set(paneId, {
              selectedEntryIds: [],
              ...(firstEntry === undefined ? {} : { cursorEntryId: firstEntry.id }),
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
      void loadWorkspace(attrs.client);
    },

    onremove: () => {
      workspaceRequest?.abort();
      navigation.dispose();
    },

    view: ({ attrs }) =>
      m('.fm-app-shell', [
        m('header.fm-app-bar', [
          m('h1.fm-app-title', 'File Manager'),
          m(
            'span.fm-runtime-badge',
            { title: 'Active transport, from VITE_RUNTIME' },
            attrs.runtime,
          ),
          m(ThemeSwitcher, {
            theme,
            showLabels: true,
            onThemeChange: (next: Theme) => {
              theme = next;
              ThemeManager.setTheme(next);
            },
          }),
        ]),
        m('.fm-workspace-toolbar', [
          m('strong', workspace?.name ?? 'Workspace'),
          m('span', 'Search'),
          m('button', { type: 'button', disabled: true }, 'Command palette'),
        ]),
        m('main.fm-workspace', [
          workspace === undefined
            ? m('.fm-workspace-loading', workspaceError ?? 'Loading workspace…')
            : m(WorkspaceLayoutView, {
                workspace,
                paneContent: (paneId) => paneContent(attrs.client, attrs.runtime, paneId),
                onActivatePane: (paneId) => activatePane(attrs.client, paneId),
                onUpdateLayout: (layout) => updateLayout(attrs.client, layout),
              }),
        ]),
        m('.fm-operation-centre', { 'aria-label': 'Operation centre' }, 'No active operations'),
        m('.fm-function-key-bar', [
          m('span', 'F5 Copy'),
          m('span', 'F6 Move'),
          m('span', 'F7 New folder'),
          m('span', 'F8 Delete'),
        ]),
      ]),
  };
};
