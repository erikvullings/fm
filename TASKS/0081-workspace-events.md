# 0081 Workspace events over the shared event bus

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0080, 0031

## Context
`file-manager-coding-agent-spec.md` §5.3.11 and §10. Workspace events describe configuration
changes only; directory contents keep arriving through the separate snapshot/delta events (0019,
0020, 0032).

## Acceptance Criteria
- Every `WorkspaceCommand` from 0080 publishes exactly one of the 12 named events from §5.3.11
  (`workspace.created`, `workspace.renamed`, `workspace.opened`, `workspace.closed`,
  `workspace.deleted`, `workspace.layoutChanged`, `workspace.activePaneChanged`,
  `workspace.tabAdded`, `workspace.tabClosed`, `workspace.tabActivated`, `workspace.tabNavigated`,
  `workspace.tabViewChanged`) through the `EventBus` (0031), each envelope carrying the workspace
  id, the new `revision`, and a mutation-specific payload.
- `workspace.opened`/`workspace.closed` are also published on the lifecycle transitions from §5.3.7
  (startup, switching workspaces), not only in response to an explicit command.
- Payload shapes are covered by a fixture test shared with the frontend event union (mirroring
  0014's approach), so the SSE (0032) and Tauri (0034) transports need no workspace-specific changes
  once they exist.
- Directory contents are never embedded in a workspace event (§5.3.11) — asserted by a test that a
  directory-snapshot-shaped payload cannot type-check as a workspace event payload.
- Unit tests: one event per command/lifecycle transition, with the correct revision and payload
  shape.

## Implementation Notes
- This task only wires publication into `WorkspaceService`; it does not implement SSE or Tauri
  transport — 0032/0034 already carry any `EventEnvelope` generically.

## Agent Notes
- Not started.
