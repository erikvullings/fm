# 0116 Centralize Selections-to-Locations Translation

Status: open
Priority: medium
Subsystem: frontend
Depends on: none

## Context
The translation from `SelectionState` → array of location URIs (needed for copy, move, paste, delete, etc.) is duplicated in approximately 15 places across AppShell. The selection module (`selection/selection.ts`) is a deep state machine, but nothing downstream leverages that depth. Every caller re-derives "what entries are selected in this pane?" from the selection state, instead of calling a single method.

## Acceptance Criteria
- `getSelectedEntryUris(selection, directoryEntries)` added to selection module interface
- Optionally `getSelectedEntries(selection, directoryEntries)` for callers needing full Entry objects
- All ~15 AppShell call sites replaced with the single function
- Function is pure, tested with selection states from existing `selection.test.ts`
- Zero change in visible behavior — this is a refactor

## Implementation Notes
- `frontend/src/features/selection/selection.ts` (143 lines) — add functions here
- `frontend/src/app/app-shell.ts` — ~15 scatter sites to replace
- `frontend/src/models/location.ts` — location URI types
- Lowest-effort, highest-leverage quick win
- Reference: architecture review — deepening opportunity #5

## Agent Notes
-
