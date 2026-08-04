import { describe, expect, it, vi } from 'vitest';

import type { BackendEvent, DirectoryDelta } from '../../models';
import { MockClientError, MockFileManagerClient } from './mock-file-manager-client';

const ROOT_REQUEST = {
  workspaceId: 'workspace-1',
  paneId: 'left',
  requestId: 'request-1',
  location: { providerId: 'file', uri: 'mock:///' },
} as const;

describe('MockFileManagerClient directories', () => {
  it('lists deterministic nested and special-case fixture entries', async () => {
    const client = new MockFileManagerClient();

    const root = await client.listDirectory(ROOT_REQUEST);
    const nested = await client.listDirectory({
      ...ROOT_REQUEST,
      requestId: 'request-2',
      location: { providerId: 'file', uri: 'mock:///Documents' },
    });

    expect(root.entries.map(({ name, kind, hidden }) => ({ name, kind, hidden }))).toEqual([
      { name: 'Documents', kind: 'directory', hidden: false },
      { name: 'Empty', kind: 'directory', hidden: false },
      { name: 'Unreadable', kind: 'directory', hidden: false },
      { name: '.env', kind: 'file', hidden: true },
      { name: '日本語.txt', kind: 'file', hidden: false },
      { name: 'documents-link', kind: 'symlink', hidden: false },
    ]);
    expect(nested.entries.map((entry) => entry.name)).toEqual(['Projects', 'report.pdf']);
  });

  it('pages a million-entry directory without returning every entry', async () => {
    const client = new MockFileManagerClient({ pageSize: 25, seed: 99 });

    const first = await client.listDirectory({
      ...ROOT_REQUEST,
      location: { providerId: 'file', uri: 'mock:///large/1000000' },
    });
    const nextToken = first.continuationToken;
    expect(nextToken).toBe('25');
    if (nextToken === undefined) {
      throw new Error('Expected the first large-directory page to have a continuation token');
    }
    const second = await client.listDirectory({
      ...ROOT_REQUEST,
      continuationToken: nextToken,
      location: { providerId: 'file', uri: 'mock:///large/1000000' },
    });

    expect(first.entries).toHaveLength(25);
    expect(first.totalKnownEntries).toBe(1_000_000);
    expect(first.hasMore).toBe(true);
    expect(second.entries[0]?.id).not.toBe(first.entries[0]?.id);
  });

  it('returns error and loading snapshots for configured directory states', async () => {
    const client = new MockFileManagerClient({
      loadingLocations: ['mock:///Documents'],
    });

    const unreadable = await client.listDirectory({
      ...ROOT_REQUEST,
      location: { providerId: 'file', uri: 'mock:///Unreadable' },
    });
    const loading = await client.navigatePane({
      ...ROOT_REQUEST,
      location: { providerId: 'file', uri: 'mock:///Documents' },
    });

    expect(unreadable.loadingState).toEqual({
      type: 'error',
      message: 'Directory is not readable',
    });
    expect(loading.loadingState).toEqual({ type: 'loading' });
  });
});

describe('MockFileManagerClient API', () => {
  it('provides deterministic capabilities, workspace, metadata, actions, and plugins', async () => {
    const client = new MockFileManagerClient();

    const capabilities = await client.getRuntimeCapabilities();
    const workspace = await client.getWorkspace('mock-workspace');
    const metadata = await client.getEntryMetadata({
      entryId: 'mock:///日本語.txt',
      location: { providerId: 'file', uri: 'mock:///%E6%97%A5%E6%9C%AC%E8%AA%9E.txt' },
    });
    const actions = await client.listActions();
    const plugins = await client.listPlugins();
    const actionResult = await client.invokeAction({ actionId: 'core.refresh', context: {} });

    expect(capabilities.runtime).toBe('mock');
    expect(workspace.id).toBe('mock-workspace');
    expect(metadata.entryId).toBe('mock:///日本語.txt');
    expect(actions.map((action) => action.id)).toEqual([
      'core.refresh',
      'core.rename',
      'core.copy',
      'core.move',
      'core.createDirectory',
      'core.paste',
      'core.trash',
      'core.delete',
      'core.palette',
      'core.focusLocation',
      'core.quickFilter',
      'core.findFiles',
      'core.newTab',
      'core.closeTab',
      'core.nextTab',
      'core.previousTab',
      'core.reopenClosedTab',
      'core.open',
      'core.view',
      'core.edit',
      'core.openWith',
      'core.revealInSystemFileManager',
      'core.openTerminal',
      'core.parent',
      'core.switchPane',
      'core.moveCursorUp',
      'core.moveCursorDown',
      'core.moveCursorPageUp',
      'core.moveCursorPageDown',
      'core.moveCursorFirst',
      'core.moveCursorLast',
      'core.extendSelectionUp',
      'core.extendSelectionDown',
      'core.toggleSelection',
      'core.selectAll',
      'core.clearSelection',
    ]);
    expect(plugins.map((plugin) => plugin.id)).toEqual(['mock.archive']);
    expect(actionResult).toEqual({ actionId: 'core.refresh', invoked: true });
  });

  it('tracks operation lifecycle calls in memory', async () => {
    const client = new MockFileManagerClient({ seed: 22 });
    const operation = await client.startOperation({
      type: 'copy',
      sources: [
        {
          providerId: 'file',
          uri: 'mock:///Documents/report.pdf',
        },
      ],
      destination: { providerId: 'file', uri: 'mock:///Empty' },
      conflictPolicy: 'ask',
    });

    await client.resolveConflict({
      operationId: operation.id,
      resolution: 'skip',
      applyToAllSimilar: false,
    });
    await client.cancelOperation(operation.id);

    expect(client.getOperation(operation.id)).toMatchObject({
      state: 'cancelled',
      conflictPolicy: 'skip',
    });
  });

  it('implements workspace lifecycle and semantic commands in memory', async () => {
    const client = new MockFileManagerClient();
    const created = await client.createWorkspace({ name: 'Projects' });
    const renamed = await client.renameWorkspace(created.id, 'Development', created.revision);
    const changed = await client.dispatchWorkspaceCommand({
      type: 'addTab',
      workspaceId: created.id,
      expectedRevision: renamed.revision,
      paneId: 'left',
      location: { providerId: 'file', uri: 'mock:///Documents' },
    });

    expect((await client.listWorkspaces()).map((workspace) => workspace.name)).toEqual([
      'Development',
    ]);
    expect(changed.panesById.left?.tabOrder).toHaveLength(2);
    await client.deleteWorkspace(changed.id, changed.revision);
    expect(await client.listWorkspaces()).toEqual([]);
  });
});

