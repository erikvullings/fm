# 0119 Decompose FileManagerService into capability sub-services

Status: open
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
