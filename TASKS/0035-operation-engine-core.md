# 0035 Operation engine core: jobs, scheduler, progress

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0031, 0018

## Context
`file-manager-coding-agent-spec.md` §17 and §33 step 7. Every mutating operation is a job owned by
the Rust engine (§3 rules 6 and 8). This task builds the machinery; individual operation kinds land
one at a time in 0037–0044.

## Acceptance Criteria
- `fm-operations` defines `Operation`, `OperationState`, `OperationKind`, `OperationProgress` and
  `ConflictPolicy` exactly as in §17.
- A scheduler runs operations with configurable concurrency (from settings), tracks state
  transitions, and rejects illegal transitions with a typed error.
- Two phases per operation: planning (enumerate work, compute totals) then execution, so
  `total_items`/`total_bytes` are known before progress is reported where feasible.
- Progress events are throttled/coalesced (e.g. at most ~10/s per operation) before publication
  (§28).
- `bytes_per_second` is a smoothed rate, not an instantaneous spike.
- Every operation is cancellable at a safe point; cancellation leaves no partial destination file
  (see 0046 for the full cancellation surface).
- Safety pre-checks shared by all operations (§17): source == destination, destination inside
  source, case-only differences on case-insensitive filesystems, symlink cycles, and a refusal to
  replace a directory with a file or vice versa.
- Operations are published as `operation.created` / `operation.stateChanged` / `operation.progress`
  / `operation.completed` / `operation.failed` events.
- Unit tests for state machine transitions, planning totals, throttling, and each safety pre-check.
- No operation kind is executable yet — a `NotImplemented` operation kind is fine for testing the
  scheduler.

## Implementation Notes
- Do not implement all operations in one unreviewable change (§33 step 7).
- Structured tracing per operation with `operation_id` (§30).
- Design the plan step so it can later be persisted for crash-safe history (§37).

## Agent Notes
- Not started.
