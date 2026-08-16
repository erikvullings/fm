# 0134 Thumbnails for images/video and a grid/icon view mode

Status: in-progress (MVP shipped: image/CBZ/CBR thumbnails, table icon-column overlay, and a basic grid view with three icon sizes; video/PDF thumbnails, photo-day grouping, grid sort/filter/type-select, and F3 fullscreen preview are follow-up work — see Agent Notes)
Priority: high
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0085, 0018

## Context

Thumbnails are explicitly flagged as an unimplemented capability on both platform integration
tasks — 0059 ("thumbnails... are declared as out of scope") and 0060's README entry ("thumbnails
remain an unimplemented capability") — and no task anywhere in `TASKS/` picks this up. For a
"state-of-the-art" file manager this is table stakes next to Finder, Explorer, and ForkLift: image
and video files should show a real thumbnail instead of (or layered onto) the generic type icon
from 0085/0091, and there should be a grid/icon view mode to browse a folder of photos usefully —
today the directory table (0024) only renders a single dense row-based layout.

This is two related but separable pieces of work: (1) thumbnail generation/caching as a backend
capability, and (2) a grid/icon view mode in the frontend that consumes it. Both are needed for the
feature to be useful, but (1) alone also improves the existing table view (a thumbnail can replace
the icon in the existing icon column for image/video rows without a new view mode).

## Acceptance Criteria

- Backend: a thumbnail service that generates downscaled previews for common image formats (at
  minimum JPEG/PNG/GIF/WebP) and, capability-permitting, video (first-frame extraction) and PDF
  (first-page render) — reuse the same "capability may not exist on every provider/platform, report
  `false` rather than half-implementing" convention already established for `nativeDragOut` (0062)
  and other `PlatformCapabilities` bits.
