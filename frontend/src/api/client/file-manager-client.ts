import type {
  ActionDescriptor,
  ActionResult,
  ArchiveCredentialRequest,
  BackendEvent,
  CreateWorkspaceRequest,
  DirectorySnapshot,
  EditableFile,
  EditableFileSave,
  EntryMetadata,
  EntryMetadataRequest,
  FileRangeChunk,
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
  Unsubscribe,
  WorkspaceCommand,
  WorkspaceId,
  WorkspaceProjection,
  WorkspaceSummary,
} from '../../models';
import type { EventStreamStatusObservable } from '../events/event-stream';

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

/** A native file-reference drop reported by the desktop window. */
export interface NativeFileDrop {
  readonly locations: readonly Location[];
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * Transport-neutral file manager API (spec §12). Components must depend only
 * on this interface, never on `fetch`, `EventSource` or Tauri's `invoke`
 * directly (spec §3 rule 1).
 */
export interface FileManagerClient {
  readonly connection: EventStreamStatusObservable;
  getRuntimeCapabilities(signal?: AbortSignal): Promise<RuntimeCapabilities>;

  /** Starts an OS file-reference drag from the desktop host. */
  startNativeDrag(locations: readonly Location[], signal?: AbortSignal): Promise<void>;

  /** Subscribes to Finder/Explorer file drops over the desktop window. */
  subscribeNativeFileDrops(listener: (drop: NativeFileDrop) => void): Promise<Unsubscribe>;

  getSettings(signal?: AbortSignal): Promise<Settings>;

  updateSettings(settings: Settings, signal?: AbortSignal): Promise<Settings>;

  listWorkspaces(signal?: AbortSignal): Promise<WorkspaceSummary[]>;

  createWorkspace(
    request: CreateWorkspaceRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection>;

  getWorkspace(workspaceId: WorkspaceId, signal?: AbortSignal): Promise<WorkspaceProjection>;

  renameWorkspace(
    workspaceId: WorkspaceId,
    name: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection>;

  deleteWorkspace(
    workspaceId: WorkspaceId,
    expectedRevision?: number,
    signal?: AbortSignal,
  ): Promise<void>;

  openWorkspace(workspaceId: WorkspaceId, signal?: AbortSignal): Promise<WorkspaceProjection>;

  dispatchWorkspaceCommand(
    command: WorkspaceCommand,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection>;

  navigatePane(request: NavigateRequest, signal?: AbortSignal): Promise<DirectorySnapshot>;

  listDirectory(request: ListDirectoryRequest, signal?: AbortSignal): Promise<DirectorySnapshot>;

  getEntryMetadata(request: EntryMetadataRequest, signal?: AbortSignal): Promise<EntryMetadata>;

  cacheArchivePassword(request: ArchiveCredentialRequest, signal?: AbortSignal): Promise<void>;

  /** Lazily fetches a native PNG icon; unsupported/failure is a themed-icon fallback. */
  getFileIcon(sampleLocationUri: string, signal?: AbortSignal): Promise<Uint8Array | undefined>;

  /** Reads one bounded byte range from a file, for the in-app large file viewer (task 0088). */
  readFileRange(request: ReadFileRangeRequest, signal?: AbortSignal): Promise<FileRangeChunk>;
  loadEditableFile(request: LoadEditableFileRequest, signal?: AbortSignal): Promise<EditableFile>;
  saveEditableFile(
    request: SaveEditableFileRequest,
    signal?: AbortSignal,
  ): Promise<EditableFileSave>;

  /** Searches a single file's content, for the in-app large file viewer (task 0088). */
  searchInFile(request: SearchInFileRequest, signal?: AbortSignal): Promise<SearchInFileResult>;

  startOperation(request: StartOperationRequest, signal?: AbortSignal): Promise<Operation>;

  listOperations(signal?: AbortSignal): Promise<Operation[]>;

  cancelOperation(operationId: OperationId, signal?: AbortSignal): Promise<void>;

  pauseOperation(operationId: OperationId, signal?: AbortSignal): Promise<void>;

  resumeOperation(operationId: OperationId, signal?: AbortSignal): Promise<void>;

  resolveConflict(request: ResolveConflictRequest, signal?: AbortSignal): Promise<void>;

  startSearch(request: StartSearchRequest, signal?: AbortSignal): Promise<StartSearchResult>;

  cancelSearch(searchId: string, signal?: AbortSignal): Promise<void>;

  listActions(signal?: AbortSignal): Promise<ActionDescriptor[]>;

  invokeAction(request: InvokeActionRequest, signal?: AbortSignal): Promise<ActionResult>;

  listPlugins(signal?: AbortSignal): Promise<PluginDescriptor[]>;

  setPluginEnabled(pluginId: PluginId, enabled: boolean, signal?: AbortSignal): Promise<void>;

  getPluginLogs(pluginId: PluginId, signal?: AbortSignal): Promise<PluginLogEntry[]>;

  /**
   * Fetches raw SVG markup for one icon-theme asset (task 0095); `assetPath` is a theme's
   * `PluginIconDefinition.iconPath` value, passed through verbatim.
   */
  getPluginIconThemeAsset(
    pluginId: PluginId,
    assetPath: string,
    signal?: AbortSignal,
  ): Promise<string>;

  subscribe(listener: (event: BackendEvent) => void): Promise<Unsubscribe>;

  onResynchronise(listener: () => void): Unsubscribe;

  disconnect(): void;
}
