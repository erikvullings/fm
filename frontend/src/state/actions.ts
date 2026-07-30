import type {
  BackendNotification,
  DirectoryDelta,
  DirectorySnapshot,
  Operation,
  OperationId,
  OperationProgress,
  PaneId,
  PluginDescriptor,
  Workspace,
} from '../models';
import type { ConnectionState, RuntimeState } from './model';
import type { AppUpdate } from './patch';
import {
  connectionPatch,
  directoryDeltaPatch,
  directorySnapshotPatch,
  notificationPatch,
  operationPatch,
  operationProgressPatch,
  pluginPatch,
  runtimePatch,
  workspaceSnapshotPatch,
} from './reducers';

/** Typed mutations available to components and backend-event producers. */
export interface AppActions {
  setRuntime(runtime: RuntimeState): void;
  replaceWorkspace(workspace: Workspace): void;
  replaceDirectory(snapshot: DirectorySnapshot): void;
  applyDirectoryDelta(paneId: PaneId, delta: DirectoryDelta): void;
  upsertOperation(operation: Operation): void;
  updateOperationProgress(operationId: OperationId, progress: OperationProgress): void;
  upsertPlugin(plugin: PluginDescriptor): void;
  notify(notification: BackendNotification): void;
  setConnection(connection: ConnectionState): void;
}

/** Binds pure slice reducers to the store's single batched update boundary. */
export function createAppActions(update: AppUpdate): AppActions {
  return {
    setRuntime: (runtime) => update(runtimePatch(runtime)),
    replaceWorkspace: (workspace) => update(workspaceSnapshotPatch(workspace)),
    replaceDirectory: (snapshot) => update(directorySnapshotPatch(snapshot)),
    applyDirectoryDelta: (paneId, delta) => update(directoryDeltaPatch(paneId, delta)),
    upsertOperation: (operation) => update(operationPatch(operation)),
    updateOperationProgress: (operationId, progress) =>
      update(operationProgressPatch(operationId, progress)),
    upsertPlugin: (plugin) => update(pluginPatch(plugin)),
    notify: (notification) => update(notificationPatch(notification)),
    setConnection: (connection) => update(connectionPatch(connection)),
  };
}
