# 0062 Drag and drop within the app and with the OS

Status: open
Priority: low
Owner: unassigned
Agent: unassigned
Area: desktop
Depends on: 0061, 0048

## Context
`file-manager-coding-agent-spec.md` §15 (table is a drag source and drop target), §23 (drag to and
from Finder/Explorer) and §33 step 10.

## Acceptance Criteria
- Within the app: dragging a selection between panes and tabs starts a copy or move operation
  through the engine (modifier decides; default documented per platform).
- Drop targets highlight clearly, invalid targets are rejected before the drop, and dropping onto a
  directory row targets that directory rather than its parent.
- Native drag-out to Finder/Explorer and drag-in from them, capability-gated via `nativeDragOut`
  (§21) and unavailable in browser mode.
- Dropping files from outside the app starts the appropriate operation with the same conflict and
  confirmation rules as any other operation (§35 — no silent overwrite).
- Keyboard-accessible alternatives exist for everything drag can do (§29).
- Drag of a very large selection does not stall the UI.
- Tests: drop-target resolution and validation logic (unit); native drag verified manually per
  platform and recorded in the task notes.

## Implementation Notes
- Native drag-out requires platform work behind the adapter traits (0058); if a platform cannot be
  supported yet, report the capability as `false` rather than half-implementing it.

## Agent Notes
- Not started.
