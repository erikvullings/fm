import type { LoadEditableFileResponseDto } from '../api/generated/models/loadEditableFileResponseDto';
import type { ReadFileRangeResponseDto } from '../api/generated/models/readFileRangeResponseDto';
import type { SaveEditableFileResponseDto } from '../api/generated/models/saveEditableFileResponseDto';
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
  sort?: SortDescriptor[];
  showHidden?: boolean;
  foldersFirst?: boolean;
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

/** Supplies an archive password to the backend-session-only credential cache. */
export interface ArchiveCredentialRequest {
  location: Location;
  password: string;
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
  /**
   * Per-source destinations for a batch `rename` (task 0072 multi-rename), one entry per
   * `sources` item in the same order. Omitted for every other operation kind and for a
   * single-entry rename, which keeps using `destination` instead.
   */
  destinations?: readonly Location[];
  conflictPolicy: ConflictPolicy;
  name?: string;
  archiveFormat?: 'zip' | 'sevenZip';
  archiveCompressionLevel?: number;
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
 * Starts a recursive, cancellable search (filename and/or content,
 * `POST /api/v1/search`, task 0068/0089), mirroring `fm_transport_dto::StartSearchRequestDto`.
 */
export interface StartSearchRequest {
  query: string;
  contentQuery?: string | undefined;
  contentRegex?: boolean;
  contentCaseSensitive?: boolean;
  contentWholeWord?: boolean;
  recurse?: boolean;
  showHidden?: boolean;
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

export interface LoadEditableFileRequest {
  location: Location;
}
export type EditableFile = LoadEditableFileResponseDto;
export interface SaveEditableFileRequest {
  location: Location;
  destination?: Location;
  content: string;
  expectedRevision: string;
  overwriteConflict: boolean;
}
export type EditableFileSave = SaveEditableFileResponseDto;

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
  wholeWord: boolean;
}

/** One match found by a {@link SearchInFileRequest}. */
export type SearchInFileMatch = SearchInFileMatchDto;

/** The result of a {@link SearchInFileRequest}. */
export type SearchInFileResult = SearchInFileResponseDto;