- Thumbnails are generated lazily (only for visible/requested entries, matching the virtualized
  table's viewport-driven fetch pattern from 0024) and cached on disk keyed by content hash + size,
  invalidated when the source file changes (reuse 0020's filesystem-watch deltas where available).
- A configurable size limit / file-count budget so thumbnailing a directory with thousands of large
  images doesn't stall the UI or exhaust disk cache space.
- The existing icon column (0085/0091) shows a thumbnail instead of the generic type icon for
  supported files once generated, falling back to the current icon while pending or unsupported.
- A new grid/icon view mode, togglable per pane, showing larger thumbnails with filename below —
  this is the "view-mode architecture" flagged as a prerequisite in 0129's Ctrl+F1/Ctrl+F2/
  Ctrl+Shift+F1 cluster; build the view-mode switch generally enough that a future "brief"/"full
  details" mode could reuse it, but only ship grid/icon view now.
- CBR/CBZ display the first image (front/title page).
- The Grid view can operate in photo app mode (toggled on/off or selected) and separate images
  per day.
- Allow for sorting by date/size/extension ascending or descending. Includes filters and
  type-to select functionality. Icon size is small, medium and large.
- Selected thumbnails can use F3 to see the full screen version.
- Tests: thumbnail generation for each supported format, cache invalidation on file change, size/
  count budget enforcement, and a frontend test for the view-mode toggle and thumbnail rendering.

## Implementation Notes

- Check `frontend/src/features/panes/` (post-0114 decomposition) for where the table-vs-future-grid
  split should live; the pane component should own view-mode state, not `app-shell.ts`.
- macOS Quick Look (`qlmanage -t`) can generate high-quality thumbnails for a very wide range of
  formats (including PDFs and many document types) with minimal own code — evaluate shelling out to
  it on macOS specifically vs a pure-Rust image-decoding pipeline shared across platforms, and
  document the tradeoff (macOS-only quality boost vs cross-platform consistency) before deciding.
- Windows has an equivalent shell thumbnail cache (`IThumbnailProvider`) worth the same evaluation.

## Agent Notes

- 2026-08-16 claude: Implemented the MVP slice agreed with the user (image+CBZ/CBR thumbnails,
  icon-column integration, basic grid view) via TDD across backend and frontend. Scope was agreed
  up front via `AskUserQuestion`: video/PDF thumbnails and photo-day grouping/sort/filter/
  type-select/F3 preview were explicitly deferred to a follow-up pass rather than attempted
  half-finished.

  **Backend (new `crates/fm-metadata` content + `crates/fm-application/src/thumbnails.rs`):**
  - `fm-metadata`: pure-Rust thumbnail generation (`image` crate) for JPEG/PNG/GIF/WebP, downscaled
    to one of three sizes (small=64px/medium=128px/large=256px) and re-encoded as JPEG. A 25 MB
    per-file source-size budget (`MAX_SOURCE_BYTES`) is enforced before decoding. A disk cache
    (`ThumbnailCache`) keyed by `sha256(source bytes)-{size}` is content-addressed, so a changed
    file is automatically a cache miss — no separate invalidation step needed (0020's filesystem
    watch deltas were not wired in for this reason: the content-hash key already makes staleness
    impossible, and delta-driven cache priming is a pure performance optimization, not a
    correctness requirement, left as a documented follow-up). The cache is capped at 200 MB
    on-disk via oldest-write-first eviction.
  - `fm-application/src/thumbnails.rs`: `ThumbnailService` (owns the cache + a 4-permit
    `tokio::sync::Semaphore` capping concurrent generations, so a fast-scrolled directory of
    thousands of images can't spawn unbounded CPU-bound decode work at once). Provider-agnostic:
    reads bytes via the existing `FileSystemProvider`/`ProviderRegistry` abstraction (same pattern
    as `content_streaming.rs`), not the OS-native `PlatformAdapter::thumbnail()` stub — so it works
    identically for local files and, in principle, any future provider that supports
    `ProviderCapabilities::READ`.
  - **CBZ/CBR discovery**: both are fully supported with *zero* new dependencies or deferral. The
    existing `ArchiveFileSystemProvider` (zip + `rars` crate, already wired into `fm-archive` for
    general archive browsing) sniffs the real format by magic bytes, not extension — so a `.cbz`
    (zip) or `.cbr` (rar) file is browsable via the same `archive://{path}!/` URI the frontend
    already builds for entering archives (`frontend/src/features/navigation/archive-location.ts`).
    `read_first_comic_page` builds that root location, lists it, picks the first file entry (sorted
    by name) whose extension is a supported image format, and feeds its bytes through the same
    `generate_image_thumbnail` path as a plain image file.
  - **Capability reporting**: deliberately did *not* add a new `RuntimeCapabilitiesDto` boolean.
    `native_thumbnails`/`PlatformCapabilities::THUMBNAILS` already exist end-to-end from task
    0091's icon work but describe *OS-native* thumbnail providers (Quick Look/`IThumbnailProvider`)
    specifically — left `false`/unset since no native path was implemented, which remains accurate.
    The pure-Rust generator's support varies per file format, not per platform, so it's exposed via
    the existing "try the request, 404 falls back to the icon" convention (same as
    `file_icon`/`NativeIconLoader` already do) rather than a coarser global flag.
  - New route `GET /api/v1/thumbnails?uri=&size=` (`apps/fm-server/src/routes/thumbnails.rs`) and
    Tauri command `get_thumbnail` (`apps/fm-desktop/src-tauri/src/commands.rs`), mirroring 0091's
    `icons.rs`/`get_file_icon` exactly. Every `ThumbnailError` maps to `ApplicationError::NotFound`
    (404), matching `file_icon`'s "unsupported → 404 → icon fallback" convention.
  - `DirectoryViewConfiguration`/`DirectoryViewConfigurationDto` extended with `view_mode`
    (`table`/`grid`) and `icon_size` (`small`/`medium`/`large`), both `#[serde(default)]` so a
    workspace saved before this task still deserializes (defaults to `table`/`medium`). A matching
    `DirectoryViewPatch.view_mode`/`.icon_size` lets the frontend's `updateView` workspace command
    persist the toggle per tab, exactly like `sort`/`showHidden`/`foldersFirst` already do.

  **Frontend:**
  - `FileManagerClient.getThumbnail(uri, size, signal?)` implemented on all three adapters
    (http/tauri/mock), and a new `ThumbnailLoader` (`frontend/src/features/directory-table/
    thumbnail-loader.ts`) mirroring `NativeIconLoader`'s lazy/dedup/in-memory-cache shape, keyed
    per-entry+size (not per-extension, since a thumbnail is file-specific).
  - `directory-table.ts`'s icon column now tries a thumbnail first, then the native icon overlay,
    then the themed glyph — the existing fallback chain from 0085/0091 extended by one link.
  - New `DirectoryGrid` component (`frontend/src/features/directory-table/directory-grid.ts`):
    virtualized wrapping-tile grid reusing the table's `DirectoryEntrySource`/`onEndReached`
    contract and the same windowing math (`calculateVisibleWindow`), treating one "row" as a
    horizontal band of tiles instead of one entry. Shares selection/cursor/context-menu/drag-drop
    callback wiring with `DirectoryTable` via a common object built once in `pane.ts`.
  - View-mode toggle: an IconButton labelled "View" between "New tab" and "Favourites" in the
    pane's breadcrumb row (per explicit user request), opening a small menu with List / Small icons
    / Medium icons / Large icons (`role="menuitemradio"`), persisted via the `updateView` command.
  - Manually verified in the browser (mock runtime): toggling table → grid → table, tile rendering
    with themed icon + filename, selection highlighting, and double-click navigation into a folder
    while in grid view all work; independent per-pane state confirmed (left pane in grid, right
    pane in table, simultaneously). Real thumbnail *image* rendering (not just the UI shell) was
    verified via the backend integration tests (`apps/fm-server/tests/thumbnails_routes.rs`) using
    real generated PNG bytes end-to-end through the HTTP route, not through manual browser
    inspection — the mock client fakes non-decodable bytes for speed, so it doesn't exercise real
    JPEG decoding in the browser.

  **Known gaps / explicitly deferred (not silently skipped):**
  - Video first-frame and PDF first-page thumbnails: not implemented. User chose "defer entirely"
    when asked about tech tradeoffs (shell out to `qlmanage -t`/`IThumbnailProvider` vs. pure-Rust
    crates) rather than commit to a dependency decision as part of this MVP. `PlatformAdapter::
    thumbnail()` remains the unimplemented stub it already was; the Implementation Notes' macOS/
    Windows shell-out evaluation was not performed.
  - No dedicated CBR (RAR) test with real archive bytes: `rars` is a reader-only crate (no RAR
    writer exists in the Rust ecosystem — WinRAR's proprietary `rar` tool is the only common
    encoder, unavailable in this environment), and no `.rar`/`.cbr` fixture exists anywhere in the
    repo already, including `fm-archive`'s own test suite. The CBR code path is identical to the
    tested CBZ path (`read_first_comic_page`/`archive_root_for` don't branch on format — the
    archive provider's own magic-byte sniffing picks Zip vs. Rar transparently), so this is a test
    coverage gap on an already-shared code path, not an unverified separate implementation.
  - Grid view sort/filter/type-to-select controls, small/medium/large *photo-app mode with
    day-grouping*, and F3 fullscreen preview: not implemented. The grid reuses whatever sort is
    already active for the pane (no grid-specific sort UI), has no filter/type-ahead beyond what
    the pane's existing quick-filter already provides, and F3 does nothing new for a grid selection
    yet.
  - Inline rename and drag-and-drop are wired into `DirectoryGrid`'s attrs contract (same callback
    shapes as `DirectoryTable`) but rename-in-place UI (an input overlaying the tile) was not built
    — renaming a grid-selected entry has no visible affordance yet, only the callback plumbing.
  - Delta-driven thumbnail cache invalidation (reusing 0020's `DirectoryDelta::EntriesUpdated` to
    avoid re-hashing unchanged files) was not wired in — the content-addressed cache already
    guarantees correctness without it; this would only be a performance optimization for very large
    files repeatedly requested.

  **Verified:** `cargo test --workspace` (full workspace, all crates green) and `cargo clippy
  --workspace --all-targets` (zero warnings) from the repo root; `cargo fmt --all --check` clean.
  Frontend: `pnpm exec tsc --noEmit` clean; `pnpm exec vitest run` — 1120/1121 passing (the one
  failure, `config/mithril-inspector.test.ts`'s production-build timeout test, is pre-existing
  machine-load flakiness unrelated to this change — confirmed by re-running it alone, which
  passes). New test counts for this task specifically: 15 in `fm-metadata` (thumbnail generation +
  cache), 7 in `fm-application/src/thumbnails.rs` (service including CBZ), 3 in `apps/fm-server/
  tests/thumbnails_routes.rs` (HTTP route), 1 in `apps/fm-desktop` (Tauri command), 2 in
  `fm-domain`/`fm-transport-dto` combined (view-mode/icon-size DTO defaults+round-trip) plus the
  `update_view_patches_view_mode_and_icon_size...` test in `fm-application`, 6 in
  `thumbnail-loader.test.ts`, 3 new in `directory-table.test.ts` (thumbnail fallback chain), 11 in
  `directory-grid.test.ts`, and 4 new in `pane.test.ts` (view-mode menu) — all verified by running
  exactly those files/crates, not quoted from a whole-suite total.
  `pnpm run api:export && pnpm run api:generate` was run; the OpenAPI document and generated
  TypeScript client are up to date with the new endpoint and DTO fields.
