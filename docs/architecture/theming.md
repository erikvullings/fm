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

## Directory entry icons

Per-entry glyphs in the directory table (`frontend/src/features/directory-table/entry-icons.ts`)
are resolved from `entryIconRegistry`, a mutable registry exported from that module rather than
hard-coded in `directory-table.ts`. It holds three maps:

- `kindIcons`: keyed by `EntryKind` (`directory`/`symlink`/`file`), used before any extension/MIME
  match and as the final fallback.
- `extensionIcons`: keyed by lowercased file extension without the leading dot (`png`, `zip`, `pdf`,
  ...), consulted first for `file` entries.
- `mimePrefixIcons`: keyed by a MIME type prefix (`image/`, `audio/`, ...), consulted when an
  entry's extension has no registered icon.

A theme or plugin package overrides or extends the built-in set by mutating these maps directly at
startup, for example:

```ts
import { entryIconRegistry } from '../features/directory-table/entry-icons';
import { psdIcon } from './my-theme-icons';

entryIconRegistry.extensionIcons.set('psd', psdIcon);
```

`createDefaultEntryIconRegistry()` returns a fresh, independent registry (used by tests) built from
the same defaults as the shared `entryIconRegistry` singleton. Every icon renderer has the shape
`(attrs?: IconAttrs) => m.Children`, matching the plain SVG helpers in
`frontend/src/components/icons.ts` (`.fm-icon` class, `currentColor` fill, consistent `viewBox`).
This is a themeable rendering layer only; native OS icons served from the backend
(`runtimeCapabilities.nativeFileIcons`) are a separate, not-yet-implemented overlay tracked by a
follow-up task.

### Catppuccin icon theme (task 0092)

`frontend/src/themes/catppuccin-icons.ts` provides an alternate icon set built on the same
`EntryIconRegistry` extension point, vendoring a curated subset of the MIT-licensed
[`catppuccin/vscode-icons`](https://github.com/catppuccin/vscode-icons) SVGs (Mocha flavor) —
folder/file/symlink glyphs plus common source-code extensions (TypeScript, JavaScript, JSON,
Markdown, HTML, CSS, YAML, TOML, Rust, Python, XML, CSV, git-related dotfiles, lockfiles, logs,
fonts) and MIME-prefix fallbacks (image/audio/video/PDF/ZIP). Unlike the default `.fm-icon`
helpers in `components/icons.ts` (single-path, `currentColor`, `viewBox="0 0 24 24"`), these icons
are reproduced verbatim from the upstream source: multi-path/multi-group, stroke-based, with fixed
per-icon Catppuccin Mocha palette colors, at `viewBox="0 0 16 16"`.

The theme is selected through `Settings.iconTheme` (`'generic' | 'catppuccin'`, persisted through
the backend `Settings` entity per specification §26 — not `localStorage`) and applied via
`installCatppuccinIconTheme()` / `restoreDefaultIconTheme()`, called from `app-shell.ts`'s
`applyAppearance()` alongside the other live-appearance settings. The Settings Editor's
Appearance section exposes it as a `Select` next to date/size format.
