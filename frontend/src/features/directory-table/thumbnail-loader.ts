import m from 'mithril';

import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { EntrySummary } from '../../models';
import { isParentEntry } from '../panes/parent-entry';

export type ThumbnailSize = 'small' | 'medium' | 'large';

type ThumbnailClient = Pick<FileManagerClient, 'getThumbnail'>;

/** Extensions the backend can generate a preview for (task 0134): plain images
 * directly, CBZ/CBR comic archives via their first page. Kept in sync with
 * `fm_metadata::SUPPORTED_IMAGE_EXTENSIONS` plus the cbz/cbr special case. */
const THUMBNAILABLE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'cbz', 'cbr']);

function isThumbnailable(entry: EntrySummary): boolean {
  if (entry.kind !== 'file') return false;
  if (isParentEntry(entry.id)) return false;
  return THUMBNAILABLE_EXTENSIONS.has((entry.extension ?? '').toLocaleLowerCase());
}

function cacheKey(entry: EntrySummary, size: ThumbnailSize): string {
  return `${entry.location.uri}:${size}`;
}

function jpegDataUri(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** Lazily resolves and caches thumbnails without delaying directory row/tile
 * rendering (task 0134) - mirrors {@link NativeIconLoader}'s lazy/dedup/cache
 * shape, keyed per entry+size rather than per extension since a thumbnail is
 * specific to one file's content, not shared across every file of a type. */
export class ThumbnailLoader {
  private readonly thumbnails = new Map<string, string | undefined>();
  private readonly pending = new Set<string>();

  constructor(
    private readonly client: ThumbnailClient,
    private readonly redraw: () => void = m.redraw,
  ) {}

  thumbnailDataUri(entry: EntrySummary, size: ThumbnailSize): string | undefined {
    if (!isThumbnailable(entry)) return undefined;
    const key = cacheKey(entry, size);
    if (this.thumbnails.has(key)) return this.thumbnails.get(key);
    if (this.pending.has(key)) return undefined;

    this.pending.add(key);
    void this.client
      .getThumbnail(entry.location.uri, size)
      .then((bytes) =>
        this.thumbnails.set(key, bytes === undefined ? undefined : jpegDataUri(bytes)),
      )
      .catch(() => this.thumbnails.set(key, undefined))
      .finally(() => {
        this.pending.delete(key);
        this.redraw();
      });
    return undefined;
  }
}
