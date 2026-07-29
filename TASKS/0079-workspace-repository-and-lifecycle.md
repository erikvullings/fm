# 0079 Workspace repository, validation and default-workspace lifecycle

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0078

## Context
`file-manager-coding-agent-spec.md` §5.3.2, §5.3.6, §5.3.7, §5.3.8 and §5.3.16 items 1–4, 9 and 12.
This gives `fm-application` its first real `WorkspaceService`/`WorkspaceRepository` pair — today
`FileManagerService` only implements `runtime_capabilities` and explicitly defers workspaces (see
`crates/fm-application/src/service.rs`).

## Acceptance Criteria
- `WorkspaceRepository` trait per §5.3.8: `list`, `load`, `save(workspace, expected_revision)`,
  `delete(id, expected_revision)`, returning a typed `WorkspaceError`.
- An in-memory implementation for tests, then a persistent implementation using versioned JSON
  files under the platform config directory (`directories`/`dirs` crate) with atomic writes (temp
  file + rename). This storage choice is made independently of task 0030's settings storage to
  avoid a circular dependency between the two tasks; note in Agent Notes if a later task
  consolidates them onto one mechanism (e.g. SQLite).
- `Workspace::validate()` checks every invariant in §5.3.6 (all 14 items) and returns structured,
  itemized validation errors rather than one opaque failure.
- A `schema_version` + migration chain for `Workspace` itself (distinct from the general settings
  schema in 0030); a test migrates a v0 fixture forward to the current version.
- Default-workspace creation: one workspace named `Default`, two panes in a 50/50 horizontal split,
  one tab per pane, the home directory (or a configured secondary location for the second pane) as
  the initial location. Home-directory resolution goes through a small platform seam (e.g. the
  `dirs` crate) rather than a hard-coded per-OS path; richer platform integration is deferred to
  0058/0059/0060.
- Startup lifecycle per §5.3.7: load workspace summaries plus the last-active workspace id, select
  an explicitly requested workspace or else the last-active one or else create the default, validate
  and migrate, build the runtime object, open active tabs first and lazily load inactive tabs,
  without blocking the application shell until every tab is loaded.
- Corrupt or unreadable workspace data never crashes startup: the bad file is backed up and a valid
  default is substituted, mirroring 0030's settings recovery behaviour, with a surfaced notification
  hook the frontend can display later.
- Unit tests: one failing case per invariant (14 total), default-workspace shape, migration,
  revision monotonicity, corrupt-file recovery.

## Implementation Notes
- Lives in `fm-application` (`WorkspaceService` + `WorkspaceRepository`), depending only on
  `fm-domain` — no Axum/Tauri dependency (§3 rule 4).
- Reuse `fm-domain`'s refined types from 0078 directly; do not reintroduce a parallel DTO here —
  DTO/REST/Tauri wiring is task 0080's concern.
- This task does not yet expose the semantic `WorkspaceCommand` mutation API (0080) or events
  (0081); it only owns storage, validation and the create/load/list/delete lifecycle.

## Agent Notes
- Not started.
