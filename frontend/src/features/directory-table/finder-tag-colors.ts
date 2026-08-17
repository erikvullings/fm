import type { FinderTagColor } from '../../models';

/** Finder's seven built-in label colors, in the order Finder's own Tags menu lists them, mapped
 * to the matching CSS custom property (defined once in `themes/theme.css`, task 0136) for
 * badges/pickers - never a hard-coded hex value here (enforced by
 * `themes/component-colours.test.ts`). */
export const FINDER_TAG_COLOR_SWATCHES: ReadonlyMap<
  Exclude<FinderTagColor, 'none'>,
  string
> = new Map([
  ['red', 'var(--fm-finder-tag-red)'],
  ['orange', 'var(--fm-finder-tag-orange)'],
  ['yellow', 'var(--fm-finder-tag-yellow)'],
  ['green', 'var(--fm-finder-tag-green)'],
  ['blue', 'var(--fm-finder-tag-blue)'],
  ['purple', 'var(--fm-finder-tag-purple)'],
  ['gray', 'var(--fm-finder-tag-gray)'],
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
