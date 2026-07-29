import type { EntryId } from './ids';
import type { Location } from './location';

/** The kind of a directory entry, mirroring `fm_transport_dto::EntryKindDto`. */
export type EntryKind = 'file' | 'directory' | 'symlink';

/**
 * A compact summary of a directory entry, suitable for directory listings
 * (spec §5.2), mirroring `fm_transport_dto::EntrySummaryDto`.
 */
export interface EntrySummary {
  id: EntryId;
  location: Location;
  name: string;
  kind: EntryKind;
  size?: number;
  modifiedAt?: string;
  createdAt?: string;
  hidden: boolean;
  readOnly: boolean;
  extension?: string;
  mimeType?: string;
  iconKey?: string;
  metadataRevision: number;
}

/** Filesystem permission information for an entry. */
export interface PermissionsInfo {
  readable: boolean;
  writable: boolean;
  executable: boolean;
  unixMode?: number;
}

/** Ownership information for an entry. */
export interface OwnershipInfo {
  owner?: string;
  group?: string;
}

/** Pixel dimensions of an image entry. */
export interface ImageDimensions {
  width: number;
  height: number;
}

/** Media (audio/video) metadata for an entry. */
export interface MediaMetadata {
  durationSeconds?: number;
  codec?: string;
  bitrateBps?: number;
}

/** Archive-specific metadata for an entry (for example a `.zip` file). */
export interface ArchiveInfo {
  entryCount?: number;
  uncompressedSize?: number;
}

/**
 * Detailed, non-eagerly-fetched metadata for a single entry (spec §5.2),
 * mirroring `fm_transport_dto::EntryMetadataDto`.
 */
export interface EntryMetadata {
  entryId: EntryId;
  permissions?: PermissionsInfo;
  ownership?: OwnershipInfo;
  extendedAttributes: Record<string, string>;
  checksums: Record<string, string>;
  imageDimensions?: ImageDimensions;
  media?: MediaMetadata;
  archive?: ArchiveInfo;
  pluginFields: Record<string, unknown>;
}
