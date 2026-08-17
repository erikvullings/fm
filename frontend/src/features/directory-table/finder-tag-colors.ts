import type { FinderTagColor } from '../../models';

/** Finder's seven built-in label colors, in the order Finder's own Tags menu lists them,
 * mapped to a representative swatch color for badges/pickers (task 0136). Approximate - not
 * pixel-matched to a specific macOS version, since these are UI accents, not OS chrome. */
export const FINDER_TAG_COLOR_SWATCHES: ReadonlyMap<
  Exclude<FinderTagColor, 'none'>,
  string
> = new Map([
  ['red', '#fc3b32'],
  ['orange', '#ff9d0a'],
  ['yellow', '#ffcc00'],
  ['green', '#67cc57'],
  ['blue', '#5596f6'],
  ['purple', '#b767cc'],
  ['gray', '#a1a1a1'],
]);

/** Every assignable color, "none" first - matches the order a color picker should offer them. */
export const FINDER_TAG_COLORS: readonly FinderTagColor[] = [
  'none',
  ...FINDER_TAG_COLOR_SWATCHES.keys(),
];

/** CSS color for a tag's swatch/badge dot, or `undefined` for no color (nothing to paint). */
export function finderTagColorSwatch(color: FinderTagColor): string | undefined {
  return color === 'none' ? undefined : FINDER_TAG_COLOR_SWATCHES.get(color);
}

/** Human-readable label for a color option, e.g. in a picker. */
export function finderTagColorLabel(color: FinderTagColor): string {
  if (color === 'none') return 'No Color';
  return color.charAt(0).toUpperCase() + color.slice(1);
}
