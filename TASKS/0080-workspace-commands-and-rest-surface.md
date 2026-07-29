# 0080 Workspace semantic commands, revisions and REST/Tauri surface

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0079, 0008

## Context
`file-manager-coding-agent-spec.md` §5.3.9, §5.3.10, §5.3.12, §7, §8 and §11. The frontend must
never replace arbitrary workspace JSON (§5.3.9) — every mutation goes through a focused command,
verified against the workspace's revision.

## Acceptance Criteria
- `WorkspaceCommand` tagged enum exactly per §5.3.9: `RenameWorkspace`, `SetActivePane`, `AddTab`,
  `CloseTab`, `ActivateTab`, `NavigateTab`, `UpdateView`, `UpdateLayout`, each carrying
  `expected_revision`.
- `WorkspaceService::apply_command` performs, in order: verify the expected revision, validate the
  command, apply the mutation, increment the revision, persist, update the runtime session, and
  return the changed projection (§5.3.9). Event emission is task 0081's concern — accept an
  injectable publisher so this task doesn't have to wait on the event bus.
- A stale `expected_revision` returns the exact structured conflict from §5.3.10: `code:
  "workspaceRevisionConflict"`, `message`, `details.workspaceId`/`expectedRevision`/`actualRevision`.
- Closing a pane's last tab creates a replacement tab at the home directory rather than leaving an
  invalid empty pane (§5.3.4).
- REST endpoints with stable operation ids per §5.3.12 and §9's naming list:
  - `GET /api/v1/workspaces` → `listWorkspaces`
  - `POST /api/v1/workspaces` → `createWorkspace`
  - `GET /api/v1/workspaces/{workspaceId}` → `getWorkspace`
  - `PATCH /api/v1/workspaces/{workspaceId}` (or the commands endpoint below) → applies a
    `WorkspaceCommandDto`
  - `DELETE /api/v1/workspaces/{workspaceId}` → `deleteWorkspace`
  - `POST /api/v1/workspaces/{workspaceId}/open` → `openWorkspace`
  - `POST /api/v1/workspaces/{workspaceId}/commands` → dispatches a tagged `WorkspaceCommandDto`
- Equivalent Tauri commands call the exact same `WorkspaceService` methods (§11, §3 rule 9) — no
  duplicated validation/mutation logic in the Tauri layer.
- Switching the open workspace never cancels operations already running in the operation service
  (§5.3.7) — asserted by a test that the operation-cancellation code path is never invoked on
  workspace switch (full operation-lifecycle testing lands with 0035/0036).
- Debounced persistence (250–750ms) for layout/column-resize-style commands vs. prompt persistence
  for structural commands (add/close tab) (§5.3.8).
- OpenAPI regenerated and `api:check` passes with the new DTOs.
- Integration tests: a full command → REST round trip for every `WorkspaceCommand` variant, a
  stale-revision conflict, and the last-tab-close replacement behaviour.

## Implementation Notes
- `fm-transport-dto` gains the `Workspace` DTO's missing fields (schema version, revision,
  timestamps, operation centre — see 0078) and a tagged `WorkspaceCommandDto` union. Keep this DTO
  work here, not in 0078, which is domain-only.
- Keep Axum handlers thin; all validation/mutation logic lives in `WorkspaceService` (§3 rule 2).

## Agent Notes
- Not started.
