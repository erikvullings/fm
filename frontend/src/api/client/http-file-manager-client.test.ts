import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../fetch-mutator';

const getRuntimeCapabilities = vi.fn();
const getSystemLocations = vi.fn();
const listDirectory = vi.fn();
const navigatePane = vi.fn();
const getEntryMetadata = vi.fn();
const listWorkspaces = vi.fn();
const createWorkspace = vi.fn();
const getWorkspace = vi.fn();
const deleteWorkspace = vi.fn();
const openWorkspace = vi.fn();
const applyWorkspaceCommand = vi.fn();
const requestStartOperation = vi.fn();
const requestListOperations = vi.fn();
const requestCancelOperation = vi.fn();
const requestPauseOperation = vi.fn();
const requestResumeOperation = vi.fn();
const requestResolveOperationConflict = vi.fn();
const requestStartSearch = vi.fn();
const requestCancelSearch = vi.fn();
const requestListPlugins = vi.fn();
const requestEnablePlugin = vi.fn();
const requestDisablePlugin = vi.fn();
const requestGetPluginLogs = vi.fn();
const requestReadFileRange = vi.fn();
const requestSearchInFile = vi.fn();
const requestGetFileIcon = vi.fn();

vi.mock('../generated/file-manager-api', () => ({
  getRuntimeCapabilities: (...args: unknown[]) => getRuntimeCapabilities(...args),
  getSystemLocations: (...args: unknown[]) => getSystemLocations(...args),
  listDirectory: (...args: unknown[]) => listDirectory(...args),
  navigatePane: (...args: unknown[]) => navigatePane(...args),
  getEntryMetadata: (...args: unknown[]) => getEntryMetadata(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
  createWorkspace: (...args: unknown[]) => createWorkspace(...args),
  getWorkspace: (...args: unknown[]) => getWorkspace(...args),
  deleteWorkspace: (...args: unknown[]) => deleteWorkspace(...args),
  openWorkspace: (...args: unknown[]) => openWorkspace(...args),
  applyWorkspaceCommand: (...args: unknown[]) => applyWorkspaceCommand(...args),
  startOperation: (...args: unknown[]) => requestStartOperation(...args),
  listOperations: (...args: unknown[]) => requestListOperations(...args),
  cancelOperation: (...args: unknown[]) => requestCancelOperation(...args),
  pauseOperation: (...args: unknown[]) => requestPauseOperation(...args),
  resumeOperation: (...args: unknown[]) => requestResumeOperation(...args),
  resolveOperationConflict: (...args: unknown[]) => requestResolveOperationConflict(...args),
  startSearch: (...args: unknown[]) => requestStartSearch(...args),
  cancelSearch: (...args: unknown[]) => requestCancelSearch(...args),
  listPlugins: (...args: unknown[]) => requestListPlugins(...args),
  enablePlugin: (...args: unknown[]) => requestEnablePlugin(...args),
  disablePlugin: (...args: unknown[]) => requestDisablePlugin(...args),
  getPluginLogs: (...args: unknown[]) => requestGetPluginLogs(...args),
  readFileRange: (...args: unknown[]) => requestReadFileRange(...args),
  searchInFile: (...args: unknown[]) => requestSearchInFile(...args),
  getFileIcon: (...args: unknown[]) => requestGetFileIcon(...args),
}));

const { HttpFileManagerClient } = await import('./http-file-manager-client');

class TestEventSource extends EventTarget {
  close(): void {}
}

beforeEach(() => {
  vi.stubGlobal('EventSource', TestEventSource);
});

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
    runtime: 'browserServer',
    serverAdministration: false,
    systemTrash: true,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  getRuntimeCapabilities.mockReset();
  listDirectory.mockReset();
  navigatePane.mockReset();
  getEntryMetadata.mockReset();
  listWorkspaces.mockReset();
  createWorkspace.mockReset();
  getWorkspace.mockReset();
  deleteWorkspace.mockReset();
  openWorkspace.mockReset();
  applyWorkspaceCommand.mockReset();
  requestStartOperation.mockReset();
  requestListOperations.mockReset();
  requestCancelOperation.mockReset();
  requestPauseOperation.mockReset();
  requestResumeOperation.mockReset();
  requestResolveOperationConflict.mockReset();
  requestStartSearch.mockReset();
  requestCancelSearch.mockReset();
  requestListPlugins.mockReset();
  requestEnablePlugin.mockReset();
  requestDisablePlugin.mockReset();
  requestGetPluginLogs.mockReset();
  requestReadFileRange.mockReset();
  requestSearchInFile.mockReset();
  requestGetFileIcon.mockReset();
});

