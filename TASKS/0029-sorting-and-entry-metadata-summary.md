# 0029 Sorting and file metadata summary

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0028

## Context
`file-manager-coding-agent-spec.md` §16 milestone 1 (basic sorting, file metadata summary) and §15
(sorting, multiple sort keys later).

## Acceptance Criteria
- Click or keyboard on a column header sorts ascending/descending by name, extension, size or
  modified time; the active sort is indicated in the header and the status bar.
- Directories sort before files by default, configurable later; the setting is read from settings
  (0030), not hard-coded in the component.
- Sorting is stable, case-insensitive-but-deterministic for names, and uses a natural/numeric
  comparison for names containing digits.
- Sort compares raw values, never formatted display strings (§20 sample plugin 2 makes this a
  general rule).
- Sorting a 100,000-entry directory does not block the UI beyond one frame; measured.
- A metadata summary panel or status area shows details for the cursor entry, fetched lazily through
  `getEntryMetadata` and cancelled when the cursor moves on (§5.2).
- Size and date formatting respect the settings-driven size format and date format (0030).
- Vitest tests cover comparator behaviour (including Unicode, numeric names, missing sizes for
  directories) and lazy metadata cancellation.

## Implementation Notes
- The multi-key sort model can be represented now as a one-element list so §15's "multiple sort keys
  later" needs no rewrite — but do not build the UI for it.
- Server-side sort options exist in the list request (0019); prefer sorting the loaded page in the
  frontend for responsiveness and let the server sort when paging.

## Agent Notes
- Not started.
