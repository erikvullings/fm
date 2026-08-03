# 0088 Lister-style instant large-file viewer with lazy search

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0087

## Context
Follow-up from the same footer/viewer conversation as 0087. Total Commander's "Lister" (F3) opens
even multi-gigabyte files instantly by never loading the whole file into memory: it reads and
renders only the visible window, paging content in lazily as the user scrolls, and can still search
across the full file (not just the loaded window) without a full up-front load. Task 0087 ships F3
as a stopgap that just opens the OS default viewer; this task replaces that behaviour with a real
in-app viewer for text-like content once it exists, without changing F3's shortcut/action id/footer
wiring (0087's `core.view` action stays the entry point — its dispatch target changes, not its
identity).

Existing building blocks and gaps, confirmed by inspection:
- `fm-vfs`'s `VfsProvider::open_read` (`crates/fm-vfs/src/provider.rs`) returns a full sequential
  `AsyncRead` stream with no offset/range parameter — sufficient for "load lazily from the start"
  but not for random-access seeking to an arbitrary byte offset (needed to jump to a search hit
  deep in a large file without re-reading everything before it).
- Content search is explicitly out of scope for the existing recursive filesystem search feature
  (task 0068's Acceptance Criteria: "filters and content search are explicitly out of scope per
  spec §24") — there is no reusable in-content search infrastructure anywhere in the codebase.
  This task's search requirement is a new capability, not a wire-up of an existing one.

## Acceptance Criteria
- A new viewer surface (likely a modal/panel, consistent with the existing preview panel from task
  0071 if that ships first — check for overlap before duplicating UI chrome) that opens instantly
  regardless of file size: initial render must not wait on reading the full file.
- Backend: a byte-range read capability (new `VfsProvider` method or an additive HTTP
  `Range`-header-aware endpoint) so the frontend can request "give me bytes N..M" instead of
  streaming from the start every time. Decide whether this belongs on `VfsProvider` itself (works
  for both hosts uniformly) or is HTTP/Tauri-command-specific plumbing built on top of the existing
  `open_read` stream (skip-and-take on the server side) — prefer the former if provider
  implementations (local, and any future archive/remote provider) can support it cheaply, since
  that keeps it host-agnostic per `AGENTS.md`'s browser/Tauri parity rule.
- Frontend: a virtualized text/hex viewer that renders only the visible window (reuse the
  windowing approach from the directory table's virtualization if applicable), fetching adjacent
  chunks lazily as the user scrolls, with a small in-memory LRU of already-fetched chunks so
  scrolling back doesn't always re-fetch.
- Search: incremental substring/regex search that can locate matches outside the currently-loaded
  window without reading the entire file into the frontend at once — e.g. a backend search-within-
  file endpoint that scans server-side and returns match byte offsets (a chunked/streaming scan,
  not a full read into server memory either, so it scales the same way for huge files), with the
  frontend then fetching just the chunk(s) around each match to display. Jump-to-next/previous
  match should feel instant once the offset is known.
- Explicitly scope v1 to text-like content (respect a size/binary-detection heuristic — e.g. sniff
  for NUL bytes in the first chunk, same convention other file managers use); binary/hex viewing
  can be a documented non-goal or a fast-follow, but must not crash or hang on binary input either
  way (fall back to "binary file, cannot preview" rather than attempting to render).
- F3 (`core.view`, task 0087) opens this viewer for text-like files when available, falling back to
  the OS default-application open for binary/unsupported content or hosts where the viewer isn't
  available yet.
- Tests: backend range-read and search-within-file unit/integration tests (including on a
  synthetically large fixture file, per the performance-fixture conventions in task 0065), and a
  frontend viewer component test covering lazy chunk loading and search-driven scroll-to-match.

## Implementation Notes
- This is a substantial feature — expect it to need its own sub-tasks if scoped work turns out
  larger than one PR (e.g. split "backend range read + search" from "frontend virtualized viewer").
  Re-split into 0088a/0088b (or renumber) rather than growing this file indefinitely if that
  happens.
- Reuse `crates/fm-vfs-local`'s existing file-handle patterns for range reads (seek + read, since
  local files trivially support `Seek`); non-seekable or remote providers may need a documented
  reduced-capability path (e.g. read-ahead-and-discard rather than true seek) — treat this the same
  way other provider capabilities are capability-gated (see `fm-vfs/src/capabilities.rs`) rather
  than assuming every provider can do it.
- Check task 0071 (preview service) for overlap before building a second, competing preview/viewer
  UI surface — if 0071 already ships a preview panel shell, extend it rather than duplicating.

## Agent Notes
