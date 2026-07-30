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
  StartOperationRequest,
  Unsubscribe,
  WorkspaceCommand,
  WorkspaceId,
  WorkspaceProjection,
  WorkspaceSummary,
} from '../../models';
import { workspaceProjectionFromDto } from '../../models/workspace';
import {
  listDirectory as requestDirectory,
  getEntryMetadata as requestEntryMetadata,
  navigatePane as requestNavigation,
  getRuntimeCapabilities as requestRuntimeCapabilities,
  getWorkspace as requestWorkspace,
  applyWorkspaceCommand as requestWorkspaceCommand,
  createWorkspace as requestWorkspaceCreation,
  deleteWorkspace as requestWorkspaceDeletion,
  openWorkspace as requestWorkspaceOpen,
  listWorkspaces as requestWorkspaces,
} from '../generated/file-manager-api';
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
  private notImplemented(methodName: string, taskNumber: string): never {
    throw new NotImplementedError(`HttpFileManagerClient.${methodName}`, taskNumber);
  }

  async getRuntimeCapabilities(signal?: AbortSignal): Promise<RuntimeCapabilities> {
    const response = await requestRuntimeCapabilities(
      signal !== undefined ? { signal } : undefined,
    );
    return response.data;
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

  /** TODO(0033): delegate to the SSE event stream; a no-op unsubscribe until then. */
  async subscribe(_listener: (event: BackendEvent) => void): Promise<Unsubscribe> {
    return () => {};
  }
}
