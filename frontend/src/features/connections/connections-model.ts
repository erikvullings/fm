import type { FileManagerClient } from '../../api/client/file-manager-client';
import type {
  Connection,
  ConnectionConfiguration,
  ConnectionId,
  ConnectionStatus,
  CreateConnectionRequest,
  UpdateConnectionRequest,
} from '../../models';

/**
 * Status glyph shown next to a connection's name in the `SERVERS` sidebar
 * group (spec §5.5, §20): a filled dot only while connected, an open dot
 * for every other status (including in-progress/degraded ones, which the
 * status label spells out).
 */
export function connectionStatusGlyph(status: ConnectionStatus): '●' | '○' {
  return status === 'connected' ? '●' : '○';
}

/** Human-readable label for a connection's runtime status. */
export function connectionStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'disconnected':
      return 'Disconnected';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'authenticationRequired':
      return 'Authentication required';
    case 'failed':
      return 'Failed';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * Merges a created/updated connection into a list by id, appending it if
 * not already present. Never mutates `connections`.
 */
export function upsertConnection(
  connections: readonly Connection[],
  updated: Connection,
): readonly Connection[] {
  const index = connections.findIndex((connection) => connection.id === updated.id);
  if (index === -1) return [...connections, updated];
  const next = [...connections];
  next[index] = updated;
  return next;
}

/** Removes a connection from a list by id. Never mutates `connections`. */
export function withoutConnection(
  connections: readonly Connection[],
  id: ConnectionId,
): readonly Connection[] {
  return connections.filter((connection) => connection.id !== id);
}

/** The fields a connection editor form lets a user type freely. */
export interface ConnectionDraftFields {
  readonly name: string;
  readonly configuration: ConnectionConfiguration;
}

export interface ConnectionDraftValidationError {
  readonly field: string;
  readonly message: string;
}

/**
 * Validates the fields the connection editor form lets a user type freely
 * (task 0103). Only SSH-specific fields are checked client-side, matching
 * the honestly-scoped surface this task builds (SSH is the only kind
 * meaningfully usable before task 0104/0106); other kinds fall back to the
 * backend's own structured validation, surfaced as a save error.
 */
export function validateConnectionDraft(
  draft: ConnectionDraftFields,
): readonly ConnectionDraftValidationError[] {
  const errors: ConnectionDraftValidationError[] = [];
  if (draft.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'Enter a connection name.' });
  }
  if (draft.configuration.kind === 'ssh') {
    const { host, username, port } = draft.configuration;
    if (host.trim().length === 0) {
      errors.push({ field: 'host', message: 'Enter a host.' });
    }
    if (username.trim().length === 0) {
      errors.push({ field: 'username', message: 'Enter a username.' });
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      errors.push({ field: 'port', message: 'Enter a port between 1 and 65535.' });
    }
  }
  return errors;
}

// Thin, one-line wrappers over the shared `FileManagerClient` (spec §12):
// components must depend only on this module for connection CRUD/lifecycle,
// never call `client.*Connection*` directly, so the client dependency and
// the exact request/response shape stay in one place.

/** Lists every stored connection profile with its current runtime status. */
export function loadConnections(
  client: FileManagerClient,
  signal?: AbortSignal,
): Promise<Connection[]> {
  return client.listConnections(signal);
}

/** Creates a new connection profile. */
export function createConnection(
  client: FileManagerClient,
  request: CreateConnectionRequest,
): Promise<Connection> {
  return client.createConnection(request);
}

/** Updates an existing connection profile. */
export function updateConnection(
  client: FileManagerClient,
  id: ConnectionId,
  request: UpdateConnectionRequest,
): Promise<Connection> {
  return client.updateConnection(id, request);
}

/** Deletes a connection profile and its stored credential, if any. */
export function deleteConnection(client: FileManagerClient, id: ConnectionId): Promise<void> {
  return client.deleteConnection(id);
}

/**
 * Attempts to connect. See the backend `fm_connections::ConnectionService`
 * for the honest scope of this operation before task 0104/0106 register a
 * real protocol dialer.
 */
export function connectConnection(
  client: FileManagerClient,
  id: ConnectionId,
): Promise<Connection> {
  return client.connectConnection(id);
}

/** Marks a connection as disconnected. */
export function disconnectConnection(
  client: FileManagerClient,
  id: ConnectionId,
): Promise<Connection> {
  return client.disconnectConnection(id);
}

/** Checks whether a connection's configuration/credential are currently usable. */
export function testConnection(client: FileManagerClient, id: ConnectionId): Promise<Connection> {
  return client.testConnection(id);
}
