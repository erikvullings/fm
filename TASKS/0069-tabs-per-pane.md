# 0069 Tabs per pane

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0080, 0050

## Context
`file-manager-coding-agent-spec.md` §16 milestone 3, §5.3 (`PaneState` already holds a list of tabs)
and §37.

## Acceptance Criteria
- `Ctrl/Cmd+T` opens a new tab in the active pane at the current location; `Ctrl/Cmd+W` closes the
  active tab (never the last one without confirmation).
- Tab strip shows each tab's directory name with a tooltip of the full path, supports reordering by
  drag, and shows an overflow affordance when tabs exceed the width.
- Each tab keeps its own location, navigation history, sort, filter, cursor and selection.
- Switching tabs is instant: the previous snapshot is reused if still valid, otherwise refetched,
  and pending requests for a hidden tab are cancelled.
- Tabs persist across restarts via the `AddTab`/`CloseTab`/`ActivateTab` workspace commands (0080),
  including per-tab history.
- Keyboard: cycle tabs, jump to tab N, reopen last closed tab.
- Vitest tests: tab lifecycle, per-tab state isolation, persistence round-trip.

## Implementation Notes
- The backend tab model was refined by 0078 (renamed/extended `TabState`) and gained a real
  command surface in 0080 (`AddTab`/`CloseTab`/`ActivateTab`) — this task consumes that surface
  rather than inventing its own persistence, so it should need no further domain redesign; if it
  does, that is a signal worth recording in the notes.
- Directory watchers must be released for tabs that are closed (0020).

## Agent Notes
- Not started.
