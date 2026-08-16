import type {
  BackendEvent,
  Connection,
  ConnectionId,
  ContentMatchSummary,
  DirectoryDelta,
  Operation,
  OperationConflict,
  OperationId,
  OperationState,
  PaneId,
  PluginDescriptor,
  WorkspaceId,
  WorkspaceProjection,
  WorkspaceSummary,
} from '../../models';
import {
  type ChecksumState,
  type DuplicateState,
  withChecksumBatch,
  withDuplicateResults,
} from '../checksums/checksum-state';
import { type ComparisonState, withComparisonBatch } from '../comparison/comparison-state';
import { upsertConnection, withoutConnection } from '../connections/connections-model';
import {
  dismissOperation,
  type OperationCentreState,
  reduceOperationEvents,
} from '../operations/operation-state';

const FAST_OPERATION_DISMISS_THRESHOLD_MS = 500;
const AUTO_DISMISS_DELAY_MS = 5_000;

function isAutoDismissibleState(state: OperationState): boolean {
  return (
    state === 'completed' ||
    state === 'completedWithWarnings' ||
    state === 'cancelled' ||
    state === 'interrupted'
  );
}

function shouldRefreshOnTerminalOperation(operation: Operation): boolean {
  if (operation.kind === 'search' || operation.kind === 'compare') return false;
  return (
    operation.state === 'completed' ||
    operation.state === 'completedWithWarnings' ||
    operation.state === 'failed' ||
    operation.state === 'cancelled' ||
    operation.state === 'interrupted'
  );
}

/**
 * All state and callbacks the backend event handler needs, provided by AppShell at
 * registry creation time. Keeping this interface narrow lets each handler be tested
 * with a plain mock object — no DOM, no Mithril, no real client required.
 */
export interface BackendEventContext {
  // Workspace
  getWorkspaceId(): WorkspaceId | undefined;
  getWorkspaceRevision(): number | undefined;
  replaceWorkspace(next: WorkspaceProjection): void;
  refreshWorkspaceSummaries(): void;
  setWorkspaceSummaries(summaries: readonly WorkspaceSummary[]): void;
  setWorkspaceActionError(message: string): void;
  recoverActiveWorkspace(summaries: readonly WorkspaceSummary[]): Promise<void>;
  listWorkspaces(): Promise<readonly WorkspaceSummary[]>;
  getWorkspace(id: WorkspaceId): Promise<WorkspaceProjection>;

  // Conflict
  setPendingConflict(conflict: OperationConflict): void;

  // Operations
  getPendingOperationEvents(): BackendEvent[];
  pushPendingOperationEvent(event: BackendEvent): void;
  /** Returns and atomically empties the pending event queue. */
  clearPendingOperationEvents(): BackendEvent[];
  getOperationFrame(): number | undefined;
  setOperationFrame(frame: number | undefined): void;
  getOperations(): OperationCentreState;
  setOperations(next: OperationCentreState): void;
  getDismissedOperationIds(): ReadonlySet<OperationId>;
  clearDismissedOperation(id: OperationId): void;
  scheduleAutoDismiss(id: OperationId, delayMs: number): void;

  // Directory
  /** Returns the current revision for the active tab in `paneId`, or `undefined` if unknown. */
  getActiveDirectoryRevision(paneId: PaneId): number | undefined;
  applyDelta(paneId: PaneId, delta: DirectoryDelta): void;
  refetchAffectedPanes(paneId?: PaneId, options?: { readonly background?: boolean }): void;

  // Plugins
  getPlugins(): readonly PluginDescriptor[];
  setPlugins(plugins: readonly PluginDescriptor[]): void;
  listPlugins(): Promise<readonly PluginDescriptor[]>;
  /** Returns `currentSettings?.iconTheme`, used to re-apply the theme after a plugin update. */
  getCurrentIconThemeSetting(): string | undefined;
  applyIconTheme(themeId: string): void;

  // Connections
  getConnections(): readonly Connection[];
  setConnections(next: readonly Connection[]): void;
  getConnection(id: ConnectionId): Promise<Connection>;

  // Comparison
  getComparisonState(): ComparisonState;
  setComparisonState(next: ComparisonState): void;
  /** Selects, in both compared panes, every currently loaded entry whose comparison outcome
   * isn't `identical` (Total-Commander-style "Compare directories"). Called once a comparison
   * finishes streaming. */
  markComparisonDifferences(state: ComparisonState): void;

