# 0037 Operation: create directory

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0036

## Context
`file-manager-coding-agent-spec.md` §33 step 7 item 1 — the first real operation, deliberately the
simplest, to prove the whole path from keypress to event-driven refresh.

## Acceptance Criteria
- `OperationKind::CreateDirectory` implemented in the engine via the provider's `create_directory`.
- Rejects with typed errors: name already exists, invalid characters for the platform, reserved
  Windows device names, empty name, path traversal in the name.
- Optionally creates intermediate directories only when explicitly requested; never implicitly.
- `F7` opens a create-directory dialog (`mithril-materialized`) pre-focused, `Esc` cancels,
  `Enter` confirms; the new directory is selected and scrolled into view after creation.
- The affected directory refreshes through a delta event, not a manual full reload.
- Integration tests in a temp directory: success, name collision, invalid name, permission denied
  (where testable), Unicode name.
- Frontend test: dialog validation and post-create selection.

## Implementation Notes
- Never test destructive or mutating operations outside temporary test roots (§27, §35).
- This task establishes the pattern (engine kind → service → REST/Tauri → UI → event refresh) that
  0038–0044 follow; keep it clean.

## Agent Notes
- Not started.
