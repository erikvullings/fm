# 0026 Two-pane workspace layout and pane focus

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0025

## Context
`file-manager-coding-agent-spec.md` §14 (main window) and §36 item 3. The engine must not hard-code
exactly two panes (§5.3), but the first UI shows two.

## Acceptance Criteria
- Main window layout matches §14: application bar, workspace toolbar row, left/right panes,
  operation centre area (placeholder until 0036), optional function-key bar.
- Two panes side by side with a draggable splitter; the split ratio persists (0030).
- Exactly one pane is active; `Tab` switches panes and focus follows, with visible focus (§29).
- Clicking anywhere in a pane makes it active.
- The layout is driven by `WorkspaceLayout` from the backend workspace model, so a future
  three-pane layout needs no component rewrite.
- Window resize keeps both panes usable down to a reasonable minimum width.
- Vitest tests cover: pane activation, `Tab` switching, splitter constraints.

## Implementation Notes
- The function-key/action bar can render placeholder labels (F5 Copy, F6 Move, ...) that become live
  once the action registry lands (0050).
- Operation centre area is a stub that 0036 fills in.

## Agent Notes
- Not started.
