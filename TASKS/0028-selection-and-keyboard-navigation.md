# 0028 Selection model and keyboard navigation

Status: done
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0027

## Context
`file-manager-coding-agent-spec.md` §15 ("keyboard behaviour") and §27 (the selection reducer and
keyboard navigation are named frontend test targets). Selection is independent of the cursor.

## Acceptance Criteria
- A pure selection reducer in `features/selection/` supporting: cursor movement, single selection,
  range selection, discontinuous selection, select all, invert selection, and clearing.
- Selection survives sorting and filtering (keyed by `EntryId`), and is pruned when entries
  disappear via a delta.
- Keyboard bindings from §15 implemented for navigation and selection:
  `Up/Down`, `PageUp/PageDown`, `Home/End`, `Enter`, `Backspace`, `Tab`, `Space`,
  `Shift+Arrow`, `Ctrl/Cmd+A`.
- Type-to-select jumps to the first entry matching the typed prefix, with a timeout reset.
- Platform-appropriate modifiers: Command on macOS, Control on Windows/Linux (§29).
- Browser-reserved shortcuts that cannot be intercepted reliably are avoided or remapped (§15).
- Vitest tests cover every reducer transition and each key binding, including range selection across
  a sort change.

## Implementation Notes
- The reducer is pure and independent of Mithril so it is trivially testable (§27).
- Keybindings are hard-coded here but must route through the action system once 0050 lands; define
  the action ids now (`core.selectAll`, `core.invertSelection`, ...) to avoid rework.

## Agent Notes
- 2026-07-31 codex: Added a pure stable-`EntryId` selection reducer under
  `features/selection/` for independent cursor movement, single/range/discontinuous selection,
  select all, invert, clear, and explicit delta pruning. Range anchors remain stable across
  reordered visible entries, while filtered-out selections remain selected.
- 2026-07-31 codex: Added typed semantic key interpretation with reserved `core.*` action IDs,
  runtime-capability platform modifiers, viewport/edge movement, Shift+Arrow extension, Space
  toggling, Ctrl/Cmd+A, and 700 ms prefix type-to-select. Integrated it with per-pane AppShell
  state while preserving task 0027's Enter, Backspace, history, and workspace Tab behavior.
- 2026-07-31 codex: Verified 28 dedicated reducer/keybinding cases and 4 task-specific pane/AppShell
  integration cases by rerunning their five Vitest files. Frontend typecheck and production build,
  repository-wide formatting/clippy/Biome lint, and the full Rust/frontend/script `pnpm test`
  suite pass. No `CLAUDE.md` exists to update; README documents the added keyboard and selection
  surface.
