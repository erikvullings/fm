import type { SortDescriptorDto } from '../api/generated/models/sortDescriptorDto';
import type { ActionId, EntryId, OperationId, PaneId } from './ids';
import type { Location } from './location';
import type { ConflictPolicy, OperationKind } from './operation';

/** Open column sort descriptor shared by workspace views and directory requests. */
export type SortDescriptor = SortDescriptorDto;

/**
 * Requests the entries of a directory (`POST /api/v1/directories/list`),
 * mirroring `fm_transport_dto::ListDirectoryRequest`.
 */
export interface ListDirectoryRequest {
  workspaceId: string;
  paneId: PaneId;
  requestId: string;
  location: Location;
  continuationToken?: string;
  sort?: SortDescriptor[];
  showHidden?: boolean;
  foldersFirst?: boolean;
}

/**
 * Requests navigation to a new location (`POST /api/v1/navigation/open`),
 * mirroring `fm_transport_dto::NavigateRequest`.
 */
export interface NavigateRequest {
  workspaceId: string;
  paneId: PaneId;
  requestId: string;
  location: Location;
}

/**
 * Requests detailed metadata for a single entry
 * (`POST /api/v1/entries/metadata`), mirroring
 * `fm_transport_dto::EntryMetadataRequest`.
 */
export interface EntryMetadataRequest {
  entryId: EntryId;
  location: Location;
}

/**
 * Starts a mutating operation (spec §17). No backend DTO exists yet
 * (operations land in tasks 0037+); fields mirror the domain `Operation`
 * struct until then.
 */
export interface StartOperationRequest {
  type: OperationKind;
  sources: readonly Location[];
  destination?: Location;
  conflictPolicy: ConflictPolicy;
  name?: string;
  createIntermediateDirectories?: boolean;
}

/** Submits the user's decision for a queued conflict (spec §17). */
export type ConflictResolution = 'skip' | 'overwrite' | 'renameNew' | 'cancelOperation';

export interface ResolveConflictRequest {
  operationId: OperationId;
  resolution: ConflictResolution;
  applyToAllSimilar: boolean;
}

/** Invokes a registered action (spec §18). */
export interface InvokeActionRequest {
  actionId: ActionId;
  parameters?: unknown;
}
