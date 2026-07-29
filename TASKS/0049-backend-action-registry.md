# 0049 Backend action registry

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0036

## Context
`file-manager-coding-agent-spec.md` §18 — everything invokable from the UI is an action, and menus,
context menus, toolbars, the command palette and keyboard shortcuts all invoke the same registry.

## Acceptance Criteria
- `ActionDescriptor` as in §18: `id`, `title`, `description`, `category`, `default_shortcuts`,
  `context_requirements`, `parameter_schema`, `source`.
- Core actions registered with the ids listed in §18: `core.open`, `core.openWith`, `core.copy`,
  `core.move`, `core.rename`, `core.delete`, `core.createDirectory`, `core.openTerminal`,
  `core.copyPath`, `core.copyRelativePath` (plus selection/navigation actions from 0028).
  Actions whose feature does not exist yet are registered as unavailable, not omitted.
- `GET /api/v1/actions` → `listActions` and `POST /api/v1/actions/{actionId}/invoke` →
  `invokeAction`, mirrored as Tauri commands.
- Invocation carries a typed context (active pane, selection, cursor entry) and the backend
  re-validates `context_requirements` — the backend is authoritative even though the frontend may
  pre-evaluate availability for rendering (§18).
- Invoking an unavailable or unknown action returns a typed error, never a panic.
- Actions that mutate files delegate to the operation engine and return an `OperationId`.
- Unit tests: registration, duplicate-id rejection, context requirement evaluation, invocation
  routing.

## Implementation Notes
- `KeyChord` needs a serializable, platform-aware representation (`Cmd` vs `Ctrl`) shared with the
  frontend dispatcher (0050).
- The registry must accept plugin-contributed actions later (0053) — keep `ActionSource` open.

## Agent Notes
- Not started.
