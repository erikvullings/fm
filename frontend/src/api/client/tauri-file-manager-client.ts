import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import type {
  ActionDescriptor,
  ActionResult,
  ArchiveCredentialRequest,
  BackendEvent,
  Connection,
  ConnectionId,
  CreateConnectionRequest,
  CreateWorkspaceRequest,
  DirectorySnapshot,
  EditableFile,
  EditableFileSave,
  EntryMetadata,
  EntryMetadataRequest,
  FileRangeChunk,
  HostKeyProbe,
  InvokeActionRequest,
  ListDirectoryRequest,
  LoadEditableFileRequest,
  Location,
  NavigateRequest,
  Operation,
  OperationId,
  PluginDescriptor,
  PluginId,
  PluginLogEntry,
  ReadFileRangeRequest,
  ResolveConflictRequest,
  RuntimeCapabilities,
  SaveEditableFileRequest,
  SearchInFileRequest,
  SearchInFileResult,
  Settings,
  StartOperationRequest,
  StartSearchRequest,
  StartSearchResult,
  SystemLocation,
  Unsubscribe,
  UpdateConnectionRequest,
  WorkspaceCommand,
  WorkspaceId,
  WorkspaceProjection,
  WorkspaceSummary,
} from '../../models';
import { entryMetadataFromDto } from '../../models/entry';
import { directorySnapshotFromDto } from '../../models/snapshot';
import { workspaceProjectionFromDto } from '../../models/workspace';
import { TauriEventStream } from '../events/tauri-event-stream';
import type { DirectorySnapshotDto } from '../generated/models/directorySnapshotDto';
import type { EntryMetadataDto } from '../generated/models/entryMetadataDto';
import type { WorkspaceDto } from '../generated/models/workspaceDto';
import type { FileManagerClient, NativeFileDrop } from './file-manager-client';

/**
 * Tauri transport adapter, calling `FileManagerService` through `invoke`
 * (spec §11, §12). Only commands registered on the Rust side (task 0015) are
 * implemented; the rest throw {@link NotImplementedError} naming the task
 * that will add their command, mirroring `HttpFileManagerClient`.
 */
export class TauriFileManagerClient implements FileManagerClient {
  private readonly eventStream = new TauriEventStream();
  readonly connection = this.eventStream.status;

  cacheArchivePassword(request: ArchiveCredentialRequest, _signal?: AbortSignal): Promise<void> {
    return invoke<void>('cache_archive_password', { request });
  }

  async getRuntimeCapabilities(_signal?: AbortSignal): Promise<RuntimeCapabilities> {
    return invoke<RuntimeCapabilities>('get_runtime_capabilities');
  }

  async getSystemLocations(_signal?: AbortSignal): Promise<SystemLocation[]> {
    return invoke<SystemLocation[]>('get_system_locations');
  }

  startNativeDrag(locations: readonly Location[], _signal?: AbortSignal): Promise<void> {
    return invoke<void>('start_native_drag', { locations });
  }

  async quit(): Promise<void> {
    await getCurrentWindow().close();
  }

  subscribeNativeFileDrops(listener: (drop: NativeFileDrop) => void): Promise<Unsubscribe> {
    return getCurrentWindow().onDragDropEvent(async ({ payload }) => {
      if (payload.type !== 'drop') return;
      const locations = await invoke<Location[]>('native_drag_locations', {
        paths: payload.paths,
      });
      listener({ locations, position: payload.position });
    });
  }

