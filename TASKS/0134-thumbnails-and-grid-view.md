# 0134 Thumbnails for images/video and a grid/icon view mode

Status: open
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

- (none yet)
