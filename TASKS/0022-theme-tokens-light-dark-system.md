# 0022 CSS variable themes: light, dark and follow-system

Status: open
Priority: medium
Owner: unassigned
Agent: unassigned
Area: frontend
Depends on: 0002

## Context
`file-manager-coding-agent-spec.md` §14 ("Themes" and "Visual direction"). The UI must be polished,
compact, keyboard-first, information-dense and consistent across macOS and Windows.

## Acceptance Criteria
- `frontend/src/themes/` defines the design tokens listed in §14: `--fm-background`, `--fm-surface`,
  `--fm-surface-elevated`, `--fm-text`, `--fm-text-muted`, `--fm-border`, `--fm-accent`,
  `--fm-selection`, `--fm-selection-inactive`, `--fm-hover`, `--fm-error`, `--fm-warning`,
  `--fm-success`, `--fm-row-height`, `--fm-font-family`, `--fm-font-size`, `--fm-radius`,
  `--fm-shadow`.
- Light and dark themes plus a follow-system mode driven by `prefers-color-scheme`, switchable at
  runtime without reload.
- `mithril-materialized` is themed from the same tokens so dialogs and forms match the panes.
- No component hard-codes a colour (§14); a test or lint rule greps the component sources for hex
  colours and fails on new ones.
- Contrast of text on surface and of selection states meets WCAG AA (§29); documented in
  `docs/architecture/theming.md`.
- `prefers-reduced-motion` disables transitions (§29).

## Implementation Notes
- Distinct `--fm-selection` vs `--fm-selection-inactive` matters: the inactive pane must show its
  selection dimmed, not hidden.
- Selection and cursor must be distinguishable without colour alone (§29) — plan for a border or
  marker as well.

## Agent Notes
- Not started.