describe('HttpFileManagerClient', () => {
  describe('getFileIcon', () => {
    it('returns binary icon bytes and forwards cancellation', async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      requestGetFileIcon.mockResolvedValue({
        status: 200,
        data: new Blob([bytes], { type: 'image/png' }),
        headers: new Headers({ 'content-type': 'image/png' }),
      });
      const controller = new AbortController();
      const client = new HttpFileManagerClient();

      await expect(client.getFileIcon('file:///report.pdf', controller.signal)).resolves.toEqual(
        bytes,
      );
      expect(requestGetFileIcon).toHaveBeenCalledWith(
        { uri: 'file:///report.pdf' },
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('silently returns undefined for unsupported hosts and fetch failures', async () => {
      requestGetFileIcon.mockRejectedValue(new Error('not found'));
      const client = new HttpFileManagerClient();

      await expect(client.getFileIcon('file:///report.pdf')).resolves.toBeUndefined();
    });
  });

  describe('getRuntimeCapabilities', () => {
    it('maps the generated client response data to the frontend model (happy path)', async () => {
      const fixture = fixtureCapabilities();
      getRuntimeCapabilities.mockResolvedValue({
        status: 200,
        data: fixture,
        headers: new Headers(),
      });
      const client = new HttpFileManagerClient();

      const result = await client.getRuntimeCapabilities();

      expect(result).toEqual(fixture);
    });

    it('forwards the caller-provided AbortSignal to the generated client call', async () => {
      getRuntimeCapabilities.mockResolvedValue({
        status: 200,
        data: fixtureCapabilities(),
        headers: new Headers(),
      });
      const client = new HttpFileManagerClient();
      const controller = new AbortController();

      await client.getRuntimeCapabilities(controller.signal);

      expect(getRuntimeCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('propagates a rejected ApiError without wrapping or leaking a raw Response', async () => {
      const apiError = new ApiError(500, { code: 'unknownError', message: 'boom' });
      getRuntimeCapabilities.mockRejectedValue(apiError);
      const client = new HttpFileManagerClient();

      await expect(client.getRuntimeCapabilities()).rejects.toBe(apiError);
    });

    it('propagates an abort rejection rather than swallowing the cancellation', async () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      getRuntimeCapabilities.mockRejectedValue(abortError);
      const client = new HttpFileManagerClient();
      const controller = new AbortController();

      await expect(client.getRuntimeCapabilities(controller.signal)).rejects.toBe(abortError);
    });
  });

  describe('getSystemLocations', () => {
    it('maps discovered locations and forwards cancellation', async () => {
      getSystemLocations.mockResolvedValue({
        status: 200,
        data: [
          {
            name: 'Example Drive',
            kind: 'cloud',
            location: { providerId: 'local', uri: 'file:///Example' },
            providerHint: 'example',
          },
        ],
        headers: new Headers(),
      });
      const controller = new AbortController();

      await expect(
        new HttpFileManagerClient().getSystemLocations(controller.signal),
      ).resolves.toEqual([
        {
          name: 'Example Drive',
          kind: 'cloud',
          location: { providerId: 'local', uri: 'file:///Example' },
          providerHint: 'example',
        },
      ]);
      expect(getSystemLocations).toHaveBeenCalledWith(
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  describe('subscribe', () => {
    it('connects the shared SSE stream and returns its listener unsubscribe', async () => {
      const client = new HttpFileManagerClient();

      const unsubscribe = await client.subscribe(() => {});

      expect(() => unsubscribe()).not.toThrow();
      expect(client.connection.get()).toBe('connecting');
      client.disconnect();
      expect(client.connection.get()).toBe('closed');
    });
  });

  describe('directory methods', () => {
    it('calls the generated list endpoint and forwards cancellation', async () => {
      const snapshot = {
        paneId: 'pane-1',
        requestId: 'req-1',
        revision: 1,
        location: { providerId: 'local', uri: 'file:///' },
        entries: [],
        hasMore: false,
        loadingState: { type: 'loaded' },
      };
      listDirectory.mockResolvedValue({ status: 200, data: snapshot, headers: new Headers() });
      const client = new HttpFileManagerClient();
      const controller = new AbortController();
      const request = {
        workspaceId: 'workspace-1',
        paneId: 'pane-1',
        requestId: 'req-1',
        location: { providerId: 'local', uri: 'file:///' },
      };

      await expect(client.listDirectory(request, controller.signal)).resolves.toEqual(snapshot);
      expect(listDirectory).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  describe('workspace methods', () => {
    it('normalizes workspace DTOs returned by semantic command dispatch', async () => {
      const dto = {
        id: 'workspace-1',
        name: 'Renamed',
        revision: 2,
        layout: { type: 'pane', paneId: 'pane-1' },
        panes: [],
        activePaneId: 'pane-1',
        operationCentre: { visible: false, height: 180 },
      };
      applyWorkspaceCommand.mockResolvedValue({ status: 200, data: dto, headers: new Headers() });
      const client = new HttpFileManagerClient();
      const command = {
        type: 'renameWorkspace',
        workspaceId: 'workspace-1',
        expectedRevision: 1,
        name: 'Renamed',
      } as const;

      await expect(client.dispatchWorkspaceCommand(command)).resolves.toEqual(
        expect.objectContaining({
          id: 'workspace-1',
          name: 'Renamed',
          paneOrder: [],
          panesById: {},
        }),
      );
      expect(applyWorkspaceCommand).toHaveBeenCalledWith('workspace-1', command, undefined);
    });
  });

  describe('operation methods', () => {
    it('starts a semantic operation and maps the wire type discriminator', async () => {
      requestStartOperation.mockResolvedValue({
        status: 201,
        headers: new Headers(),
        data: {
          id: 'operation-1',
          type: 'copy',
          state: 'queued',
          sources: [],
          destination: null,
          progress: { completedItems: 0, completedBytes: 0 },
          conflictPolicy: 'ask',
          createdAt: '2026-07-31T12:00:00Z',
        },
      });
      const client = new HttpFileManagerClient();
      const request = {
        type: 'copy',
        sources: [{ providerId: 'local', uri: 'file:///Documents' }],
        conflictPolicy: 'ask',
      } as const;

      await expect(client.startOperation(request)).resolves.toMatchObject({
        id: 'operation-1',
        kind: 'copy',
        state: 'queued',
      });
      expect(requestStartOperation).toHaveBeenCalledWith(request, undefined);
    });

    it('lists operations and forwards cancellation to every lifecycle request', async () => {
      requestListOperations.mockResolvedValue({
        status: 200,
        data: { operations: [] },
        headers: new Headers(),
      });
      requestCancelOperation.mockResolvedValue({ status: 204, headers: new Headers() });
      requestPauseOperation.mockResolvedValue({ status: 204, headers: new Headers() });
      requestResumeOperation.mockResolvedValue({ status: 204, headers: new Headers() });
      const controller = new AbortController();
      const client = new HttpFileManagerClient();

      await expect(client.listOperations(controller.signal)).resolves.toEqual([]);
      await client.cancelOperation('operation-1', controller.signal);
      await client.pauseOperation('operation-1', controller.signal);
      await client.resumeOperation('operation-1', controller.signal);

      const options = expect.objectContaining({ signal: controller.signal });
      expect(requestListOperations).toHaveBeenCalledWith(undefined, options);
      expect(requestCancelOperation).toHaveBeenCalledWith('operation-1', options);
      expect(requestPauseOperation).toHaveBeenCalledWith('operation-1', options);
      expect(requestResumeOperation).toHaveBeenCalledWith('operation-1', options);
    });

    it('reserves the exact conflict request shape without duplicating the operation id in JSON', async () => {
      requestResolveOperationConflict.mockResolvedValue({
        status: 204,
        headers: new Headers(),
      });
      const client = new HttpFileManagerClient();

      await client.resolveConflict({
        operationId: 'operation-1',
        resolution: 'renameNew',
        applyToAllSimilar: true,
      });

      expect(requestResolveOperationConflict).toHaveBeenCalledWith(
        'operation-1',
        { resolution: 'renameNew', applyToAllSimilar: true },
        undefined,
      );
    });
  });

  describe('search methods', () => {
    it('starts a filename search and returns its id and virtual location', async () => {
      requestStartSearch.mockResolvedValue({
        status: 201,
        headers: new Headers(),
        data: {
          searchId: 'search-1',
          location: { providerId: 'local', uri: 'search://local/search-1' },
        },
      });
      const client = new HttpFileManagerClient();
      const controller = new AbortController();

      await expect(
        client.startSearch(
          {
            query: 'report',
            roots: [{ providerId: 'local', uri: 'file:///Documents' }],
            workspaceId: 'workspace-1',
          },
          controller.signal,
        ),
      ).resolves.toEqual({
        searchId: 'search-1',
        location: { providerId: 'local', uri: 'search://local/search-1' },
      });
      expect(requestStartSearch).toHaveBeenCalledWith(
        {
          query: 'report',
          roots: [{ providerId: 'local', uri: 'file:///Documents' }],
          workspaceId: 'workspace-1',
        },
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('rejects an unexpected startSearch response status', async () => {
      requestStartSearch.mockResolvedValue({ status: 400, headers: new Headers(), data: {} });
      const client = new HttpFileManagerClient();

      await expect(
        client.startSearch({ query: 'x', roots: [], workspaceId: 'workspace-1' }),
      ).rejects.toThrow('Unexpected startSearch response status: 400');
    });

    it('forwards the content-search fields to the backend (regression: these were silently dropped)', async () => {
      requestStartSearch.mockResolvedValue({
        status: 201,
        headers: new Headers(),
        data: {
          searchId: 'search-1',
          location: { providerId: 'local', uri: 'search://local/search-1' },
        },
      });
      const client = new HttpFileManagerClient();

      await client.startSearch({
        query: '*.md',
        contentQuery: 'archive',
        contentRegex: false,
        contentCaseSensitive: false,
        contentWholeWord: true,
        recurse: true,
        roots: [{ providerId: 'local', uri: 'file:///Documents' }],
        workspaceId: 'workspace-1',
      });

      expect(requestStartSearch).toHaveBeenCalledWith(
        expect.objectContaining({
          contentQuery: 'archive',
          contentRegex: false,
          contentCaseSensitive: false,
          contentWholeWord: true,
          recurse: true,
        }),
        undefined,
      );
    });

    it('forwards showHidden to the backend so hidden files are excluded when show-hidden is off', async () => {
      requestStartSearch.mockResolvedValue({
        status: 201,
        headers: new Headers(),
        data: {
          searchId: 'search-1',
          location: { providerId: 'local', uri: 'search://local/search-1' },
        },
      });
      const client = new HttpFileManagerClient();

      await client.startSearch({
        query: '*.md',
        recurse: true,
        showHidden: false,
        roots: [{ providerId: 'local', uri: 'file:///Documents' }],
        workspaceId: 'workspace-1',
      });

      expect(requestStartSearch).toHaveBeenCalledWith(
        expect.objectContaining({ showHidden: false }),
        undefined,
      );
    });

    it('cancels a search', async () => {
      requestCancelSearch.mockResolvedValue({ status: 204, headers: new Headers() });
      const client = new HttpFileManagerClient();
      const controller = new AbortController();

      await client.cancelSearch('search-1', controller.signal);

      expect(requestCancelSearch).toHaveBeenCalledWith(
        'search-1',
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('rejects an unexpected cancelSearch response status', async () => {
      requestCancelSearch.mockResolvedValue({ status: 404, headers: new Headers() });
      const client = new HttpFileManagerClient();

      await expect(client.cancelSearch('search-1')).rejects.toThrow(
        'Unexpected cancelSearch response status: 404',
      );
    });
  });

  describe('file range and content search methods', () => {
    it('reads a byte range from a file', async () => {
      const chunk = {
        data: [1, 2, 3],
        offset: 0,
        length: 3,
        eof: false,
        probablyBinary: false,
      };
      requestReadFileRange.mockResolvedValue({ status: 200, data: chunk, headers: new Headers() });
      const client = new HttpFileManagerClient();
      const controller = new AbortController();
      const request = {
        location: { providerId: 'local', uri: 'file:///report.txt' },
        offset: 0,
        length: 3,
      };

      await expect(client.readFileRange(request, controller.signal)).resolves.toEqual(chunk);
      expect(requestReadFileRange).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('rejects an unexpected readFileRange response status', async () => {
      requestReadFileRange.mockResolvedValue({ status: 400, headers: new Headers(), data: {} });
      const client = new HttpFileManagerClient();

      await expect(
        client.readFileRange({
          location: { providerId: 'local', uri: 'file:///report.txt' },
          offset: 0,
          length: 3,
        }),
      ).rejects.toThrow('Unexpected readFileRange response status: 400');
    });

    it('searches a file for content matches', async () => {
      const result = {
        matches: [{ lineNumber: 1, offset: 0, length: 5 }],
        truncated: false,
      };
      requestSearchInFile.mockResolvedValue({ status: 200, data: result, headers: new Headers() });
      const client = new HttpFileManagerClient();
      const controller = new AbortController();
      const request = {
        location: { providerId: 'local', uri: 'file:///report.txt' },
        query: 'error',
        regex: false,
        caseSensitive: false,
        wholeWord: false,
      };

      await expect(client.searchInFile(request, controller.signal)).resolves.toEqual(result);
      expect(requestSearchInFile).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('rejects an unexpected searchInFile response status', async () => {
      requestSearchInFile.mockResolvedValue({ status: 400, headers: new Headers(), data: {} });
      const client = new HttpFileManagerClient();

      await expect(
        client.searchInFile({
          location: { providerId: 'local', uri: 'file:///report.txt' },
          query: 'error',
          regex: false,
          caseSensitive: false,
          wholeWord: false,
        }),
      ).rejects.toThrow('Unexpected searchInFile response status: 400');
    });
  });

  describe('plugin methods', () => {
    function fixturePermissions() {
      return {
        selectedEntryMetadata: true,
        selectedEntryContentRead: false,
        filesystemRead: [],
        filesystemWrite: [],
        clipboardRead: false,
        clipboardWrite: true,
        network: [],
        processSpawn: false,
        notifications: false,
        settingsStorage: false,
      };
    }

    it('maps discovered plugins including their permissions and diagnostics', async () => {
      requestListPlugins.mockResolvedValue({
        status: 200,
        headers: new Headers(),
        data: [
          {
            id: 'example.copy-markdown',
            name: 'Copy Markdown',
            version: '1.0.0',
            description: 'Copies a markdown link',
            enabled: true,
            diagnostic: null,
            columns: [],
            permissions: fixturePermissions(),
          },
        ],
      });
      const client = new HttpFileManagerClient();

      const plugins = await client.listPlugins();

      expect(plugins).toEqual([
        {
          id: 'example.copy-markdown',
          name: 'Copy Markdown',
          version: '1.0.0',
          description: 'Copies a markdown link',
          enabled: true,
          columns: [],
          permissions: fixturePermissions(),
        },
      ]);
    });

    it('enables and disables a plugin through the matching generated endpoint', async () => {
      requestEnablePlugin.mockResolvedValue({ status: 204, headers: new Headers() });
      requestDisablePlugin.mockResolvedValue({ status: 204, headers: new Headers() });
      const controller = new AbortController();
      const client = new HttpFileManagerClient();

      await client.setPluginEnabled('example.copy-markdown', true, controller.signal);
      await client.setPluginEnabled('example.copy-markdown', false, controller.signal);

      const options = expect.objectContaining({ signal: controller.signal });
      expect(requestEnablePlugin).toHaveBeenCalledWith('example.copy-markdown', options);
      expect(requestDisablePlugin).toHaveBeenCalledWith('example.copy-markdown', options);
    });

    it('fetches a plugin bounded diagnostic log', async () => {
      requestGetPluginLogs.mockResolvedValue({
        status: 200,
        headers: new Headers(),
        data: [{ message: 'plugin execution timed out' }],
      });
      const client = new HttpFileManagerClient();

      await expect(client.getPluginLogs('example.copy-markdown')).resolves.toEqual([
        { message: 'plugin execution timed out' },
      ]);
      expect(requestGetPluginLogs).toHaveBeenCalledWith('example.copy-markdown', undefined);
    });
  });
});
