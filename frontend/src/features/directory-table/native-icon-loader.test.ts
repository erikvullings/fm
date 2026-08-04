import { describe, expect, it, vi } from 'vitest';

import type { FileManagerClient } from '../../api/client/file-manager-client';
import type { EntrySummary } from '../../models';
import { NativeIconLoader } from './native-icon-loader';

function entry(name: string, extension: string): EntrySummary {
  return {
    id: name,
    location: { providerId: 'file', uri: `file:///tmp/${name}` },
    name,
    kind: 'file',
    size: 1,
    modifiedAt: '2026-08-04T00:00:00.000Z',
    hidden: false,
    readOnly: false,
    extension,
    metadataRevision: 1,
  };
}

describe('NativeIconLoader', () => {
  it('loads lazily and caches interleaved entries by normalized extension', async () => {
    const getFileIcon = vi
      .fn<FileManagerClient['getFileIcon']>()
      .mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const redraw = vi.fn();
    const loader = new NativeIconLoader({ getFileIcon }, redraw);

    expect(loader.iconDataUri(entry('first.PDF', 'PDF'))).toBeUndefined();
    expect(loader.iconDataUri(entry('photo.png', 'png'))).toBeUndefined();
    expect(loader.iconDataUri(entry('second.pdf', 'pdf'))).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(getFileIcon).toHaveBeenCalledTimes(2);
    expect(getFileIcon).toHaveBeenNthCalledWith(1, 'file:///tmp/first.PDF');
    expect(getFileIcon).toHaveBeenNthCalledWith(2, 'file:///tmp/photo.png');
    expect(loader.iconDataUri(entry('third.pdf', 'pdf'))).toBe('data:image/png;base64,iVBORw==');
    await vi.waitFor(() => expect(redraw).toHaveBeenCalledTimes(2));
  });

  it('caches an unavailable icon and keeps returning the themed fallback path', async () => {
    const getFileIcon = vi.fn<FileManagerClient['getFileIcon']>().mockResolvedValue(undefined);
    const loader = new NativeIconLoader({ getFileIcon }, vi.fn());
    const textFile = entry('notes.txt', 'txt');

    expect(loader.iconDataUri(textFile)).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(loader.iconDataUri(textFile)).toBeUndefined();
    expect(getFileIcon).toHaveBeenCalledTimes(1);
  });
});
