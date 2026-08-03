import actionFixtures from '../../../../fixtures/mock-responses/actions.json';
import directoryFixtures from '../../../../fixtures/mock-responses/directories.json';
import pluginFixtures from '../../../../fixtures/mock-responses/plugins.json';
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
  Location,
  NavigateRequest,
  Operation,
  OperationId,
  PluginDescriptor,
  PluginId,
  PluginLogEntry,
  ResolveConflictRequest,
  RuntimeCapabilities,
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
import { EventStreamSignalRegistry, MutableEventStreamStatus } from '../events/event-stream';
import type { FileManagerClient } from './file-manager-client';
import {
  createGeneratedDirectory,
  GENERATED_DIRECTORY_SIZES,
  type GeneratedDirectorySize,
} from './mock-directory-generator';

interface FixtureEntry {
  name: string;
  kind: 'file' | 'directory' | 'symlink';
  size?: number;
  hidden?: boolean;
  readable?: boolean;
}

const directories = directoryFixtures as Record<string, FixtureEntry[]>;
const actions = actionFixtures as ActionDescriptor[];
const plugins = pluginFixtures as PluginDescriptor[];

export type MockClientMethod =
  | 'getRuntimeCapabilities'
  | 'getSettings'
  | 'updateSettings'
  | 'getWorkspace'
  | 'listWorkspaces'
  | 'createWorkspace'
  | 'renameWorkspace'
  | 'deleteWorkspace'
  | 'openWorkspace'
  | 'dispatchWorkspaceCommand'
  | 'navigatePane'
  | 'listDirectory'
  | 'getEntryMetadata'
  | 'startOperation'
  | 'listOperations'
  | 'cancelOperation'
  | 'pauseOperation'
  | 'resumeOperation'
  | 'resolveConflict'
  | 'listActions'
  | 'invokeAction'
  | 'listPlugins'
  | 'setPluginEnabled'
  | 'getPluginLogs'
  | 'getPluginIconThemeAsset'
  | 'startSearch'
  | 'cancelSearch';

export interface MockFileManagerClientOptions {
  pageSize?: number;
  seed?: number;
  loadingLocations?: readonly string[];
  latencyMs?: number;
  failures?: Partial<Record<MockClientMethod, Error>>;
}

function fixtureEntry(
  parentUri: string,
  fixture: FixtureEntry,
): import('../../models').EntrySummary {
  const uri = `${parentUri === 'mock:///' ? parentUri : `${parentUri}/`}${encodeURIComponent(fixture.name)}`;
  const extension =
    fixture.kind === 'file' && fixture.name.includes('.')
      ? fixture.name.slice(fixture.name.lastIndexOf('.') + 1)
      : undefined;

  return {
    id: uri,
    location: { providerId: 'file', uri },
    name: fixture.name,
    kind: fixture.kind,
    ...(fixture.size === undefined ? {} : { size: fixture.size }),
    hidden: fixture.hidden ?? false,
    readOnly: fixture.readable === false,
    ...(extension === undefined ? {} : { extension }),
    metadataRevision: 1,
  };
}

