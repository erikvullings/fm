import type {
  ActionDescriptor,
  ActionResult,
  ArchiveCredentialRequest,
  BackendEvent,
  CreateWorkspaceRequest,
  DirectorySnapshot,
  EntryMetadata,
  EntryMetadataRequest,
  FileRangeChunk,
  InvokeActionRequest,
  ListDirectoryRequest,
  Location as FileLocation,
  NavigateRequest,
  Operation,
  OperationId,
  PluginDescriptor,
  PluginIconTheme,
  PluginId,
  PluginLogEntry,
  ReadFileRangeRequest,
  ResolveConflictRequest,
  RuntimeCapabilities,
  SearchInFileRequest,
  SearchInFileResult,
  Settings,
  StartOperationRequest,
  StartSearchRequest,
  StartSearchResult,
  Unsubscribe,
  WorkspaceCommand,
  WorkspaceId,
  WorkspaceProjection,
  WorkspaceSummary,
} from '../../models';
import { entryMetadataFromDto } from '../../models/entry';
import { directorySnapshotFromDto } from '../../models/snapshot';
import { workspaceProjectionFromDto } from '../../models/workspace';
import { SseEventStream } from '../events/sse-event-stream';
import {
  invokeAction as requestActionInvocation,
  listActions as requestActions,
  cacheArchivePassword as requestArchivePasswordCache,
  resolveOperationConflict as requestConflictResolution,
  listDirectory as requestDirectory,
  getEntryMetadata as requestEntryMetadata,
  getFileIcon as requestFileIcon,
  navigatePane as requestNavigation,
  cancelOperation as requestOperationCancel,
  pauseOperation as requestOperationPause,
  resumeOperation as requestOperationResume,
  startOperation as requestOperationStart,
  listOperations as requestOperations,
  disablePlugin as requestPluginDisable,
  enablePlugin as requestPluginEnable,
  getPluginIconThemeAsset as requestPluginIconThemeAsset,
  getPluginLogs as requestPluginLogs,
  listPlugins as requestPlugins,
  readFileRange as requestReadFileRange,
  getRuntimeCapabilities as requestRuntimeCapabilities,
  cancelSearch as requestSearchCancel,
  searchInFile as requestSearchInFile,
  startSearch as requestSearchStart,
  getSettings as requestSettings,
  updateSettings as requestSettingsUpdate,
  getWorkspace as requestWorkspace,
  applyWorkspaceCommand as requestWorkspaceCommand,
  createWorkspace as requestWorkspaceCreation,
  deleteWorkspace as requestWorkspaceDeletion,
  openWorkspace as requestWorkspaceOpen,
  listWorkspaces as requestWorkspaces,
} from '../generated/file-manager-api';
import type { ActionDescriptorDto } from '../generated/models/actionDescriptorDto';
import type { InvokeActionRequestDtoParameters } from '../generated/models/invokeActionRequestDtoParameters';
import type { OperationDto } from '../generated/models/operationDto';
import type { PluginIconThemeDto } from '../generated/models/pluginIconThemeDto';
import type { SettingsDto } from '../generated/models/settingsDto';
import type { FileManagerClient } from './file-manager-client';

/**
 * HTTP transport adapter, wrapping the Orval-generated client behind
 * `FileManagerClient` (spec §12). Only methods with a generated endpoint are
 * implemented; the rest throw {@link NotImplementedError} naming the backend
 * task that will add their endpoint (mirrors the stub from task 0011).
 * `RuntimeCapabilitiesDto`/`RuntimeCapabilities` are the same type (see
 * `models/runtime-capabilities.ts`), so no DTO mapping step is needed there;
 * once further endpoints land, keep any real DTO → model mapping in one
 * shared module so the Tauri/mock adapters can reuse it.
 */
export class HttpFileManagerClient implements FileManagerClient {
  private readonly eventStream = new SseEventStream();
  readonly connection = this.eventStream.status;

  async cacheArchivePassword(
    request: ArchiveCredentialRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await requestArchivePasswordCache(
      request,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204) {
      throw new Error(`Unexpected cacheArchivePassword response status: ${response.status}`);
    }
  }
  async getRuntimeCapabilities(signal?: AbortSignal): Promise<RuntimeCapabilities> {
    const response = await requestRuntimeCapabilities(
      signal !== undefined ? { signal } : undefined,
    );
    return response.data;
  }

