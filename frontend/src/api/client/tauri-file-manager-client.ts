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
  PluginId,
  PluginLogEntry,
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
import type { FileManagerClient } from './file-manager-client';

/**
 * Tauri transport adapter, calling `FileManagerService` through `invoke`
 * (spec §11, §12). Only commands registered on the Rust side (task 0015) are
 * implemented; the rest throw {@link NotImplementedError} naming the task
 * that will add their command, mirroring `HttpFileManagerClient`.
 */
export class TauriFileManagerClient implements FileManagerClient {
  private readonly eventStream = new TauriEventStream();
  readonly connection = this.eventStream.status;

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

  startOperation(request: StartOperationRequest, _signal?: AbortSignal): Promise<Operation> {
    return invoke<Operation>('start_operation', { request });
  }

  listOperations(_signal?: AbortSignal): Promise<Operation[]> {
    return invoke<Operation[]>('list_operations');
  }

  async cancelOperation(operationId: OperationId, _signal?: AbortSignal): Promise<void> {
    await invoke('cancel_operation', { operationId });
  }

  async pauseOperation(operationId: OperationId, _signal?: AbortSignal): Promise<void> {
    await invoke('pause_operation', { operationId });
  }

  async resumeOperation(operationId: OperationId, _signal?: AbortSignal): Promise<void> {
    await invoke('resume_operation', { operationId });
  }

  async resolveConflict(request: ResolveConflictRequest, _signal?: AbortSignal): Promise<void> {
    await invoke('resolve_operation_conflict', { request });
  }

  listActions(_signal?: AbortSignal): Promise<ActionDescriptor[]> {
    return invoke<ActionDescriptor[]>('list_actions');
  }

  invokeAction(request: InvokeActionRequest, _signal?: AbortSignal): Promise<ActionResult> {
    return invoke<ActionResult>('invoke_action', {
      actionId: request.actionId,
      request: { parameters: request.parameters, context: request.context },
    });
  }

  listPlugins(_signal?: AbortSignal): Promise<PluginDescriptor[]> {
    return invoke<PluginDescriptor[]>('list_plugins');
  }

  async setPluginEnabled(
    pluginId: PluginId,
    enabled: boolean,
    _signal?: AbortSignal,
  ): Promise<void> {
    await invoke(enabled ? 'enable_plugin' : 'disable_plugin', { pluginId });
  }

  getPluginLogs(pluginId: PluginId, _signal?: AbortSignal): Promise<PluginLogEntry[]> {
    return invoke<PluginLogEntry[]>('get_plugin_logs', { pluginId });
  }

  /** TODO(0034): full EventBus → Tauri channel parity; connects the minimal skeleton for now. */
  async subscribe(listener: (event: BackendEvent) => void): Promise<Unsubscribe> {
    const unsubscribeListener = this.eventStream.listeners.subscribe(listener);
    await this.eventStream.connect();
    return () => {
      unsubscribeListener();
    };
  }

  onResynchronise(listener: () => void): Unsubscribe {
    return this.eventStream.resynchronise.subscribe(listener);
  }

  disconnect(): void {
    this.eventStream.close();
  }
}
