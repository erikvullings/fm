import type {
  BackendNotification,
  DirectoryDelta,
  DirectorySnapshot,
  EntryId,
  EntrySummary,
  Operation,
  OperationId,
  OperationProgress,
  PaneId,
  PluginDescriptor,
  RuntimeCapabilities,
  Workspace,
} from '../models';
import type { RuntimeKind } from '../utilities/runtime';
import type {
  ConnectionState,
  DeepReadonly,
  DirectoryState,
  RuntimeState,
  WorkspaceState,
} from './model';
import type { AppPatch } from './patch';

function normalizeEntries(entries: readonly EntrySummary[]): {
  readonly entryIds: readonly EntryId[];
  readonly entriesById: Readonly<Record<EntryId, DeepReadonly<EntrySummary>>>;
} {
  const entryIds: EntryId[] = [];
  const entriesById: Record<EntryId, DeepReadonly<EntrySummary>> = {};
  for (const entry of entries) {
    if (!(entry.id in entriesById)) {
      entryIds.push(entry.id);
    }
    entriesById[entry.id] = entry;
  }
  return { entryIds, entriesById };
}

function directoryFromSnapshot(snapshot: DirectorySnapshot): DirectoryState {
  return {
    requestId: snapshot.requestId,
    revision: snapshot.revision,
    ...normalizeEntries(snapshot.entries),
  };
}

/** Replaces runtime bootstrap data. */
export function runtimePatch(runtime: RuntimeState): AppPatch {
  return { runtime: () => runtime };
}

/** Convenience constructor for runtime patches at adapter boundaries. */
export function runtimeState(
  kind: RuntimeKind,
  capabilities?: DeepReadonly<RuntimeCapabilities>,
): RuntimeState {
  return capabilities === undefined ? { kind } : { kind, capabilities };
}

/** Replaces the major workspace snapshot and invalidates its directory projections. */
export function workspaceSnapshotPatch(workspace: Workspace): AppPatch {
  return { workspace: () => ({ current: workspace, directories: {} }) };
}

/** Replaces one pane's major directory snapshot with a stable-ID normalized projection. */
export function directorySnapshotPatch(snapshot: DirectorySnapshot): AppPatch {
  return {
    workspace: (workspace) => ({
      ...workspace,
      directories: {
        ...workspace.directories,
        [snapshot.paneId]: directoryFromSnapshot(snapshot),
      },
    }),
  };
}

function upsertEntries(
  directory: DirectoryState,
  entries: readonly EntrySummary[],
  revision: number,
): DirectoryState {
  const entryIds = [...directory.entryIds];
  const entriesById = { ...directory.entriesById };
  for (const entry of entries) {
    if (!(entry.id in entriesById)) {
      entryIds.push(entry.id);
    }
    entriesById[entry.id] = entry;
  }
  return { ...directory, revision, entryIds, entriesById };
}

function removeEntries(
  directory: DirectoryState,
  entryIdsToRemove: readonly EntryId[],
  revision: number,
): DirectoryState {
  const removed = new Set(entryIdsToRemove);
  const entriesById = { ...directory.entriesById };
  for (const entryId of removed) {
    delete entriesById[entryId];
  }
  return {
    ...directory,
    revision,
    entryIds: directory.entryIds.filter((entryId) => !removed.has(entryId)),
    entriesById,
  };
}

function applyDirectoryDelta(
  workspace: WorkspaceState,
  paneId: PaneId,
  delta: DirectoryDelta,
): WorkspaceState {
  if (delta.type === 'reset') {
    return {
      ...workspace,
      directories: {
        ...workspace.directories,
        [paneId]: directoryFromSnapshot(delta.snapshot),
      },
    };
  }
  const directory = workspace.directories[paneId];
  if (directory === undefined) {
    return workspace;
  }
  const next =
    delta.type === 'entriesRemoved'
      ? removeEntries(directory, delta.entryIds, delta.revision)
      : upsertEntries(directory, delta.entries, delta.revision);
  return {
    ...workspace,
    directories: { ...workspace.directories, [paneId]: next },
  };
}

/** Applies an incremental directory change without relying on input ordering. */
export function directoryDeltaPatch(paneId: PaneId, delta: DirectoryDelta): AppPatch {
  return { workspace: (workspace) => applyDirectoryDelta(workspace, paneId, delta) };
}

/** Inserts or replaces a complete operation snapshot. */
export function operationPatch(operation: Operation): AppPatch {
  return {
    operations: (operations) => ({
      byId: { ...operations.byId, [operation.id]: operation },
    }),
  };
}

/** Replaces an operation's progress snapshot when that operation is known. */
export function operationProgressPatch(
  operationId: OperationId,
  progress: OperationProgress,
): AppPatch {
  return {
    operations: (operations) => {
      const operation = operations.byId[operationId];
      if (operation === undefined) {
        return operations;
      }
      return {
        byId: {
          ...operations.byId,
          [operationId]: { ...operation, progress },
        },
      };
    },
  };
}

/** Inserts or replaces a plugin descriptor. */
export function pluginPatch(plugin: PluginDescriptor): AppPatch {
  return {
    plugins: (plugins) => ({ byId: { ...plugins.byId, [plugin.id]: plugin } }),
  };
}

/** Appends one user-visible notification. */
export function notificationPatch(notification: BackendNotification): AppPatch {
  return {
    notifications: (notifications) => ({ items: [...notifications.items, notification] }),
  };
}

/** Replaces connection status fields as one immutable snapshot. */
export function connectionPatch(connection: ConnectionState): AppPatch {
  return { connection: () => connection };
}
