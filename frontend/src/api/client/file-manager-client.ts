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

/**
 * Raised by an adapter method with no implementation yet for the current
 * milestone; carries the task number that will complete it (spec §12).
 */
export class NotImplementedError extends Error {
  constructor(methodName: string, taskNumber: string) {
    super(
      `${methodName} is not implemented until task ${taskNumber}; see TASKS/${taskNumber}-*.md`,
    );
    this.name = 'NotImplementedError';
  }
}

/**
 * Transport-neutral file manager API (spec §12). Components must depend only
 * on this interface, never on `fetch`, `EventSource` or Tauri's `invoke`
 * directly (spec §3 rule 1).
 */
export interface FileManagerClient {
  getRuntimeCapabilities(signal?: AbortSignal): Promise<RuntimeCapabilities>;

  getWorkspace(workspaceId: WorkspaceId, signal?: AbortSignal): Promise<Workspace>;

  navigatePane(request: NavigateRequest, signal?: AbortSignal): Promise<DirectorySnapshot>;

  listDirectory(request: ListDirectoryRequest, signal?: AbortSignal): Promise<DirectorySnapshot>;

  getEntryMetadata(request: EntryMetadataRequest, signal?: AbortSignal): Promise<EntryMetadata>;

  startOperation(request: StartOperationRequest, signal?: AbortSignal): Promise<Operation>;

  cancelOperation(operationId: OperationId, signal?: AbortSignal): Promise<void>;

  resolveConflict(request: ResolveConflictRequest, signal?: AbortSignal): Promise<void>;

  listActions(signal?: AbortSignal): Promise<ActionDescriptor[]>;

  invokeAction(request: InvokeActionRequest, signal?: AbortSignal): Promise<ActionResult>;

  listPlugins(signal?: AbortSignal): Promise<PluginDescriptor[]>;

  subscribe(listener: (event: BackendEvent) => void): Promise<Unsubscribe>;
}
