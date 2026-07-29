import type { OperationId, WorkspaceId } from './ids';
import type { Operation, OperationProgress, OperationState } from './operation';
import type { PluginDescriptor } from './plugin';
import type { DirectoryDelta, DirectorySnapshot } from './snapshot';
import type { Workspace } from './workspace';

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

/** Typed payloads named by specification §10. */
export type BackendEventPayload =
  | { type: 'runtime.ready' }
  | { type: 'workspace.updated'; workspace: Workspace }
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
