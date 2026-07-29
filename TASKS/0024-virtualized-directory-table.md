# 0024 Virtualized directory table component

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0021, 0022, 0013

## Context
`file-manager-coding-agent-spec.md` §15 — the directory table is the critical custom component.
§35 forbids rendering large directories without virtualization. Build it against the mock client
(0013) so it can be developed and benchmarked before the real backend is wired up.

## Acceptance Criteria
- Custom Mithril component (not `mithril-materialized`, not card-based — §14) rendering only the
  visible window of rows plus a small overscan.
- Fixed row height for this version, read from `--fm-row-height`; configurable row height is later.
- Initial columns: name, extension/type, size, modified time.
- States: loading placeholders, empty, error, plus hidden-file styling and symlink/junction
  indicators.
- Renders 1,000 / 10,000 / 100,000 real entries and a 1,000,000-entry mocked dataset without
  mounting every row; a test asserts DOM node count stays bounded while scrolling.
- Scroll and keyboard cursor movement stay responsive; measured with a rendering benchmark
  committed under `frontend/src/features/directory-table/`.
- Accessibility (§29): correct grid/row/cell semantics, visible focus, accessible labels, and the
  focused row is announced; no colour-only status indicators.
- Rows are keyed by stable `EntryId` so deltas patch rows instead of re-creating them.
- Vitest tests cover windowing maths, scroll-to-index, and rendering of each state.

## Implementation Notes
- Selection, cursor and sorting behaviour are separate tasks (0028, 0029); this task provides the
  rendering surface and the cursor/selection *rendering* hooks.
- Design for later: resizable/reorderable/configurable columns, plugin columns, inline rename, drag
  source and drop target — leave the seams without implementing them (§15, §35).

## Agent Notes
- Not started.
