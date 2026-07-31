import { invoke } from '@tauri-apps/api/core';

import type {
  ActionDescriptor,
  ActionResult,
  BackendEvent,
  CreateWorkspaceRequest,
  DirectorySnapshot,
  EntryMetadata,
  EntryMetadataRequest,
  InvokeActionRequest,
  ListDirectoryRequest,
  NavigateRequest,
  Operation,
  OperationId,
  PluginDescriptor,
  ResolveConflictRequest,
  RuntimeCapabilities,
  Settings,
  StartOperationRequest,
  Unsubscribe,
  WorkspaceCommand,
  WorkspaceId,
  WorkspaceProjection,
  WorkspaceSummary,
} from '../../models';
import { workspaceProjectionFromDto } from '../../models/workspace';
import { TauriEventStream } from '../events/tauri-event-stream';
import type { WorkspaceDto } from '../generated/models/workspaceDto';
import { type FileManagerClient, NotImplementedError } from './file-manager-client';

/**
 * Tauri transport adapter, calling `FileManagerService` through `invoke`
 * (spec §11, §12). Only commands registered on the Rust side (task 0015) are
 * implemented; the rest throw {@link NotImplementedError} naming the task
 * that will add their command, mirroring `HttpFileManagerClient`.
 */
export class TauriFileManagerClient implements FileManagerClient {
  private readonly eventStream = new TauriEventStream();

  private notImplemented(methodName: string, taskNumber: string): never {
    throw new NotImplementedError(`TauriFileManagerClient.${methodName}`, taskNumber);
  }

  async getRuntimeCapabilities(_signal?: AbortSignal): Promise<RuntimeCapabilities> {
    return invoke<RuntimeCapabilities>('get_runtime_capabilities');
  }

  getSettings(_signal?: AbortSignal): Promise<Settings> {
    return invoke<Settings>('get_settings');
  }

  updateSettings(settings: Settings, _signal?: AbortSignal): Promise<Settings> {
    return invoke<Settings>('update_settings', { settings });
  }

  listWorkspaces(_signal?: AbortSignal): Promise<WorkspaceSummary[]> {
    return invoke<WorkspaceSummary[]>('list_workspaces');
  }

  async createWorkspace(
    request: CreateWorkspaceRequest,
    _signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    return workspaceProjectionFromDto(await invoke<WorkspaceDto>('create_workspace', { request }));
  }

  async getWorkspace(
    workspaceId: WorkspaceId,
    _signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    return workspaceProjectionFromDto(await invoke<WorkspaceDto>('get_workspace', { workspaceId }));
  }

  renameWorkspace(
    workspaceId: WorkspaceId,
    name: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    return this.dispatchWorkspaceCommand(
      { type: 'renameWorkspace', workspaceId, name, expectedRevision },
      signal,
    );
  }

  async deleteWorkspace(
    workspaceId: WorkspaceId,
    expectedRevision?: number,
    _signal?: AbortSignal,
  ): Promise<void> {
    await invoke('delete_workspace', { workspaceId, expectedRevision });
  }

  async openWorkspace(
    workspaceId: WorkspaceId,
    _signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    return workspaceProjectionFromDto(
      await invoke<WorkspaceDto>('open_workspace', { workspaceId }),
    );
  }

  async dispatchWorkspaceCommand(
    command: WorkspaceCommand,
    _signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    return workspaceProjectionFromDto(
      await invoke<WorkspaceDto>('apply_workspace_command', { command }),
    );
  }

  navigatePane(request: NavigateRequest, _signal?: AbortSignal): Promise<DirectorySnapshot> {
    return invoke<DirectorySnapshot>('navigate_pane', { request });
  }

  listDirectory(request: ListDirectoryRequest, _signal?: AbortSignal): Promise<DirectorySnapshot> {
    return invoke<DirectorySnapshot>('list_directory', { request });
  }

  getEntryMetadata(request: EntryMetadataRequest, _signal?: AbortSignal): Promise<EntryMetadata> {
    return invoke<EntryMetadata>('get_entry_metadata', { request });
  }

  startOperation(_request: StartOperationRequest, _signal?: AbortSignal): Promise<Operation> {
    return this.notImplemented('startOperation', '0036');
  }

  cancelOperation(_operationId: OperationId, _signal?: AbortSignal): Promise<void> {
    return this.notImplemented('cancelOperation', '0036');
  }

  resolveConflict(_request: ResolveConflictRequest, _signal?: AbortSignal): Promise<void> {
    return this.notImplemented('resolveConflict', '0036');
  }

  listActions(_signal?: AbortSignal): Promise<ActionDescriptor[]> {
    return this.notImplemented('listActions', '0049');
  }

  invokeAction(_request: InvokeActionRequest, _signal?: AbortSignal): Promise<ActionResult> {
    return this.notImplemented('invokeAction', '0049');
  }

  listPlugins(_signal?: AbortSignal): Promise<PluginDescriptor[]> {
    return this.notImplemented('listPlugins', '0053');
  }

  /** TODO(0034): full EventBus → Tauri channel parity; connects the minimal skeleton for now. */
  async subscribe(listener: (event: BackendEvent) => void): Promise<Unsubscribe> {
    const unsubscribeListener = this.eventStream.listeners.subscribe(listener);
    await this.eventStream.connect();
    return () => {
      unsubscribeListener();
    };
  }
}
