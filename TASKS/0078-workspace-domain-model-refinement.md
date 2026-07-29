# 0078 Workspace domain model refinement (spec §5.3)

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0006

## Context
`file-manager-coding-agent-spec.md` §5.3.2–§5.3.5 were fleshed out in much more detail after task
0006 shipped `fm-domain`'s workspace types. This task reconciles the two — 0006's own Agent Notes
flagged this exact possibility ("to be revisited if a later task's contract disagrees"). Two
concrete deviations matter beyond naming:

- §5.3.3 explicitly forbids one structure mixing persisted configuration with temporary UI state,
  but today's `DirectoryViewState` (in `fm-domain`) mixes the persisted `sort` field with
  frontend-session-only `selected_entry_ids`/`cursor_entry_id` inside the same type that gets
  serialized as part of a `Workspace` — meaning selection/cursor would currently be persisted to
  disk if a workspace were saved as-is.
- `fm-transport-dto`'s `WorkspaceLayoutDto::Pane` is already a named `{ pane_id }` struct variant
  (task 0007), but the underlying domain `WorkspaceLayout::Pane(PaneId)` is a tuple variant — 0007's
  own Agent Notes already called out this mismatch.

## Acceptance Criteria
- `Workspace` gains `schema_version: u32`, `created_at`/`updated_at: DateTime<Utc>`, `revision: u64`
  and `operation_centre: OperationCentrePreferences { visible: bool, height: u32 }` (§5.3.3,
  §5.3.15 example).
- `PaneState` gains `title: Option<String>` and a pane-level `default_view: DirectoryViewConfiguration`
  (§5.3.4).
- The persisted per-tab view configuration (`sort`, `columns`, `show_hidden`, `folders_first`,
  `quick_filter`) moves into its own `DirectoryViewConfiguration` type that is `Serialize`/
  `Deserialize` and contains **no** frontend-only fields; `selected_entry_ids` and `cursor_entry_id`
  are removed from anything that gets persisted as part of a workspace (§5.3.3) — they belong to
  the frontend-only `WorkspaceViewState`, which stays a TS-only concept (0082), not a Rust domain
  type.
- `ColumnConfiguration { column_id: String, width: u32, visible: bool }` backs
  `DirectoryViewConfiguration.columns` (§5.3.4, §5.3.15 example).
- `TabState` gains `title_override: Option<String>` and `pinned: bool` (§5.3.4).
- `NavigationHistory` gains an explicit `current: Location` field alongside `back`/`forward`
  matching §5.3.4's shape, or the deviation (keeping `TabState.location` as the sole current-location
  source of truth) is explicitly documented as a considered choice rather than an oversight.
- `WorkspaceLayout::Pane` becomes a struct variant with a named `pane_id: PaneId` field (not a tuple
  variant), and `SplitDirection` is renamed `SplitAxis` with `Horizontal`/`Vertical` variants,
  matching §5.3.5 — verified by a test that the JSON shape is byte-for-byte the §5.3.5/§5.3.15
  examples (`{"type":"pane","paneId":"..."}`).
- `fm-transport-dto`'s existing `From`/`Into` conversions (0007) still compile and round-trip after
  the rename — update them rather than duplicating logic.
- Unit tests: serde round-trip of the full refined `Workspace` against the literal §5.3.15 JSON
  example; a test proving `DirectoryViewConfiguration` cannot represent selection/cursor state.
- `cargo clippy --workspace --all-targets -- -D warnings` and `missing_docs` stay clean; every
  renamed/added field is documented.

## Implementation Notes
- This renames types shipped by task 0006 (already `done`) and consumed by 0007's DTOs — search
  the workspace for `Workspace`, `PaneState`, `TabState`, `WorkspaceLayout::Pane(`, `SplitDirection`
  before renaming (an IDE symbol rename keeps call sites in sync); update `fm-transport-dto`'s
  conversions in the same change.
- Do not add a Rust type for `WorkspaceViewState` — it is frontend-only per §5.3.3.
- Keep this task scoped to `fm-domain` (plus the minimal `fm-transport-dto` conversion fixups it
  forces); new DTO fields/endpoints for the command surface are task 0080's concern.

## Agent Notes
- Not started.