  // Checksums and duplicate detection (task 0077)
  getChecksumState(): ChecksumState;
  setChecksumState(next: ChecksumState): void;
  getDuplicateState(): DuplicateState;
  setDuplicateState(next: DuplicateState): void;

  // Search
  getFindFilesSearchId(): string | undefined;
  /** Returns the live Set of pane IDs that have a background reload in flight. */
  getSearchBatchReloadInFlight(): Set<PaneId>;
  cacheContentMatches(uri: string, matches: readonly ContentMatchSummary[]): void;
  /** Returns IDs of panes whose active tab is showing `uri`. */
  findPanesWithUri(uri: string): readonly PaneId[];
  loadPane(paneId: PaneId, options?: { background?: boolean }): Promise<void>;

  // Redraw
  redraw(): void;
}

/**
 * Creates the backend event handler for AppShell. All handler logic that previously
 * lived in AppShell's `handleBackendEvent` closure now lives here, testable in
 * isolation via a mock {@link BackendEventContext}.
 */
export function createBackendEventHandler(ctx: BackendEventContext): (event: BackendEvent) => void {
  return function handleBackendEvent(event: BackendEvent): void {
    const payload = event.payload;

    // Workspace lifecycle events refresh the switcher summary list regardless of
    // which workspace they pertain to (task 0084).
    if (
      payload.type === 'workspace.created' ||
      payload.type === 'workspace.renamed' ||
      payload.type === 'workspace.deleted'
    ) {
      ctx.refreshWorkspaceSummaries();
      if (payload.type === 'workspace.deleted' && event.workspaceId === ctx.getWorkspaceId()) {
        void ctx
          .listWorkspaces()
          .then((summaries) => {
            ctx.setWorkspaceSummaries(summaries);
            return ctx.recoverActiveWorkspace(summaries);
          })
          .catch((error: unknown) => {
            ctx.setWorkspaceActionError(
              error instanceof Error ? error.message : 'Unable to recover workspace',
            );
          })
          .finally(() => ctx.redraw());
        return;
      }
    }

    if (event.workspaceId !== undefined && event.workspaceId !== ctx.getWorkspaceId()) return;

    if (payload.type === 'operation.conflict') {
      ctx.setPendingConflict(payload);
      ctx.redraw();
    }

    if (payload.type.startsWith('operation.')) {
      ctx.pushPendingOperationEvent(event);
      if (ctx.getOperationFrame() === undefined) {
        ctx.setOperationFrame(
          requestAnimationFrame(() => {
            ctx.setOperationFrame(undefined);
            const events = ctx.clearPendingOperationEvents();
            const previous = ctx.getOperations();
            let next = reduceOperationEvents(previous, events);
            let panesNeedRefresh = false;
            for (const [id, current] of Object.entries(next.byId) as Array<
              [OperationId, Operation | undefined]
            >) {
              if (current === undefined) continue;
              const previousState = previous.byId[id]?.state;
              if (previousState === current.state) continue;
              ctx.clearDismissedOperation(id);
              if (shouldRefreshOnTerminalOperation(current)) {
                panesNeedRefresh = true;
              }
              if (!isAutoDismissibleState(current.state)) continue;
              if (
                Date.now() - Date.parse(current.createdAt) <
                FAST_OPERATION_DISMISS_THRESHOLD_MS
              ) {
                next = dismissOperation(next, id);
              } else {
                ctx.scheduleAutoDismiss(id, AUTO_DISMISS_DELAY_MS);
              }
            }
            for (const dismissedId of ctx.getDismissedOperationIds()) {
              if (next.byId[dismissedId] !== undefined) {
                next = dismissOperation(next, dismissedId);
              }
            }
            ctx.setOperations(next);
            // Operation completion must force an authoritative refresh so both source and
            // destination panes reflect move/copy/rename/delete outcomes immediately.
            if (panesNeedRefresh) ctx.refetchAffectedPanes(undefined, { background: false });
            ctx.redraw();
          }),
        );
      }
      return;
    }

    if (payload.type === 'directory.snapshot') {
      const currentRevision = ctx.getActiveDirectoryRevision(payload.snapshot.paneId);
      if (currentRevision !== undefined && payload.snapshot.revision <= currentRevision) return;
      ctx.applyDelta(payload.snapshot.paneId, { type: 'reset', snapshot: payload.snapshot });
      return;
    }

    if (payload.type === 'directory.delta') {
      try {
        ctx.applyDelta(payload.paneId, payload.delta);
      } catch {
        ctx.refetchAffectedPanes(payload.paneId);
      }
      return;
    }

    if (payload.type === 'plugin.changed') {
      const changed = payload.plugin;
      const current = ctx.getPlugins();
      ctx.setPlugins(
        current.some((plugin) => plugin.id === changed.id)
          ? current.map((plugin) => (plugin.id === changed.id ? { ...plugin, ...changed } : plugin))
          : current,
      );
      ctx.redraw();
      void ctx
        .listPlugins()
        .then((listed) => {
          ctx.setPlugins(listed);
          const themeId = ctx.getCurrentIconThemeSetting();
          if (themeId !== undefined) ctx.applyIconTheme(themeId);
          ctx.redraw();
        })
        .catch(() => undefined);
      return;
    }

    if (
      payload.type === 'connection.created' ||
      payload.type === 'connection.updated' ||
      payload.type === 'connection.statusChanged' ||
      payload.type === 'connection.deleted'
    ) {
      if (payload.type === 'connection.deleted') {
        ctx.setConnections(withoutConnection(ctx.getConnections(), payload.connectionId));
        ctx.redraw();
        return;
      }
      void ctx
        .getConnection(payload.connectionId)
        .then((updated) => {
          ctx.setConnections(upsertConnection(ctx.getConnections(), updated));
          ctx.redraw();
        })
        .catch(() => undefined);
      return;
    }

    if (payload.type === 'search.resultsBatch') {
      if (payload.searchId !== ctx.getFindFilesSearchId()) return;
      for (const entry of payload.entries) {
        if (entry.contentMatches !== undefined && entry.contentMatches.length > 0) {
          ctx.cacheContentMatches(entry.location.uri, entry.contentMatches);
        }
      }
      const searchUri = `search://local/${payload.searchId}`;
      const inFlight = ctx.getSearchBatchReloadInFlight();
      for (const paneId of ctx.findPanesWithUri(searchUri)) {
        if (payload.isComplete) {
          void ctx.loadPane(paneId);
          continue;
        }
        if (inFlight.has(paneId)) continue;
        inFlight.add(paneId);
        void ctx.loadPane(paneId, { background: true }).finally(() => inFlight.delete(paneId));
      }
      ctx.redraw();
      return;
    }

    if (payload.type === 'comparison.resultsBatch') {
      const next = withComparisonBatch(
        ctx.getComparisonState(),
        payload.comparisonId,
        payload.entries,
        payload.isComplete,
        payload.warningsCount,
      );
      ctx.setComparisonState(next);
      // Guard on `next.isComplete`, not `payload.isComplete`: a stale/no-longer-tracked batch
      // (comparisonId mismatch) leaves `next` as the untouched current state, whose own
      // completion flag reflects reality even though this particular payload was discarded.
      if (next.isComplete) ctx.markComparisonDifferences(next);
      ctx.redraw();
      return;
    }

    if (payload.type === 'checksum.resultsBatch') {
      ctx.setChecksumState(
        withChecksumBatch(
          ctx.getChecksumState(),
          payload.jobId,
          payload.entries,
          payload.isComplete,
          payload.isCancelled,
        ),
      );
      ctx.redraw();
      return;
    }

    if (payload.type === 'duplicates.resultsReady') {
      ctx.setDuplicateState(
        withDuplicateResults(
          ctx.getDuplicateState(),
          payload.scanId,
          payload.groups,
          payload.isCancelled,
          payload.warningsCount,
        ),
      );
      ctx.redraw();
      return;
    }

    if ('revision' in payload) {
      const workspaceId = ctx.getWorkspaceId();
      const currentRevision = ctx.getWorkspaceRevision();
      if (workspaceId === undefined || currentRevision === undefined) return;
      if (payload.revision <= currentRevision) return;
      void ctx.getWorkspace(workspaceId).then((next) => ctx.replaceWorkspace(next));
    }
  };
}