  async getFileIcon(
    sampleLocationUri: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array | undefined> {
    try {
      const response = await requestFileIcon(
        { uri: sampleLocationUri },
        signal === undefined ? undefined : { signal },
      );
      if (response.status !== 200) return undefined;
      return new Uint8Array(await response.data.arrayBuffer());
    } catch {
      return undefined;
    }
  }

  async getSettings(signal?: AbortSignal): Promise<Settings> {
    return settingsFromDto(
      (await requestSettings(signal === undefined ? undefined : { signal })).data,
    );
  }

  async updateSettings(settings: Settings, signal?: AbortSignal): Promise<Settings> {
    const response = await requestSettingsUpdate(
      settingsToDto(settings),
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected updateSettings response status: ${response.status}`);
    }
    return settingsFromDto(response.data);
  }

  async listWorkspaces(signal?: AbortSignal): Promise<WorkspaceSummary[]> {
    const response = await requestWorkspaces(signal === undefined ? undefined : { signal });
    return response.data;
  }

  async createWorkspace(
    request: CreateWorkspaceRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    const response = await requestWorkspaceCreation(
      request,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 201) {
      throw new Error(`Unexpected createWorkspace response status: ${response.status}`);
    }
    return workspaceProjectionFromDto(response.data);
  }

  async getWorkspace(workspaceId: WorkspaceId, signal?: AbortSignal): Promise<WorkspaceProjection> {
    const response = await requestWorkspace(
      workspaceId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected getWorkspace response status: ${response.status}`);
    }
    return workspaceProjectionFromDto(response.data);
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
    signal?: AbortSignal,
  ): Promise<void> {
    await requestWorkspaceDeletion(
      workspaceId,
      expectedRevision === undefined ? undefined : { expectedRevision },
      signal === undefined ? undefined : { signal },
    );
  }

