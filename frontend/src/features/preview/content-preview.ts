import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { EntrySummary } from '../../models';
import { IMAGE_EXTENSIONS } from '../directory-table/entry-icons';

/**
 * Which inline preview renderer applies to an entry (task 0071's renderer registry, shared by
 * the cursor-driven preview panel and the Lister-style large-file viewer, task 0088). Extension
 * alone never proves an entry is safely textual - callers must also check the fetched chunk's
 * `probablyBinary` flag before rendering "text" content.
 */
export type PreviewKind = 'text' | 'image' | 'metadata' | 'unsupported';

/**
 * Above this size, the lightweight cursor-driven preview panel shows a "too large to preview"
 * state instead of fetching content (task 0071's configurable-size-limit AC). The Lister viewer
 * (task 0088) has no such limit since it never loads more than its visible window. Fast-follow:
 * expose this as a user setting instead of a fixed constant.
 */
export const PREVIEW_SIZE_LIMIT_BYTES = 2 * 1024 * 1024;

/** Bytes fetched for a text preview snippet - enough for a few dozen lines without over-fetching. */
export const TEXT_PREVIEW_BYTES = 8 * 1024;

/** Resolves the preview/viewer renderer kind for `entry` from its kind and extension. */
export function resolvePreviewKind(entry: EntrySummary): PreviewKind {
  if (entry.kind !== 'file') {
    return 'metadata';
  }
  const extension = entry.extension?.toLowerCase();
  if (extension !== undefined && IMAGE_EXTENSIONS.includes(extension)) {
    return 'image';
  }
  return 'text';
}

const IMAGE_MIME_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

/** The MIME type to use for an `<img>` data URI, preferring the extension over a stale/generic
 * server-reported `mimeType`. */
export function imageMimeTypeFor(entry: EntrySummary): string {
  const extension = entry.extension?.toLowerCase();
  const byExtension =
    extension === undefined ? undefined : IMAGE_MIME_TYPES_BY_EXTENSION[extension];
  return byExtension ?? entry.mimeType ?? 'application/octet-stream';
}

/**
 * Encodes raw bytes as a `data:` URI, the same approach `NativeIconLoader` uses for native icons
 * - avoids `URL.createObjectURL`, which jsdom does not implement, and needs no explicit revoke.
 */
export function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Bytes fetched per `readFileRange` call when reading a whole image - matches the backend's
 * `MAX_RANGE_LENGTH` cap so every request is served in one round trip when possible. */
export const IMAGE_RANGE_CHUNK_BYTES = 1024 * 1024;

/** Client surface required to read an image's full bytes in range-sized chunks. */
export type ImageRangeClient = Pick<FileManagerClient, 'readFileRange'>;

/**
 * Reads an entire image file as range-sized chunks (respecting the backend's per-request byte
 * cap) and encodes it as a `data:` URI. Shared by the cursor-driven preview panel (which never
 * reaches this for entries over {@link PREVIEW_SIZE_LIMIT_BYTES}) and the Lister-style viewer
 * (which has no such limit - full images are always shown, per Total Commander convention).
 */
export async function readFullImageDataUri(
  client: ImageRangeClient,
  entry: EntrySummary,
  signal: AbortSignal,
): Promise<string> {
  // Accumulate as typed-array segments rather than spreading each chunk's `number[]` into a
  // shared array (`chunks.push(...chunk.data)`) - for a 1 MiB chunk that spreads ~1,048,576
  // arguments into a single call and throws "Maximum call stack size exceeded".
  const segments: Uint8Array[] = [];
  let totalLength = 0;
  let offset = 0;
  for (;;) {
    const chunk = await client.readFileRange(
      { location: entry.location, offset, length: IMAGE_RANGE_CHUNK_BYTES },
      signal,
    );
    const segment = Uint8Array.from(chunk.data);
    segments.push(segment);
    totalLength += segment.length;
    offset += chunk.length;
    if (chunk.eof || chunk.length === 0) break;
  }
  const bytes = new Uint8Array(totalLength);
  let position = 0;
  for (const segment of segments) {
    bytes.set(segment, position);
    position += segment.length;
  }
  return bytesToDataUri(bytes, imageMimeTypeFor(entry));
}