/** Case-insensitive substring match, or a `*`/`?` glob match when the query contains a wildcard. */
function matchesQuery(name: string, query: string): boolean {
  if (!query.includes('*') && !query.includes('?')) {
    return name.toLowerCase().includes(query.toLowerCase());
  }
  const pattern = query
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${pattern}$`).test(name.toLowerCase());
}

/**
 * Recursively walks the fixture directory tree from `rootUri` (reduced
 * fidelity vs. the real `fm-search` traversal), silently skipping the
 * `Unreadable` fixture directory the same way `directorySnapshot` treats it.
 */
function collectMatches(rootUri: string, query: string): import('../../models').EntrySummary[] {
  const results: import('../../models').EntrySummary[] = [];
  const pending = [rootUri];
  while (pending.length > 0) {
    const uri = pending.pop();
    if (uri === undefined || uri === 'mock:///Unreadable') continue;
    const fixtures = directories[uri];
    if (fixtures === undefined) continue;
    for (const fixture of fixtures) {
      const entry = fixtureEntry(uri, fixture);
      if (matchesQuery(fixture.name, query)) {
        results.push(entry);
      }
      if (fixture.kind === 'directory') {
        pending.push(entry.location.uri);
      }
    }
  }
  return results;
}

function createMockWorkspace(id: WorkspaceId, name = 'Mock Workspace'): WorkspaceProjection {
  return {
    id,
    name,
    revision: 1,
    paneOrder: ['left', 'right'],
    panesById: {
      left: {
        id: 'left',
        tabOrder: ['left-tab'],
        tabsById: {
          'left-tab': {
            id: 'left-tab',
            title: 'Mock files',
            location: { providerId: 'file', uri: 'mock:///' },
            canNavigateBack: false,
            canNavigateForward: false,
            view: {
              sort: [],
              columns: [],
              showHidden: false,
              foldersFirst: true,
              quickFilter: null,
            },
          },
        },
        activeTabId: 'left-tab',
      },
      right: {
        id: 'right',
        tabOrder: ['right-tab'],
        tabsById: {
          'right-tab': {
            id: 'right-tab',
            title: 'Documents',
            location: { providerId: 'file', uri: 'mock:///Documents' },
            canNavigateBack: false,
            canNavigateForward: false,
            view: {
              sort: [],
              columns: [],
              showHidden: false,
              foldersFirst: true,
              quickFilter: null,
            },
          },
        },
        activeTabId: 'right-tab',
      },
    },
    activePaneId: 'left',
    layout: {
      type: 'split',
      axis: 'horizontal',
      ratio: 0.5,
      first: { type: 'pane', paneId: 'left' },
      second: { type: 'pane', paneId: 'right' },
    },
    operationCentre: { visible: false, height: 180 },
  };
}

/** Strictly typed controls for the deterministic in-memory frontend adapter. */
export class MockFileManagerClient implements FileManagerClient {
  readonly connection = new MutableEventStreamStatus();
  private readonly resynchronise = new EventStreamSignalRegistry();
  private readonly pageSize: number;
  private readonly seed: number;
  private readonly loadingLocations: ReadonlySet<string>;
  private readonly latencyMs: number;
  private readonly failures: Partial<Record<MockClientMethod, Error>>;
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly scriptedEvents: BackendEvent[] = [];
  private readonly operations = new Map<OperationId, Operation>();
  private readonly navigationHistory = new Map<string, { back: Location[]; forward: Location[] }>();
  private readonly workspaces = new Map<WorkspaceId, WorkspaceProjection>();
  private pluginState: PluginDescriptor[] = structuredClone(plugins);
  private settings: Settings = {
    schemaVersion: 2,
    theme: 'auto',
    fontSize: 13,
    rowHeight: 20,
    dateFormat: 'medium',
    sizeFormat: 'binary',
    showHiddenFiles: false,
    confirmPermanentDelete: true,
    defaultConflictPolicy: 'ask',
    operationConcurrency: 2,
    defaultPaneLayout: 'dual',
    defaultColumns: ['core.name', 'core.size', 'core.modified'],
    keybindings: {},
    enabledPlugins: [],
    pluginSettings: {},
    terminalCommand: null,
    defaultStartLocations: [],
    iconTheme: 'generic',
  };
  private operationSequence = 0;
  private tabSequence = 0;
  private workspaceSequence = 0;
  private searchSequence = 0;
  private eventSequence = 0;
  private readonly searches = new Map<string, { cancelled: boolean }>();

  constructor(options: MockFileManagerClientOptions = {}) {
    this.pageSize = options.pageSize ?? 100;
    this.seed = options.seed ?? 13;
    this.loadingLocations = new Set(options.loadingLocations);
    this.latencyMs = options.latencyMs ?? 0;
    this.failures = options.failures ?? {};
  }

  getRuntimeCapabilities(signal?: AbortSignal): Promise<RuntimeCapabilities> {
    return this.perform('getRuntimeCapabilities', signal, () => ({
      clipboard: false,
      nativeDragOut: false,
      nativeFileIcons: false,
      nativeMenus: false,
      nativeThumbnails: false,
      openTerminal: false,
      platform: 'linux',
      plugins: true,
      revealInSystemFileManager: false,
      runtime: 'mock',
      serverAdministration: false,
      systemTrash: false,
    }));
  }

  getSettings(signal?: AbortSignal): Promise<Settings> {
    return this.perform('getSettings', signal, () => structuredClone(this.settings));
  }

  updateSettings(settings: Settings, signal?: AbortSignal): Promise<Settings> {
    return this.perform('updateSettings', signal, () => {
      this.settings = structuredClone(settings);
      return structuredClone(this.settings);
    });
  }

  listWorkspaces(signal?: AbortSignal): Promise<WorkspaceSummary[]> {
    return this.perform('listWorkspaces', signal, () =>
      [...this.workspaces.values()].map(({ id, name, revision }) => ({
        id,
        name,
        revision,
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
    );
  }

  createWorkspace(
    request: CreateWorkspaceRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    return this.perform('createWorkspace', signal, () => {
      this.workspaceSequence += 1;
      const workspace = createMockWorkspace(
        `mock-workspace-${this.workspaceSequence}`,
        request.name ?? 'Default',
      );
      this.workspaces.set(workspace.id, workspace);
      return structuredClone(workspace);
    });
  }

  getWorkspace(workspaceId: WorkspaceId, signal?: AbortSignal): Promise<WorkspaceProjection> {
    return this.perform('getWorkspace', signal, () => {
      const workspace = this.workspaces.get(workspaceId) ?? createMockWorkspace(workspaceId);
      this.workspaces.set(workspaceId, workspace);
      return structuredClone(workspace);
    });
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

  deleteWorkspace(
    workspaceId: WorkspaceId,
    expectedRevision?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.perform('deleteWorkspace', signal, () => {
      const workspace = this.workspaces.get(workspaceId);
      if (workspace !== undefined && expectedRevision !== undefined) {
        this.requireWorkspaceRevision(workspace, expectedRevision);
      }
      this.workspaces.delete(workspaceId);
    });
  }

  openWorkspace(workspaceId: WorkspaceId, signal?: AbortSignal): Promise<WorkspaceProjection> {
    return this.perform('openWorkspace', signal, () => {
      const workspace = this.workspaces.get(workspaceId) ?? createMockWorkspace(workspaceId);
      this.workspaces.set(workspaceId, workspace);
      return structuredClone(workspace);
    });
  }

  dispatchWorkspaceCommand(
    command: WorkspaceCommand,
    signal?: AbortSignal,
  ): Promise<WorkspaceProjection> {
    return this.perform('dispatchWorkspaceCommand', signal, () => {
      const current =
        this.workspaces.get(command.workspaceId) ?? createMockWorkspace(command.workspaceId);
      this.requireWorkspaceRevision(current, command.expectedRevision);
      let changed: WorkspaceProjection;
      switch (command.type) {
        case 'renameWorkspace':
          changed = { ...current, name: command.name, revision: current.revision + 1 };
          break;
        case 'setActivePane':
          changed = {
            ...current,
            activePaneId: command.paneId,
            revision: current.revision + 1,
          };
          break;
        case 'updateLayout':
          changed = { ...current, layout: command.layout, revision: current.revision + 1 };
          break;
        case 'addTab': {
          const pane = current.panesById[command.paneId];
          if (pane === undefined) {
            throw new MockClientError('paneNotFound', `No mock pane with id ${command.paneId}`);
          }
          this.tabSequence += 1;
          const tabId = `mock-tab-${this.tabSequence}`;
          const tab = {
            id: tabId,
            title: command.location.uri.split('/').at(-1) || command.location.uri,
            location: command.location,
            canNavigateBack: false,
            canNavigateForward: false,
            view: {
              sort: [],
              columns: [],
              showHidden: false,
              foldersFirst: true,
              quickFilter: null,
            },
          };
          changed = {
            ...current,
            revision: current.revision + 1,
            panesById: {
              ...current.panesById,
              [pane.id]: {
                ...pane,
                tabOrder: [...pane.tabOrder, tabId],
                tabsById: { ...pane.tabsById, [tabId]: tab },
                activeTabId: tabId,
              },
            },
          };
          break;
        }
        case 'closeTab':
        case 'activateTab':
        case 'navigateTab':
        case 'updateView': {
          const pane = current.panesById[command.paneId];
          if (pane === undefined) {
            throw new MockClientError('paneNotFound', `No mock pane with id ${command.paneId}`);
          }
          if (command.type === 'closeTab') {
            const tabsById = { ...pane.tabsById };
            delete tabsById[command.tabId];
            const tabOrder = pane.tabOrder.filter((tabId) => tabId !== command.tabId);
            changed = {
              ...current,
              revision: current.revision + 1,
              panesById: {
                ...current.panesById,
                [pane.id]: {
                  ...pane,
                  tabOrder,
                  tabsById,
                  activeTabId: tabOrder[0] ?? pane.activeTabId,
                },
              },
            };
            break;
          }
          const tab = pane.tabsById[command.tabId];
          if (tab === undefined) {
            throw new MockClientError('tabNotFound', `No mock tab with id ${command.tabId}`);
          }
          const historyKey = `${current.id}:${pane.id}:${tab.id}`;
          const history = this.navigationHistory.get(historyKey) ?? { back: [], forward: [] };
          let navigatedLocation = tab.location;
          if (command.type === 'navigateTab') {
            if (command.navigationMode === 'push' && command.location != null) {
              if (command.location.uri !== tab.location.uri) {
                history.back.push(tab.location);
              }
              history.forward = [];
              navigatedLocation = command.location;
            } else if (command.navigationMode === 'back') {
              const target = history.back.pop();
              if (target !== undefined) {
                history.forward.push(tab.location);
                navigatedLocation = target;
              }
            } else if (command.navigationMode === 'forward') {
              const target = history.forward.pop();
              if (target !== undefined) {
                history.back.push(tab.location);
                navigatedLocation = target;
              }
            } else if (command.navigationMode === 'refresh' && command.location != null) {
              navigatedLocation = command.location;
            }
            this.navigationHistory.set(historyKey, history);
          }
          const nextTab =
            command.type === 'navigateTab'
              ? {
                  ...tab,
                  location: navigatedLocation,
                  canNavigateBack: history.back.length > 0,
                  canNavigateForward: history.forward.length > 0,
                }
              : command.type === 'updateView'
                ? {
                    ...tab,
                    view: {
                      ...tab.view,
                      ...Object.fromEntries(
                        Object.entries(command.patch).filter(
                          ([key, value]) => key !== 'quickFilter' && value !== null,
                        ),
                      ),
                      ...(command.patch.quickFilter === undefined
                        ? {}
                        : {
                            quickFilter:
                              command.patch.quickFilter === null ||
                              command.patch.quickFilter.type === 'clear'
                                ? null
                                : command.patch.quickFilter.filter,
                          }),
                    },
                  }
                : tab;
          changed = {
            ...current,
            revision: current.revision + 1,
            panesById: {
              ...current.panesById,
              [pane.id]: {
                ...pane,
                activeTabId: command.type === 'activateTab' ? command.tabId : pane.activeTabId,
                tabsById: { ...pane.tabsById, [tab.id]: nextTab },
              },
            },
          };
          break;
        }
      }
      this.workspaces.set(changed.id, changed);
      return structuredClone(changed);
    });
  }

  private requireWorkspaceRevision(workspace: WorkspaceProjection, expectedRevision: number): void {
    if (workspace.revision !== expectedRevision) {
      throw new MockClientError(
        'workspaceRevisionConflict',
        'The workspace changed after this view was loaded.',
      );
    }
  }

  navigatePane(request: NavigateRequest, signal?: AbortSignal): Promise<DirectorySnapshot> {
    return this.directorySnapshot(request, signal, 'navigatePane');
  }

  listDirectory(request: ListDirectoryRequest, signal?: AbortSignal): Promise<DirectorySnapshot> {
    return this.directorySnapshot(request, signal, 'listDirectory');
  }

  getEntryMetadata(request: EntryMetadataRequest, signal?: AbortSignal): Promise<EntryMetadata> {
    return this.perform('getEntryMetadata', signal, () => ({
      entryId: request.entryId,
      permissions: { readable: true, writable: true, executable: false },
      ownership: { owner: 'mock-user', group: 'mock-group' },
      extendedAttributes: {},
      checksums: {},
      pluginFields: {},
    }));
  }

  startOperation(request: StartOperationRequest, signal?: AbortSignal): Promise<Operation> {
    return this.perform('startOperation', signal, () => {
      this.operationSequence += 1;
      const operation: Operation = {
        id: `mock-operation-${this.seed}-${this.operationSequence}`,
        kind: request.type,
        state: 'running',
        sources: request.sources.map((location) => ({ id: location.uri, location })),
        ...(request.destination === undefined ? {} : { destination: request.destination }),
        progress: { completedItems: 0, completedBytes: 0 },
        conflictPolicy: request.conflictPolicy,
        createdAt: '2026-01-01T00:00:00.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
      };
      this.operations.set(operation.id, operation);
      return operation;
    });
  }

  listOperations(signal?: AbortSignal): Promise<Operation[]> {
    return this.perform('listOperations', signal, () =>
      [...this.operations.values()].map((operation) => structuredClone(operation)),
    );
  }

  cancelOperation(operationId: OperationId, signal?: AbortSignal): Promise<void> {
    return this.perform('cancelOperation', signal, () => {
      const operation = this.requireOperation(operationId);
      this.operations.set(operationId, { ...operation, state: 'cancelled' });
    });
  }

  pauseOperation(operationId: OperationId, signal?: AbortSignal): Promise<void> {
    return this.perform('pauseOperation', signal, () => {
      const operation = this.requireOperation(operationId);
      this.operations.set(operationId, { ...operation, state: 'paused' });
    });
  }

  resumeOperation(operationId: OperationId, signal?: AbortSignal): Promise<void> {
    return this.perform('resumeOperation', signal, () => {
      const operation = this.requireOperation(operationId);
      this.operations.set(operationId, { ...operation, state: 'running' });
    });
  }

  resolveConflict(request: ResolveConflictRequest, signal?: AbortSignal): Promise<void> {
    return this.perform('resolveConflict', signal, () => {
      const operation = this.requireOperation(request.operationId);
      this.operations.set(request.operationId, {
        ...operation,
        ...(request.resolution === 'cancelOperation'
          ? { state: 'cancelled' as const }
          : request.resolution === 'confirm'
            ? { state: 'running' as const }
            : { conflictPolicy: request.resolution, state: 'running' as const }),
      });
    });
  }

  listActions(signal?: AbortSignal): Promise<ActionDescriptor[]> {
    return this.perform('listActions', signal, () => structuredClone(actions));
  }

  invokeAction(request: InvokeActionRequest, signal?: AbortSignal): Promise<ActionResult> {
    return this.perform('invokeAction', signal, () => {
      if (!actions.some((action) => action.id === request.actionId)) {
        throw new MockClientError('actionNotFound', `No mock action with id ${request.actionId}`);
      }
      return { actionId: request.actionId, invoked: true };
    });
  }

  listPlugins(signal?: AbortSignal): Promise<PluginDescriptor[]> {
    return this.perform('listPlugins', signal, () => structuredClone(this.pluginState));
  }

  setPluginEnabled(pluginId: PluginId, enabled: boolean, signal?: AbortSignal): Promise<void> {
    return this.perform('setPluginEnabled', signal, () => {
      if (!this.pluginState.some((plugin) => plugin.id === pluginId)) {
        throw new MockClientError('pluginNotFound', `No mock plugin with id ${pluginId}`);
      }
      this.pluginState = this.pluginState.map((plugin) =>
        plugin.id === pluginId ? { ...plugin, enabled } : plugin,
      );
    });
  }

  getPluginLogs(pluginId: PluginId, signal?: AbortSignal): Promise<PluginLogEntry[]> {
    return this.perform('getPluginLogs', signal, () => {
      if (!this.pluginState.some((plugin) => plugin.id === pluginId)) {
        throw new MockClientError('pluginNotFound', `No mock plugin with id ${pluginId}`);
      }
      return [];
    });
  }

  getPluginIconThemeAsset(
    pluginId: PluginId,
    assetPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.perform('getPluginIconThemeAsset', signal, () => {
      const plugin = this.pluginState.find((candidate) => candidate.id === pluginId);
      const isDeclared = Object.values(plugin?.iconTheme?.iconDefinitions ?? {}).some(
        (definition) => definition.iconPath === assetPath,
      );
      if (!isDeclared) {
        throw new MockClientError(
          'pluginNotFound',
          `No icon theme asset ${assetPath} for plugin ${pluginId}`,
        );
      }
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>';
    });
  }

  startSearch(request: StartSearchRequest, signal?: AbortSignal): Promise<StartSearchResult> {
    return this.perform('startSearch', signal, () => {
      this.searchSequence += 1;
      const searchId = `mock-search-${this.seed}-${this.searchSequence}`;
      const location: Location = { providerId: 'local', uri: `search://local/${searchId}` };
      this.searches.set(searchId, { cancelled: false });
      const entries = request.roots.flatMap((root) => collectMatches(root.uri, request.query));
      // Deferred with a macrotask (rather than a microtask) so it always runs
      // after this method's own promise has resolved and the caller has
      // recorded `searchId`, avoiding a race against the resultsBatch handler
      // matching events by searchId.
      setTimeout(() => {
        if (this.searches.get(searchId)?.cancelled ?? true) return;
        this.eventSequence += 1;
        this.emit({
          eventId: this.eventSequence,
          timestamp: '2026-01-01T00:00:00.000Z',
          workspaceId: request.workspaceId,
          payload: {
            type: 'search.resultsBatch',
            searchId,
            entries,
            isComplete: true,
            warningsCount: 0,
          },
        });
      }, 0);
      return { searchId, location };
    });
  }

  cancelSearch(searchId: string, signal?: AbortSignal): Promise<void> {
    return this.perform('cancelSearch', signal, () => {
      const search = this.searches.get(searchId);
      if (search === undefined) {
        throw new MockClientError('searchNotFound', `No mock search with id ${searchId}`);
      }
      search.cancelled = true;
    });
  }

  subscribe(listener: (event: BackendEvent) => void): Promise<Unsubscribe> {
    this.connection.set('open');
    this.listeners.add(listener);
    return Promise.resolve(() => {
      this.listeners.delete(listener);
    });
  }

  disconnect(): void {
    this.connection.set('closed');
  }

  onResynchronise(listener: () => void): Unsubscribe {
    return this.resynchronise.subscribe(listener);
  }

  /** Simulates a replay gap requiring affected panes to refetch. */
  emitResynchronise(): void {
    this.resynchronise.dispatch();
  }

  /** Replaces the pending event script; call {@link emitNextEvent} to advance it. */
  scriptEvents(events: readonly BackendEvent[]): void {
    this.scriptedEvents.splice(0, this.scriptedEvents.length, ...structuredClone(events));
  }

  /** Delivers one pending scripted event to every active subscriber. */
  emitNextEvent(): boolean {
    const event = this.scriptedEvents.shift();
    if (event === undefined) {
      return false;
    }
    this.emit(event);
    return true;
  }

  /** Delivers an event immediately to every active subscriber. */
  emit(event: BackendEvent): void {
    for (const listener of this.listeners) {
      listener(structuredClone(event));
    }
  }

  /** Returns the current in-memory state for a mock operation. */
  getOperation(operationId: OperationId): Operation | undefined {
    const operation = this.operations.get(operationId);
    return operation === undefined ? undefined : structuredClone(operation);
  }

  private directorySnapshot(
    request: ListDirectoryRequest,
    signal: AbortSignal | undefined,
    method: 'navigatePane' | 'listDirectory',
  ): Promise<DirectorySnapshot> {
    const fixtures = directories[request.location.uri];
    const generatedSize = this.generatedSize(request.location.uri);
    if (fixtures === undefined && generatedSize === undefined) {
      return Promise.reject(
        new MockClientError('directoryNotFound', `No mock directory at ${request.location.uri}`),
      );
    }

    const offset = this.parseContinuationToken(request.continuationToken);
    const entries =
      generatedSize === undefined
        ? (fixtures ?? []).map((fixture) => fixtureEntry(request.location.uri, fixture))
        : createGeneratedDirectory(generatedSize, this.seed).page(offset, this.pageSize);
    const totalEntries = generatedSize ?? fixtures?.length ?? 0;
    const nextOffset = offset + entries.length;
    const isUnreadable = request.location.uri === 'mock:///Unreadable';
    const loadingState = isUnreadable
      ? ({ type: 'error', message: 'Directory is not readable' } as const)
      : this.loadingLocations.has(request.location.uri)
        ? ({ type: 'loading' } as const)
        : ({ type: 'loaded' } as const);

    return this.perform(method, signal, () => ({
      paneId: request.paneId,
      requestId: request.requestId,
      revision: 1,
      location: request.location,
      writable: request.location.uri !== 'mock:///Read-only',
      entries: isUnreadable ? [] : entries,
      totalKnownEntries: totalEntries,
      hasMore: nextOffset < totalEntries,
      ...(nextOffset < totalEntries ? { continuationToken: String(nextOffset) } : {}),
      loadingState,
    }));
  }

  private generatedSize(uri: string): GeneratedDirectorySize | undefined {
    const match = /^mock:\/\/\/large\/(\d+)$/.exec(uri);
    if (match?.[1] === undefined) {
      return undefined;
    }
    const size = Number(match[1]);
    return GENERATED_DIRECTORY_SIZES.find((candidate) => candidate === size);
  }

  private parseContinuationToken(token: string | undefined): number {
    if (token === undefined) {
      return 0;
    }
    const offset = Number(token);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new MockClientError('invalidContinuationToken', `Invalid continuation token: ${token}`);
    }
    return offset;
  }

  private requireOperation(operationId: OperationId): Operation {
    const operation = this.operations.get(operationId);
    if (operation === undefined) {
      throw new MockClientError('operationNotFound', `No mock operation with id ${operationId}`);
    }
    return operation;
  }

  private async perform<T>(
    method: MockClientMethod,
    signal: AbortSignal | undefined,
    createValue: () => T,
  ): Promise<T> {
    if (signal?.aborted === true) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const failure = this.failures[method];
    if (failure !== undefined) {
      throw failure;
    }
    if (this.latencyMs > 0) {
      await this.delay(signal);
    }
    return createValue();
  }

  private delay(signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, this.latencyMs);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

/** A deterministic error raised by an injected or fixture-backed mock failure. */
export class MockClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MockClientError';
  }
}