  async getFileIcon(
    sampleLocationUri: string,
    _signal?: AbortSignal,
  ): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await invoke<number[]>('get_file_icon', { uri: sampleLocationUri }));
    } catch {
      return undefined;
    }
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
    return workspaceProjectionFromDto(
      await invoke<WorkspaceDto>('get_workspace', { workspaceId }),
      {
        redirectSessionOnlyTabs: true,
      },
    );
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
      {
        redirectSessionOnlyTabs: true,
      },
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

  async navigatePane(request: NavigateRequest, _signal?: AbortSignal): Promise<DirectorySnapshot> {
    return directorySnapshotFromDto(
      await invoke<DirectorySnapshotDto>('navigate_pane', { request }),
    );
  }

  async listDirectory(
    request: ListDirectoryRequest,
    _signal?: AbortSignal,
  ): Promise<DirectorySnapshot> {
    return directorySnapshotFromDto(
      await invoke<DirectorySnapshotDto>('list_directory', { request }),
    );
  }

  async getEntryMetadata(
    request: EntryMetadataRequest,
    _signal?: AbortSignal,
  ): Promise<EntryMetadata> {
    return entryMetadataFromDto(await invoke<EntryMetadataDto>('get_entry_metadata', { request }));
  }

  readFileRange(request: ReadFileRangeRequest, _signal?: AbortSignal): Promise<FileRangeChunk> {
    return invoke<FileRangeChunk>('read_file_range', { request });
  }

  loadEditableFile(request: LoadEditableFileRequest, _signal?: AbortSignal): Promise<EditableFile> {
    return invoke<EditableFile>('load_editable_file', { request });
  }

  saveEditableFile(
    request: SaveEditableFileRequest,
    _signal?: AbortSignal,
  ): Promise<EditableFileSave> {
    return invoke<EditableFileSave>('save_editable_file', { request });
  }

  searchInFile(request: SearchInFileRequest, _signal?: AbortSignal): Promise<SearchInFileResult> {
    return invoke<SearchInFileResult>('search_in_file', { request });
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
    await invoke('resolve_operation_conflict', {
      operationId: request.operationId,
      request: {
        resolution: request.resolution,
        applyToAllSimilar: request.applyToAllSimilar,
      },
    });
  }

  startSearch(request: StartSearchRequest, _signal?: AbortSignal): Promise<StartSearchResult> {
    return invoke<StartSearchResult>('start_search', { request });
  }

  async cancelSearch(searchId: string, _signal?: AbortSignal): Promise<void> {
    await invoke('cancel_search', { searchId });
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

  getPluginIconThemeAsset(
    pluginId: PluginId,
    assetPath: string,
    _signal?: AbortSignal,
  ): Promise<string> {
    return invoke<string>('get_plugin_icon_theme_asset', { pluginId, path: assetPath });
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

  listConnections(_signal?: AbortSignal): Promise<Connection[]> {
    return invoke<Connection[]>('list_connections');
  }

  createConnection(request: CreateConnectionRequest, _signal?: AbortSignal): Promise<Connection> {
    return invoke<Connection>('create_connection', { request });
  }

  getConnection(connectionId: ConnectionId, _signal?: AbortSignal): Promise<Connection> {
    return invoke<Connection>('get_connection', { connectionId });
  }

  updateConnection(
    connectionId: ConnectionId,
    request: UpdateConnectionRequest,
    _signal?: AbortSignal,
  ): Promise<Connection> {
    return invoke<Connection>('update_connection', { connectionId, request });
  }

  async deleteConnection(connectionId: ConnectionId, _signal?: AbortSignal): Promise<void> {
    await invoke('delete_connection', { connectionId });
  }

  connectConnection(connectionId: ConnectionId, _signal?: AbortSignal): Promise<Connection> {
    return invoke<Connection>('connect_connection', { connectionId });
  }

  disconnectConnection(connectionId: ConnectionId, _signal?: AbortSignal): Promise<Connection> {
    return invoke<Connection>('disconnect_connection', { connectionId });
  }

  testConnection(connectionId: ConnectionId, _signal?: AbortSignal): Promise<Connection> {
    return invoke<Connection>('test_connection', { connectionId });
  }

  probeSshHostKey(connectionId: ConnectionId, _signal?: AbortSignal): Promise<HostKeyProbe> {
    return invoke<HostKeyProbe>('probe_ssh_host_key', { connectionId });
  }

  async acceptSshHostKey(
    connectionId: ConnectionId,
    fingerprint: string,
    _signal?: AbortSignal,
  ): Promise<void> {
    await invoke('accept_ssh_host_key', { connectionId, request: { fingerprint } });
  }
}
