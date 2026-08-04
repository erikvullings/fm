# 0097 Directory aggregate totals (size/file count) independent of pagination

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: none

## Context
The pane status bar (task that introduced the Marta-style summary) shows `"<size> in <N> files,
and <M> folders"`. Today this is computed client-side in `frontend/src/features/panes/pane.ts`
(`listingSummary`) purely from `ordinaryEntries` - i.e. only the entries the frontend has paged in
so far, NOT the true total for the directory. For large directories this undercounts until every
page has been fetched (which may never happen automatically - see `loadAllPages` in
`frontend/src/features/navigation/navigation.ts`, only invoked from the End-key/responsive-sort
path, not on every directory open).

This is more tractable than it first looks: `fm-application::directory::DirectoryService::list`
(`crates/fm-application/src/directory.rs`) already calls `list_all(...)` to eagerly fetch **every**
entry from the provider into an in-memory `full_entries` cache before returning even the first
(paginated) page to the client - this is how `total_known_entries` is already populated
accurately on the very first response, well before the frontend has paged in everything. Computing
a true aggregate (total byte size of files, file count, folder count) from that same
already-fully-loaded `full_entries` is a cheap, no-extra-I/O addition, not a new directory walk.

## Acceptance Criteria
- `fm_domain::DirectorySnapshot` (`crates/fm-domain/src/snapshot.rs`) gains
  `total_known_size: Option<u64>` (sum of `size` for every entry whose `kind != Directory`,
  i.e. files and symlinks) and `total_known_file_count: Option<u64>` (count of the same;
  `total_known_entries - total_known_file_count` gives the folder count), mirroring the existing
  `total_known_entries` field's `Option` convention (`None` when not eagerly known, e.g. from
  providers/paths that can't cheaply enumerate everything).
- `crates/fm-application/src/directory.rs` computes both from `full_entries` at every
  `DirectorySnapshot` construction site that already sets `total_known_entries` from a complete
  entry list (the main `list()` first-page path and `publish_changes`'s watch-triggered refresh
  path).
- `fm-transport-dto::DirectorySnapshotDto` (`crates/fm-transport-dto/src/snapshot.rs`) and
  `fm-events`'s equivalent snapshot/delta types mirror the two new fields through both `From`
  impls, the OpenAPI schema example, and existing round-trip tests.
- Regenerate `frontend/openapi/openapi.json` (`pnpm run api:export`) and the Orval client
  (`pnpm run api:generate`) - do not hand-edit either, per `AGENTS.md`.
- Thread the two new optional fields through `frontend/src/models/snapshot.ts`,
  `frontend/src/features/navigation/navigation.ts`, `frontend/src/features/workspace/workspace-layout.ts`,
  and `frontend/src/app/app-shell.ts` into `PaneAttrs`, following the exact pattern already used
  for `totalKnownEntries` at each of those layers.
- `frontend/src/features/panes/pane.ts`'s status bar summary prefers the backend-supplied totals
  when present (accurate immediately, no pagination caveat needed) and falls back to the current
  client-side `ordinaryEntries`-only aggregation only when the backend didn't supply them (e.g.
  providers where eager enumeration isn't cheap).
- `frontend/src/api/client/mock-file-manager-client.ts` populates the new fields so mock-mode
  behaviour matches a real backend.
- Tests: Rust unit tests for the two new aggregate fields (empty directory, mixed
  files/folders/symlinks, a file with `size: None`), and frontend tests confirming the status bar
  uses the backend-supplied totals when present.

## Agent Notes
- Confirmed while investigating the "loading detail should be invisible to the user" status-bar
  complaint: `total_known_entries` is already fully accurate from the very first page (see
  `full_entries.len()` in `crates/fm-application/src/directory.rs`), so the analogous size/file-count
  totals require no new provider-level directory walk - just a sum over data already resident in
  memory. This task exists instead of an ad-hoc same-session patch because it touches the wire
  contract (OpenAPI/Orval regeneration) across ~10 files and deserves the same task-tracked,
  properly-regenerated treatment as any other DTO change, per `AGENTS.md`.
- In the meantime, the status bar's "(N of M loaded)" pagination-progress annotation was removed
  outright (frontend-only change) so the UI doesn't expose the loading detail, even though the
  underlying number is still only as accurate as what's been paged into the frontend so far until
  this task ships.
