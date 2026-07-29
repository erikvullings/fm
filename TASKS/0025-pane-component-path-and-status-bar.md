# 0025 Pane component: tab strip, breadcrumb path bar and status bar

Status: open
Priority: high
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0024

## Context
`file-manager-coding-agent-spec.md` §14 (main window layout) and §33 step 5. A pane composes a tab
bar, a breadcrumb/path input, the directory table and a status bar.

## Acceptance Criteria
- `features/panes/` provides a `Pane` component containing: tab strip (single tab for now),
  breadcrumb path bar, directory table, status bar.
- The breadcrumb shows each path segment as a clickable target and switches to an editable text
  input on click or `Ctrl/Cmd+L`, with `Esc` to cancel and `Enter` to navigate.
- Path input accepts absolute paths, `~`, and paths with spaces; invalid paths show an inline error
  without clearing the current view.
- Status bar shows: entry count, selected count, selected size, and the current sort.
- The active pane is visually distinct; the inactive pane shows dimmed selection
  (`--fm-selection-inactive`).
- Compact, information-dense layout per §14 "visual direction"; no card-heavy styling.
- Vitest tests cover breadcrumb segment generation (including root and UNC cases), edit-mode
  toggling, and status bar counters.

## Implementation Notes
- The pane holds presentation state only; all filesystem state comes from the backend (§3 rule 8).
- Tab strip renders one tab now; multi-tab behaviour is task 0069.

## Agent Notes
- Not started.