  async openWorkspace(
    workspaceId: WorkspaceId,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    const response = await requestWorkspaceOpen(
      workspaceId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected openWorkspace response status: ${response.status}`);
    }
    return workspaceProjectionFromDto(response.data);
  }

  async dispatchWorkspaceCommand(
    command: WorkspaceCommand,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    const response = await requestWorkspaceCommand(
      command.workspaceId,
      command,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected applyWorkspaceCommand response status: ${response.status}`);
    }
    return workspaceProjectionFromDto(response.data);
  }

  async navigatePane(request: NavigateRequest, signal?: AbortSignal): Promise<DirectorySnapshot> {
    const response = await requestNavigation(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected navigatePane response status: ${response.status}`);
    }
    return directorySnapshotFromDto(response.data);
  }

  async listDirectory(
    request: ListDirectoryRequest,
    signal?: AbortSignal,
  ): Promise<DirectorySnapshot> {
    const response = await requestDirectory(request, signal !== undefined ? { signal } : undefined);
    if (response.status !== 200) {
      throw new Error(`Unexpected listDirectory response status: ${response.status}`);
    }
    return directorySnapshotFromDto(response.data);
  }

  async getEntryMetadata(
    request: EntryMetadataRequest,
    signal?: AbortSignal,
  ): Promise<EntryMetadata> {
    const response = await requestEntryMetadata(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected getEntryMetadata response status: ${response.status}`);
    }
    return entryMetadataFromDto(response.data);
  }

  async readFileRange(
    request: ReadFileRangeRequest,
    signal?: AbortSignal,
  ): Promise<FileRangeChunk> {
    const response = await requestReadFileRange(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected readFileRange response status: ${response.status}`);
    }
    return response.data;
  }

  async searchInFile(
    request: SearchInFileRequest,
    signal?: AbortSignal,
  ): Promise<SearchInFileResult> {
    const response = await requestSearchInFile(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected searchInFile response status: ${response.status}`);
    }
    return response.data;
  }

  async startOperation(request: StartOperationRequest, signal?: AbortSignal): Promise<Operation> {
    const response = await requestOperationStart(
      { ...request, sources: [...request.sources] },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 201) {
      throw new Error(`Unexpected startOperation response status: ${response.status}`);
    }
    return operationFromDto(response.data);
  }

  async listOperations(signal?: AbortSignal): Promise<Operation[]> {
    const response = await requestOperations(
      undefined,
      signal === undefined ? undefined : { signal },
    );
    return response.data.operations.map(operationFromDto);
  }

  async cancelOperation(operationId: OperationId, signal?: AbortSignal): Promise<void> {
    const response = await requestOperationCancel(
      operationId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected cancelOperation response status: ${response.status}`);
  }

  async pauseOperation(operationId: OperationId, signal?: AbortSignal): Promise<void> {
    const response = await requestOperationPause(
      operationId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected pauseOperation response status: ${response.status}`);
  }

  async resumeOperation(operationId: OperationId, signal?: AbortSignal): Promise<void> {
    const response = await requestOperationResume(
      operationId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected resumeOperation response status: ${response.status}`);
  }

  async resolveConflict(request: ResolveConflictRequest, signal?: AbortSignal): Promise<void> {
    const response = await requestConflictResolution(
      request.operationId,
      { resolution: request.resolution, applyToAllSimilar: request.applyToAllSimilar },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected resolveConflict response status: ${response.status}`);
  }

  async startSearch(request: StartSearchRequest, signal?: AbortSignal): Promise<StartSearchResult> {
    const response = await requestSearchStart(
      { query: request.query, roots: [...request.roots], workspaceId: request.workspaceId },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 201) {
      throw new Error(`Unexpected startSearch response status: ${response.status}`);
    }
    return { searchId: response.data.searchId, location: response.data.location };
  }

  async cancelSearch(searchId: string, signal?: AbortSignal): Promise<void> {
    const response = await requestSearchCancel(
      searchId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected cancelSearch response status: ${response.status}`);
  }

  listActions(signal?: AbortSignal): Promise<ActionDescriptor[]> {
    return requestActions(signal === undefined ? undefined : { signal }).then((response) =>
      response.data.map(actionFromDto),
    );
  }

  async invokeAction(request: InvokeActionRequest, signal?: AbortSignal): Promise<ActionResult> {
    const response = await requestActionInvocation(
      request.actionId,
      {
        parameters: (request.parameters ?? null) as InvokeActionRequestDtoParameters,
        context: request.context,
      },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected invokeAction response status: ${response.status}`);
    }
    return {
      actionId: response.data.actionId,
      invoked: response.data.invoked,
      ...(response.data.operationId == null ? {} : { operationId: response.data.operationId }),
    };
  }

  async listPlugins(signal?: AbortSignal): Promise<PluginDescriptor[]> {
    const response = await requestPlugins(signal === undefined ? undefined : { signal });
    if (response.status !== 200)
      throw new Error(`Unexpected listPlugins response status: ${response.status}`);
    return response.data.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      enabled: plugin.enabled,
      ...(plugin.diagnostic == null ? {} : { diagnostic: plugin.diagnostic }),
      ...(plugin.columns === undefined ? {} : { columns: plugin.columns }),
      ...(plugin.iconTheme == null ? {} : { iconTheme: pluginIconThemeFromDto(plugin.iconTheme) }),
      permissions: {
        selectedEntryMetadata: plugin.permissions.selectedEntryMetadata,
        selectedEntryContentRead: plugin.permissions.selectedEntryContentRead,
        filesystemRead: plugin.permissions.filesystemRead,
        filesystemWrite: plugin.permissions.filesystemWrite,
        clipboardRead: plugin.permissions.clipboardRead,
        clipboardWrite: plugin.permissions.clipboardWrite,
        network: plugin.permissions.network,
        processSpawn: plugin.permissions.processSpawn,
        notifications: plugin.permissions.notifications,
        settingsStorage: plugin.permissions.settingsStorage,
      },
    }));
  }

  async setPluginEnabled(
    pluginId: PluginId,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const options = signal === undefined ? undefined : { signal };
    const response = enabled
      ? await requestPluginEnable(pluginId, options)
      : await requestPluginDisable(pluginId, options);
    if (response.status !== 204)
      throw new Error(`Unexpected setPluginEnabled response status: ${response.status}`);
  }

  async getPluginLogs(pluginId: PluginId, signal?: AbortSignal): Promise<PluginLogEntry[]> {
    const response = await requestPluginLogs(
      pluginId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200)
      throw new Error(`Unexpected getPluginLogs response status: ${response.status}`);
    return response.data.map((entry) => ({ message: entry.message }));
  }

  async getPluginIconThemeAsset(
    pluginId: PluginId,
    assetPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await requestPluginIconThemeAsset(
      pluginId,
      { path: assetPath },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200)
      throw new Error(`Unexpected getPluginIconThemeAsset response status: ${response.status}`);
    return response.data;
  }

  async subscribe(listener: (event: BackendEvent) => void): Promise<Unsubscribe> {
    const unsubscribe = this.eventStream.listeners.subscribe(listener);
    await this.eventStream.connect();
    return unsubscribe;
  }

  onResynchronise(listener: () => void): Unsubscribe {
    return this.eventStream.resynchronise.subscribe(listener);
  }

  disconnect(): void {
    this.eventStream.close();
  }
}

