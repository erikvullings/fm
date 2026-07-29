# 0066 Accessibility review

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0051, 0045

## Context
`file-manager-coding-agent-spec.md` §29 and §37 (accessibility review is part of polished
version 1).

## Acceptance Criteria
- Full keyboard-only operation verified for every MVP flow: navigate, select, copy, move, rename,
  delete, resolve a conflict, use the command palette, change theme.
- Visible focus everywhere, including inside the virtualized table; the focused row remains
  understandable while scrolling (§29).
- Semantic roles and accessible labels for panes, table, toolbar, dialogs and the operation centre.
- Modal dialogs trap focus correctly and return focus on close (§29).
- Screen-reader pass on macOS (VoiceOver) and Windows (Narrator) for the main flows, with findings
  recorded.
- Reduced-motion preference respected; text scales without breaking the layout.
- Contrast meets WCAG AA in both themes; no status conveyed by colour alone (§29).
- Findings are either fixed here or filed as follow-up tasks with numbers referenced in the notes.
- `docs/architecture/accessibility.md` records what was tested, with what, and what is outstanding.

## Implementation Notes
- Automated checks (axe-core in a Vitest/browser test) catch the mechanical issues; the virtualized
  table and keyboard flows need manual verification.

## Agent Notes
- Not started.
