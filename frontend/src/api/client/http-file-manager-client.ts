import type {
  ActionDescriptor,
  ActionResult,
  ApplySyncPlanRequest,
  ApplySyncPlanResult,
  ArchiveCredentialRequest,
  BackendEvent,
  CalculateFolderSizeRequest,
  CalculateFolderSizeResult,
  ChecksumAlgorithm,
  ChecksumFile,
  ChecksumPage,
  ComparisonPage,
  Connection,
  ConnectionId,
  CreateConnectionRequest,
  CreateWorkspaceRequest,
  DirectorySnapshot,
  DuplicatePage,
  EditableFile,
  EditableFileSave,
  EntryMetadata,
  EntryMetadataRequest,
  Location as FileLocation,
  FileRangeChunk,
  GenerateSyncPlanRequest,
  HostKeyProbe,
  InvokeActionRequest,
  ListDirectoryRequest,
  LoadEditableFileRequest,
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
  SaveEditableFileRequest,
  SearchInFileRequest,
  SearchInFileResult,
  SetPaneActivityRequest,
  Settings,
  StartChecksumRequest,
  StartChecksumResult,
  StartComparisonRequest,
  StartComparisonResult,
  StartDuplicateScanRequest,
  StartDuplicateScanResult,
  StartOperationRequest,
  StartSearchRequest,
  StartSearchResult,
  SyncPlan,
  SystemLocation,
  Unsubscribe,
  UpdateConnectionRequest,
  VerificationReport,
  WorkspaceCommand,
  WorkspaceId,
  WorkspaceProjection,
  WorkspaceSummary,
} from '../../models';
import {
  checksumPageFromDto,
  duplicatePageFromDto,
  verificationReportFromDto,
} from '../../models/checksum';
import { syncPlanItemToDto } from '../../models/comparison';
import { entryMetadataFromDto } from '../../models/entry';
import { comparisonPageFromDto, syncPlanFromDto } from '../../models/requests';
import { directorySnapshotFromDto } from '../../models/snapshot';
import { workspaceProjectionFromDto } from '../../models/workspace';
import { SseEventStream } from '../events/sse-event-stream';
import {
  invokeAction as requestActionInvocation,
  listActions as requestActions,
  cacheArchivePassword as requestArchivePasswordCache,
  cancelChecksums as requestChecksumCancel,
  renderChecksumFile as requestChecksumFileRender,
  verifyChecksumFile as requestChecksumFileVerify,
  getChecksums as requestChecksumGet,
  startChecksums as requestChecksumStart,
  cancelComparison as requestComparisonCancel,
  getComparison as requestComparisonGet,
  startComparison as requestComparisonStart,
  resolveOperationConflict as requestConflictResolution,
  getConnection as requestConnection,
  connectConnection as requestConnectionConnect,
  createConnection as requestConnectionCreation,
  deleteConnection as requestConnectionDeletion,
  disconnectConnection as requestConnectionDisconnect,
  listConnections as requestConnections,
  testConnection as requestConnectionTest,
  updateConnection as requestConnectionUpdate,
  listDirectory as requestDirectory,
  cancelDuplicateScan as requestDuplicateScanCancel,
  getDuplicateScan as requestDuplicateScanGet,
  startDuplicateScan as requestDuplicateScanStart,
  getEntryMetadata as requestEntryMetadata,
  getFileIcon as requestFileIcon,
  calculateFolderSize as requestFolderSizeCalculation,
  loadEditableFile as requestLoadEditableFile,
  navigatePane as requestNavigation,
  cancelOperation as requestOperationCancel,
  pauseOperation as requestOperationPause,
  resumeOperation as requestOperationResume,
  startOperation as requestOperationStart,
  listOperations as requestOperations,
  setPaneActivity as requestPaneActivity,
  disablePlugin as requestPluginDisable,
  enablePlugin as requestPluginEnable,
  getPluginIconThemeAsset as requestPluginIconThemeAsset,
  getPluginLogs as requestPluginLogs,
  listPlugins as requestPlugins,
  readFileRange as requestReadFileRange,
  getRuntimeCapabilities as requestRuntimeCapabilities,
  saveEditableFile as requestSaveEditableFile,
  cancelSearch as requestSearchCancel,
  searchInFile as requestSearchInFile,
  startSearch as requestSearchStart,
  getSettings as requestSettings,
  updateSettings as requestSettingsUpdate,
  acceptSshHostKey as requestSshHostKeyAcceptance,
  probeSshHostKey as requestSshHostKeyProbe,
  applySyncPlan as requestSyncPlanApply,
  generateSyncPlan as requestSyncPlanGenerate,
  getSystemLocations as requestSystemLocations,
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
import { getSessionToken } from '../session-token';
import type { FileManagerClient, NativeFileDrop } from './file-manager-client';

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
  private readonly eventStream = new SseEventStream({ tokenProvider: getSessionToken });
  readonly connection = this.eventStream.status;

  startNativeDrag(_locations: readonly FileLocation[], _signal?: AbortSignal): Promise<void> {
    return Promise.reject(new Error('Native drag is available only in the desktop application'));
  }

  subscribeNativeFileDrops(_listener: (drop: NativeFileDrop) => void): Promise<Unsubscribe> {
    return Promise.resolve(() => undefined);
  }

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

  async getSystemLocations(signal?: AbortSignal): Promise<SystemLocation[]> {
    const response = await requestSystemLocations(signal === undefined ? undefined : { signal });
    if (response.status !== 200) {
      throw new Error(`Unexpected getSystemLocations response status: ${response.status}`);
    }
    return response.data.map((item) => ({
      name: item.name,
      kind: item.kind,
      location: { ...item.location },
      ...(item.providerHint == null ? {} : { providerHint: item.providerHint }),
      ...(item.protocol == null ? {} : { protocol: item.protocol }),
      ...(item.server == null ? {} : { server: item.server }),
      ...(item.share == null ? {} : { share: item.share }),
      ...(item.readOnly == null ? {} : { readOnly: item.readOnly }),
    }));
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
    return workspaceProjectionFromDto(response.data, { redirectSessionOnlyTabs: true });
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
    return workspaceProjectionFromDto(response.data, { redirectSessionOnlyTabs: true });
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
      // Surface the backend's actual `ApplicationErrorDto.message` (e.g. "unsupported RAR
      // compression method") rather than a generic status-code message - this is the archive
      // listing path the comic (.cbz/.cbr) and EPUB viewers depend on, where the underlying
      // cause (an archive format/feature the backend's reader can't handle) is exactly what a
      // user needs to see to tell "this app has a bug" from "this file can't be read".
      const message =
        typeof response.data === 'object' && response.data !== null && 'message' in response.data
          ? String((response.data as { message: unknown }).message)
          : `Unexpected listDirectory response status: ${response.status}`;
      throw new Error(message);
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

  async setPaneActivity(request: SetPaneActivityRequest, signal?: AbortSignal): Promise<void> {
    const response = await requestPaneActivity(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    if (response.status !== 204) {
      throw new Error(`Unexpected setPaneActivity response status: ${response.status}`);
    }
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

  async loadEditableFile(
    request: LoadEditableFileRequest,
    signal?: AbortSignal,
  ): Promise<EditableFile> {
    const response = await requestLoadEditableFile(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    if (response.status !== 200)
      throw new Error(`Unexpected loadEditableFile response status: ${response.status}`);
    return response.data;
  }

  async saveEditableFile(
    request: SaveEditableFileRequest,
    signal?: AbortSignal,
  ): Promise<EditableFileSave> {
    const response = await requestSaveEditableFile(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    if (response.status !== 200)
      throw new Error(`Unexpected saveEditableFile response status: ${response.status}`);
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

  async calculateFolderSize(
    request: CalculateFolderSizeRequest,
    signal?: AbortSignal,
  ): Promise<CalculateFolderSizeResult> {
    const response = await requestFolderSizeCalculation(
      request,
      signal !== undefined ? { signal } : undefined,
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected calculateFolderSize response status: ${response.status}`);
    }
    return response.data;
  }

  async startOperation(request: StartOperationRequest, signal?: AbortSignal): Promise<Operation> {
    const { destinations, archiveCompressionLevel, ...rest } = request;
    const response = await requestOperationStart(
      {
        ...rest,
        sources: [...rest.sources],
        ...(destinations === undefined ? {} : { destinations: [...destinations] }),
        ...(archiveCompressionLevel === undefined ? {} : { archiveCompressionLevel }),
      },
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
      {
        query: request.query,
        ...(request.contentQuery === undefined ? {} : { contentQuery: request.contentQuery }),
        ...(request.contentRegex === undefined ? {} : { contentRegex: request.contentRegex }),
        ...(request.contentCaseSensitive === undefined
          ? {}
          : { contentCaseSensitive: request.contentCaseSensitive }),
        ...(request.contentWholeWord === undefined
          ? {}
          : { contentWholeWord: request.contentWholeWord }),
        ...(request.recurse === undefined ? {} : { recurse: request.recurse }),
        ...(request.showHidden === undefined ? {} : { showHidden: request.showHidden }),
        roots: [...request.roots],
        workspaceId: request.workspaceId,
      },
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

  async startComparison(
    request: StartComparisonRequest,
    signal?: AbortSignal,
  ): Promise<StartComparisonResult> {
    const response = await requestComparisonStart(
      {
        workspaceId: request.workspaceId,
        left: request.left,
        right: request.right,
        criteria: request.criteria,
        ...(request.showHidden === undefined ? {} : { showHidden: request.showHidden }),
      },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 201) {
      throw new Error(`Unexpected startComparison response status: ${response.status}`);
    }
    return { comparisonId: response.data.comparisonId };
  }

  async getComparison(
    comparisonId: string,
    options?: { offset?: number; limit?: number; differencesOnly?: boolean },
    signal?: AbortSignal,
  ): Promise<ComparisonPage> {
    const response = await requestComparisonGet(
      comparisonId,
      {
        ...(options?.offset === undefined ? {} : { offset: options.offset }),
        ...(options?.limit === undefined ? {} : { limit: options.limit }),
        ...(options?.differencesOnly === undefined
          ? {}
          : { differencesOnly: options.differencesOnly }),
      },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected getComparison response status: ${response.status}`);
    }
    return comparisonPageFromDto(response.data);
  }

  async cancelComparison(comparisonId: string, signal?: AbortSignal): Promise<void> {
    const response = await requestComparisonCancel(
      comparisonId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected cancelComparison response status: ${response.status}`);
  }

  async startChecksums(
    request: StartChecksumRequest,
    signal?: AbortSignal,
  ): Promise<StartChecksumResult> {
    const response = await requestChecksumStart(
      {
        workspaceId: request.workspaceId,
        entries: request.entries,
        algorithms: request.algorithms,
      },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 201) {
      throw new Error(`Unexpected startChecksums response status: ${response.status}`);
    }
    return { jobId: response.data.jobId };
  }

  async getChecksums(
    jobId: string,
    options?: { offset?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<ChecksumPage> {
    const response = await requestChecksumGet(
      jobId,
      {
        ...(options?.offset === undefined ? {} : { offset: options.offset }),
        ...(options?.limit === undefined ? {} : { limit: options.limit }),
      },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected getChecksums response status: ${response.status}`);
    }
    return checksumPageFromDto(response.data);
  }

  async cancelChecksums(jobId: string, signal?: AbortSignal): Promise<void> {
    const response = await requestChecksumCancel(
      jobId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected cancelChecksums response status: ${response.status}`);
  }

  async renderChecksumFile(
    jobId: string,
    algorithm: ChecksumAlgorithm,
    signal?: AbortSignal,
  ): Promise<ChecksumFile> {
    const response = await requestChecksumFileRender(
      jobId,
      { algorithm },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected renderChecksumFile response status: ${response.status}`);
    }
    return { suggestedName: response.data.suggestedName, content: response.data.content };
  }

  async verifyChecksumFile(
    jobId: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<VerificationReport> {
    const response = await requestChecksumFileVerify(
      jobId,
      { content },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected verifyChecksumFile response status: ${response.status}`);
    }
    return verificationReportFromDto(response.data);
  }

  async startDuplicateScan(
    request: StartDuplicateScanRequest,
    signal?: AbortSignal,
  ): Promise<StartDuplicateScanResult> {
    const response = await requestDuplicateScanStart(
      {
        workspaceId: request.workspaceId,
        roots: request.roots,
        ...(request.showHidden === undefined ? {} : { showHidden: request.showHidden }),
        ...(request.includeEmptyFiles === undefined
          ? {}
          : { includeEmptyFiles: request.includeEmptyFiles }),
      },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 201) {
      throw new Error(`Unexpected startDuplicateScan response status: ${response.status}`);
    }
    return { scanId: response.data.scanId };
  }

  async getDuplicateScan(
    scanId: string,
    options?: { offset?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<DuplicatePage> {
    const response = await requestDuplicateScanGet(
      scanId,
      {
        ...(options?.offset === undefined ? {} : { offset: options.offset }),
        ...(options?.limit === undefined ? {} : { limit: options.limit }),
      },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected getDuplicateScan response status: ${response.status}`);
    }
    return duplicatePageFromDto(response.data);
  }

  async cancelDuplicateScan(scanId: string, signal?: AbortSignal): Promise<void> {
    const response = await requestDuplicateScanCancel(
      scanId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected cancelDuplicateScan response status: ${response.status}`);
  }

  async generateSyncPlan(
    comparisonId: string,
    request: GenerateSyncPlanRequest,
    signal?: AbortSignal,
  ): Promise<SyncPlan> {
    const response = await requestSyncPlanGenerate(
      comparisonId,
      { mode: request.mode },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200) {
      throw new Error(`Unexpected generateSyncPlan response status: ${response.status}`);
    }
    return syncPlanFromDto(response.data);
  }

  async applySyncPlan(
    comparisonId: string,
    request: ApplySyncPlanRequest,
    signal?: AbortSignal,
  ): Promise<ApplySyncPlanResult> {
    const response = await requestSyncPlanApply(
      comparisonId,
      { items: request.items.map(syncPlanItemToDto) },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 201) {
      throw new Error(`Unexpected applySyncPlan response status: ${response.status}`);
    }
    return { operationIds: response.data.operationIds as OperationId[] };
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

  async listConnections(signal?: AbortSignal): Promise<Connection[]> {
    const response = await requestConnections(signal === undefined ? undefined : { signal });
    if (response.status !== 200)
      throw new Error(`Unexpected listConnections response status: ${response.status}`);
    return response.data;
  }

  async createConnection(
    request: CreateConnectionRequest,
    signal?: AbortSignal,
  ): Promise<Connection> {
    const response = await requestConnectionCreation(
      request,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 201)
      throw new Error(`Unexpected createConnection response status: ${response.status}`);
    return response.data;
  }

  async getConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<Connection> {
    const response = await requestConnection(
      connectionId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200)
      throw new Error(`Unexpected getConnection response status: ${response.status}`);
    return response.data;
  }

  async updateConnection(
    connectionId: ConnectionId,
    request: UpdateConnectionRequest,
    signal?: AbortSignal,
  ): Promise<Connection> {
    const response = await requestConnectionUpdate(
      connectionId,
      request,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200)
      throw new Error(`Unexpected updateConnection response status: ${response.status}`);
    return response.data;
  }

  async deleteConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<void> {
    const response = await requestConnectionDeletion(
      connectionId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected deleteConnection response status: ${response.status}`);
  }

  async connectConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<Connection> {
    const response = await requestConnectionConnect(
      connectionId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200)
      throw new Error(`Unexpected connectConnection response status: ${response.status}`);
    return response.data;
  }

  async disconnectConnection(
    connectionId: ConnectionId,
    signal?: AbortSignal,
  ): Promise<Connection> {
    const response = await requestConnectionDisconnect(
      connectionId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200)
      throw new Error(`Unexpected disconnectConnection response status: ${response.status}`);
    return response.data;
  }

  async testConnection(connectionId: ConnectionId, signal?: AbortSignal): Promise<Connection> {
    const response = await requestConnectionTest(
      connectionId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200)
      throw new Error(`Unexpected testConnection response status: ${response.status}`);
    return response.data;
  }

  async probeSshHostKey(connectionId: ConnectionId, signal?: AbortSignal): Promise<HostKeyProbe> {
    const response = await requestSshHostKeyProbe(
      connectionId,
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 200)
      throw new Error(`Unexpected probeSshHostKey response status: ${response.status}`);
    return response.data;
  }

  async acceptSshHostKey(
    connectionId: ConnectionId,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await requestSshHostKeyAcceptance(
      connectionId,
      { fingerprint },
      signal === undefined ? undefined : { signal },
    );
    if (response.status !== 204)
      throw new Error(`Unexpected acceptSshHostKey response status: ${response.status}`);
  }
}

function pluginIconThemeFromDto(dto: PluginIconThemeDto): PluginIconTheme {
  return {
    iconDefinitions: dto.iconDefinitions,
    ...(dto.file == null ? {} : { file: dto.file }),
    ...(dto.folder == null ? {} : { folder: dto.folder }),
    ...(dto.symlink == null ? {} : { symlink: dto.symlink }),
    fileExtensions: dto.fileExtensions,
    fileNames: dto.fileNames,
    folderNames: dto.folderNames,
    folderNamesExpanded: dto.folderNamesExpanded,
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
    ...(dto.errors.length === 0
      ? {}
      : {
          errors: dto.errors.map((error) => ({
            entry: error.entry,
            message: error.message,
          })),
        }),
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
          ? locations.map(
              (location): FileLocation => ({
                providerId: String((location as { providerId?: unknown }).providerId),
                uri: String((location as { uri?: unknown }).uri),
              }),
            )
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
