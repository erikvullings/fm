# 0085 Directory entry icons

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0058

## Context
Follow-up from a pane-regression investigation: the user expected per-entry file/folder icons in
the directory table, assuming task 0059 (macOS platform integration) had added them. It didn't —
0059/0060 only implemented native icon *fetching* as a backend capability
(`fm-platform-macos`/`fm-platform-windows` `file_icon`, cached by extension/UTI) with no HTTP
route, Tauri command, or frontend consumer. `EntrySummary.icon_key` is hardcoded to `None`
everywhere it's constructed (`fm-vfs-local`, `fm-search`, `fm-application/directory.rs`). The
runtime capability flag `nativeFileIcons` (`RuntimeCapabilitiesDto.native_file_icons`) already
flows to the frontend (see `crates/fm-application/src/service.rs` `runtime_capabilities()`) but is
currently unused. As a stopgap, generic kind-based glyphs (`folderIcon`/`fileIcon`/`symlinkIcon` in
`frontend/src/components/icons.ts`) were added to the `core.name` column in
`frontend/src/features/directory-table/directory-table.ts`; this task replaces/extends that.

## Design question to resolve first
Two ways to source icons, not mutually exclusive:
1. **Theme plumbing (frontend-only):** a themeable per-kind/per-extension icon map (SVG glyphs or
   a `mask-image`/CSS-custom-property based icon font), resolved entirely client-side, no backend
   involvement. Matches the existing `--fm-*` token pattern in `docs/architecture/theming.md`.
2. **Served from the background:** the backend fetches real OS icons (already implemented for
   macOS, task 0060 for Windows) and serves them as bytes over a new HTTP route + matching Tauri
   command, keyed by `icon_key`/extension; the frontend fetches and caches them.

**Recommendation:** do both, layered — (1) is the baseline and the actual "theme" surface (always
available, zero network/IPC cost, instantly swappable), and (2) is an opt-in enhancement that
overlays real native icons on top of it when `runtimeCapabilities.nativeFileIcons` is true and the
icon has loaded, falling back to (1) while loading/unavailable/on non-native hosts (browser mode,
or platforms without a `fm-platform-*` icon implementation). This keeps parity across hosts (per
`AGENTS.md`, browser and Tauri must both work) since browser mode simply never gets past the
theme-icon fallback unless `fm-server` also serves native icons.

## Acceptance Criteria
- A themeable icon-resolution module (e.g. `frontend/src/features/directory-table/entry-icons.ts`)
  maps `EntryKind` (`file`/`directory`/`symlink`) plus `extension`/`mimeType` to an icon renderer,
  replacing the current inline `entryTypeIcon` in `directory-table.ts`.
- **Theme-creator replaceability is a hard requirement**: the icon set must be overridable without
  editing `directory-table.ts` — e.g. a single exported map/registry keyed by extension/kind that a
  theme package can import and extend/replace, or CSS custom properties (`--fm-icon-*`) analogous
  to the existing `--fm-*` token contract in `docs/architecture/theming.md`. Document the extension
  point there.
- Default icon set ships built-in (folder/file/symlink at minimum; a handful of common extensions
  such as image/archive/audio/video/pdf is a reasonable v1 scope — do not attempt exhaustive
  extension coverage).
- When `runtimeCapabilities.nativeFileIcons` is true: a new backend endpoint (HTTP route in
  `fm-server` + Tauri command, both calling the existing `PlatformAdapter::file_icon`) serves icon
  bytes keyed by extension/UTI (not per-entry — preserve the existing one-lookup-per-extension
  cache behaviour from 0059/0060, §28). The frontend fetches lazily (on first row render of a
  given extension) and caches client-side (in-memory is enough; no need to persist across reloads).
- Native icon fetch failures or unsupported hosts silently fall back to the themed glyph — never a
  broken image or blank cell.
- Works identically in both `pnpm dev:http` (browser) and `pnpm dev:tauri` (desktop) hosts; a host
  without the capability (browser talking to a non-icon-serving `fm-server`, or `nativeFileIcons:
  false`) only ever shows the themed glyphs, which is an acceptable, fully-functional default.
- Tests: icon-resolution map unit tests, a directory-table render test asserting the right themed
  glyph per kind/extension, and (if the backend piece lands in this task rather than a split
  follow-up) a route/command test asserting the cache-per-extension behavior end-to-end.

## Implementation Notes
- `crates/fm-platform/src/adapter.rs`'s `PlatformAdapter::file_icon` already exists and is
  implemented for macOS (0059); Windows (0060) status should be checked before assuming both hosts
  have it — if only macOS does, ship the native-icon layer as capability-gated per §28/§35 roadmap
  conventions the same way other partial platform features are declared.
- Consider splitting this into two tasks (frontend theme-icon baseline vs. backend-served native
  icon overlay) if the combined scope proves too large for one PR — the baseline alone already
  satisfies the user's immediate "I can't see any icons" complaint and has no backend dependency.
- Reuse the `icon()` helper pattern in `frontend/src/components/icons.ts` for any new built-in SVG
  glyphs (`currentColor` fill, consistent `viewBox`, `.fm-icon` class) rather than inventing a new
  icon primitive.

## Agent Notes
