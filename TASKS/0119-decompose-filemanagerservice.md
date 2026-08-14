# 0119 Decompose FileManagerService into capability sub-services

Status: in_progress
Priority: high
Subsystem: backend
Depends on: none

## Context

The ` FileManagerService` facade (`crates/fm-application/src/service.rs`) has grown to ~5,800 lines, combining operation executor construction, plugin management, settings CRUD, search coordination, connection DTO conversion, file editing, archive operations, action invocation, workspace lifecycle, and icon serving. The interface is the entire struct (~40+ public methods), making the module shallow: understanding any one capability requires navigating the whole monolith.

This is the central architectural friction point in the Rust codebase. See `/improve-codebase-architecture` skill findings for the full analysis.

## Acceptance Criteria
- `FileManagerService` reduced to a thin composition layer (target: <500 lines)
- Each capability cluster (operations, file editing, plugins, connections, search) extracted into its own deep module with a small, well-defined interface
- All extracted modules have their own test coverage — not just unit tests, but tests through the module's interface
- No behavioural changes visible to callers (Axum routes, Tauri commands, CLI)
- All existing integration tests pass
- Zero compiler warnings after the refactor

## Implementation Notes
- Strategic modules emerge naturally: `OperationOrchestrator`, `FileEditorService`, `ConnectionFacade`, `PluginManager`, and settings delegation
- The facade shrinks to field declarations + delegation calls
- Follow the pattern already established by `ConnectionService` (deep, ~970 lines, well-tested, ~20 tests) and `DirectoryService` (deep, ~1072 lines, well-tested)
- This task is the parent; subtasks 0120-0125 each extract one capability. This task coordinates and ensures the composition layer is correct after all subtasks land.

## Agent Notes

- 2026-08-14: Picked this up after confirming (via `wc -l`) the facade was still ~3,836 lines
  despite subtasks 0120–0125 all being done — the composition layer itself was never actually
  thinned. First extraction pass in this session:
  - New module `crates/fm-application/src/operation_history.rs` (302 lines): moved
    `OperationHistory` (crash-safe operation-snapshot persistence beside settings, prune/save,
    restart-recovery marking in-flight operations as `Interrupted`), `ApplicationOperationObserver`
    (bridges the scheduler's `OperationSnapshotObserver` callback to both history persistence and
    refreshing affected directory listings), and the pure `operation_dto`/`operation_result_summary`
    conversion functions they depend on. This cluster was fully self-contained (only real dependency
    was `DirectoryService`, already public from the crate root) and had exactly one dedicated unit
    test (`restarted_service_restores_inflight_history_as_interrupted`, left in `service.rs`'s test
    module since it exercises `FileManagerService::new` end-to-end, not `OperationHistory` in
    isolation — appropriate as a facade-level integration test).
  - `service.rs`: 3,836 → 3,555 lines. Added `ApplicationOperationObserver::new(...)` constructor
    (the old code built it via a public-field struct literal, which no longer works once the fields
    are private to the new module). Fixed all resulting import fallout (`OperationSnapshotObserver`,
    `HashSet`, `std::io::Write` no longer needed at the top level; `OperationStateDto` moved into the
    test module's own `use`, since every usage was test-only and caused an unused-import warning in
    non-test builds otherwise).
  - Verified: `cargo build -p fm-application --tests` zero warnings, `cargo clippy -p fm-application
    --all-targets -- -D warnings` clean, `cargo fmt -p fm-application` clean, `cargo test -p
    fm-application --lib` 183/183 passing (including the moved-behavior test), `cargo test -p
    fm-application` (all integration test binaries) all green, `cargo build --workspace` clean.
  - **Not done**: the facade is still ~3,555 lines against the <500-line target — this single pass
    is real but modest progress (~7% reduction), not the full decomposition. Left `Status:
    in_progress` rather than `done`; do not mark this task done until the line-count target is
    actually met.
  - **What's left in `service.rs`, roughly in extraction-priority order**:
    1. A cluster of ~15 free-standing pure mapping/conversion functions (~400 lines, currently
       lines ~1460–1860): `map_scheduler_error`, `copy_request`, `delete_request`,
       `comparison_entry_side_dto`, `comparison_entry_dto`, `sync_plan_item_dto`, `operation_kind`,
       `mutating_operation_kind`, `platform_action_kind`, `map_platform_error`,
       `map_file_icon_error`, `settings_to_dto`, `settings_from_dto`, `detect_platform`. Same shape
       as the just-extracted `operation_dto` — no `self` dependency, straightforward to move to a
       `service_mappings.rs` (or split further: settings mapping vs. comparison mapping vs. platform
       mapping are three unrelated concerns bundled only by "free function in this file").
    2. The `impl FileManagerService` block itself (~1,330 lines) is where the real facade-shrinking
       work is: per the Implementation Notes below, capability clusters like search/comparison
       coordination (`start_search`/`cancel_search`/`start_comparison`/`generate_sync_plan`/
       `apply_sync_plan`, currently thin-ish wrappers already delegating to `fm-search`/
       `fm-comparison` engines — check whether they're thin enough to leave as delegation or need
       a coordinating module of their own) and action invocation (`invoke_action`, ~125 lines) are
       the biggest remaining named clusters that don't yet have a dedicated module the way
       operations/file-editing/connections/plugins already do.
    3. **The `#[cfg(test)]` block is ~1,690 of the file's ~3,555 lines** (from `mod tests` at
       ~line 1863 to EOF) — this is the elephant in the room for hitting <500 lines. Reaching the
       target requires moving each extracted capability's tests into that capability's own module
       alongside the code (as this pass did for the one `OperationHistory`-specific test), not just
       shrinking the non-test code. Facade-level integration tests (constructing a real
       `FileManagerService` end-to-end) belong in `service.rs`; anything testing one capability in
       isolation should move with that capability.
  - Stopped here for this session rather than chaining further extractions without re-verifying
    each one — each subsequent pass should follow the same pattern (extract self-contained cluster
    → new module → fix imports → `cargo build --tests` zero warnings → `clippy -D warnings` → `fmt`
    → `cargo test -p fm-application --lib` and the full integration suite → `cargo build --workspace`)
    before moving to the next cluster, rather than batching multiple extractions unverified.
