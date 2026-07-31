import m, { type FactoryComponent } from 'mithril';
import { type Theme, ThemeManager, ThemeSwitcher } from 'mithril-materialized';

import type { FileManagerClient } from '../api/client/file-manager-client';
import { dispatchWorkspaceCommand } from '../features/workspace/dispatch-workspace-command';
import {
  WorkspaceLayoutView,
  type WorkspacePaneContent,
} from '../features/workspace/workspace-layout';
import type {
  EntryId,
  EntrySummary,
  LoadingState,
  PaneId,
  WorkspaceLayout,
  WorkspaceProjection,
} from '../models';
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
  const directories = new Map<PaneId, { state: LoadingState; entries: readonly EntrySummary[] }>();
  const directoryRequests = new Map<PaneId, AbortController>();
  let workspaceRequest: AbortController | undefined;

  function loadDirectory(
    client: FileManagerClient,
    currentWorkspace: WorkspaceProjection,
    paneId: PaneId,
  ): void {
    const pane = currentWorkspace.panesById[paneId];
    const tab = pane?.tabsById[pane.activeTabId];
    if (tab === undefined) {
      return;
    }
    directoryRequests.get(paneId)?.abort();
    const request = new AbortController();
    directoryRequests.set(paneId, request);
    directories.set(paneId, { state: { type: 'loading' }, entries: [] });
    void client
      .listDirectory(
        {
          workspaceId: currentWorkspace.id,
          paneId,
          requestId: `app-shell-${paneId}-${currentWorkspace.revision}`,
          location: tab.location,
        },
        request.signal,
      )
      .then(
        (snapshot) => {
          directories.set(paneId, {
            entries: snapshot.entries,
            state: snapshot.loadingState,
          });
          m.redraw();
        },
        (error: unknown) => {
          if (request.signal.aborted) {
            return;
          }
          directories.set(paneId, {
            entries: [],
            state: {
              type: 'error',
              message: error instanceof Error ? error.message : 'Unknown directory error',
            },
          });
          m.redraw();
        },
      );
  }

  async function loadWorkspace(client: FileManagerClient): Promise<void> {
    workspaceRequest = new AbortController();
    try {
      const summaries = await client.listWorkspaces(workspaceRequest.signal);
      const loaded =
        summaries[0] === undefined
          ? await client.createWorkspace({ name: 'Default' }, workspaceRequest.signal)
          : await client.openWorkspace(summaries[0].id, workspaceRequest.signal);
      workspace = loaded;
      for (const paneId of loaded.paneOrder) {
        loadDirectory(client, loaded, paneId);
      }
    } catch (error: unknown) {
      if (workspaceRequest.signal.aborted) {
        return;
      }
      workspaceError = error instanceof Error ? error.message : 'Unable to load workspace';
    }
    m.redraw();
  }

  async function navigateDirectory(
    client: FileManagerClient,
    runtime: RuntimeKind,
    paneId: PaneId,
    path: string,
  ): Promise<void> {
    if (runtime !== 'mock' || workspace === undefined) {
      throw new Error('Path navigation is not available for this runtime yet');
    }
    const request = new AbortController();
    directoryRequests.get(paneId)?.abort();
    directoryRequests.set(paneId, request);
    const snapshot = await client.listDirectory(
      {
        workspaceId: workspace.id,
        paneId,
        requestId: `app-shell-${paneId}-${path}`,
        location: { providerId: 'file', uri: `mock:///${path.replace(/^[/~]+/, '')}` },
      },
      request.signal,
    );
    directories.set(paneId, { entries: snapshot.entries, state: snapshot.loadingState });
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
    client: FileManagerClient,
    runtime: RuntimeKind,
    paneId: PaneId,
  ): WorkspacePaneContent {
    const directory = directories.get(paneId) ?? { state: { type: 'idle' } as const, entries: [] };
    return {
      ...directory,
      selectedEntryIds: new Set<EntryId>(),
      sortLabel: 'Name ascending',
      onNavigate: (path) => navigateDirectory(client, runtime, paneId, path),
    };
  }

  return {
    oninit: ({ attrs }) => {
      // Specification §26 keeps settings on the backend rather than in browser
      // storage, so the theme manager's own localStorage persistence stays off;
      // task 0030 restores the theme from the settings service instead.
      ThemeManager.setUseLocalStorage(false);
      ThemeManager.initialize(theme);
      void loadWorkspace(attrs.client);
    },

    onremove: () => {
      workspaceRequest?.abort();
      for (const request of directoryRequests.values()) {
        request.abort();
      }
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
