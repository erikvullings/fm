import { describe, expect, it, vi } from 'vitest';

import type { EntrySummary } from '../../models';
import {
  bytesToDataUri,
  IMAGE_RANGE_CHUNK_BYTES,
  imageMimeTypeFor,
  PREVIEW_SIZE_LIMIT_BYTES,
  readFullImageDataUri,
  resolvePreviewKind,
} from './content-preview';

function entry(overrides: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id: 'entry-1',
    location: { providerId: 'local', uri: 'file:///tmp/report.txt' },
    name: 'report.txt',
    kind: 'file',
    hidden: false,
    readOnly: false,
    metadataRevision: 1,
    ...overrides,
  };
}

describe('resolvePreviewKind', () => {
  it('resolves directories and symlinks to metadata', () => {
    expect(resolvePreviewKind(entry({ kind: 'directory' }))).toBe('metadata');
    expect(resolvePreviewKind(entry({ kind: 'symlink' }))).toBe('metadata');
  });

  it('resolves an image extension to image', () => {
    expect(resolvePreviewKind(entry({ name: 'photo.png', extension: 'png' }))).toBe('image');
    expect(resolvePreviewKind(entry({ name: 'photo.JPEG', extension: 'JPEG' }))).toBe('image');
  });

  it('resolves any other file extension to text', () => {
    expect(resolvePreviewKind(entry({ name: 'report.txt', extension: 'txt' }))).toBe('text');
    expect(resolvePreviewKind(entry({ name: 'archive.zip', extension: 'zip' }))).toBe('text');
  });
});

describe('imageMimeTypeFor', () => {
  it('prefers a known extension over the reported mimeType', () => {
    expect(
      imageMimeTypeFor(entry({ extension: 'png', mimeType: 'application/octet-stream' })),
    ).toBe('image/png');
  });

  it('falls back to the reported mimeType for an unknown extension', () => {
    expect(imageMimeTypeFor(entry({ extension: 'xyz', mimeType: 'image/x-custom' }))).toBe(
      'image/x-custom',
    );
  });

  it('falls back to a generic type when neither is known', () => {
    expect(imageMimeTypeFor(entry())).toBe('application/octet-stream');
  });
});

describe('bytesToDataUri', () => {
  it('encodes bytes as a base64 data URI', () => {
    const uri = bytesToDataUri(new Uint8Array([72, 101, 108, 108, 111]), 'text/plain');
    expect(uri).toBe(`data:text/plain;base64,${btoa('Hello')}`);
  });
});

describe('PREVIEW_SIZE_LIMIT_BYTES', () => {
  it('is a positive, sensibly small default', () => {
    expect(PREVIEW_SIZE_LIMIT_BYTES).toBeGreaterThan(0);
    expect(PREVIEW_SIZE_LIMIT_BYTES).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
});

describe('readFullImageDataUri', () => {
  it('does not overflow the call stack on a full-size (1 MiB) chunk', async () => {
    // Regression test: a naive `chunks.push(...chunk.data)` spreads ~1,048,576 arguments into a
    // single call and throws "Maximum call stack size exceeded".
    const bytes = new Array<number>(IMAGE_RANGE_CHUNK_BYTES).fill(1);
    const readFileRange = vi.fn().mockResolvedValue({
      data: bytes,
      eof: true,
      length: bytes.length,
      offset: 0,
    });
    const entryValue = entry({ name: 'photo.png', extension: 'png' });
    const uri = await readFullImageDataUri(
      { readFileRange },
      entryValue,
      new AbortController().signal,
    );
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('concatenates multiple chunks in order', async () => {
    const readFileRange = vi
      .fn()
      .mockResolvedValueOnce({ data: [72, 101], eof: false, length: 2, offset: 0 })
      .mockResolvedValueOnce({ data: [108, 108, 111], eof: true, length: 3, offset: 2 });
    const uri = await readFullImageDataUri(
      { readFileRange },
      entry({ name: 'photo.png', extension: 'png' }),
      new AbortController().signal,
    );
    expect(uri).toBe(`data:image/png;base64,${btoa('Hello')}`);
  });
});
