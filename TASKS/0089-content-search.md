# 0089 Content search across files

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0068

## Context
Total Commander's Alt+F7 "Find files" dialog searches both filenames and file *contents* (grep-like,
with regex support) in one place. Task 0068 shipped the filename/glob half of this as the
`fm-search` crate + `search://local/{searchId}` virtual location, but its Acceptance Criteria
explicitly deferred content search ("filters and content search are designed for but explicitly
deferred (§24)") and its Agent Notes confirm content search was NOT attempted in the landed code.

More importantly: **there is no frontend UI to trigger or view a search at all yet**, for either
filenames or content — 0068 shipped the backend engine and OpenAPI-generated `startSearch` client
function only; 0068's own Agent Notes call this out directly ("no dedicated frontend UI (search
bar, results view, click-to-navigate handler) exists yet to consume it ... left as a natural
follow-on"). Confirmed by inspection: nothing in `frontend/src` references `startSearch` outside
the generated API client. This task therefore necessarily includes standing up that missing search
entry point, not just adding a content-matching mode to an existing dialog.

## Acceptance Criteria
- A search dialog/panel (entry point: a new `core.findFiles` action, Total-Commander-style default
  shortcut `Alt+F7`) with: a filename/glob query (reusing 0068's existing filename search
  unchanged), an optional content-search query (plain substring by default, opt-in regex — mirror
  the "regex opt-in and validated before use" convention already used for 0072's multi-rename), and
  a scope (current directory / current directory + subdirectories / one or more chosen roots).
- Backend: extend `fm-search`'s traversal to optionally scan matched (or all, if no filename filter)
  files' contents for the content query, without reading an entire huge file into memory at once —
  chunked/streaming scan per file, bounded per-file time/size so one huge file cannot stall the
  whole search (reuse the streaming-scan mindset from task 0088's Lister search, but do not block on
  0088 landing first — these are independent features that happen to share a scanning approach).
- Skip binary files by heuristic (same NUL-byte sniff convention noted in task 0088) rather than
  attempting a text match against binary content.
- Results stream to the frontend the same way 0068's filename results do (batched
  `search.resultsBatch` events over the existing event stream) — content matches carry enough
  information to jump to the first (or each) match's line/offset in the file, not just "this file
  matched".
- Frontend results view: a virtualized list (reuse the directory-table windowing approach) showing
  matched files with total match count; activating a result navigates to its containing directory
  with the entry selected (0068's existing per-entry `location` already supports this for the
  filename-only case — verify/extend for the content-match case too).
- Search is cancellable and cancels promptly mid-traversal (same `CancellationToken` pattern as
  0068).
- Tests: `fm-search` unit/integration tests for content matching (including a binary-file fixture
  that must be skipped, and a large-file fixture to confirm bounded scanning), Vitest tests for the
  new dialog/results-view component, and an end-to-end route test mirroring
  `apps/fm-server/tests/search_routes.rs`.

## Implementation Notes
- `crates/fm-search/src/engine.rs` (`SearchEngine::start`), `matcher.rs`, `provider.rs`, and
  `store.rs` are the existing pieces to extend — read task 0068's Agent Notes in full before
  starting, they document the current design precisely (batching thresholds, cancellation
  checkpoints, `search://` location handling).
- Do not build a second, competing search entry point if a "quick filter" or similar per-pane UI
  already partially overlaps — task 0067 (quick filter) is explicitly local/client-side and
  distinct from this (see `TASKS/0067-quick-filter.md`: "Distinct from filesystem search (0068) —
  this never hits the backend"), so no overlap there, but double-check no other in-flight task has
  since added a search UI before starting.
- OpenAPI/Orval regen required if `StartSearchRequestDto`/`StartSearchResponseDto` gain new fields
  (content query, scope) — see `AGENTS.md` "Generated code".

## Agent Notes
