import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../fetch-mutator';

const getRuntimeCapabilities = vi.fn();
const listDirectory = vi.fn();
const navigatePane = vi.fn();
const getEntryMetadata = vi.fn();
const listWorkspaces = vi.fn();
const createWorkspace = vi.fn();
const getWorkspace = vi.fn();
const deleteWorkspace = vi.fn();
const openWorkspace = vi.fn();
const applyWorkspaceCommand = vi.fn();

vi.mock('../generated/file-manager-api', () => ({
  getRuntimeCapabilities: (...args: unknown[]) => getRuntimeCapabilities(...args),
  listDirectory: (...args: unknown[]) => listDirectory(...args),
  navigatePane: (...args: unknown[]) => navigatePane(...args),
  getEntryMetadata: (...args: unknown[]) => getEntryMetadata(...args),
  listWorkspaces: (...args: unknown[]) => listWorkspaces(...args),
  createWorkspace: (...args: unknown[]) => createWorkspace(...args),
  getWorkspace: (...args: unknown[]) => getWorkspace(...args),
  deleteWorkspace: (...args: unknown[]) => deleteWorkspace(...args),
  openWorkspace: (...args: unknown[]) => openWorkspace(...args),
  applyWorkspaceCommand: (...args: unknown[]) => applyWorkspaceCommand(...args),
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
});

describe('HttpFileManagerClient', () => {
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

  describe('methods with no backend endpoint yet', () => {
    it('throws NotImplementedError for startOperation, naming task 0036', () => {
      const client = new HttpFileManagerClient();

      expect(() =>
        client.startOperation({
          kind: 'copy',
          sources: [],
          destination: { providerId: 'file', uri: 'file:///' },
          conflictPolicy: 'ask',
        }),
      ).toThrowError(
        expect.objectContaining({
          name: 'NotImplementedError',
          message: expect.stringContaining('0036'),
        }),
      );
    });
  });
});
