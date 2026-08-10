# 0120 Extract Operation Planner module

Status: open
Priority: high
Subsystem: backend
Depends on: 0119

## Context

`FileManagerService::start_operation()` (lines ~515-888, ~370 lines) is a giant `match` over `OperationKind` that eagerly resolves providers, checks capabilities, and constructs executor structs inline. The executors (`CopyExecutor`, `MoveExecutor`, `DeleteExecutor`, `CreateArchiveExecutor`, etc.) are private structs embedded in the same file, impossible to test independently. All executor construction bugs can only be found by exercising the full service.

The **deletion test** confirms: deleting this `match` block would scatter the complexity (provider resolution, capability checking, executor construction) across every caller. Concentrating it into an `OperationPlanner` module creates a deep seam.

## Acceptance Criteria
- `OperationPlanner` module in `crates/fm-application/src/operation_planner.rs` with a single interface: `plan(kind, request) -> Result<Arc<dyn OperationExecutor>, ApplicationError>`
- All executor structs (`CopyExecutor`, `MoveExecutor`, `DeleteExecutor`, `CreateArchiveExecutor`, `TrashExecutor`, etc.) moved into the planner module
- Provider resolution and capability checking contained within the planner
- Tests for every executor construction path — including move copy+delete fallback, archive format inference, capability rejection — exercisable without bootstrapping `FileManagerService`
- `FileManagerService::start_operation()` reduced to: call planner, submit to scheduler, handle idempotency
- Zero behavioural changes

## Implementation Notes
- The planner needs access to: `ProviderRegistry`, `ArchiveFileSystemProvider`, `PlatformAdapter` (for trash), `Settings` (for delete confirmation flag), `audit_log_path`
- These are passed to the planner constructor, not leaked through the interface
- The idempotency map and scheduler interaction stay in `FileManagerService` — they're orchestration concerns, not planning concerns
- Test with probe providers (existing `LateProvider` pattern from `directory.rs` is a good reference)
- ~370 lines removed from `service.rs`, concentrated into planner module

## Agent Notes
