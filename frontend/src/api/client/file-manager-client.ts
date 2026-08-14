import type {
  ActionDescriptor,
  ActionResult,
  ApplySyncPlanRequest,
  ApplySyncPlanResult,
  ArchiveCredentialRequest,
  BackendEvent,
  ComparisonPage,
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
  GenerateSyncPlanRequest,
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
  SetPaneActivityRequest,
  Settings,
  StartComparisonRequest,
  StartComparisonResult,
  StartOperationRequest,
  StartSearchRequest,
  StartSearchResult,
  SyncPlan,
  SystemLocation,
  Unsubscribe,
  UpdateConnectionRequest,
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
  getSystemLocations(signal?: AbortSignal): Promise<SystemLocation[]>;

  /** Starts an OS file-reference drag from the desktop host. */
  startNativeDrag(locations: readonly Location[], signal?: AbortSignal): Promise<void>;

  /** Closes the desktop window (Alt+F4, task 0128). Only implemented on the Tauri host. */
  quit?(): Promise<void>;

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

  /** Marks a pane's foreground/background state (task 0109). */
  setPaneActivity(request: SetPaneActivityRequest, signal?: AbortSignal): Promise<void>;

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

  /** Starts a cancellable directory comparison (spec §16 milestone 5, task 0075). */
  startComparison(
    request: StartComparisonRequest,
    signal?: AbortSignal,
  ): Promise<StartComparisonResult>;

  /** Pages through a comparison's streamed results, optionally differences-only. */
  getComparison(
    comparisonId: string,
    options?: { offset?: number; limit?: number; differencesOnly?: boolean },
    signal?: AbortSignal,
  ): Promise<ComparisonPage>;

  cancelComparison(comparisonId: string, signal?: AbortSignal): Promise<void>;

  /** Proposes a sync plan from a comparison's current results; never mutates anything. */
  generateSyncPlan(
    comparisonId: string,
    request: GenerateSyncPlanRequest,
    signal?: AbortSignal,
  ): Promise<SyncPlan>;

  /** Applies a (possibly user-edited) sync plan through the operation engine. */
  applySyncPlan(
    comparisonId: string,
    request: ApplySyncPlanRequest,
    signal?: AbortSignal,
  ): Promise<ApplySyncPlanResult>;

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

  /** Lists every stored connection profile with its current runtime status (task 0103). */
  listConnections(signal?: AbortSignal): Promise<Connection[]>;

  createConnection(request: CreateConnectionRequest, signal?: AbortSignal): Promise<Connection>;

  getConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<Connection>;

  updateConnection(
    connectionId: ConnectionId,
    request: UpdateConnectionRequest,
    signal?: AbortSignal,
  ): Promise<Connection>;

  deleteConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<void>;

  /**
   * Attempts to connect. See the backend `fm_connections::ConnectionService`
   * for the honest scope of this operation before task 0104/0106 register a
   * real protocol dialer.
   */
  connectConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<Connection>;

  disconnectConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<Connection>;

  testConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<Connection>;

  /**
   * Probes an SSH connection's currently presented host key without
   * authenticating (task 0104, spec §6.4) - lets a caller decide whether to
   * accept a never-seen or changed key before `connect`/`test` report
   * `hostKeyUnverified`/`hostKeyMismatch` via the connection's `status`.
   */
  probeSshHostKey(connectionId: ConnectionId, signal?: AbortSignal): Promise<HostKeyProbe>;

  /**
   * Accepts (persists) a host-key fingerprint for an SSH connection (task
   * 0104, spec §6.4). Never call this with a fingerprint the caller has not
   * shown the user for confirmation - the backend re-probes the host before
   * persisting, but this is the only path that ever writes to the
   * known-hosts store.
   */
  acceptSshHostKey(
    connectionId: ConnectionId,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<void>;
}
