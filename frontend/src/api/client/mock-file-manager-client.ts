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
import { type FileManagerClient, NotImplementedError } from './file-manager-client';

const OWNING_TASK = '0013';

/**
 * In-memory mock transport adapter, used for frontend development and tests
 * without a backend (spec §12, §27). Every method is completed by task
 * {@link OWNING_TASK}; until then each call throws {@link NotImplementedError}.
 */
export class MockFileManagerClient implements FileManagerClient {
  private notImplemented(methodName: string): never {
    throw new NotImplementedError(`MockFileManagerClient.${methodName}`, OWNING_TASK);
  }

  getRuntimeCapabilities(_signal?: AbortSignal): Promise<RuntimeCapabilities> {
    return this.notImplemented('getRuntimeCapabilities');
  }

  getWorkspace(_workspaceId: WorkspaceId, _signal?: AbortSignal): Promise<Workspace> {
    return this.notImplemented('getWorkspace');
  }

  navigatePane(_request: NavigateRequest, _signal?: AbortSignal): Promise<DirectorySnapshot> {
    return this.notImplemented('navigatePane');
  }

  listDirectory(_request: ListDirectoryRequest, _signal?: AbortSignal): Promise<DirectorySnapshot> {
    return this.notImplemented('listDirectory');
  }

  getEntryMetadata(_request: EntryMetadataRequest, _signal?: AbortSignal): Promise<EntryMetadata> {
    return this.notImplemented('getEntryMetadata');
  }

  startOperation(_request: StartOperationRequest, _signal?: AbortSignal): Promise<Operation> {
    return this.notImplemented('startOperation');
  }

  cancelOperation(_operationId: OperationId, _signal?: AbortSignal): Promise<void> {
    return this.notImplemented('cancelOperation');
  }

  resolveConflict(_request: ResolveConflictRequest, _signal?: AbortSignal): Promise<void> {
    return this.notImplemented('resolveConflict');
  }

  listActions(_signal?: AbortSignal): Promise<ActionDescriptor[]> {
    return this.notImplemented('listActions');
  }

  invokeAction(_request: InvokeActionRequest, _signal?: AbortSignal): Promise<ActionResult> {
    return this.notImplemented('invokeAction');
  }

  listPlugins(_signal?: AbortSignal): Promise<PluginDescriptor[]> {
    return this.notImplemented('listPlugins');
  }

  subscribe(_listener: (event: BackendEvent) => void): Promise<Unsubscribe> {
    return this.notImplemented('subscribe');
  }
}
