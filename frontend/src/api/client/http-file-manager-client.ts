import type {
  ActionDescriptor,
  ActionResult,
  BackendEvent,
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
  Workspace,
  WorkspaceId,
} from '../../models';
import { getRuntimeCapabilities as requestRuntimeCapabilities } from '../generated/file-manager-api';
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

  // No task currently owns `GET /api/v1/workspaces/{workspaceId}` (spec §8 lists it,
  // but no TASKS/*.md claims it yet) — flagged as a known gap rather than guessed at.
  getWorkspace(_workspaceId: WorkspaceId, _signal?: AbortSignal): Promise<Workspace> {
    return this.notImplemented('getWorkspace', 'TBD');
  }

  navigatePane(_request: NavigateRequest, _signal?: AbortSignal): Promise<DirectorySnapshot> {
    return this.notImplemented('navigatePane', '0019');
  }

  listDirectory(_request: ListDirectoryRequest, _signal?: AbortSignal): Promise<DirectorySnapshot> {
    return this.notImplemented('listDirectory', '0019');
  }

  getEntryMetadata(_request: EntryMetadataRequest, _signal?: AbortSignal): Promise<EntryMetadata> {
    return this.notImplemented('getEntryMetadata', '0019');
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
