import type { ReadFileRangeResponseDto } from '../api/generated/models/readFileRangeResponseDto';
import type { SearchInFileMatchDto } from '../api/generated/models/searchInFileMatchDto';
import type { SearchInFileResponseDto } from '../api/generated/models/searchInFileResponseDto';
import type { SortDescriptorDto } from '../api/generated/models/sortDescriptorDto';
import type { ActionInvocationContext } from './action';
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
  symlinkPolicy?: 'copyLink' | 'copyTarget';
  permanentDeleteConfirmed?: boolean;
  overrideReadOnly?: boolean;
}

/** Submits the user's decision for a queued conflict (spec §17). */
export type ConflictResolution = 'confirm' | 'skip' | 'overwrite' | 'renameNew' | 'cancelOperation';

export interface ResolveConflictRequest {
  operationId: OperationId;
  resolution: ConflictResolution;
  applyToAllSimilar: boolean;
}

/** Invokes a registered action (spec §18). */
export interface InvokeActionRequest {
  actionId: ActionId;
  parameters?: unknown;
  context: ActionInvocationContext;
}

/**
 * Starts a recursive, cancellable filename search (`POST /api/v1/search`,
 * task 0068), mirroring `fm_transport_dto::StartSearchRequestDto`.
 */
export interface StartSearchRequest {
  query: string;
  roots: readonly Location[];
  workspaceId: string;
}

/**
 * Identifies a started search and its `search://local/{searchId}` virtual
 * result location, mirroring `fm_transport_dto::StartSearchResponseDto`.
 */
export interface StartSearchResult {
  searchId: string;
  location: Location;
}

/**
 * Requests a byte range from a single file (`POST /api/v1/files/range`,
 * task 0088), mirroring `fm_transport_dto::ReadFileRangeRequestDto`.
 */
export interface ReadFileRangeRequest {
  location: Location;
  offset: number;
  length: number;
}

/**
 * One chunk of a file's content, mirroring
 * `fm_transport_dto::ReadFileRangeResponseDto`. Field shapes match the wire
 * DTO exactly, so no separate mapper is needed.
 */
export type FileRangeChunk = ReadFileRangeResponseDto;

/**
 * Searches a single file's content for a substring or regex
 * (`POST /api/v1/files/search`, task 0088), mirroring
 * `fm_transport_dto::SearchInFileRequestDto`.
 */
export interface SearchInFileRequest {
  location: Location;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
}

/** One match found by a {@link SearchInFileRequest}. */
export type SearchInFileMatch = SearchInFileMatchDto;

/** The result of a {@link SearchInFileRequest}. */
export type SearchInFileResult = SearchInFileResponseDto;
