import type { FileManagerClient } from '../../api/client/file-manager-client';
import type {
  DirectorySnapshot,
  EntrySummary,
  ListDirectoryRequest,
  LoadingState,
  Location,
  PaneId,
  TabId,
  TabProjection,
  WorkspaceCommand,
  WorkspaceProjection,
} from '../../models';
import { dispatchWorkspaceCommand } from '../workspace/dispatch-workspace-command';

/** Client surface required by directory navigation. */
export type NavigationClient = Pick<
  FileManagerClient,
  'dispatchWorkspaceCommand' | 'getWorkspace' | 'listDirectory' | 'navigatePane'
>;

/** Renderable directory state for one pane, including paging information. */
export interface PaneDirectoryView {
  readonly state: LoadingState;
  readonly entries: readonly EntrySummary[];
  readonly location?: Location;
  readonly writable?: boolean;
  readonly requestId?: string;
  readonly revision?: number;
  readonly hasMore: boolean;
  readonly continuationToken?: string;
  /** Total entries in the directory, known from the first page's response even before all pages load. */
  readonly totalKnownEntries?: number;
}

/** Integration callbacks kept outside the navigation module. */
export interface NavigationControllerOptions {
  readonly client: NavigationClient;
  readonly getWorkspace: () => WorkspaceProjection | undefined;
  readonly replaceWorkspace: (workspace: WorkspaceProjection) => void;
  /** Prompts for a session-only archive password; resolves false when cancelled. */
  readonly requestArchivePassword?: (location: Location, invalid: boolean) => Promise<boolean>;
  /**
   * `preferredCursorName`, when set, is the entry name the pane's cursor
   * should land on instead of the listing's first entry (e.g. the child
   * directory just navigated away from via `parent()`).
   */
  readonly updatePane: (
    paneId: PaneId,
    tabId: TabId,
    view: PaneDirectoryView,
    preferredCursorName?: string,
  ) => void;
}

/** Public navigation operations consumed by pane and workspace input handlers. */
export interface NavigationController {
  load(paneId: PaneId): Promise<void>;
  navigate(paneId: PaneId, location: Location, preferredCursorName?: string): Promise<void>;
  parent(paneId: PaneId): Promise<void>;
  back(paneId: PaneId): Promise<void>;
  forward(paneId: PaneId): Promise<void>;
  retry(paneId: PaneId): Promise<void>;
  loadNextPage(paneId: PaneId): Promise<void>;
  /** Loads every remaining page for the pane's current directory (e.g. before jumping to the last entry). */
  loadAllPages(paneId: PaneId): Promise<void>;
  /** Cancels a specific tab's in-flight request, e.g. because it just became hidden. */
  abort(paneId: PaneId, tabId: TabId): void;
  dispose(): void;
}

interface ActiveRequest {
  readonly id: string;
  readonly controller: AbortController;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load directory';
}

function applicationErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function activeTab(workspace: WorkspaceProjection, paneId: PaneId) {
  const pane = workspace.panesById[paneId];
  return pane?.tabsById[pane.activeTabId];
}

/** Returns a provider-preserving lexical parent; roots map to themselves. */
export function parentLocation(location: Location): Location {
  try {
    if (location.providerId === 'archive' && location.uri.startsWith('archive://')) {
      const remainder = location.uri.slice('archive://'.length);
      const separator = remainder.indexOf('!');
      if (separator >= 0) {
        const outer = remainder.slice(0, separator);
        const inner = remainder.slice(separator + 1).replace(/^\/+|\/+$/g, '');
        if (inner.length === 0) {
          return parentLocation({ providerId: 'local', uri: `file://${outer}` });
        }
        const finalSeparator = inner.lastIndexOf('/');
        const parentInner = finalSeparator < 0 ? '' : inner.slice(0, finalSeparator);
        return {
          providerId: 'archive',
          uri: `archive://${outer}!/${parentInner}`,
        };
      }
    }
    const url = new URL(location.uri);
    const path = url.pathname;
    if (path === '/' || path.length === 0) {
      return location;
    }
    const trimmed = path.replace(/\/+$/, '');
    const finalSeparator = trimmed.lastIndexOf('/');
    url.pathname = finalSeparator <= 0 ? '/' : trimmed.slice(0, finalSeparator);
    return { ...location, uri: url.toString() };
  } catch {
    return location;
  }
}

