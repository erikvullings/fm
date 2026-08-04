import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/fetch-mutator';
import type { DirectorySnapshot, EntryId, WorkspaceProjection } from '../../models';
import {
  createNavigationController,
  type NavigationClient,
  type PaneDirectoryView,
  parentLocation,
} from './navigation';

function workspace(uri = 'file:///home/erik'): WorkspaceProjection {
  return {
    id: 'workspace',
    name: 'Workspace',
    revision: 1,
    layout: { type: 'pane', paneId: 'left' },
    paneOrder: ['left'],
    panesById: {
      left: {
        id: 'left',
        tabOrder: ['tab'],
        activeTabId: 'tab',
        tabsById: {
          tab: {
            id: 'tab',
            title: 'erik',
            location: { providerId: 'local', uri },
            canNavigateBack: true,
            canNavigateForward: true,
            view: {
              sort: [],
              columns: [],
              showHidden: false,
              foldersFirst: true,
              quickFilter: null,
            },
          },
        },
      },
    },
    activePaneId: 'left',
    operationCentre: { visible: false, height: 240 },
  };
}

/** Two independent tabs in one pane, `active` selecting which one is currently shown. */
function workspaceWithTwoTabs(active: 'tab-a' | 'tab-b' = 'tab-a'): WorkspaceProjection {
  const emptyView = {
    sort: [],
    columns: [],
    showHidden: false,
    foldersFirst: true,
    quickFilter: null,
  };
  return {
    id: 'workspace',
    name: 'Workspace',
    revision: 1,
    layout: { type: 'pane', paneId: 'left' },
    paneOrder: ['left'],
    panesById: {
      left: {
        id: 'left',
        tabOrder: ['tab-a', 'tab-b'],
        activeTabId: active,
        tabsById: {
          'tab-a': {
            id: 'tab-a',
            title: 'a',
            location: { providerId: 'local', uri: 'file:///a' },
            canNavigateBack: false,
            canNavigateForward: false,
            view: emptyView,
          },
          'tab-b': {
            id: 'tab-b',
            title: 'b',
            location: { providerId: 'local', uri: 'file:///b' },
            canNavigateBack: false,
            canNavigateForward: false,
            view: emptyView,
          },
        },
      },
    },
    activePaneId: 'left',
    operationCentre: { visible: false, height: 240 },
  };
}

