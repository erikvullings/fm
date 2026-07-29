# 0082 Frontend WorkspaceProjection, state slice and command dispatch

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0080, 0021, 0011

## Context
`file-manager-coding-agent-spec.md` §5.3.13, §5.3.10 and §13. The frontend must mutate workspaces
only through the semantic commands from 0080, never by replacing arbitrary JSON (§5.3.9), and must
keep a normalized projection rather than copying directory entries into workspace state.

## Acceptance Criteria
- `WorkspaceProjection`/`PaneProjection`/`TabProjection` types in `frontend/src/models/workspace.ts`
  exactly per §5.3.13 — normalized (`paneOrder`/`panesById`, `tabOrder`/`tabsById`), replacing the
  current ad hoc `Workspace` shape from 0011 wherever it no longer matches. Flag any breaking change
  to 0011's existing consumers explicitly in Agent Notes rather than silently adjusting them.
- `AppState.workspace` (0021) is sourced from the projection; directory snapshots are stored
  separately, keyed by tab or directory-session id, so a workspace mutation never replaces or
  copies a large entry array (§5.3.13).
- `WorkspaceViewState` (frontend-only cursor/selection/dialog/drag state, §5.3.3) lives in its own
  state slice, is never sent to the backend and is never derived from or merged into the
  `WorkspaceProjection`.
- `FileManagerClient` (0011) gains the workspace command surface — `listWorkspaces`,
  `createWorkspace`, `renameWorkspace`, `deleteWorkspace`, `openWorkspace`,
  `dispatchWorkspaceCommand` (or an equivalent split into per-command methods) — implemented across
  all three adapters (`Http`/`Tauri`/`Mock`), mirroring how task 0036 extends the interface for
  operations.
- A stale-revision (`workspaceRevisionConflict`) response reloads the latest projection and only
  retries the mutation when it is safely idempotent (§5.3.10); a non-idempotent stale mutation
  surfaces to the user instead of silently retrying.
- Vitest tests: projection normalization from a fixture matching §5.3.15's example JSON,
  revision-conflict reload/no-silent-retry behaviour, and a test asserting a workspace mutation
  leaves previously stored directory entries untouched.

## Implementation Notes
- Keep workspace command dispatch in `features/workspace/`, not inside pane/table components (§35).
- This extends the `FileManagerClient` interface itself, the same pattern task 0036 uses for
  operations — update the `NotImplementedError` owning-task references for these new methods in the
  HTTP/mock/Tauri adapters if they were stubbed with a stale task number before this task lands.

## Agent Notes
- Not started.
