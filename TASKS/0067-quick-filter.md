# 0067 Quick filter

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0029

## Context
`file-manager-coding-agent-spec.md` §24 item 1 and §16 milestone 3. The quick filter narrows the
currently loaded directory and must stay entirely responsive.

## Acceptance Criteria
- `Ctrl/Cmd+F` opens an inline filter in the active pane; `Esc` clears and closes it.
- Filters the loaded snapshot in the frontend with plain-text matching, case-insensitive, updating
  as the user types with no perceptible lag on 100,000 entries.
- The status bar shows "N of M shown"; clearing restores the full list.
- Cursor and selection behave sensibly across filtering: selection is preserved by `EntryId` and
  hidden-but-selected entries are reported in the status bar.
- Filtering interacts correctly with paging: it is clear whether unloaded pages are excluded, and
  the UI says so rather than implying the directory has fewer entries.
- Glob and regex modes are designed for but not implemented (§24); the mode enum exists with one
  variant.
- Vitest tests: matching, selection preservation, status counts, clear behaviour.

## Implementation Notes
- Distinct from filesystem search (0068) — this never hits the backend.
- Hidden-file visibility is a separate setting, not a filter.

## Agent Notes
- Not started.
