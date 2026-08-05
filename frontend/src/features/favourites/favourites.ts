import type { Location } from '../../models';

/** A named location displayed in the favourites menu. */
export interface FavouriteLocation {
  readonly label: string;
  readonly location: Location;
}

/** Maximum number of recent locations retained for one workspace. */
export const MAX_RECENT_LOCATIONS = 12;

function sameLocation(left: Location, right: Location): boolean {
  return left.providerId === right.providerId && left.uri === right.uri;
}

/**
 * Records a visit without mutating the existing list. The newest visit is first,
 * duplicate locations are collapsed, and locations removed from favourites do
 * not reappear in the recent list.
 */
export function recordRecentLocation(
  existing: readonly Location[],
  location: Location,
  removedFavourites: readonly Location[] = [],
): readonly Location[] {
  if (removedFavourites.some((removed) => sameLocation(removed, location))) return existing;
  return [location, ...existing.filter((candidate) => !sameLocation(candidate, location))].slice(
    0,
    MAX_RECENT_LOCATIONS,
  );
}

/** Moves an existing favourite to a requested position without changing its identity. */
export function reorderFavourites(
  favourites: readonly FavouriteLocation[],
  from: number,
  to: number,
): readonly FavouriteLocation[] {
  if (from < 0 || from >= favourites.length || to < 0 || to >= favourites.length) return favourites;
  const reordered = [...favourites];
  const [favourite] = reordered.splice(from, 1);
  if (favourite === undefined) return favourites;
  reordered.splice(to, 0, favourite);
  return reordered;
}
