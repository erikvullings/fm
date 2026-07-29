# 0007 Transport DTOs and OpenAPI schemas

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: backend
Depends on: 0006

## Context
`file-manager-coding-agent-spec.md` §8 and §9 require versioned JSON DTOs documented with `utoipa`.
Rule 5 of §3 forbids reusing transport DTOs indiscriminately as internal domain models, so DTOs
live in `fm-transport-dto` with explicit conversions from/to `fm-domain`.

## Acceptance Criteria
- `fm-transport-dto` defines DTOs for the milestone-1 surface: `RuntimeCapabilitiesDto`,
  `WorkspaceDto`, `PaneStateDto`, `TabStateDto`, `LocationDto`, `EntrySummaryDto`,
  `DirectorySnapshotDto`, `ListDirectoryRequest`, `NavigateRequest`, `EntryMetadataRequest`,
  `EntryMetadataDto`, and the error DTO from §8.
- All DTOs derive `Serialize`, `Deserialize`, `ToSchema`, use `#[serde(rename_all = "camelCase")]`
  and RFC 3339 timestamps.
- Tagged unions use string discriminators (`#[serde(tag = "type", rename_all = "camelCase")]`).
- `ApplicationErrorDto { code, message, requestId, details }` matches the example in §8; codes are a
  closed enum with stable camelCase names and never leak raw OS error strings.
- `From`/`TryFrom` conversions between domain types and DTOs, with unit tests round-tripping each
  DTO through JSON and asserting the exact camelCase field names.
- Important schemas carry `#[schema(example = ...)]` values (§9).

## Implementation Notes
- Reserve naming for endpoints not yet implemented (operations, actions, plugins, settings) but do
  not add DTOs without a consumer (§35 — no speculative abstractions).
- `fm-transport-dto` may depend on `fm-domain` and `utoipa`, never the reverse.

## Agent Notes
- Not started.
