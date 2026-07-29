# 0036 Operations API and operation centre UI

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0035, 0033

## Context
`file-manager-coding-agent-spec.md` §8 (operation endpoints), §14 (operation centre in the main
window) and §36 item 5.

## Acceptance Criteria
- REST endpoints with stable operation ids:
  - `GET /api/v1/operations` → `listOperations`
  - `POST /api/v1/operations` → `startOperation`
  - `GET /api/v1/operations/{operationId}` → `getOperation`
  - `POST /api/v1/operations/{operationId}/cancel` → `cancelOperation`
  - `POST /api/v1/operations/{operationId}/pause` → `pauseOperation`
  - `POST /api/v1/operations/{operationId}/resume` → `resumeOperation`
  - `POST /api/v1/operations/{operationId}/resolve-conflict` → `resolveOperationConflict`
- `startOperation` accepts the semantic request shape from §7 (`type`, `sources`, `destination`,
  `conflictPolicy`) and honours an idempotency key so a retried request does not start a second job
  (§8).
- Equivalent Tauri commands exist (§11) and share the same service methods.
- `FileManagerClient` gains `startOperation`, `cancelOperation`, `resolveConflict`, `listOperations`
  across all three adapters.
- Operation centre UI in `features/operations/`: queued/running/paused/completed/failed operations
  with per-operation progress, rate, current entry, and cancel/pause/resume controls.
- Progress updates arrive via events and are batched; the UI does not poll.
- Completed operations remain visible with their result until dismissed; failures show the
  user-readable message plus a details expander.
- Vitest tests for progress reducer and operation centre states; Rust integration test starts a
  no-op operation and observes the full event sequence.

## Implementation Notes
- The frontend issues semantic operations only and never enumerates or copies files itself
  (§7, §35).
- Reserve the conflict endpoint's DTO now; the dialog lands in 0045.

## Agent Notes
- Not started.