describe('MockFileManagerClient controls', () => {
  it('delivers scripted directory-delta and operation-progress events on demand', async () => {
    const client = new MockFileManagerClient();
    const listener = vi.fn();
    const unsubscribe = await client.subscribe(listener);
    const events: BackendEvent[] = [
      {
        eventId: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
        payload: {
          type: 'directory.delta',
          paneId: 'left',
          delta: {
            type: 'entriesRemoved',
            revision: 2,
            entryIds: ['entry-1'],
          } satisfies DirectoryDelta,
        },
      },
      {
        eventId: 2,
        timestamp: '2026-01-01T00:00:01.000Z',
        payload: {
          type: 'operation.progress',
          operationId: 'operation-1',
          progress: { completedItems: 1, completedBytes: 512 },
        },
      },
    ];

    client.scriptEvents(events);
    expect(client.emitNextEvent()).toBe(true);
    expect(client.emitNextEvent()).toBe(true);
    expect(client.emitNextEvent()).toBe(false);
    unsubscribe();
    client.emit(events[0] as BackendEvent);

    expect(listener.mock.calls.map((call) => (call[0] as BackendEvent).eventId)).toEqual([1, 2]);
  });

  it('applies artificial latency and supports aborting during the delay', async () => {
    vi.useFakeTimers();
    const client = new MockFileManagerClient({ latencyMs: 500 });
    const controller = new AbortController();
    const result = client.getRuntimeCapabilities(controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await vi.runAllTimersAsync();

    await rejection;
    vi.useRealTimers();
  });

  it('injects configured failures by method', async () => {
    const failure = new MockClientError('offline', 'Mock backend is offline');
    const client = new MockFileManagerClient({
      failures: { listDirectory: failure },
    });

    await expect(client.listDirectory(ROOT_REQUEST)).rejects.toBe(failure);
  });
});

describe('MockFileManagerClient search methods', () => {
  it('recursively matches filenames by substring and streams a completed resultsBatch event', async () => {
    vi.useFakeTimers();
    const client = new MockFileManagerClient();
    const listener = vi.fn();
    await client.subscribe(listener);

    const result = await client.startSearch({
      query: 'report',
      roots: [{ providerId: 'file', uri: 'mock:///' }],
      workspaceId: 'workspace-1',
    });

    expect(result.searchId).toMatch(/^mock-search-/);
    expect(result.location).toEqual({
      providerId: 'local',
      uri: `search://local/${result.searchId}`,
    });

    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0]?.[0] as BackendEvent;
    expect(event.payload).toMatchObject({
      type: 'search.resultsBatch',
      searchId: result.searchId,
      isComplete: true,
      warningsCount: 0,
    });
    expect(event.payload).toMatchObject({
      entries: [expect.objectContaining({ name: 'report.pdf' })],
    });
  });

  it('matches a glob query recursively across nested fixture directories', async () => {
    vi.useFakeTimers();
    const client = new MockFileManagerClient();
    const listener = vi.fn();
    await client.subscribe(listener);

    await client.startSearch({
      query: '*.md',
      roots: [{ providerId: 'file', uri: 'mock:///' }],
      workspaceId: 'workspace-1',
    });
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    const event = listener.mock.calls[0]?.[0] as BackendEvent;
    expect(event.payload).toMatchObject({
      entries: [expect.objectContaining({ name: 'file-manager.md' })],
    });
  });

  it('never emits a resultsBatch for a search cancelled before it fires', async () => {
    vi.useFakeTimers();
    const client = new MockFileManagerClient();
    const listener = vi.fn();
    await client.subscribe(listener);

    const result = await client.startSearch({
      query: 'report',
      roots: [{ providerId: 'file', uri: 'mock:///' }],
      workspaceId: 'workspace-1',
    });
    await client.cancelSearch(result.searchId);
    await vi.runAllTimersAsync();
    vi.useRealTimers();

    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects cancelling an unknown search id', async () => {
    const client = new MockFileManagerClient();

    await expect(client.cancelSearch('nonexistent')).rejects.toMatchObject({
      code: 'searchNotFound',
    });
  });
});