/** Returns the final path segment (decoded) of a location, e.g. for cursor restoration after `..`. */
function lastPathSegment(location: Location): string | undefined {
  try {
    if (location.providerId === 'archive' && location.uri.startsWith('archive://')) {
      const [outer, rawInner = ''] = location.uri.slice('archive://'.length).split('!', 2);
      const inner = rawInner.replace(/^\/+|\/+$/g, '');
      if (inner.length > 0) {
        return decodeURIComponent(inner.slice(inner.lastIndexOf('/') + 1));
      }
      if (outer !== undefined) {
        return decodeURIComponent(outer.slice(outer.lastIndexOf('/') + 1));
      }
    }
    const path = new URL(location.uri).pathname.replace(/\/+$/, '');
    const finalSeparator = path.lastIndexOf('/');
    const segment = finalSeparator < 0 ? path : path.slice(finalSeparator + 1);
    return segment.length === 0 ? undefined : decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Isolates cancellable requests and cached views per tab, not merely per pane. */
function tabKey(paneId: PaneId, tabId: TabId): string {
  return `${paneId}:${tabId}`;
}

/** Coordinates workspace history and cancellable directory requests per (pane, tab). */
export function createNavigationController(
  options: NavigationControllerOptions,
): NavigationController {
  const activeRequests = new Map<string, ActiveRequest>();
  const paneViews = new Map<string, PaneDirectoryView>();
  // Dedupes concurrent `loadNextPage` calls for the same tab (e.g. repeated `onEndReached`
  // firing while scrolling) so a later call reuses the in-flight fetch instead of aborting it
  // via `begin()` and restarting from scratch — otherwise a fast scroll can cancel-and-restart
  // the fetch forever, so it never completes.
  const pendingNextPage = new Map<string, Promise<void>>();

  async function withArchiveCredential<T>(
    location: Location,
    operation: () => Promise<T>,
  ): Promise<T> {
    for (;;) {
      try {
        return await operation();
      } catch (error: unknown) {
        const code = applicationErrorCode(error);
        if (
          location.providerId !== 'archive' ||
          options.requestArchivePassword === undefined ||
          (code !== 'credentialRequired' && code !== 'invalidCredential') ||
          !(await options.requestArchivePassword(location, code === 'invalidCredential'))
        ) {
          throw error;
        }
      }
    }
  }

  function begin(paneId: PaneId, tabId: TabId): ActiveRequest {
    const key = tabKey(paneId, tabId);
    activeRequests.get(key)?.controller.abort();
    const request = {
      id: crypto.randomUUID(),
      controller: new AbortController(),
    };
    activeRequests.set(key, request);
    return request;
  }

  function isCurrent(paneId: PaneId, tabId: TabId, request: ActiveRequest): boolean {
    const key = tabKey(paneId, tabId);
    return activeRequests.get(key)?.id === request.id && !request.controller.signal.aborted;
  }

  function publish(
    paneId: PaneId,
    tabId: TabId,
    view: PaneDirectoryView,
    preferredCursorName?: string,
  ): void {
    paneViews.set(tabKey(paneId, tabId), view);
    options.updatePane(paneId, tabId, view, preferredCursorName);
  }

  function loadingView(
    paneId: PaneId,
    tabId: TabId,
    request: ActiveRequest,
    fallbackLocation: Location,
  ): PaneDirectoryView {
    const current = paneViews.get(tabKey(paneId, tabId));
    return {
      state: { type: 'loading' },
      entries: current?.entries ?? [],
      location: current?.location ?? fallbackLocation,
      requestId: request.id,
      hasMore: false,
    };
  }

  function requestFor(
    workspace: WorkspaceProjection,
    paneId: PaneId,
    requestId: string,
    location: Location,
    tab: TabProjection | undefined,
    continuationToken?: string,
  ): ListDirectoryRequest {
    return {
      workspaceId: workspace.id,
      paneId,
      requestId,
      location,
      ...(continuationToken === undefined ? {} : { continuationToken }),
      ...(tab?.view.sort === undefined ? {} : { sort: tab.view.sort }),
      ...(tab === undefined
        ? {}
        : { showHidden: tab.view.showHidden, foldersFirst: tab.view.foldersFirst }),
    };
  }

  function viewFromSnapshot(
    snapshot: DirectorySnapshot,
    entries: readonly EntrySummary[] = snapshot.entries,
  ): PaneDirectoryView {
    return {
      state: snapshot.loadingState,
      entries,
      location: snapshot.location,
      writable: snapshot.writable,
      requestId: snapshot.requestId,
      revision: snapshot.revision,
      hasMore: snapshot.hasMore,
      ...(snapshot.continuationToken === undefined
        ? {}
        : { continuationToken: snapshot.continuationToken }),
      ...(snapshot.totalKnownEntries === undefined
        ? {}
        : { totalKnownEntries: snapshot.totalKnownEntries }),
    };
  }

  async function load(paneId: PaneId): Promise<void> {
    const workspace = options.getWorkspace();
    const tab = workspace === undefined ? undefined : activeTab(workspace, paneId);
    if (workspace === undefined || tab === undefined) {
      return;
    }
    const request = begin(paneId, tab.id);
    publish(paneId, tab.id, loadingView(paneId, tab.id, request, tab.location));
    try {
      const snapshot = await withArchiveCredential(tab.location, () =>
        options.client.listDirectory(
          requestFor(workspace, paneId, request.id, tab.location, tab),
          request.controller.signal,
        ),
      );
      if (isCurrent(paneId, tab.id, request) && snapshot.requestId === request.id) {
        publish(paneId, tab.id, viewFromSnapshot(snapshot));
      }
    } catch (error: unknown) {
      if (isCurrent(paneId, tab.id, request)) {
        publish(paneId, tab.id, {
          state: { type: 'error', message: errorMessage(error) },
          entries: [],
          location: tab.location,
          requestId: request.id,
          hasMore: false,
        });
      }
    }
  }

  async function navigateHistory(
    paneId: PaneId,
    navigationMode: 'push' | 'back' | 'forward',
    location?: Location,
    preferredCursorName?: string,
  ): Promise<void> {
    const workspace = options.getWorkspace();
    const pane = workspace?.panesById[paneId];
    const tab = pane?.tabsById[pane.activeTabId];
    if (
      workspace === undefined ||
      pane === undefined ||
      tab === undefined ||
      (navigationMode === 'back' && !tab.canNavigateBack) ||
      (navigationMode === 'forward' && !tab.canNavigateForward)
    ) {
      return;
    }
    const request = begin(paneId, tab.id);
    publish(paneId, tab.id, loadingView(paneId, tab.id, request, location ?? tab.location));
    const command: WorkspaceCommand = {
      type: 'navigateTab',
      workspaceId: workspace.id,
      paneId,
      tabId: tab.id,
      navigationMode,
      expectedRevision: workspace.revision,
      ...(location === undefined ? {} : { location }),
    };
    try {
      // Explicit destinations can be validated without mutating workspace history. This keeps a
      // failed archive open (for example an unsupported RAR-backed CBR) from replacing the tab's
      // last usable location and poisoning retry, reload, and breadcrumb navigation.
      const pendingSnapshot =
        location === undefined
          ? undefined
          : await withArchiveCredential(location, () =>
              options.client.navigatePane(
                {
                  workspaceId: workspace.id,
                  paneId,
                  requestId: request.id,
                  location,
                },
                request.controller.signal,
              ),
            );
      if (!isCurrent(paneId, tab.id, request)) {
        return;
      }
      // Goes through the resilient wrapper (not the raw client call) so a revision conflict
      // still resyncs the local workspace projection via `options.replaceWorkspace` even though
      // push/back/forward navigation isn't safe to silently retry — otherwise the local revision
      // is left permanently stale and every subsequent navigation command in the workspace (any
      // pane) keeps failing with the same conflict until something else happens to resync it.
      const updated = await dispatchWorkspaceCommand(
        options.client,
        command,
        options.replaceWorkspace,
        request.controller.signal,
      );
      if (!isCurrent(paneId, tab.id, request)) {
        return;
      }
      const updatedTab = activeTab(updated, paneId);
      if (updatedTab === undefined) {
        return;
      }
      const snapshot =
        pendingSnapshot ??
        (await withArchiveCredential(updatedTab.location, () =>
          options.client.navigatePane(
            {
              workspaceId: updated.id,
              paneId,
              requestId: request.id,
              location: updatedTab.location,
            },
            request.controller.signal,
          ),
        ));
      if (isCurrent(paneId, tab.id, request) && snapshot.requestId === request.id) {
        publish(paneId, tab.id, viewFromSnapshot(snapshot), preferredCursorName);
      }
    } catch (error: unknown) {
      if (isCurrent(paneId, tab.id, request)) {
        const currentTab = options.getWorkspace();
        publish(paneId, tab.id, {
          state: { type: 'error', message: errorMessage(error) },
          entries: [],
          location:
            (currentTab === undefined ? undefined : activeTab(currentTab, paneId)?.location) ??
            tab.location,
          requestId: request.id,
          hasMore: false,
        });
      }
    }
  }

  // `loadNextPageImpl`/`loadNextPage`/`loadAllPages` all take an explicit `tabId` pinned by
  // their caller (defaulting to the pane's active tab at the moment of the call) rather than
  // re-resolving `pane.activeTabId` on every invocation. Otherwise, if the user switches tabs
  // while `loadAllPages`'s loop is still awaiting a page, the next iteration would silently
  // start fetching pages for whichever tab is now active instead of stopping for the original
  // (now-hidden) tab, corrupting both tabs' entries.
  async function loadNextPageImpl(paneId: PaneId, tabId: TabId): Promise<void> {
    const workspace = options.getWorkspace();
    const tab = workspace?.panesById[paneId]?.tabsById[tabId];
    const current = paneViews.get(tabKey(paneId, tabId));
    if (
      workspace === undefined ||
      tab === undefined ||
      current?.location === undefined ||
      !current.hasMore ||
      current.continuationToken === undefined
    ) {
      return;
    }
    const request = begin(paneId, tabId);
    try {
      const snapshot = await options.client.listDirectory(
        requestFor(workspace, paneId, request.id, current.location, tab, current.continuationToken),
        request.controller.signal,
      );
      if (isCurrent(paneId, tabId, request) && snapshot.requestId === request.id) {
        publish(
          paneId,
          tabId,
          viewFromSnapshot(snapshot, [...current.entries, ...snapshot.entries]),
        );
      }
    } catch (error: unknown) {
      if (isCurrent(paneId, tabId, request)) {
        publish(paneId, tabId, {
          ...current,
          state: { type: 'error', message: errorMessage(error) },
          requestId: request.id,
        });
      }
    }
  }

  function loadNextPage(paneId: PaneId, tabId?: TabId): Promise<void> {
    const workspace = options.getWorkspace();
    const resolvedTabId =
      tabId ?? (workspace === undefined ? undefined : activeTab(workspace, paneId)?.id);
    if (resolvedTabId === undefined) {
      return Promise.resolve();
    }
    const key = tabKey(paneId, resolvedTabId);
    const pending = pendingNextPage.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const promise = loadNextPageImpl(paneId, resolvedTabId).finally(() => {
      pendingNextPage.delete(key);
    });
    pendingNextPage.set(key, promise);
    return promise;
  }

  async function loadAllPages(paneId: PaneId): Promise<void> {
    const workspace = options.getWorkspace();
    const tabId = workspace === undefined ? undefined : activeTab(workspace, paneId)?.id;
    if (tabId === undefined) {
      return;
    }
    for (;;) {
      // Stop (without switching targets) once the tab this was started for is no longer
      // active, e.g. the user switched tabs while pages were still loading in the background.
      const stillActive = options.getWorkspace();
      if (stillActive === undefined || activeTab(stillActive, paneId)?.id !== tabId) {
        return;
      }
      const current = paneViews.get(tabKey(paneId, tabId));
      if (current === undefined || !current.hasMore || current.state.type === 'error') {
        return;
      }
      await loadNextPage(paneId, tabId);
    }
  }

  return {
    load,
    navigate: (paneId, location, preferredCursorName) =>
      navigateHistory(paneId, 'push', location, preferredCursorName),
    parent: async (paneId) => {
      const workspace = options.getWorkspace();
      const tab = workspace === undefined ? undefined : activeTab(workspace, paneId);
      if (tab === undefined) {
        return;
      }
      const parent = parentLocation(tab.location);
      if (parent.uri !== tab.location.uri) {
        await navigateHistory(paneId, 'push', parent, lastPathSegment(tab.location));
      }
    },
    back: (paneId) => navigateHistory(paneId, 'back'),
    forward: (paneId) => navigateHistory(paneId, 'forward'),
    retry: load,
    loadNextPage,
    loadAllPages,
    abort: (paneId, tabId) => {
      activeRequests.get(tabKey(paneId, tabId))?.controller.abort();
    },
    dispose: () => {
      for (const request of activeRequests.values()) {
        request.controller.abort();
      }
      activeRequests.clear();
    },
  };
}
