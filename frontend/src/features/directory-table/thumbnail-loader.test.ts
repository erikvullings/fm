import { describe, expect, it, vi } from 'vitest';

import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { EntrySummary } from '../../models';
import { ThumbnailLoader } from './thumbnail-loader';

function entry(name: string, extension: string, kind: EntrySummary['kind'] = 'file'): EntrySummary {
  return {
    id: name,
    location: { providerId: 'file', uri: `file:///tmp/${name}` },
    name,
    kind,
    size: 1,
    modifiedAt: '2026-08-04T00:00:00.000Z',
    hidden: false,
    readOnly: false,
    extension,
    metadataRevision: 1,
  };
}

describe('ThumbnailLoader', () => {
  it('loads lazily and caches interleaved entries by uri and size', async () => {
    const getThumbnail = vi
      .fn<FileManagerClient['getThumbnail']>()
      .mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    const redraw = vi.fn();
    const loader = new ThumbnailLoader({ getThumbnail }, redraw);

    expect(loader.thumbnailDataUri(entry('first.png', 'png'), 'small')).toBeUndefined();
    expect(loader.thumbnailDataUri(entry('second.jpg', 'jpg'), 'small')).toBeUndefined();
    // Same file requested again before the first fetch resolves - must dedup, not refetch.
    expect(loader.thumbnailDataUri(entry('first.png', 'png'), 'small')).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(getThumbnail).toHaveBeenCalledTimes(2);
    expect(getThumbnail).toHaveBeenNthCalledWith(1, 'file:///tmp/first.png', 'small');
    expect(getThumbnail).toHaveBeenNthCalledWith(2, 'file:///tmp/second.jpg', 'small');
    expect(loader.thumbnailDataUri(entry('first.png', 'png'), 'small')).toBe(
      'data:image/jpeg;base64,/9j/4A==',
    );
    await vi.waitFor(() => expect(redraw).toHaveBeenCalledTimes(2));
  });

  it('fetches the same file again for a different requested size', async () => {
    const getThumbnail = vi
      .fn<FileManagerClient['getThumbnail']>()
      .mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    const loader = new ThumbnailLoader({ getThumbnail }, vi.fn());
    const file = entry('photo.png', 'png');

    loader.thumbnailDataUri(file, 'small');
    loader.thumbnailDataUri(file, 'large');
    await Promise.resolve();
    await Promise.resolve();

    expect(getThumbnail).toHaveBeenCalledTimes(2);
    expect(getThumbnail).toHaveBeenNthCalledWith(1, 'file:///tmp/photo.png', 'small');
    expect(getThumbnail).toHaveBeenNthCalledWith(2, 'file:///tmp/photo.png', 'large');
  });

  it('does not fetch for a directory or an unsupported extension', () => {
    const getThumbnail = vi.fn<FileManagerClient['getThumbnail']>();
    const loader = new ThumbnailLoader({ getThumbnail }, vi.fn());

    expect(loader.thumbnailDataUri(entry('folder', '', 'directory'), 'small')).toBeUndefined();
    expect(loader.thumbnailDataUri(entry('notes.txt', 'txt'), 'small')).toBeUndefined();
    expect(getThumbnail).not.toHaveBeenCalled();
  });

  it('caches an unavailable thumbnail and keeps returning the icon fallback path', async () => {
    const getThumbnail = vi.fn<FileManagerClient['getThumbnail']>().mockResolvedValue(undefined);
    const loader = new ThumbnailLoader({ getThumbnail }, vi.fn());
    const file = entry('broken.png', 'png');

    expect(loader.thumbnailDataUri(file, 'small')).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.thumbnailDataUri(file, 'small')).toBeUndefined();
    expect(getThumbnail).toHaveBeenCalledTimes(1);
  });

  it('resolves to undefined if the client rejects, instead of throwing', async () => {
    const getThumbnail = vi
      .fn<FileManagerClient['getThumbnail']>()
      .mockRejectedValue(new Error('boom'));
    const loader = new ThumbnailLoader({ getThumbnail }, vi.fn());
    const file = entry('flaky.png', 'png');

    expect(loader.thumbnailDataUri(file, 'small')).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.thumbnailDataUri(file, 'small')).toBeUndefined();
  });

  it('treats cbz and cbr archives as thumbnailable', () => {
    const getThumbnail = vi.fn<FileManagerClient['getThumbnail']>().mockResolvedValue(undefined);
    const loader = new ThumbnailLoader({ getThumbnail }, vi.fn());

    loader.thumbnailDataUri(entry('issue.cbz', 'cbz'), 'medium');
    loader.thumbnailDataUri(entry('issue.cbr', 'cbr'), 'medium');

    expect(getThumbnail).toHaveBeenCalledTimes(2);
  });
});
