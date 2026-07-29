# 0006 Core domain model in fm-domain

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0001

## Context
Implement the core domain model from `file-manager-coding-agent-spec.md` §5. These types are the
foundation for every later crate and must not depend on Axum, Tauri or transport DTOs.

## Acceptance Criteria
- Strongly typed newtype identifiers with `Display`, `FromStr`, `Serialize`/`Deserialize`:
  `WorkspaceId`, `PaneId`, `TabId`, `EntryId`, `OperationId`, `ProviderId`, `PluginId`, `ActionId`.
- `Location { provider_id, uri }` is serializable, round-trips through string form, and preserves
  platform-specific paths (§5.1). Parsing itself is task 0017; this task defines the type and its
  invariants.
- `EntryKind`, `EntrySummary` exactly as in §5.2, with `Option` fields for metadata that may be
  unavailable.
- `Workspace`, `PaneState`, `TabState`, `NavigationHistory`, `DirectoryViewState`,
  `WorkspaceLayout` per §5.3 — with no hard-coded assumption of exactly two panes.
- `DirectorySnapshot`, `DirectoryDelta`, `LoadingState` per §5.4.
- `EntryMetadata` for the detailed (non-eager) metadata described in §5.2.
- Unit tests for id round-tripping, `Location` serialization and snapshot/delta serde stability.
- Crate has no dependency on `axum`, `tauri`, `reqwest` or `utoipa`.

## Implementation Notes
- Timestamps are `chrono::DateTime<Utc>`; serialization uses RFC 3339 (§8).
- `metadata_revision` and snapshot `revision` are monotonic `u64` used for stale-response rejection.
- Document every public item (§35).

## Agent Notes
- Not started.
