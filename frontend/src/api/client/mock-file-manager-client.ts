import actionFixtures from '../../../../fixtures/mock-responses/actions.json';
import directoryFixtures from '../../../../fixtures/mock-responses/directories.json';
import pluginFixtures from '../../../../fixtures/mock-responses/plugins.json';
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
  | 'getWorkspace'
  | 'navigatePane'
  | 'listDirectory'
  | 'getEntryMetadata'
  | 'startOperation'
  | 'cancelOperation'
  | 'resolveConflict'
  | 'listActions'
  | 'invokeAction'
  | 'listPlugins';

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

/** Strictly typed controls for the deterministic in-memory frontend adapter. */
export class MockFileManagerClient implements FileManagerClient {
  private readonly pageSize: number;
  private readonly seed: number;
  private readonly loadingLocations: ReadonlySet<string>;
  private readonly latencyMs: number;
  private readonly failures: Partial<Record<MockClientMethod, Error>>;
  private readonly listeners = new Set<(event: BackendEvent) => void>();
  private readonly scriptedEvents: BackendEvent[] = [];
  private readonly operations = new Map<OperationId, Operation>();
  private operationSequence = 0;

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

  getWorkspace(workspaceId: WorkspaceId, signal?: AbortSignal): Promise<Workspace> {
    return this.perform('getWorkspace', signal, () => ({
      id: workspaceId,
      name: 'Mock Workspace',
      panes: [
        {
          id: 'left',
          tabs: [
            {
              id: 'left-tab',
              location: { providerId: 'file', uri: 'mock:///' },
              history: { back: [], forward: [] },
              view: { sort: [{ field: 'name', direction: 'ascending' }], selectedEntryIds: [] },
            },
          ],
          activeTabId: 'left-tab',
        },
        {
          id: 'right',
          tabs: [
            {
              id: 'right-tab',
              location: { providerId: 'file', uri: 'mock:///Documents' },
              history: { back: [], forward: [] },
              view: { sort: [{ field: 'name', direction: 'ascending' }], selectedEntryIds: [] },
            },
          ],
          activeTabId: 'right-tab',
        },
      ],
      activePaneId: 'left',
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        first: { type: 'pane', paneId: 'left' },
        second: { type: 'pane', paneId: 'right' },
      },
    }));
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
        kind: request.kind,
        state: 'running',
        sources: request.sources,
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

  cancelOperation(operationId: OperationId, signal?: AbortSignal): Promise<void> {
    return this.perform('cancelOperation', signal, () => {
      const operation = this.requireOperation(operationId);
      this.operations.set(operationId, { ...operation, state: 'cancelled' });
    });
  }

  resolveConflict(request: ResolveConflictRequest, signal?: AbortSignal): Promise<void> {
    return this.perform('resolveConflict', signal, () => {
      const operation = this.requireOperation(request.operationId);
      this.operations.set(request.operationId, {
        ...operation,
        conflictPolicy: request.resolution,
        state: 'running',
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
    return this.perform('listPlugins', signal, () => structuredClone(plugins));
  }

  subscribe(listener: (event: BackendEvent) => void): Promise<Unsubscribe> {
    this.listeners.add(listener);
    return Promise.resolve(() => {
      this.listeners.delete(listener);
    });
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
