import m from 'mithril';
import type { IconAttrs } from './icons';

/**
 * Vendored subset of Tabler Icons (task 0094), used for the workspace
 * toolbar's navigation/utility buttons.
 *
 * Vendored from https://github.com/tabler/tabler-icons (MIT licensed,
 * Copyright (c) 2020-2024 Paweł Kuna) — a curated subset of the
 * `icons/outline/*.svg` sources, reproduced verbatim below rather than
 * imported as an asset, since only a handful of glyphs are needed and the
 * codebase already follows this vendoring convention (see `./icons.ts`).
 */

/** Builds an icon renderer from one vendored icon's inner SVG markup (`<path>` elements). */
function trustedStrokeIcon(innerMarkup: string, extraClass: string) {
  return (attrs?: IconAttrs): m.Children => {
    const size = attrs?.size ?? 18;
    return m(
      `svg.fm-icon.fm-icon-tabler.${extraClass}${
        attrs?.className === undefined ? '' : `.${attrs.className}`
      }`,
      {
        'aria-hidden': 'true',
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      // Safe: `innerMarkup` is a hardcoded constant vendored at build time, never user input.
      m.trust(innerMarkup),
    );
  };
}

/** "arrow-left" — back navigation. */
export const arrowLeftIcon = trustedStrokeIcon(
  '<path d="M5 12l14 0" /><path d="M5 12l6 6" /><path d="M5 12l6 -6" />',
  'fm-icon-arrow-left',
);

/** "arrow-right" — forward navigation. */
export const arrowRightIcon = trustedStrokeIcon(
  '<path d="M5 12l14 0" /><path d="M13 18l6 -6" /><path d="M13 6l6 6" />',
  'fm-icon-arrow-right',
);

/** "corner-left-up" — navigate to parent directory. */
export const cornerLeftUpIcon = trustedStrokeIcon(
  '<path d="M18 18h-6a3 3 0 0 1 -3 -3v-10l-4 4m8 0l-4 -4" />',
  'fm-icon-corner-left-up',
);

/** "search" — find files. */
export const searchIcon = trustedStrokeIcon(
  '<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" />',
  'fm-icon-search',
);

/** "command" — command palette. */
export const commandIcon = trustedStrokeIcon(
  '<path d="M7 9a2 2 0 1 1 2 -2v10a2 2 0 1 1 -2 -2h10a2 2 0 1 1 -2 2v-10a2 2 0 1 1 2 2h-10" />',
  'fm-icon-command',
);

/** "settings" — gear, for the settings button. */
export const settingsIcon = trustedStrokeIcon(
  '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065" /><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />',
  'fm-icon-settings',
);

/** "heart" — favourites/bookmarks. */
export const heartIcon = trustedStrokeIcon(
  '<path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />',
  'fm-icon-heart',
);

/** "heart-plus" — add the current location to favourites. */
export const heartPlusIcon = trustedStrokeIcon(
  '<path d="M12 20l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.96 6.053" />' +
    '<path d="M16 19h6" /><path d="M19 16v6" />',
  'fm-icon-heart-plus',
);

/** "plus" — add the current location to favourites. */
export const plusIcon = trustedStrokeIcon(
  '<path d="M12 5l0 14" /><path d="M5 12l14 0" />',
  'fm-icon-plus',
);

/** "layout-grid" — workspace switcher. */
export const layoutGridIcon = trustedStrokeIcon(
  '<path d="M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" />' +
    '<path d="M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" />' +
    '<path d="M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" />' +
    '<path d="M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" />',
  'fm-icon-layout-grid',
);

/** "x" — close a dialog/disclosure panel. */
export const closeIcon = trustedStrokeIcon(
  '<path d="M18 6l-12 12" /><path d="M6 6l12 12" />',
  'fm-icon-close',
);

/** "eye-off" — hidden-entry indicator in the directory table's name column. */
export const eyeOffIcon = trustedStrokeIcon(
  '<path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />' +
    '<path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />' +
    '<path d="M3 3l18 18" />',
  'fm-icon-eye-off',
);

/** "filter" — the pane's inline quick-filter box. */
export const filterIcon = trustedStrokeIcon(
  '<path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.414 -4.414a2 2 0 0 1 -.586 -1.414v-2.172z" />',
  'fm-icon-filter',
);
