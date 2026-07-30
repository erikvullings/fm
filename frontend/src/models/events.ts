import type { OperationId, PaneId, TabId, WorkspaceId } from './ids';
import type { Location } from './location';
import type { Operation, OperationProgress, OperationState } from './operation';
import type { PluginDescriptor } from './plugin';
import type { DirectoryDelta, DirectorySnapshot } from './snapshot';
import type { SortDirection, WorkspaceLayout } from './workspace';

/** Shared tagged event envelope for backend-to-frontend events (spec §10). */
export interface EventEnvelope<T> {
  eventId: number;
  timestamp: string;
  workspaceId?: WorkspaceId;
  payload: T;
}

/** Conflict requiring an explicit request/response resolution. */
export interface OperationConflict {
  operationId: OperationId;
  conflictId: string;
  message: string;
}

/** User-visible notification delivered by the backend. */
export interface BackendNotification {
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

/** A single sort descriptor: a column and a direction (mirrors `fm_domain::SortDescriptor`). */
export interface SortDescriptor {
  columnId: string;
  direction: SortDirection;
}

/** Persisted width and visibility for a single directory-table column. */
export interface ColumnConfiguration {
  columnId: string;
  width: number;
  visible: boolean;
}

/** A persisted quick-filter query. */
export interface PersistedFilter {
  query: string;
}

/**
 * Persisted view configuration for a directory listing: sorting, columns and
 * filters (mirrors `fm_domain::DirectoryViewConfiguration`). Contains no
 * frontend-only session state (selection, keyboard cursor).
 */
export interface DirectoryViewConfiguration {
  sort: SortDescriptor[];
  columns: ColumnConfiguration[];
  showHidden: boolean;
  foldersFirst: boolean;
  quickFilter?: PersistedFilter;
}

/** Typed payloads named by specification §10. */
export type BackendEventPayload =
  | { type: 'runtime.ready' }
  | { type: 'workspace.created'; revision: number }
  | { type: 'workspace.renamed'; revision: number; name: string }
  | { type: 'workspace.opened'; revision: number }
  | { type: 'workspace.closed'; revision: number }
  | { type: 'workspace.deleted'; revision: number }
  | { type: 'workspace.layoutChanged'; revision: number; layout: WorkspaceLayout }
  | { type: 'workspace.activePaneChanged'; revision: number; paneId: PaneId }
  | {
      type: 'workspace.tabAdded';
      revision: number;
      paneId: PaneId;
      tabId: TabId;
      location: Location;
    }
  | { type: 'workspace.tabClosed'; revision: number; paneId: PaneId; tabId: TabId }
  | { type: 'workspace.tabActivated'; revision: number; paneId: PaneId; tabId: TabId }
  | {
      type: 'workspace.tabNavigated';
      revision: number;
      paneId: PaneId;
      tabId: TabId;
      location: Location;
    }
  | {
      type: 'workspace.tabViewChanged';
      revision: number;
      paneId: PaneId;
      tabId: TabId;
      view: DirectoryViewConfiguration;
    }
  | { type: 'directory.snapshot'; snapshot: DirectorySnapshot }
  | { type: 'directory.delta'; delta: DirectoryDelta }
  | { type: 'operation.created'; operation: Operation }
  | { type: 'operation.progress'; operationId: OperationId; progress: OperationProgress }
  | { type: 'operation.stateChanged'; operationId: OperationId; state: OperationState }
  | ({ type: 'operation.conflict' } & OperationConflict)
  | { type: 'operation.completed'; operation: Operation }
  | { type: 'operation.failed'; operationId: OperationId; code: string; message: string }
  | { type: 'plugin.changed'; plugin: PluginDescriptor }
  | { type: 'notification.created'; notification: BackendNotification };

/** A backend event delivered identically over SSE and Tauri. */
export type BackendEvent = EventEnvelope<BackendEventPayload>;

/** Stops a {@link import('../api/client/file-manager-client').FileManagerClient.subscribe} listener from receiving further events. */
export type Unsubscribe = () => void;
