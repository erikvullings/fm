import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

class MockChannel<T> {
  constructor(public onmessage: (message: T) => void) {}
}

vi.mock('@tauri-apps/api/core', () => ({
  Channel: MockChannel,
  invoke: (...args: unknown[]) => invoke(...args),
}));

const { TauriFileManagerClient } = await import('./tauri-file-manager-client');

function fixtureCapabilities() {
  return {
    clipboard: true,
    nativeDragOut: false,
    nativeFileIcons: false,
    nativeMenus: false,
    nativeThumbnails: false,
    openTerminal: false,
    platform: 'macos',
    plugins: false,
    revealInSystemFileManager: true,
    runtime: 'tauri',
    serverAdministration: false,
    systemTrash: true,
  };
}

afterEach(() => {
  invoke.mockReset();
});

describe('TauriFileManagerClient', () => {
  describe('getFileIcon', () => {
    it('converts the Tauri byte array and silently falls back on errors', async () => {
      invoke.mockResolvedValueOnce([0x89, 0x50, 0x4e, 0x47]);
      const client = new TauriFileManagerClient();

      await expect(client.getFileIcon('file:///report.pdf')).resolves.toEqual(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      );
      expect(invoke).toHaveBeenCalledWith('get_file_icon', { uri: 'file:///report.pdf' });

      invoke.mockRejectedValueOnce(new Error('unsupported'));
      await expect(client.getFileIcon('file:///report.pdf')).resolves.toBeUndefined();
    });
  });

  describe('getRuntimeCapabilities', () => {
    it('invokes the get_runtime_capabilities command and returns its result', async () => {
      const fixture = fixtureCapabilities();
      invoke.mockResolvedValue(fixture);
      const client = new TauriFileManagerClient();

      const result = await client.getRuntimeCapabilities();

      expect(result).toEqual(fixture);
      expect(invoke).toHaveBeenCalledWith('get_runtime_capabilities');
    });

    it('propagates a command rejection without wrapping it', async () => {
      const commandError = new Error('boom');
      invoke.mockRejectedValue(commandError);
      const client = new TauriFileManagerClient();

      await expect(client.getRuntimeCapabilities()).rejects.toBe(commandError);
    });
  });

  describe('directory methods', () => {
    it('invokes navigate_pane with the request wrapper expected by Tauri', async () => {
      const snapshot = {
        paneId: 'left',
        requestId: 'request-1',
        revision: 1,
        location: { providerId: 'local', uri: 'file:///' },
        entries: [],
        hasMore: false,
        loadingState: { type: 'loaded' },
      };
      invoke.mockResolvedValue(snapshot);
      const client = new TauriFileManagerClient();
      const request = {
        workspaceId: 'workspace-1',
        paneId: 'left',
        requestId: 'request-1',
        location: { providerId: 'local', uri: 'file:///' },
      };

      await expect(client.navigatePane(request)).resolves.toEqual(snapshot);
      expect(invoke).toHaveBeenCalledWith('navigate_pane', { request });
    });
  });

  describe('operation methods', () => {
    it('invokes semantic operation commands without enumerating source files', async () => {
      const request = {
        type: 'copy',
        sources: [{ providerId: 'local', uri: 'file:///Documents' }],
        destination: { providerId: 'local', uri: 'file:///Archive' },
        conflictPolicy: 'ask',
      } as const;
      const operation = {
        id: 'operation-1',
        kind: 'copy',
        state: 'queued',
        sources: request.sources,
        destination: request.destination,
        progress: { completedItems: 0, completedBytes: 0 },
        conflictPolicy: 'ask',
        createdAt: '2026-07-31T12:00:00Z',
      };
      invoke.mockResolvedValue(operation);
      const client = new TauriFileManagerClient();

      await expect(client.startOperation(request)).resolves.toEqual(operation);
      expect(invoke).toHaveBeenCalledWith('start_operation', { request });
      await client.pauseOperation(operation.id);
      expect(invoke).toHaveBeenCalledWith('pause_operation', { operationId: operation.id });
      await client.resumeOperation(operation.id);
      expect(invoke).toHaveBeenCalledWith('resume_operation', { operationId: operation.id });
      await client.cancelOperation(operation.id);
      expect(invoke).toHaveBeenCalledWith('cancel_operation', { operationId: operation.id });
    });
  });

  describe('search methods', () => {
    it('invokes start_search and returns the searchId/location', async () => {
      const request = {
        query: 'report',
        roots: [{ providerId: 'local', uri: 'file:///Documents' }],
        workspaceId: 'workspace-1',
      };
      const result = {
        searchId: 'search-1',
        location: { providerId: 'local', uri: 'search://local/search-1' },
      };
      invoke.mockResolvedValue(result);
      const client = new TauriFileManagerClient();

      await expect(client.startSearch(request)).resolves.toEqual(result);
      expect(invoke).toHaveBeenCalledWith('start_search', { request });
    });

    it('invokes cancel_search with the searchId', async () => {
      invoke.mockResolvedValue(undefined);
      const client = new TauriFileManagerClient();

      await client.cancelSearch('search-1');

      expect(invoke).toHaveBeenCalledWith('cancel_search', { searchId: 'search-1' });
    });
  });

  describe('file range and content search methods', () => {
    it('invokes read_file_range and returns the chunk', async () => {
      const request = {
        location: { providerId: 'local', uri: 'file:///report.txt' },
        offset: 0,
        length: 3,
      };
      const chunk = { data: [1, 2, 3], offset: 0, length: 3, eof: false, probablyBinary: false };
      invoke.mockResolvedValue(chunk);
      const client = new TauriFileManagerClient();

      await expect(client.readFileRange(request)).resolves.toEqual(chunk);
      expect(invoke).toHaveBeenCalledWith('read_file_range', { request });
    });

    it('invokes search_in_file and returns the matches', async () => {
      const request = {
        location: { providerId: 'local', uri: 'file:///report.txt' },
        query: 'error',
        regex: false,
        caseSensitive: false,
      };
      const result = { matches: [{ lineNumber: 1, offset: 0, length: 5 }], truncated: false };
      invoke.mockResolvedValue(result);
      const client = new TauriFileManagerClient();

      await expect(client.searchInFile(request)).resolves.toEqual(result);
      expect(invoke).toHaveBeenCalledWith('search_in_file', { request });
    });
  });

  describe('workspace methods', () => {
    it('invokes get_workspace and normalizes the result', async () => {
      invoke.mockResolvedValue({
        id: 'workspace-1',
        name: 'Workspace',
        revision: 1,
        layout: { type: 'pane', paneId: 'pane-1' },
        panes: [],
        activePaneId: 'pane-1',
        operationCentre: { visible: false, height: 180 },
      });
      const client = new TauriFileManagerClient();

      await expect(client.getWorkspace('workspace-1')).resolves.toEqual(
        expect.objectContaining({ id: 'workspace-1', panesById: {} }),
      );
      expect(invoke).toHaveBeenCalledWith('get_workspace', { workspaceId: 'workspace-1' });
    });
  });

  describe('subscribe', () => {
    it('connects the Tauri event stream and forwards dispatched events to the listener', async () => {
      invoke.mockResolvedValue('subscription-1');
      const client = new TauriFileManagerClient();
      const listener = vi.fn();

      const unsubscribe = await client.subscribe(listener);

      expect(typeof unsubscribe).toBe('function');
      expect(invoke).toHaveBeenCalledWith('subscribe_events', {
        onEvent: expect.any(MockChannel),
      });
    });
  });
});
