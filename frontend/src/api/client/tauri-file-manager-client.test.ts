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
