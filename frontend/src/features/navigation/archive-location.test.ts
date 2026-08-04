import { describe, expect, it } from 'vitest';
import type { EntrySummary } from '../../models/entry';
import { archiveRootForEntry } from './archive-location';

function entry(name: string, uri = `file:///tmp/${name}`): EntrySummary {
  return {
    id: name,
    location: { providerId: 'local', uri },
    name,
    kind: 'file',
    hidden: false,
    readOnly: false,
    metadataRevision: 0,
  };
}

describe('archiveRootForEntry', () => {
  it.each(['photos.zip', 'backup.7z', 'old.RAR', 'files.tar', 'files.tar.gz', 'files.tbz2'])(
    'maps %s to its folder-like archive root',
    (name) => {
      expect(archiveRootForEntry(entry(name))).toEqual({
        providerId: 'archive',
        uri: `archive:///tmp/${name}!/`,
      });
    },
  );

  it('leaves ordinary files and non-local entries to the normal open action', () => {
    expect(archiveRootForEntry(entry('notes.txt'))).toBeUndefined();
    expect(
      archiveRootForEntry({
        ...entry('nested.zip'),
        location: { providerId: 'archive', uri: 'archive:///tmp/outer.zip!/nested.zip' },
      }),
    ).toBeUndefined();
  });
});