function snapshot(
  requestId: string,
  uri: string,
  names: readonly string[],
  overrides: Partial<DirectorySnapshot> = {},
): DirectorySnapshot {
  return {
    paneId: 'left',
    requestId,
    revision: 1,
    location: { providerId: 'local', uri },
    entries: names.map((name) => ({
      id: `${uri}/${name}` as EntryId,
      location: { providerId: 'local', uri: `${uri}/${name}` },
      name,
      kind: 'directory' as const,
      hidden: false,
      readOnly: false,
      metadataRevision: 1,
    })),
    hasMore: false,
    loadingState: { type: 'loaded' },
    ...overrides,
    writable: overrides.writable ?? true,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(initial = workspace()): {
  readonly client: NavigationClient;
  readonly getWorkspace: () => WorkspaceProjection;
  readonly views: PaneDirectoryView[];
  readonly replaceWorkspace: (next: WorkspaceProjection) => void;
} {
  let current = initial;
  const replaceWorkspace = vi.fn((next: WorkspaceProjection) => {
    current = next;
  });
  return {
    client: {
      listDirectory: vi.fn(),
      navigatePane: vi.fn(),
      dispatchWorkspaceCommand: vi.fn(),
      getWorkspace: vi.fn(),
    },
    getWorkspace: () => current,
    views: [],
    replaceWorkspace: (next) => replaceWorkspace(next),
  };
}

function echoingSnapshot(client: NavigationClient, uri: string, names: readonly string[]): void {
  vi.mocked(client.listDirectory).mockImplementation(async (request) =>
    snapshot(request.requestId, uri, names),
  );
}

describe('parentLocation', () => {
  it('finds parents and keeps filesystem roots stable', () => {
    expect(parentLocation({ providerId: 'local', uri: 'file:///home/erik' }).uri).toBe(
      'file:///home',
    );
    expect(parentLocation({ providerId: 'local', uri: 'file:///' }).uri).toBe('file:///');
    expect(parentLocation({ providerId: 'file', uri: 'mock:///Documents' }).uri).toBe('mock:///');
  });
});

describe('navigation controller', () => {
  it('shows loading synchronously and lists the real current directory', async () => {
    const context = setup();
    echoingSnapshot(context.client, 'file:///home/erik', ['Documents']);
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    const loading = controller.load('left');

    expect(context.views.at(-1)?.state).toEqual({ type: 'loading' });
    await loading;
    expect(context.views.at(-1)?.entries[0]?.name).toBe('Documents');
    expect(context.client.listDirectory).toHaveBeenCalledOnce();
  });

  it('keeps the current directory visible while a different folder loads', async () => {
    const context = setup();
    const initial = deferred<DirectorySnapshot>();
    const next = deferred<DirectorySnapshot>();
    vi.mocked(context.client.listDirectory).mockReturnValueOnce(initial.promise);
    vi.mocked(context.client.dispatchWorkspaceCommand).mockResolvedValue(
      workspace('file:///home/erik/Documents'),
    );
    vi.mocked(context.client.navigatePane).mockReturnValue(next.promise);
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    const firstLoad = controller.load('left');
    const firstRequestId = vi.mocked(context.client.listDirectory).mock.calls[0]?.[0].requestId;
    initial.resolve(snapshot(firstRequestId ?? '', 'file:///home/erik', ['Documents']));
    await firstLoad;

    const navigation = controller.navigate('left', {
      providerId: 'local',
      uri: 'file:///home/erik/Documents',
    });

    expect(context.views.at(-1)).toEqual(
      expect.objectContaining({
        state: { type: 'loading' },
        entries: [expect.objectContaining({ name: 'Documents' })],
      }),
    );
    await vi.waitFor(() => expect(context.client.navigatePane).toHaveBeenCalledOnce());
    const nextRequestId = vi.mocked(context.client.navigatePane).mock.calls[0]?.[0].requestId;
    next.resolve(snapshot(nextRequestId ?? '', 'file:///home/erik/Documents', ['Projects']));
    await navigation;
  });

  it('uses UUID request identifiers accepted by the transport DTO', async () => {
    const context = setup();
    echoingSnapshot(context.client, 'file:///home/erik', []);
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    await controller.load('left');

    const request = vi.mocked(context.client.listDirectory).mock.calls[0]?.[0];
    expect(request?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('navigates with backend history mutation before opening the directory', async () => {
    const context = setup();
    const next = workspace('file:///home/erik/Documents');
    const nextLocation = { providerId: 'local', uri: 'file:///home/erik/Documents' } as const;
    vi.mocked(context.client.dispatchWorkspaceCommand).mockResolvedValue(next);
    vi.mocked(context.client.navigatePane).mockImplementation(async (request) =>
      snapshot(request.requestId, nextLocation.uri, ['Projects']),
    );
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    await controller.navigate('left', {
      providerId: 'local',
      uri: 'file:///home/erik/Documents',
    });

    expect(context.client.dispatchWorkspaceCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'navigateTab', navigationMode: 'push' }),
      expect.any(AbortSignal),
    );
    expect(context.client.navigatePane).toHaveBeenCalledWith(
      expect.objectContaining({ location: nextLocation }),
      expect.any(AbortSignal),
    );
  });

  it('resyncs the local workspace revision on a conflict instead of leaving it stale forever', async () => {
    const context = setup();
    const staleWorkspace = context.getWorkspace();
    const resynced = { ...staleWorkspace, revision: staleWorkspace.revision + 1 };
    const conflict = new ApiError(409, {
      code: 'workspaceRevisionConflict',
      message: 'The workspace changed after this view was loaded.',
      details: { workspaceId: staleWorkspace.id, expectedRevision: 1, actualRevision: 2 },
    });
    vi.mocked(context.client.dispatchWorkspaceCommand).mockRejectedValueOnce(conflict);
    vi.mocked(context.client.getWorkspace).mockResolvedValueOnce(resynced);
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    await controller.navigate('left', {
      providerId: 'local',
      uri: 'file:///home/erik/Documents',
    });

    // The failed navigation still reports an error to the pane...
    expect(context.views.at(-1)?.state).toEqual({
      type: 'error',
      message: 'The workspace changed after this view was loaded.',
    });
    // ...but the local workspace projection is resynced so the *next* command (retry, parent,
    // breadcrumb, ...) uses the correct revision instead of repeating the same conflict forever.
    expect(context.getWorkspace().revision).toBe(resynced.revision);
  });

  it('forwards an optional preferredCursorName on navigate to updatePane', async () => {
    const context = setup();
    const next = workspace('file:///home/erik/Documents');
    const nextLocation = { providerId: 'local', uri: 'file:///home/erik/Documents' } as const;
    vi.mocked(context.client.dispatchWorkspaceCommand).mockResolvedValue(next);
    vi.mocked(context.client.navigatePane).mockImplementation(async (request) =>
      snapshot(request.requestId, nextLocation.uri, ['Projects']),
    );
    const preferredCursorNames: (string | undefined)[] = [];
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view, preferredCursorName) => {
        context.views.push(view);
        preferredCursorNames.push(preferredCursorName);
      },
    });

    await controller.navigate('left', nextLocation, 'Projects');

    expect(preferredCursorNames.at(-1)).toBe('Projects');
  });

  it('asks the backend to resolve back and forward targets', async () => {
    const context = setup();
    vi.mocked(context.client.dispatchWorkspaceCommand)
      .mockResolvedValueOnce(workspace('file:///home'))
      .mockResolvedValueOnce(workspace('file:///home/erik'));
    vi.mocked(context.client.navigatePane).mockImplementation(async (request) =>
      snapshot(request.requestId, request.location.uri, []),
    );
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    await controller.back('left');
    await controller.forward('left');

    expect(context.client.dispatchWorkspaceCommand).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({ location: expect.anything() }),
      expect.any(AbortSignal),
    );
    expect(context.client.dispatchWorkspaceCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ navigationMode: 'forward' }),
      expect.any(AbortSignal),
    );
  });

  it('does not issue parent navigation at a filesystem root', async () => {
    const context = setup(workspace('file:///'));
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    await controller.parent('left');

    expect(context.client.dispatchWorkspaceCommand).not.toHaveBeenCalled();
    expect(context.client.navigatePane).not.toHaveBeenCalled();
  });

  it('cancels superseded work and drops responses that resolve out of order', async () => {
    const context = setup();
    const first = deferred<DirectorySnapshot>();
    const second = deferred<DirectorySnapshot>();
    vi.mocked(context.client.listDirectory)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    const older = controller.load('left');
    const firstSignal = vi.mocked(context.client.listDirectory).mock.calls[0]?.[1];
    const newer = controller.load('left');
    const secondRequestId = vi.mocked(context.client.listDirectory).mock.calls[1]?.[0].requestId;
    second.resolve(snapshot(secondRequestId ?? '', 'file:///home/erik', ['new']));
    await newer;
    first.resolve(snapshot('old', 'file:///home/erik', ['old']));
    await older;

    expect(firstSignal?.aborted).toBe(true);
    expect(context.views.at(-1)?.entries[0]?.name).toBe('new');
  });

  it('appends the next page and renders readable errors with retry', async () => {
    const context = setup();
    vi.mocked(context.client.listDirectory)
      .mockImplementationOnce(async (request) =>
        snapshot(request.requestId, 'file:///home/erik', ['one'], {
          hasMore: true,
          continuationToken: 'next',
        }),
      )
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockImplementationOnce(async (request) =>
        snapshot(request.requestId, 'file:///home/erik', ['two']),
      );
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    await controller.load('left');
    await controller.loadNextPage('left');
    expect(context.views.at(-1)?.state).toEqual({
      type: 'error',
      message: 'Permission denied',
    });
    await controller.retry('left');

    expect(context.views.at(-1)?.entries[0]?.name).toBe('two');
    expect(vi.mocked(context.client.listDirectory).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ continuationToken: 'next' }),
    );
  });

  it('dedupes concurrent loadNextPage calls instead of cancelling and restarting the fetch', async () => {
    const context = setup();
    const page = deferred<DirectorySnapshot>();
    let secondRequestId = '';
    vi.mocked(context.client.listDirectory)
      .mockImplementationOnce(async (request) =>
        snapshot(request.requestId, 'file:///home/erik', ['one'], {
          hasMore: true,
          continuationToken: 'next',
        }),
      )
      .mockImplementationOnce((request) => {
        secondRequestId = request.requestId;
        return page.promise;
      });
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });
    await controller.load('left');

    const firstCall = controller.loadNextPage('left');
    const firstSignal = vi.mocked(context.client.listDirectory).mock.calls[1]?.[1];
    const secondCall = controller.loadNextPage('left');

    expect(vi.mocked(context.client.listDirectory)).toHaveBeenCalledTimes(2);
    expect(firstSignal?.aborted).toBe(false);
    page.resolve(snapshot(secondRequestId, 'file:///home/erik', ['two']));
    await Promise.all([firstCall, secondCall]);

    expect(context.views.at(-1)?.entries.map((entry) => entry.name)).toEqual(['one', 'two']);
  });

  it('loadAllPages fetches every remaining page in order', async () => {
    const context = setup();
    vi.mocked(context.client.listDirectory)
      .mockImplementationOnce(async (request) =>
        snapshot(request.requestId, 'file:///home/erik', ['one'], {
          hasMore: true,
          continuationToken: 'page-2',
        }),
      )
      .mockImplementationOnce(async (request) =>
        snapshot(request.requestId, 'file:///home/erik', ['two'], {
          hasMore: true,
          continuationToken: 'page-3',
        }),
      )
      .mockImplementationOnce(async (request) =>
        snapshot(request.requestId, 'file:///home/erik', ['three']),
      );
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });
    await controller.load('left');

    await controller.loadAllPages('left');

    expect(vi.mocked(context.client.listDirectory)).toHaveBeenCalledTimes(3);
    expect(context.views.at(-1)?.hasMore).toBe(false);
    expect(context.views.at(-1)?.entries.map((entry) => entry.name)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('loadAllPages stops instead of retrying forever when a page fails', async () => {
    const context = setup();
    vi.mocked(context.client.listDirectory)
      .mockImplementationOnce(async (request) =>
        snapshot(request.requestId, 'file:///home/erik', ['one'], {
          hasMore: true,
          continuationToken: 'page-2',
        }),
      )
      .mockRejectedValueOnce(new Error('boom'));
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });
    await controller.load('left');

    await controller.loadAllPages('left');

    expect(vi.mocked(context.client.listDirectory)).toHaveBeenCalledTimes(2);
    expect(context.views.at(-1)?.state).toEqual({ type: 'error', message: 'boom' });
  });

  it('loadAllPages stays pinned to the tab it started for and stops if the active tab changes', async () => {
    // Regression test: switching tabs (e.g. via Ctrl+Tab) while `loadAllPages` is still fetching
    // pages for the previously-active tab must never redirect its remaining fetches, or publish
    // updates, to whichever tab becomes active next — that would corrupt the newly active tab's
    // entries with data computed for a different location.
    const context = setup(workspaceWithTwoTabs('tab-a'));
    const secondPage = deferred<DirectorySnapshot>();
    vi.mocked(context.client.listDirectory)
      .mockImplementationOnce(async (request) =>
        snapshot(request.requestId, 'file:///a', ['one'], {
          hasMore: true,
          continuationToken: 'page-2',
        }),
      )
      .mockImplementationOnce((request) => {
        void request;
        return secondPage.promise;
      });
    const updates: Array<{ paneId: string; tabId: string; view: PaneDirectoryView }> = [];
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (paneId, tabId, view) => updates.push({ paneId, tabId, view }),
    });
    await controller.load('left');

    const allPages = controller.loadAllPages('left');
    const secondRequestId = vi.mocked(context.client.listDirectory).mock.calls[1]?.[0].requestId;
    // Simulate switching to tab-b (e.g. Ctrl+Tab) while tab-a's second page is still in flight.
    context.replaceWorkspace(workspaceWithTwoTabs('tab-b'));
    secondPage.resolve(
      snapshot(secondRequestId ?? '', 'file:///a', ['two'], {
        hasMore: true,
        continuationToken: 'page-3',
      }),
    );
    await allPages;

    // The in-flight fetch for tab-a still completes and publishes to tab-a...
    expect(
      updates
        .filter((update) => update.tabId === 'tab-a')
        .at(-1)
        ?.view.entries.map((e) => e.name),
    ).toEqual(['one', 'two']);
    // ...but the loop stops instead of fetching page-3 for whichever tab is now active, and
    // never publishes anything to tab-b.
    expect(vi.mocked(context.client.listDirectory)).toHaveBeenCalledTimes(2);
    expect(updates.some((update) => update.tabId === 'tab-b')).toBe(false);
  });
});

