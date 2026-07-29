import type { WorkspaceId } from './ids';

/** Shared tagged event envelope for backend-to-frontend events (spec §10). */
export interface EventEnvelope<T> {
  eventId: number;
  timestamp: string;
  workspaceId?: WorkspaceId;
  payload: T;
}

/**
 * A backend event delivered over the event stream (spec §10). Task 0014
 * (which depends on this task) refines this into a discriminated union over
 * the named events (`runtime.ready`, `directory.snapshot`, ...).
 */
export type BackendEvent = EventEnvelope<unknown>;

/** Stops a {@link import('../api/client/file-manager-client').FileManagerClient.subscribe} listener from receiving further events. */
export type Unsubscribe = () => void;
