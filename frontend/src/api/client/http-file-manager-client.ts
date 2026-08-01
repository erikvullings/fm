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
import { SseEventStream } from '../events/sse-event-stream';
import {
  invokeAction as requestActionInvocation,
  listActions as requestActions,
  resolveOperationConflict as requestConflictResolution,
  listDirectory as requestDirectory,
  getEntryMetadata as requestEntryMetadata,
  navigatePane as requestNavigation,
  cancelOperation as requestOperationCancel,
  pauseOperation as requestOperationPause,
  resumeOperation as requestOperationResume,
  startOperation as requestOperationStart,
  listOperations as requestOperations,
  getRuntimeCapabilities as requestRuntimeCapabilities,
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
import type { SettingsDto } from '../generated/models/settingsDto';
import { type FileManagerClient, NotImplementedError } from './file-manager-client';

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
  private notImplemented(methodName: string, taskNumber: string): never {
    throw new NotImplementedError(`HttpFileManagerClient.${methodName}`, taskNumber);
  }

  async getRuntimeCapabilities(signal?: AbortSignal): Promise<RuntimeCapabilities> {
    const response = await requestRuntimeCapabilities(
      signal !== undefined ? { signal } : undefined,
    );
    return response.data;
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
    return response.data as DirectorySnapshot;
  }

  async listDirectory(
    request: ListDirectoryRequest,
    signal?: AbortSignal,
  ): Promise<DirectorySnapshot> {
    const response = await requestDirectory(request, signal !== undefined ? { signal } : undefined);
    return response.data as DirectorySnapshot;
  }

  async getEntryMetadata(
    request: EntryMetadataRequest,
    signal?: AbortSignal,
  ): Promise<EntryMetadata> {
    const response = await requestEntryMetadata(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    return response.data as EntryMetadata;
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

  listPlugins(_signal?: AbortSignal): Promise<PluginDescriptor[]> {
    return this.notImplemented('listPlugins', '0053');
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
    terminalCommand: settings.terminalCommand ?? null,
  };
}

function settingsToDto(settings: Settings): SettingsDto {
  return {
    ...settings,
    defaultColumns: [...settings.defaultColumns],
    defaultStartLocations: [...settings.defaultStartLocations],
    enabledPlugins: [...settings.enabledPlugins],
    keybindings: { ...settings.keybindings },
    pluginSettings: { ...settings.pluginSettings },
  };
}