describe('per-tab isolation', () => {
  it('keys cached views by (pane, tab) so switching tabs never bleeds state', async () => {
    const context = setup(workspaceWithTwoTabs('tab-a'));
    vi.mocked(context.client.listDirectory).mockImplementation(async (request) =>
      snapshot(request.requestId, request.location.uri, [
        request.location.uri === 'file:///a' ? 'a-entry' : 'b-entry',
      ]),
    );
    const updates: Array<{ paneId: string; tabId: string; view: PaneDirectoryView }> = [];
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (paneId, tabId, view) => updates.push({ paneId, tabId, view }),
    });

    await controller.load('left');
    expect(updates.at(-1)?.tabId).toBe('tab-a');
    expect(updates.at(-1)?.view.entries[0]?.name).toBe('a-entry');

    context.replaceWorkspace(workspaceWithTwoTabs('tab-b'));
    await controller.load('left');
    expect(updates.at(-1)?.tabId).toBe('tab-b');
    expect(updates.at(-1)?.view.entries[0]?.name).toBe('b-entry');

    // tab-a's own publish from earlier is untouched by tab-b's later load.
    expect(updates.filter((update) => update.tabId === 'tab-a').at(-1)?.view.entries[0]?.name).toBe(
      'a-entry',
    );
  });

  it('abort() cancels one tab in flight without touching its sibling', async () => {
    const context = setup(workspaceWithTwoTabs('tab-a'));
    const pending = deferred<DirectorySnapshot>();
    vi.mocked(context.client.listDirectory).mockReturnValueOnce(pending.promise);
    const controller = createNavigationController({
      client: context.client,
      getWorkspace: context.getWorkspace,
      replaceWorkspace: context.replaceWorkspace,
      updatePane: (_paneId, _tabId, view) => context.views.push(view),
    });

    const loading = controller.load('left');
    const signal = vi.mocked(context.client.listDirectory).mock.calls[0]?.[1];

    controller.abort('left', 'tab-a');
    expect(signal?.aborted).toBe(true);

    pending.resolve(snapshot('irrelevant', 'file:///a', ['a-entry']));
    await loading;

    expect(context.views.at(-1)?.state).toEqual({ type: 'loading' });
  });
});
