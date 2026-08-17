import m from 'mithril';

import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { EntrySummary } from '../../models';
import { isParentEntry } from '../panes/parent-entry';

export type ThumbnailSize = 'small' | 'medium' | 'large';

type ThumbnailClient = Pick<FileManagerClient, 'getThumbnail' | 'readFileRange'>;

/** Extensions the backend can generate a preview for (task 0134): plain images
 * directly, CBZ/CBR comic archives via their first page, MP4/MOV/M4V video via
 * its first H.264 keyframe, and PDF via a first-page embedded image (not a
 * real page render - see `fm_metadata::pdf`'s module docs for that tradeoff).
 * Kept in sync with `fm_metadata::SUPPORTED_IMAGE_EXTENSIONS`/
 * `SUPPORTED_VIDEO_EXTENSIONS`/`SUPPORTED_PDF_EXTENSIONS` plus the cbz/cbr
 * special case. `svg` is handled separately below - it never goes through the
 * (JPEG-only) thumbnail endpoint since the browser already renders it natively. */
const THUMBNAILABLE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'cbz',
  'cbr',
  'mp4',
  'm4v',
  'mov',
  'pdf',
  'svg',
]);

/** Above this size, skip rendering an SVG as a thumbnail rather than inlining an unusually large
 * vector file's full source for every visible row. */
const SVG_THUMBNAIL_SIZE_LIMIT_BYTES = 512 * 1024;

function isThumbnailable(entry: EntrySummary): boolean {
  if (entry.kind !== 'file') return false;
  if (isParentEntry(entry.id)) return false;
  return THUMBNAILABLE_EXTENSIONS.has((entry.extension ?? '').toLocaleLowerCase());
}

function isSvg(entry: EntrySummary): boolean {
  return (entry.extension ?? '').toLocaleLowerCase() === 'svg';
}

function cacheKey(entry: EntrySummary, size: ThumbnailSize): string {
  // An SVG's rendering doesn't depend on the requested tile size (the browser scales the vector
  // markup itself), so it's fetched and cached once per file rather than once per size.
  return isSvg(entry) ? entry.location.uri : `${entry.location.uri}:${size}`;
}

function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Lazily resolves and caches thumbnails without delaying directory row/tile
 * rendering (task 0134) - mirrors {@link NativeIconLoader}'s lazy/dedup/cache
 * shape, keyed per entry+size rather than per extension since a thumbnail is
 * specific to one file's content, not shared across every file of a type. */
/** Caps how many thumbnail/`readFileRange` requests are in flight at once. A directory full of
 * many thumbnailable files (e.g. a folder of SVGs) previously fired one request per visible tile
 * in the same render pass, with only same-key dedup - flooding the server and tripping its rate
 * limiter (429 Too Many Requests) well before any of them completed. */
const MAX_CONCURRENT_REQUESTS = 4;

export class ThumbnailLoader {
  private readonly thumbnails = new Map<string, string | undefined>();
  private readonly pending = new Set<string>();
  private activeRequestCount = 0;
  private readonly waiting: Array<() => void> = [];

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
    const start = (): Promise<string | undefined> => {
      this.activeRequestCount += 1;
      return isSvg(entry)
        ? this.readSvgDataUri(entry)
        : this.client
            .getThumbnail(entry.location.uri, size)
            .then((bytes) =>
              bytes === undefined ? undefined : bytesToDataUri(bytes, 'image/jpeg'),
            );
    };
    // Fire immediately while under the concurrency cap; otherwise queue and let a finishing
    // request's cleanup below start the next queued one. Queuing (not the immediate path) is the
    // only place this adds an extra microtask tick, since `start` runs synchronously otherwise.
    const request =
      this.activeRequestCount >= MAX_CONCURRENT_REQUESTS
        ? new Promise<void>((resolve) => this.waiting.push(resolve)).then(start)
        : start();
    void request
      .then((dataUri) => this.thumbnails.set(key, dataUri))
      .catch(() => this.thumbnails.set(key, undefined))
      .finally(() => {
        this.activeRequestCount -= 1;
        this.waiting.shift()?.();
        this.pending.delete(key);
        this.redraw();
      });
    return undefined;
  }

  /** SVGs render natively in the browser, so this reads the raw markup directly rather than
   * routing through the (JPEG-only) thumbnail endpoint - no server-side rasterization needed. */
  private async readSvgDataUri(entry: EntrySummary): Promise<string | undefined> {
    if (entry.size !== undefined && entry.size > SVG_THUMBNAIL_SIZE_LIMIT_BYTES) return undefined;
    const chunk = await this.client.readFileRange({
      location: entry.location,
      offset: 0,
      length: SVG_THUMBNAIL_SIZE_LIMIT_BYTES,
    });
    if (!chunk.eof) return undefined;
    return bytesToDataUri(Uint8Array.from(chunk.data), 'image/svg+xml');
  }
}
