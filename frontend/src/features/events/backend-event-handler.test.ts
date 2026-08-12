import { describe, expect, it, vi } from 'vitest';

import type {
  BackendEvent,
  Connection,
  OperationConflict,
  WorkspaceProjection,
} from '../../models';
import { createOperationsState } from '../operations/operation-state';
import { type BackendEventContext, createBackendEventHandler } from './backend-event-handler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type WorkspaceId = string & { readonly _brand: unique symbol };
type PaneId = string & { readonly _brand: unique symbol };
type ConnectionId = string & { readonly _brand: unique symbol };

const WS_ID = 'ws-1' as WorkspaceId;
const PANE_ID = 'pane-1' as PaneId;

function makeEvent(payload: BackendEvent['payload'], workspaceId?: string): BackendEvent {
  return {
    eventId: 1,
    timestamp: '2026-01-01T00:00:00Z',
    ...(workspaceId !== undefined ? { workspaceId: workspaceId as WorkspaceId } : {}),
    payload,
  };
}

function makeContext(overrides: Partial<BackendEventContext> = {}): BackendEventContext {
  const searchBatchReloadInFlight = new Set<PaneId>();
  return {
    getWorkspaceId: vi.fn(() => WS_ID),
    getWorkspaceRevision: vi.fn(() => 5),
    replaceWorkspace: vi.fn(),
    refreshWorkspaceSummaries: vi.fn(),
    setWorkspaceSummaries: vi.fn(),
    setWorkspaceActionError: vi.fn(),
    recoverActiveWorkspace: vi.fn(() => Promise.resolve()),
    listWorkspaces: vi.fn(() => Promise.resolve([])),
    getWorkspace: vi.fn(() => Promise.resolve({} as WorkspaceProjection)),
    setPendingConflict: vi.fn(),
    getPendingOperationEvents: vi.fn(() => []),
    pushPendingOperationEvent: vi.fn(),
    clearPendingOperationEvents: vi.fn(() => []),
    getOperationFrame: vi.fn(() => undefined),
    setOperationFrame: vi.fn(),
    getOperations: vi.fn(() => createOperationsState()),
    setOperations: vi.fn(),
    getDismissedOperationIds: vi.fn(() => new Set<string>()),
    clearDismissedOperation: vi.fn(),
    scheduleAutoDismiss: vi.fn(),
    getActiveDirectoryRevision: vi.fn(() => undefined),
    applyDelta: vi.fn(),
    refetchAffectedPanes: vi.fn(),
    getPlugins: vi.fn(() => []),
    setPlugins: vi.fn(),
    listPlugins: vi.fn(() => Promise.resolve([])),
    getCurrentIconThemeSetting: vi.fn(() => undefined),
    applyIconTheme: vi.fn(),
    getConnections: vi.fn(() => []),
    setConnections: vi.fn(),
    getConnection: vi.fn(() => Promise.resolve({} as Connection)),
    getFindFilesSearchId: vi.fn(() => undefined),
    getSearchBatchReloadInFlight: vi.fn(() => searchBatchReloadInFlight),
    cacheContentMatches: vi.fn(),
    findPanesWithUri: vi.fn(() => []),
    loadPane: vi.fn(() => Promise.resolve()),
    redraw: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createBackendEventHandler', () => {
  describe('operation.conflict', () => {
    it('sets the pending conflict and redraws', () => {
      const ctx = makeContext();
      const handler = createBackendEventHandler(ctx);
      const conflict: OperationConflict = {
        operationId: 'op-1' as BackendEvent['payload'] extends { operationId: infer T } ? T : never,
        conflictId: 'c-1',
        message: 'File already exists',
        source: { name: 'a.txt', kind: 'file' },
        destination: { name: 'a.txt', kind: 'file' },
      };
      handler(makeEvent({ type: 'operation.conflict', ...conflict }, WS_ID));

      expect(ctx.setPendingConflict).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'operation.conflict', conflictId: 'c-1' }),
      );
      expect(ctx.redraw).toHaveBeenCalled();
    });

    it('ignores the event when it belongs to a different workspace', () => {
      const ctx = makeContext();
      const handler = createBackendEventHandler(ctx);
      const conflict: OperationConflict = {
        operationId: 'op-1' as never,
        conflictId: 'c-1',
        message: 'File already exists',
        source: { name: 'a.txt', kind: 'file' },
        destination: { name: 'a.txt', kind: 'file' },
      };
      handler(makeEvent({ type: 'operation.conflict', ...conflict }, 'other-ws'));

      expect(ctx.setPendingConflict).not.toHaveBeenCalled();
    });
  });

  describe('directory.snapshot', () => {
    it('applies a delta reset when the incoming revision is newer', () => {
      const ctx = makeContext({
        getActiveDirectoryRevision: vi.fn(() => 2),
      });
      const handler = createBackendEventHandler(ctx);

      handler(
        makeEvent(
          {
            type: 'directory.snapshot',
            snapshot: {
              paneId: PANE_ID,
              revision: 3,
              location: { providerId: 'local', uri: 'file:///tmp' },
              entries: [],
              writable: true,
              hasMore: false,
              requestId: 'r1',
              loadingState: { type: 'loaded' },
            },
          },
          WS_ID,
        ),
      );

      expect(ctx.applyDelta).toHaveBeenCalledWith(
        PANE_ID,
        expect.objectContaining({ type: 'reset' }),
      );
    });

    it('skips the snapshot when the revision is not newer', () => {
      const ctx = makeContext({
        getActiveDirectoryRevision: vi.fn(() => 5),
      });
      const handler = createBackendEventHandler(ctx);

      handler(
        makeEvent(
          {
            type: 'directory.snapshot',
            snapshot: {
              paneId: PANE_ID,
              revision: 5,
              location: { providerId: 'local', uri: 'file:///tmp' },
              entries: [],
              writable: true,
              hasMore: false,
              requestId: 'r1',
              loadingState: { type: 'loaded' },
            },
          },
          WS_ID,
        ),
      );

      expect(ctx.applyDelta).not.toHaveBeenCalled();
    });
  });

  describe('plugin.changed', () => {
    it('merges the summary into the existing plugin list and redraws', () => {
      const existing = [
        { id: 'plug-a', name: 'Plug A', version: '1.0.0', enabled: true, description: '' },
      ];
      const ctx = makeContext({ getPlugins: vi.fn(() => existing) });
      const handler = createBackendEventHandler(ctx);

      handler(
        makeEvent(
          {
            type: 'plugin.changed',
            plugin: { id: 'plug-a', name: 'Plug A', version: '1.1.0', enabled: false },
          },
          WS_ID,
        ),
      );

      expect(ctx.setPlugins).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'plug-a', version: '1.1.0', enabled: false }),
      ]);
      expect(ctx.redraw).toHaveBeenCalled();
    });

    it('re-fetches the full plugin list and re-applies the icon theme', async () => {
      const listed = [
        { id: 'plug-a', name: 'Plug A', version: '1.1.0', enabled: true, description: '' },
      ];
      const ctx = makeContext({
        getPlugins: vi.fn(() => []),
        listPlugins: vi.fn(() => Promise.resolve(listed)),
        getCurrentIconThemeSetting: vi.fn(() => 'plug-a'),
      });
      const handler = createBackendEventHandler(ctx);

      handler(
        makeEvent(
          {
            type: 'plugin.changed',
            plugin: { id: 'plug-a', name: 'Plug A', version: '1.1.0', enabled: true },
          },
          WS_ID,
        ),
      );
      // Allow listPlugins promise to settle.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ctx.setPlugins).toHaveBeenCalledWith(listed);
      expect(ctx.applyIconTheme).toHaveBeenCalledWith('plug-a');
    });
  });

  describe('connection.deleted', () => {
    it('removes the connection from the list and redraws', () => {
      const conn = { id: 'conn-1', name: 'My Server' } as unknown as Connection;
      const ctx = makeContext({ getConnections: vi.fn(() => [conn]) });
      const handler = createBackendEventHandler(ctx);

      handler(
        makeEvent({ type: 'connection.deleted', connectionId: 'conn-1' as ConnectionId }, WS_ID),
      );

      expect(ctx.setConnections).toHaveBeenCalledWith(
        expect.not.arrayContaining([expect.objectContaining({ id: 'conn-1' })]),
      );
      expect(ctx.redraw).toHaveBeenCalled();
    });
  });

  describe('search.resultsBatch', () => {
    it('caches content matches and triggers a reload for the matching pane', async () => {
      const searchId = 'search-42';
      const ctx = makeContext({
        getFindFilesSearchId: vi.fn(() => searchId),
        findPanesWithUri: vi.fn(() => [PANE_ID]),
        loadPane: vi.fn(() => Promise.resolve()),
      });
      const handler = createBackendEventHandler(ctx);

      handler(
        makeEvent(
          {
            type: 'search.resultsBatch',
            searchId,
            entries: [
              {
                id: 'entry-1' as never,
                name: 'result.ts',
                kind: 'file',
                location: { providerId: 'local', uri: 'file:///tmp/result.ts' },
                hidden: false,
                readOnly: false,
                metadataRevision: 0,
                contentMatches: [{ lineNumber: 1, offset: 0, length: 3 }],
              },
            ],
            isComplete: true,
            warningsCount: 0,
          },
          WS_ID,
        ),
      );

      expect(ctx.cacheContentMatches).toHaveBeenCalledWith('file:///tmp/result.ts', [
        { lineNumber: 1, offset: 0, length: 3 },
      ]);
      expect(ctx.loadPane).toHaveBeenCalledWith(PANE_ID);
      expect(ctx.redraw).toHaveBeenCalled();
    });

    it('ignores batches belonging to a different search', () => {
      const ctx = makeContext({
        getFindFilesSearchId: vi.fn(() => 'search-other'),
      });
      const handler = createBackendEventHandler(ctx);

      handler(
        makeEvent(
          {
            type: 'search.resultsBatch',
            searchId: 'search-42',
            entries: [],
            isComplete: true,
            warningsCount: 0,
          },
          WS_ID,
        ),
      );

      expect(ctx.cacheContentMatches).not.toHaveBeenCalled();
      expect(ctx.loadPane).not.toHaveBeenCalled();
    });
  });

  describe('workspace.deleted (active workspace)', () => {
    it('lists workspaces and triggers recovery when the active workspace is deleted', async () => {
      const summaries = [
        {
          id: 'ws-2' as WorkspaceId,
          name: 'Other',
          revision: 1,
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ];
      const ctx = makeContext({
        listWorkspaces: vi.fn(() => Promise.resolve(summaries)),
        recoverActiveWorkspace: vi.fn(() => Promise.resolve()),
      });
      const handler = createBackendEventHandler(ctx);

      handler(makeEvent({ type: 'workspace.deleted', revision: 6 }, WS_ID));
      // Allow the full promise chain (listWorkspaces → then → recoverActiveWorkspace → finally) to settle.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ctx.setWorkspaceSummaries).toHaveBeenCalledWith(summaries);
      expect(ctx.recoverActiveWorkspace).toHaveBeenCalledWith(summaries);
      expect(ctx.redraw).toHaveBeenCalled();
    });

    it('only refreshes the summary list when a different workspace is deleted', () => {
      const ctx = makeContext();
      const handler = createBackendEventHandler(ctx);

      handler(makeEvent({ type: 'workspace.deleted', revision: 6 }, 'other-ws'));

      expect(ctx.refreshWorkspaceSummaries).toHaveBeenCalled();
      expect(ctx.listWorkspaces).not.toHaveBeenCalled();
    });
  });

  describe('terminal operations', () => {
    it('forces a foreground pane refetch when a mutating operation reaches a terminal state', () => {
      const previous = createOperationsState([
        {
          id: 'op-1' as never,
          kind: 'copy',
          state: 'running',
          sources: [],
          progress: { completedItems: 0, completedBytes: 0 },
          conflictPolicy: 'ask',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]);
      const completedOperation = {
        id: 'op-1' as never,
        kind: 'copy',
        state: 'completed',
        sources: [],
        progress: { completedItems: 1, completedBytes: 1 },
        conflictPolicy: 'ask',
        createdAt: '2026-01-01T00:00:00Z',
      };
      const pending: BackendEvent[] = [];
      const ctx = makeContext({
        getOperations: vi.fn(() => previous),
        getOperationFrame: vi.fn(() => undefined),
        pushPendingOperationEvent: vi.fn((event: BackendEvent) => {
          pending.push(event);
        }),
        clearPendingOperationEvents: vi.fn(() => {
          const events = [...pending];
          pending.length = 0;
          return events;
        }),
      });
      // Replace RAF with immediate execution for deterministic unit behavior.
      const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        callback(0);
        return 1;
      });
      const handler = createBackendEventHandler(ctx);

      try {
        handler(makeEvent({ type: 'operation.created', operation: completedOperation }, WS_ID));
      } finally {
        raf.mockRestore();
      }

      expect(ctx.refetchAffectedPanes).toHaveBeenCalledWith(undefined, { background: false });
    });
  });
});
