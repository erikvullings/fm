import type {
  BackendNotification,
  EntryId,
  EntrySummary,
  Operation,
  OperationId,
  PaneId,
  PluginDescriptor,
  PluginId,
  RuntimeCapabilities,
  Workspace,
} from '../models';
import type { RuntimeKind } from '../utilities/runtime';

/** Recursively readonly representation used by application-state snapshots. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/** Runtime selection and capabilities discovered during bootstrap. */
export interface RuntimeState {
  readonly kind: RuntimeKind;
  readonly capabilities?: DeepReadonly<RuntimeCapabilities>;
}

/** A normalized directory snapshot whose entries are keyed by stable identifiers. */
export interface DirectoryState {
  readonly requestId: string;
  readonly revision: number;
  readonly entryIds: readonly EntryId[];
  readonly entriesById: Readonly<Partial<Record<EntryId, DeepReadonly<EntrySummary>>>>;
}

/** Authoritative workspace projection and per-pane directory snapshots. */
export interface WorkspaceState {
  readonly current?: DeepReadonly<Workspace>;
  readonly directories: Readonly<Partial<Record<PaneId, DirectoryState>>>;
}

/** File operations keyed by stable operation identifier. */
export interface OperationsState {
  readonly byId: Readonly<Partial<Record<OperationId, DeepReadonly<Operation>>>>;
}

/** Discovered plugins keyed by stable plugin identifier. */
export interface PluginsState {
  readonly byId: Readonly<Partial<Record<PluginId, DeepReadonly<PluginDescriptor>>>>;
}

/** Ordered user-visible notifications. */
export interface NotificationsState {
  readonly items: readonly DeepReadonly<BackendNotification>[];
}

/** Backend event-stream lifecycle. */
export interface ConnectionState {
  readonly status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  readonly lastEventId?: number;
  readonly error?: string;
}

/** Complete readonly frontend application snapshot. */
export interface AppState {
  readonly runtime: RuntimeState;
  readonly workspace: WorkspaceState;
  readonly operations: OperationsState;
  readonly plugins: PluginsState;
  readonly notifications: NotificationsState;
  readonly connection: ConnectionState;
}

/** Creates the deterministic state used before backend data is received. */
export function createInitialAppState(kind: RuntimeKind): AppState {
  return {
    runtime: { kind },
    workspace: { directories: {} },
    operations: { byId: {} },
    plugins: { byId: {} },
    notifications: { items: [] },
    connection: { status: 'disconnected' },
  };
}
