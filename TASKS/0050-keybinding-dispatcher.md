# 0050 Configurable keybinding dispatcher

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0049, 0030

## Context
`file-manager-coding-agent-spec.md` §15 ("make all keybindings configurable through the action
system"), §29 (platform modifiers) and §36 item 8.

## Acceptance Criteria
- A single dispatcher in `frontend/src/keybindings/` maps key events to action ids; no component
  registers its own global key handler.
- Default bindings come from the action registry's `default_shortcuts`; user overrides come from
  settings (0030) and win.
- The full §15 key table is bound: cursor/selection keys (0028), `F2` rename, `F5` copy, `F6` move,
  `F7` create directory, `F8`/`Delete` delete/trash, `Ctrl/Cmd+P` palette, `Ctrl/Cmd+L` location,
  `Ctrl/Cmd+F` filter, `Ctrl/Cmd+T` new tab, `Ctrl/Cmd+W` close tab.
- Platform-correct modifiers (Command on macOS, Control on Windows/Linux) resolved in one place.
- Context scoping: bindings only fire in the scope they belong to (table vs path input vs modal);
  typing in an input never triggers a file action.
- Conflicting bindings are detected and surfaced in settings rather than silently shadowing.
- Browser-reserved shortcuts that cannot be intercepted are flagged as unavailable in browser mode
  and can differ from desktop mode (§15).
- Function-key bar (0026) renders the live bindings.
- Vitest tests: resolution order (user > default), platform modifiers, scoping, conflict detection.

## Implementation Notes
- The dispatcher is a pure function from (key event, context) → action id, so it is testable without
  a DOM.
- Keybinding editing UI can be minimal for now; the settings round-trip is what matters.

## Agent Notes
- Not started.
- 2026-07-31 codex: This task is a prerequisite for 0083. Keep conflict detection, platform/browser
  availability and editable binding state behind reusable feature APIs so the settings editor can
  render them without duplicating dispatcher logic.
