# 0020 Filesystem watching and directory deltas

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0019, 0031

## Context
`file-manager-coding-agent-spec.md` §6 (`watch`), §5.4 (`DirectoryDelta`) and §33 steps 4 and 6.
Open directories must reflect external changes without a manual refresh.

## Acceptance Criteria
- The local provider implements `watch` for the directories currently open in a pane.
- Changes are coalesced and debounced, then published as `DirectoryDelta` events
  (`EntriesAdded`, `EntriesUpdated`, `EntriesRemoved`, `Reset`) with the snapshot `revision` they
  apply to.
- A burst of many changes (e.g. extracting 10,000 files) produces batched deltas, not one event per
  file (§28).
- Watch registrations are reference-counted and released when the last pane leaves the directory;
  no watcher leaks after 100 navigations (asserted by a test).
- If the platform watcher drops events or overflows, the service emits `Reset` with a fresh snapshot
  rather than diverging silently.
- Integration tests create/rename/delete files in a temp directory and assert the emitted deltas.

## Implementation Notes
- Use `notify` with a debouncer; document the per-platform caveats (macOS FSEvents coalescing,
  Windows `ReadDirectoryChangesW` buffer overflow) in `docs/architecture/`.
- Deltas carry stable `EntryId`s so the virtualized table can patch rows without a full re-render
  (§13).

## Agent Notes
- Not started.