function pluginIconThemeFromDto(dto: PluginIconThemeDto): PluginIconTheme {
  return {
    iconDefinitions: dto.iconDefinitions,
    ...(dto.file == null ? {} : { file: dto.file }),
    ...(dto.folder == null ? {} : { folder: dto.folder }),
    ...(dto.symlink == null ? {} : { symlink: dto.symlink }),
    fileExtensions: dto.fileExtensions,
    mimePrefixes: dto.mimePrefixes,
  };
}

function operationFromDto(dto: OperationDto): Operation {
  return {
    id: dto.id,
    kind: dto.type,
    state: dto.state,
    sources: dto.sources,
    ...(dto.destination == null ? {} : { destination: dto.destination }),
    progress: {
      completedItems: dto.progress.completedItems,
      completedBytes: dto.progress.completedBytes,
      ...(dto.progress.totalItems == null ? {} : { totalItems: dto.progress.totalItems }),
      ...(dto.progress.totalBytes == null ? {} : { totalBytes: dto.progress.totalBytes }),
      ...(dto.progress.currentEntry == null ? {} : { currentEntry: dto.progress.currentEntry }),
      ...(dto.progress.bytesPerSecond == null
        ? {}
        : { bytesPerSecond: dto.progress.bytesPerSecond }),
    },
    conflictPolicy: dto.conflictPolicy,
    createdAt: dto.createdAt,
    ...(dto.startedAt == null ? {} : { startedAt: dto.startedAt }),
    ...(dto.completedAt == null ? {} : { completedAt: dto.completedAt }),
    ...(dto.queuePosition == null ? {} : { queuePosition: dto.queuePosition }),
    ...(dto.resultSummary == null ? {} : { result: { message: dto.resultSummary } }),
  };
}

function actionFromDto(dto: ActionDescriptorDto): ActionDescriptor {
  return {
    id: dto.id,
    title: dto.title,
    ...(dto.description == null ? {} : { description: dto.description }),
    category: dto.category,
    defaultShortcuts: dto.defaultShortcuts ?? [],
    contextRequirements: { ...dto.contextRequirements },
    ...(dto.parameterSchema == null ? {} : { parameterSchema: dto.parameterSchema }),
    source:
      dto.source.kind === 'plugin'
        ? { kind: 'plugin', pluginId: dto.source.pluginId }
        : { kind: 'core' },
  };
}

function settingsFromDto(settings: SettingsDto): Settings {
  return {
    ...settings,
    favouriteLocations: settings.favouriteLocations.map((favourite) => ({
      ...favourite,
      location: { ...favourite.location },
    })),
    recentLocationsByWorkspace: Object.fromEntries(
      Object.entries(settings.recentLocationsByWorkspace).map(([workspaceId, locations]) => [
        workspaceId,
        Array.isArray(locations)
          ? locations.map((location): FileLocation => ({
              providerId: String((location as { providerId?: unknown }).providerId),
              uri: String((location as { uri?: unknown }).uri),
            }))
          : [],
      ]),
    ),
    terminalCommand: settings.terminalCommand ?? null,
    editorCommand: settings.editorCommand ?? null,
  };
}

function settingsToDto(settings: Settings): SettingsDto {
  return {
    ...settings,
    defaultColumns: [...settings.defaultColumns],
    defaultStartLocations: [...settings.defaultStartLocations],
    enabledPlugins: [...settings.enabledPlugins],
    favouriteLocations: settings.favouriteLocations.map((favourite) => ({
      ...favourite,
      location: { ...favourite.location },
    })),
    keybindings: { ...settings.keybindings },
    pluginSettings: { ...settings.pluginSettings },
    recentLocationsByWorkspace: Object.fromEntries(
      Object.entries(settings.recentLocationsByWorkspace).map(([workspaceId, locations]) => [
        workspaceId,
        locations.map((location) => ({ ...location })),
      ]),
    ),
  };
}
