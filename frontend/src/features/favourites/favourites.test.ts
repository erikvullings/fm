import { describe, expect, it } from 'vitest';
import type { Location } from '../../models';
import { MAX_RECENT_LOCATIONS, recordRecentLocation, reorderFavourites } from './favourites';

const location = (name: string): Location => ({ providerId: 'local', uri: `file:///tmp/${name}` });

describe('recordRecentLocation', () => {
  it('puts a visit first, deduplicates it, and bounds the list', () => {
    const first = location('first');
    const existing = Array.from({ length: MAX_RECENT_LOCATIONS }, (_, index) => location(`${index}`));

    expect(recordRecentLocation(existing, first).map((item) => item.uri)).toEqual([
      first.uri,
      ...existing.filter((item) => item.uri !== first.uri).slice(0, MAX_RECENT_LOCATIONS - 1).map((item) => item.uri),
    ]);
  });

  it('does not restore a location removed from favourites', () => {
    const removed = location('removed');
    const existing = [location('kept')];

    expect(recordRecentLocation(existing, removed, [removed])).toEqual(existing);
  });
});

describe('reorderFavourites', () => {
  it('moves a favourite while preserving every other favourite order', () => {
    const favourites = ['One', 'Two', 'Three'].map((label) => ({ label, location: location(label) }));
    expect(reorderFavourites(favourites, 2, 0).map((favourite) => favourite.label)).toEqual([
      'Three',
      'One',
      'Two',
    ]);
  });
});
