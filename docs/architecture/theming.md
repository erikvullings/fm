# Theming

The frontend has one visual token system in `frontend/src/themes/theme.css`. Components consume
`--fm-*` variables and must not declare literal theme colours. A Vitest source guard scans
non-generated frontend TypeScript and CSS and rejects hex colour literals outside `src/themes/`.

## Runtime themes

The root `data-theme` attribute is the runtime interface:

- `data-theme="light"` selects the light palette.
- `data-theme="dark"` selects the dark palette.
- no `data-theme` attribute means follow system. A `prefers-color-scheme: dark` query supplies the
  dark palette; the light palette is the default.

`mithril-materialized`'s `ThemeManager` owns that attribute. Its `light`, `dark`, and `auto` values
therefore switch both Materialized controls and custom file-manager UI without a reload.
Materialized's `--mm-*` variables map back to the corresponding `--fm-*` tokens, including
backgrounds, surfaces, text, borders, inputs, selection, hover, accent, and error colours.

## Token contract

The palette tokens are `--fm-background`, `--fm-surface`, `--fm-surface-elevated`, `--fm-text`,
`--fm-text-muted`, `--fm-border`, `--fm-accent`, `--fm-selection`,
`--fm-selection-inactive`, `--fm-hover`, `--fm-error`, `--fm-warning`, and `--fm-success`.
Density and shape use `--fm-row-height`, `--fm-font-family`, `--fm-font-size`, `--fm-radius`, and
`--fm-shadow`.

Use `--fm-selection` only in the active pane. The shared row convention uses `.fm-selected-row`
for selection and `.fm-pane[data-active="true"]` to promote it from the inactive to active
selection token. Selection has an inset edge marker; `.fm-cursor-row` uses a dashed outline.
Consequently selection and keyboard cursor remain distinguishable without relying on colour.

## Accessibility verification

WCAG AA requires at least 4.5:1 contrast for normal text. The theme test calculates relative
luminance from the shipped token values and enforces that threshold for text on the normal surface,
active selection, and inactive selection.

| Theme | Surface | Active selection | Inactive selection |
| --- | ---: | ---: | ---: |
| Light | 16.27:1 | 12.24:1 | 13.20:1 |
| Dark | 14.40:1 | 7.57:1 | 9.64:1 |

When `prefers-reduced-motion: reduce` is active, the theme stylesheet reduces transitions and
animations to effectively zero duration and disables smooth scrolling.
