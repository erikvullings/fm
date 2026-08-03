# 0087 F3 view action

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: cross-cutting
Depends on: 0058

## Context
Same footer-completeness follow-up as 0086. Total Commander convention reserves F3 for "View".
`footerFunctionKeyBindings` (`frontend/src/keybindings/dispatcher.ts`) already accepts F2/F3/F4/
F5/F6/F7/F8 sorted ascending, so registering `core.view` with a default `F3` shortcut makes it
appear in the footer in the right slot automatically — no footer changes needed.

For now, F3 View opens the selected file with the system's default application, i.e. behaves like
`core.open` (see `capability_gated_single_selection` / `PlatformCapabilities::
OPEN_WITH_DEFAULT_APPLICATION` in `crates/fm-application/src/action.rs`). This is an intentional
stopgap: task 0088 tracks a real in-app "Lister"-style viewer that F3 should switch to using once
it exists, without changing the shortcut, title, or footer wiring.

## Acceptance Criteria
- New `core.view` action registered in `crates/fm-application/src/action.rs`, category
  `fileOperations`, default shortcut `F3`, single-selection requirement (same shape as
  `core.open`).
- Add `core.view` to `fixtures/mock-responses/actions.json` (title `View`, `contextRequirements:
  {}`, matching mock-fixture convention).
- Invocation dispatch: reuse the existing `open_with_default_application` platform-adapter call
  used by `core.open` — no new platform capability needed for this task.
- Document in the action's description/doc comment that this is a stopgap and task 0088 is the
  real viewer.
- Tests: backend action-registry test for `core.view`'s shortcut/requirements/dispatch, and a
  frontend dispatcher test asserting F3 sits between F2 and F4 in `footerFunctionKeyBindings`
  output.

## Agent Notes
