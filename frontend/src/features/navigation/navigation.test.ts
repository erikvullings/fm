import { describe, expect, it, vi } from 'vitest';

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
      updatePane: (_paneId, view) => context.views.push(view),
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
      updatePane: (_paneId, view) => context.views.push(view),
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
      updatePane: (_paneId, view) => context.views.push(view),
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
      updatePane: (_paneId, view) => context.views.push(view),
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
      updatePane: (_paneId, view) => context.views.push(view),
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
      updatePane: (_paneId, view) => context.views.push(view),
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
      updatePane: (_paneId, view) => context.views.push(view),
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
      updatePane: (_paneId, view) => context.views.push(view),
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
});
