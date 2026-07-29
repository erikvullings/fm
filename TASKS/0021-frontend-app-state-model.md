# 0021 Frontend application state model

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0011

## Context
`file-manager-coding-agent-spec.md` §13: a small, explicit state model rather than a large generic
state-management framework (§35 forbids introducing one without demonstrated need).

## Acceptance Criteria
- `frontend/src/state/` defines `AppState` with `runtime`, `workspace`, `operations`, `plugins`,
  `notifications` and `connection` slices, all strongly typed and readonly.
- Updates are patch-based and immutable; major snapshots are replaced wholesale rather than mutated
  (§13).
- High-frequency updates (operation progress, directory deltas) are batched before redraw, with a
  single scheduling primitive used by every producer (§13, §28).
- Entries are keyed by stable `EntryId` throughout (§13).
- Application logic lives in state/actions modules, not in Mithril components (§35).
- Vitest tests cover: patch application, immutability of prior snapshots, batching (N updates in one
  frame produce one redraw), and slice reducers in isolation.

## Implementation Notes
- Use Meiosis (`m.stream` + Mergerino) per the local `meiosis` skill; record the choice in ADR 7
  (task 0005).
- Avoid a global redraw for every file-list event (§13) — prefer targeted subscriptions in the
  table component (0024).

## Agent Notes
- Not started.
