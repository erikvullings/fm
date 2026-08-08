# 0062 Drag and drop within the app and with the OS

Status: done
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
- 2026-08-08 Codex: Implemented typed in-app drag/drop for selections between panes and onto loaded
  tabs. Directory rows resolve to themselves while files/empty space resolve to the containing
  directory; unavailable, read-only, same-location, and source-subtree targets are rejected during
  `dragover`, and valid targets receive a visible outline. Accepted drops start ordinary `copy` or
  `move` operations with `conflictPolicy: ask`, so drag uses the same conflict/confirmation engine
  as clipboard paste and never mutates files in TypeScript. Move is the documented default;
  Option requests copy on macOS and Control requests copy elsewhere. Existing Ctrl/Cmd+C/X/V is
  the keyboard-accessible equivalent. Drag payloads use one small internal marker rather than
  serializing the selection through `DataTransfer`; source locations stay in frontend state.
  Added 5 task-specific Vitest cases: 3 drop resolution/validation/modifier tests, 1 table event
  test, and 1 cross-pane operation-dispatch test. The three task test files pass (118 tests total
  in those files, including 5 attributable to this task).
  Native OS drag-in/out is deliberately not half-implemented: every current platform adapter still
  reports `nativeDragOut: false`, so it is unavailable in browser mode and all current desktop
  builds per the Implementation Notes. Manual platform verification therefore records macOS,
  Windows, and Linux as unavailable rather than falsely claiming an interactive native test.
  Full frontend Vitest: 692 passed, 1 skipped, with three pre-existing failures unrelated to this
  task (CodeMirror viewer mount timing, stale mock action list, and a CSS whitespace-string test).
  Typecheck has no new errors; three pre-existing errors remain in archive optional-property test
  data/configuration. `git diff --check` is clean. No CLAUDE.md exists; AGENTS.md needed no change
  because no development contract changed. README documents the new user-facing behavior.
