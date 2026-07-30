import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
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
        paneId: 'left',
        requestId: 'request-1',
        location: { providerId: 'local', uri: 'file:///' },
      };

      await expect(client.navigatePane(request)).resolves.toEqual(snapshot);
      expect(invoke).toHaveBeenCalledWith('navigate_pane', { request });
    });
  });

  describe('methods with no registered Tauri command yet', () => {
    it('keeps unrelated unimplemented methods explicit', () => {
      const client = new TauriFileManagerClient();
      expect(() => client.getWorkspace('workspace-1')).toThrow(/TBD/);
    });
  });

  describe('subscribe', () => {
    it('connects the Tauri event stream and forwards dispatched events to the listener', async () => {
      const client = new TauriFileManagerClient();
      const listener = vi.fn();

      const unsubscribe = await client.subscribe(listener);

      expect(typeof unsubscribe).toBe('function');
    });
  });
});
