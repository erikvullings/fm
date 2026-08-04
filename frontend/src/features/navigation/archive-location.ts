import type { EntrySummary } from '../../models/entry';
import type { Location } from '../../models/location';

const ARCHIVE_SUFFIXES = [
  '.tar.bz2',
  '.tar.gz',
  '.tar.xz',
  '.tbz2',
  '.7z',
  '.rar',
  '.tar',
  '.tbz',
  '.tgz',
  '.txz',
  '.zip',
] as const;

/** Returns the folder-like archive root for a supported local archive entry. */
export function archiveRootForEntry(entry: EntrySummary): Location | undefined {
  if (entry.kind !== 'file' || entry.location.providerId !== 'local') return undefined;
  const lowerName = entry.name.toLocaleLowerCase('en-US');
  if (!ARCHIVE_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) return undefined;
  if (!entry.location.uri.startsWith('file://')) return undefined;

  return {
    providerId: 'archive',
    uri: `archive://${entry.location.uri.slice('file://'.length)}!/`,
  };
}
