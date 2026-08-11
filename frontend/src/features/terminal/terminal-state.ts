import type { Location } from '../../models';

/** A drawer is visible only while its terminal still belongs to the active folder. */
export function isTerminalVisible(
  openLocations: ReadonlySet<string>,
  activeLocation: Location | undefined,
): boolean {
  return activeLocation !== undefined && openLocations.has(activeLocation.uri);
}
