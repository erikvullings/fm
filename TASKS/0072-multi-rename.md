# 0072 Multi-rename tool

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0038, 0051

## Context
`file-manager-coding-agent-spec.md` §16 milestone 3 (multi-rename with preview) and §37.

## Acceptance Criteria
- Entry point: pressing F2 (`core.rename`) with more than one entry selected opens this dialog
  instead of the single-entry inline rename input (see `beginRename` in
  `frontend/src/features/panes/pane.ts`, which currently only implements the single-selection
  inline-input path); F2 with exactly one entry selected keeps using the existing inline rename.
- A multi-rename dialog operating on the current selection with rules for: search and replace,
  prefix, suffix, sequence number (configurable start/step/padding) and case transformation.
- A live preview table shows old name → new name for every selected entry before anything is
  applied (§16).
- Collisions (with each other or with existing files) are detected and highlighted in the preview,
  and applying is blocked until resolved or the conflict policy is chosen.
- Names that are invalid on the target platform are flagged in the preview.
- Applying runs through the operation engine as rename operations — never direct filesystem calls
  from the UI (§35) — and is a single cancellable operation with progress.
- Case-only renames work (reuses 0038's handling).
- The rename plan can be reviewed and cancelled; nothing is applied until confirmed.
- Vitest tests for each rule and for collision detection; Rust integration test for applying a plan.

## Implementation Notes
- The rule engine is a pure function `(entries, rules) → proposed names` so it is fully unit-tested
  and reusable by the "uppercase rename preview" sample plugin (§20 optional plugin 3).
- Regex search/replace should be opt-in and validated before use.

## Agent Notes
- Not started.
